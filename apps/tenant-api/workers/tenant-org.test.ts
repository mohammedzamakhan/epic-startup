import { beforeEach, describe, expect, it, vi } from 'vitest'

// The Durable Object runtime is not available under Vitest: a minimal base
// class and an in-memory storage stand in for it, and the migrator is a spy so
// the test can see when a database would be (re)built.
vi.mock('cloudflare:workers', () => ({
	DurableObject: class {
		ctx: unknown
		env: unknown
		constructor(ctx: unknown, env: unknown) {
			this.ctx = ctx
			this.env = env
		}
	},
}))
const migrate = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('drizzle-orm/durable-sqlite/migrator', () => ({ migrate }))
vi.mock('drizzle-orm/durable-sqlite', () => ({ drizzle: () => ({}) }))
vi.mock('./migrations.generated.ts', () => ({ durableSqliteMigrations: {} }))
const appFetch = vi.hoisted(() =>
	vi.fn(async () => Response.json({ ok: true })),
)
vi.mock('../src/app.ts', () => ({
	createTenantApiApp: () => ({ fetch: appFetch }),
}))
vi.mock('../src/lib/secrets.ts', () => ({ applyVarlockEnv: () => {} }))

import { TENANT_ORG_HEADER, TenantOrg } from './tenant-org.ts'

function memoryStorage() {
	const values = new Map<string, unknown>()
	return {
		values,
		get: async (key: string) => values.get(key),
		put: async (key: string, value: unknown) => void values.set(key, value),
		delete: async (key: string) => values.delete(key),
		deleteAll: async () => values.clear(),
		deleteAlarm: async () => {},
		getAlarm: async () => null,
		setAlarm: async () => {},
		transaction: async (fn: () => unknown) => fn(),
	}
}

const ORG = 'clw9x0a12000008l00test79'

function orgRequest(path = '/auth/me') {
	return new Request(`https://tenant.example.test${path}`, {
		headers: { [TENANT_ORG_HEADER]: ORG },
	})
}

describe('TenantOrg after deprovision', () => {
	beforeEach(() => {
		migrate.mockClear()
		appFetch.mockClear()
	})

	it('does not rebuild a wiped database on a later request', async () => {
		const storage = memoryStorage()
		const object = new TenantOrg({ storage } as never, {} as never)
		await object.provision()
		expect(migrate).toHaveBeenCalledTimes(1)

		await object.deprovision()
		// A fresh instance, as after eviction, must also see the tombstone.
		for (const instance of [
			object,
			new TenantOrg({ storage } as never, {} as never),
		]) {
			const response = await instance.fetch(orgRequest())
			expect(response.status).toBe(404)
			expect(await response.json()).toEqual({ error: 'org_not_provisioned' })
		}
		expect(migrate).toHaveBeenCalledTimes(1)
		expect(appFetch).not.toHaveBeenCalled()
	})

	it('serves again once provision runs', async () => {
		const storage = memoryStorage()
		const object = new TenantOrg({ storage } as never, {} as never)
		await object.provision()
		await object.deprovision()
		await object.provision()

		const response = await object.fetch(orgRequest())
		expect(response.status).toBe(200)
		expect(migrate).toHaveBeenCalledTimes(2)
	})
})
