import { randomUUID } from 'node:crypto'
import {
	db,
	eq,
	Organization,
	PlatformMarketingCampaign,
	PlatformMarketingMessage,
	User,
	UserOrganization,
} from '@repo/database'
import type * as email from '@repo/email'
import { dispatchPlatformCampaign } from '@repo/marketing/server/platform-campaigns'
import { describe, expect, it, vi } from 'vitest'

const sent = vi.hoisted(() => [] as string[])
vi.mock('@repo/email', async (importOriginal) => ({
	...(await importOriginal<typeof email>()),
	getEmailProvider: () => 'resend',
	sendEmail: async (input: { to: string }) => {
		sent.push(input.to)
		// Let the other dispatch interleave between the insert and the send.
		await new Promise((resolve) => setTimeout(resolve, 5))
		return { status: 'success', data: { id: randomUUID() } }
	},
}))

describe('platform campaign dispatch', () => {
	it('two dispatches of one campaign running at once send once per user', async () => {
		const id = randomUUID()
		const [organization] = await db
			.insert(Organization)
			.values({ name: `Org ${id.slice(0, 6)}`, slug: `org-${id}` })
			.returning()
		const emails: string[] = []
		for (let i = 0; i < 7; i++) {
			const email = `op-${i}-${id}@example.com`
			const [user] = await db
				.insert(User)
				.values({ username: `op-${i}-${id}`, email })
				.returning()
			await db.insert(UserOrganization).values({
				userId: user!.id,
				organizationId: organization!.id,
				organizationRoleId: 'org_role_member',
				active: true,
			})
			emails.push(email)
		}
		const [campaign] = await db
			.insert(PlatformMarketingCampaign)
			.values({
				name: 'Launch',
				channel: 'email',
				subject: 'Hi',
				content: 'Hello',
				status: 'Processing',
				audience: 'organization',
				targetOrganizationId: organization!.id,
			})
			.returning()

		await Promise.all([
			dispatchPlatformCampaign(campaign!.id),
			dispatchPlatformCampaign(campaign!.id),
		])

		expect(sent.filter((to) => emails.includes(to)).sort()).toEqual(
			[...emails].sort(),
		)
		const messages = await db
			.select()
			.from(PlatformMarketingMessage)
			.where(eq(PlatformMarketingMessage.campaignId, campaign!.id))
		expect(messages).toHaveLength(7)
	})
})
