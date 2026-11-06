import { db, eq, Organization } from '@repo/database'
import { RouterContextProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deprovisionTenantDatabase } from '#app/utils/sites/tenant-api.server.ts'
import {
	createAuthenticatedRequest,
	createTestOrganization,
	createTestSession,
	createTestUser,
} from '#tests/test-utils.ts'
import { action } from './_index.tsx'

vi.mock('#app/utils/sites/tenant-api.server.ts', () => ({
	provisionTenantDatabase: vi.fn(),
	deprovisionTenantDatabase: vi.fn(),
}))

beforeEach(() => {
	vi.mocked(deprovisionTenantDatabase).mockReset().mockResolvedValue({
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
	const exists = async () =>
		(
			await db
				.select({ id: Organization.id })
				.from(Organization)
				.where(eq(Organization.id, organization.id))
		).length === 1
	return { organization, submit, exists }
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
})
