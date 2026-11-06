import { db, eq, Organization } from '@repo/database'
import { RouterContextProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	deprovisionTenantDatabase,
	provisionTenantDatabase,
} from '#app/utils/sites/tenant-api.server.ts'
import type * as regionGuard from '#app/utils/staffing/region-guard.server.ts'
import {
	createAuthenticatedRequest,
	createTestOrganization,
	createTestSession,
	createTestUser,
} from '#tests/test-utils.ts'
import { action as websiteAction } from '../website+/_index.tsx'
import { action } from './_index.tsx'

const databaseMocks = vi.hoisted(() => ({ update: vi.fn() }))

vi.mock('@repo/database', async (importOriginal) => {
	const actual = await importOriginal<{ db: typeof db }>()
	databaseMocks.update.mockImplementation((table) => actual.db.update(table))
	return {
		...actual,
		db: new Proxy(actual.db, {
			get(target, property) {
				return property === 'update'
					? databaseMocks.update
					: Reflect.get(target, property)
			},
		}),
	}
})

vi.mock('#app/utils/sites/tenant-api.server.ts', () => ({
	provisionTenantDatabase: vi.fn(),
	deprovisionTenantDatabase: vi.fn(),
}))
vi.mock('#app/utils/sites/kv-cache.server.ts', () => ({
	purgeOrganizationSiteCache: vi.fn(),
}))
vi.mock(
	'#app/utils/staffing/region-guard.server.ts',
	async (importOriginal) => {
		const actual = await importOriginal<typeof regionGuard>()
		return {
			...actual,
			fetchStaffSummary: vi.fn().mockResolvedValue({
				staff: 0,
				byStatus: { invited: 0, active: 0, on_leave: 0, terminated: 0 },
				linkedLogins: 0,
				scopeAssignments: 0,
				positions: 0,
				payRecords: 0,
				notes: 0,
				auditEntries: 0,
			}),
		}
	},
)

beforeEach(() => {
	databaseMocks.update.mockClear()
	vi.mocked(deprovisionTenantDatabase).mockReset().mockResolvedValue({
		region: 'us',
	})
	vi.mocked(provisionTenantDatabase).mockReset().mockResolvedValue({
		region: 'us',
	})
})

async function setup(options: {
	dataRegion: 'us' | 'ksa'
	hasProvisionedDb: boolean
}) {
	const user = await createTestUser()
	const organization = await createTestOrganization(user.id)
	const { cookie } = await createTestSession(user.id)
	await db
		.update(Organization)
		.set(options)
		.where(eq(Organization.id, organization.id))
	const url = new URL(`http://localhost:3001/${organization.slug}/settings`)
	const submit = () =>
		action({
			request: createAuthenticatedRequest(
				url.toString(),
				{
					method: 'POST',
					body: new URLSearchParams({ intent: 'delete-organization' }),
				},
				cookie,
			),
			params: { orgSlug: organization.slug },
			context: new RouterContextProvider(),
			url,
			pattern: '/:orgSlug/settings',
		} as Parameters<typeof action>[0]).catch((thrown: unknown) => thrown)
	const websiteUrl = new URL(
		`http://localhost:3001/${organization.slug}/website`,
	)
	// Another admin switches the data region to Saudi Arabia.
	const switchRegion = () =>
		websiteAction({
			request: createAuthenticatedRequest(
				websiteUrl.toString(),
				{
					method: 'POST',
					body: new URLSearchParams({
						organizationId: organization.id,
						intent: 'update-site-data-region',
						dataRegion: 'ksa',
						confirmWipe: 'true',
					}),
				},
				cookie,
			),
			params: { orgSlug: organization.slug },
			context: new RouterContextProvider(),
			url: websiteUrl,
			pattern: '/:orgSlug/website',
		} as Parameters<typeof websiteAction>[0]).catch((thrown: unknown) => thrown)
	const exists = async () =>
		(
			await db
				.select({ id: Organization.id })
				.from(Organization)
				.where(eq(Organization.id, organization.id))
		).length === 1
	return { organization, submit, switchRegion, exists }
}

