import { DurableObject } from 'cloudflare:workers'
import {
	drizzle,
	type DrizzleSqliteDODatabase,
} from 'drizzle-orm/durable-sqlite'
import { migrate } from 'drizzle-orm/durable-sqlite/migrator'
import {
	schema,
	registerTenantDb,
	registerTenantDbTransactionRunner,
	runInTenantOrgScope,
	unregisterTenantDb,
	TENANT_ORG_ID_PATTERN,
	type TenantDatabase,
} from '@repo/tenant-db'
import { durableSqliteMigrations } from './migrations.generated.ts'
import { createTenantApiApp } from '../src/app.ts'
import { applyVarlockEnv } from '../src/lib/secrets.ts'
import {
	armStaffAlarm,
	handleStaffAlarm,
	isStaffActivityPath,
} from '../src/lib/staff-alarm.ts'
import { runStaffTickForOrg } from '../src/services/staff-tick-service.ts'
import type { TenantApiWorkerEnv } from './bindings.ts'

export const TENANT_ORG_HEADER = 'X-Epic-Tenant-Org-Id'

/**
 * Written by `deprovision()` after the wipe and cleared only by `provision()`.
 * Without it, any later request (a queued event, a stale browser token, the
 * staff alarm) would run the migrations again and quietly rebuild an empty
 * database for an organization that was deleted or moved to another region.
 */
export const DEPROVISIONED_TOMBSTONE_KEY = 'tenant:deprovisioned'

export class TenantDbDeprovisionedError extends Error {
	constructor() {
		super('Tenant database is deprovisioned')
		this.name = 'TenantDbDeprovisionedError'
	}
}

export class TenantOrg extends DurableObject<TenantApiWorkerEnv> {
	private db: DrizzleSqliteDODatabase<typeof schema> | null = null
	private readonly app = createTenantApiApp()
	private orgId: string | null = null

	private getOrgId() {
		if (!this.orgId) {
			throw new Error('TenantOrg orgId is not set')
		}
		return this.orgId
	}

	private async ensureDb() {
		if (this.db) return this.db
		if (await this.ctx.storage.get(DEPROVISIONED_TOMBSTONE_KEY)) {
			throw new TenantDbDeprovisionedError()
		}

		const db = drizzle(this.ctx.storage, { schema })
		// Drizzle's `db.transaction` is `transactionSync` here and does not await
		// async callbacks, so multi-step writes use the async storage transaction.
		registerTenantDbTransactionRunner(db, (fn) =>
			this.ctx.storage.transaction(fn),
		)
		this.db = db
		await migrate(this.db, durableSqliteMigrations)
		return this.db
	}

	async provision() {
		await this.ctx.storage.delete(DEPROVISIONED_TOMBSTONE_KEY)
		await this.ensureDb()
	}

	async deprovision() {
		// `deleteAll` leaves a pending alarm in place, and a woken object would
		// then tick against a database that no longer exists.
		await this.ctx.storage.deleteAlarm()
		await this.ctx.storage.deleteAll()
		await this.ctx.storage.put(DEPROVISIONED_TOMBSTONE_KEY, Date.now())
		if (this.orgId && this.db) {
			unregisterTenantDb(this.orgId, this.db as unknown as TenantDatabase)
		}
		this.db = null
	}

	/**
	 * Registers this object's database for its org so `getTenantDb(orgId)`
	 * resolves it. The registration is per org and outlives the request, so
	 * work queued after the response (message delivery, journey emission)
	 * still finds the database, and other objects in the same isolate never
	 * see or clear it.
	 */
	private useTenantDb<T>(
		orgId: string,
		db: DrizzleSqliteDODatabase<typeof schema>,
		fn: () => Promise<T>,
	): Promise<T> {
		registerTenantDb(orgId, db as unknown as TenantDatabase)
		return runInTenantOrgScope(orgId, fn)
	}

	async fetch(request: Request): Promise<Response> {
		applyVarlockEnv(this.env)

		const orgId = request.headers.get(TENANT_ORG_HEADER)
		if (!orgId || !TENANT_ORG_ID_PATTERN.test(orgId)) {
			return Response.json(
				{ error: 'Invalid tenant org routing' },
				{ status: 400 },
			)
		}
		this.orgId = orgId

		let db: DrizzleSqliteDODatabase<typeof schema>
		try {
			db = await this.ensureDb()
		} catch (error) {
			if (error instanceof TenantDbDeprovisionedError) {
				return Response.json({ error: 'org_not_provisioned' }, { status: 404 })
			}
			throw error
		}
		const response = await this.useTenantDb(orgId, db, async () =>
			this.app.fetch(request, this.env),
		)
		await this.maybeArmStaffAlarm(request, response, orgId)
		return response
	}

	/**
	 * Arms the sub-hourly staff tick (see `src/lib/staff-alarm.ts`) when a
	 * successful request shows the organization is using the staff features, or
	 * when the hourly tick reports something still worth watching. Never throws:
	 * a failure here must not fail the request it rode on.
	 */
	private async maybeArmStaffAlarm(
		request: Request,
		response: Response,
		orgId: string,
	) {
		try {
			if (response.status >= 400) return
			const { pathname } = new URL(request.url)
			if (pathname === '/api/staff/tick') {
				const body = (await response
					.clone()
					.json()
					.catch(() => null)) as {
					result?: { needsFollowUp?: boolean }
				} | null
				if (!body?.result?.needsFollowUp) return
			} else if (!isStaffActivityPath(pathname)) {
				return
			}
			await armStaffAlarm(this.ctx.storage, orgId, Date.now())
		} catch (error) {
			console.error(
				'Staff alarm arming failed',
				error instanceof Error ? error.name : 'unknown',
			)
		}
	}

	/** The sub-hourly staff tick: runs next to the data, then re-arms if needed. */
	async alarm() {
		applyVarlockEnv(this.env)
		await handleStaffAlarm({
			storage: this.ctx.storage,
			now: Date.now(),
			runTick: async (orgId) => {
				this.orgId = orgId
				// A deprovisioned object has no alarm left; if one fires anyway it
				// fails here instead of rebuilding the database.
				const db = await this.ensureDb()
				return this.useTenantDb(orgId, db, () => runStaffTickForOrg(orgId))
			},
		})
	}
}