describe('deleting an organization', () => {
	it('deletes the regional tenant database (and its recordings) in its own region first', async () => {
		const { organization, submit, exists } = await setup({
			dataRegion: 'ksa',
			hasProvisionedDb: true,
		})

		const response = (await submit()) as Response
		expect(response.status).toBe(302)

		expect(deprovisionTenantDatabase).toHaveBeenCalledWith(
			expect.objectContaining({ orgId: organization.id, dataRegion: 'ksa' }),
		)
		expect(await exists()).toBe(false)
	})

	it('keeps the organization when the tenant database cannot be deleted', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {})
		vi.mocked(deprovisionTenantDatabase).mockRejectedValue(
			new Error('Tenant API error: unreachable'),
		)
		const { submit, exists } = await setup({
			dataRegion: 'us',
			hasProvisionedDb: true,
		})

		const response = (await submit()) as Response
		expect(response.status).toBe(502)
		expect(await response.json()).toMatchObject({
			error: expect.stringContaining('not deleted'),
		})
		expect(await exists()).toBe(true)
	})

	describe('racing a region switch', () => {
		// tenant-api, as the set of regions that hold this organization's database.
		let databases: Set<string>
		beforeEach(() => {
			databases = new Set(['us'])
			vi.mocked(provisionTenantDatabase).mockImplementation(
				async ({ dataRegion }) => {
					databases.add(dataRegion ?? 'us')
					return { region: dataRegion as 'us' }
				},
			)
		})
		const tenantDeletes = () =>
			vi
				.mocked(deprovisionTenantDatabase)
				.mockImplementation(async ({ dataRegion }) => {
					databases.delete(dataRegion ?? 'us')
					return { region: dataRegion as 'us' }
				})

		async function expectNoOrphanedDatabase(
			exists: () => Promise<boolean>,
			organizationId: string,
		) {
			if (await exists()) {
				const row = await db.query.Organization.findFirst({
					where: eq(Organization.id, organizationId),
				})
				expect([...databases]).toEqual([row?.dataRegion])
			} else {
				expect([...databases]).toEqual([])
			}
		}

		it('a switch that finishes after the delete read its region is not left behind', async () => {
			const { organization, submit, switchRegion, exists } = await setup({
				dataRegion: 'us',
				hasProvisionedDb: true,
			})
			tenantDeletes()
			// The switch runs to completion just before the delete's first write.
			const update = databaseMocks.update.getMockImplementation()!
			databaseMocks.update.mockImplementationOnce((table) => {
				const pending = switchRegion()
				return {
					set: (values: Record<string, unknown>) => ({
						where: (condition: unknown) => ({
							returning: async (fields: unknown) => {
								await pending
								return update(table)
									.set(values)
									.where(condition)
									.returning(fields)
							},
							then: async (resolve: (value: unknown) => void) => {
								await pending
								resolve(await update(table).set(values).where(condition))
							},
						}),
					}),
				}
			})

			const response = (await submit()) as Response

			expect(response.status).toBe(409)
			await expectNoOrphanedDatabase(exists, organization.id)
			expect(await exists()).toBe(true)
		})

		it('a switch started while the delete is wiping its region cannot provision a new one', async () => {
			const { organization, submit, switchRegion, exists } = await setup({
				dataRegion: 'us',
				hasProvisionedDb: true,
			})
			let switched: unknown
			vi.mocked(deprovisionTenantDatabase).mockImplementationOnce(
				async ({ dataRegion }) => {
					// The switch reaches tenant-api before the delete's own request.
					switched = await switchRegion()
					tenantDeletes()
					databases.delete(dataRegion ?? 'us')
					return { region: dataRegion as 'us' }
				},
			)
			tenantDeletes()

			await submit()

			expect((switched as Response).status).toBe(302)
			await expectNoOrphanedDatabase(exists, organization.id)
		})
	})
})
