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
import {
	dispatchPlatformCampaign,
	getPlatformCampaign,
} from '@repo/marketing/server/platform-campaigns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { consoleWarn } from '#tests/setup/setup-test-env.ts'

const sent = vi.hoisted(() => [] as string[])
const sendHooks = vi.hoisted(() => ({
	/** Runs inside each send, before it resolves. */
	onSend: null as null | ((to: string) => Promise<void>),
}))
vi.mock('@repo/email', async (importOriginal) => ({
	...(await importOriginal<typeof email>()),
	getEmailProvider: () => 'resend',
	sendEmail: async (input: { to: string }) => {
		sent.push(input.to)
		await sendHooks.onSend?.(input.to)
		// Let the other dispatch interleave between the insert and the send.
		await new Promise((resolve) => setTimeout(resolve, 5))
		return { status: 'success', data: { id: randomUUID() } }
	},
}))

async function createAudience(size: number) {
	const id = randomUUID()
	const [organization] = await db
		.insert(Organization)
		.values({ name: `Org ${id.slice(0, 6)}`, slug: `org-${id}` })
		.returning()
	const users: { id: string; email: string }[] = []
	for (let i = 0; i < size; i++) {
		users.push(await addMember(organization!.id, `op-${i}-${id}`))
	}
	return { organization: organization!, users }
}

async function addMember(organizationId: string, username: string) {
	const email = `${username}@example.com`
	const [user] = await db.insert(User).values({ username, email }).returning()
	await db.insert(UserOrganization).values({
		userId: user!.id,
		organizationId,
		organizationRoleId: 'org_role_member',
		active: true,
	})
	return { id: user!.id, email }
}

async function createCampaign(
	organizationId: string,
	values: Partial<typeof PlatformMarketingCampaign.$inferInsert> = {},
) {
	const [campaign] = await db
		.insert(PlatformMarketingCampaign)
		.values({
			name: 'Launch',
			channel: 'email',
			subject: 'Hi',
			content: 'Hello',
			status: 'Processing',
			audience: 'organization',
			targetOrganizationId: organizationId,
			...values,
		})
		.returning()
	return campaign!
}

async function campaignRow(id: string) {
	const [row] = await db
		.select()
		.from(PlatformMarketingCampaign)
		.where(eq(PlatformMarketingCampaign.id, id))
	return row!
}

describe('platform campaign dispatch', () => {
	beforeEach(() => {
		// Unconfirmed recipients and timed-out sends are reported with a warning.
		consoleWarn.mockImplementation(() => {})
	})
	afterEach(() => {
		sendHooks.onSend = null
	})

	it('two dispatches of one campaign running at once send once per user', async () => {
		const { organization, users } = await createAudience(7)
		const emails = users.map((user) => user.email)
		const campaign = await createCampaign(organization.id)

		await Promise.all([
			dispatchPlatformCampaign(campaign.id),
			dispatchPlatformCampaign(campaign.id),
		])

		expect(sent.filter((to) => emails.includes(to)).sort()).toEqual(
			[...emails].sort(),
		)
		const messages = await db
			.select()
			.from(PlatformMarketingMessage)
			.where(eq(PlatformMarketingMessage.campaignId, campaign.id))
		expect(messages).toHaveLength(7)
	})

	it('surfaces recipients an interrupted dispatch left Processing', async () => {
		const { organization, users } = await createAudience(3)
		const campaign = await createCampaign(organization.id)
		// An earlier dispatch claimed this user and died before recording the
		// outcome: the email may or may not have gone out.
		await db.insert(PlatformMarketingMessage).values({
			campaignId: campaign.id,
			userId: users[0]!.id,
			status: 'Processing',
		})

		await dispatchPlatformCampaign(campaign.id)

		expect(sent).not.toContain(users[0]!.email)
		expect((await campaignRow(campaign.id)).status).toBe('Completed')
		const detail = await getPlatformCampaign(campaign.id)
		expect(detail?.unconfirmedRecipientCount).toBe(1)
		expect(
			detail?.recipients.filter((recipient) => recipient.status === 'Sent'),
		).toHaveLength(2)
	})

	it('times out a hung send, leaves it Processing, and keeps the heartbeat fresh', async () => {
		const { organization, users } = await createAudience(7)
		const longAgo = new Date(Date.now() - 60 * 60 * 1000)
		const campaign = await createCampaign(organization.id, {
			updatedAt: longAgo,
		})
		const hung = users[0]!.email
		const heartbeatAges: number[] = []
		sendHooks.onSend = async (to) => {
			const row = await campaignRow(campaign.id)
			heartbeatAges.push(Date.now() - row.updatedAt.getTime())
			if (to === hung) await new Promise(() => {})
		}

		await dispatchPlatformCampaign(campaign.id, { sendTimeoutMs: 100 })

		expect((await campaignRow(campaign.id)).status).toBe('Completed')
		const detail = await getPlatformCampaign(campaign.id)
		expect(detail?.unconfirmedRecipientCount).toBe(1)
		const byEmail = new Map(
			detail?.recipients.map((recipient) => [recipient.email, recipient]),
		)
		expect(byEmail.get(hung)?.status).toBe('Processing')
		for (const user of users.slice(1)) {
			expect(byEmail.get(user.email)?.status).toBe('Sent')
		}
		expect(heartbeatAges).toHaveLength(7)
		for (const age of heartbeatAges) expect(age).toBeLessThan(60_000)
	})

	it('keeps the first audience count when a dispatch resumes', async () => {
		const { organization, users } = await createAudience(2)
		const campaign = await createCampaign(organization.id)
		await dispatchPlatformCampaign(campaign.id)
		expect((await campaignRow(campaign.id)).targetAudienceCount).toBe(2)

		// The audience grows, then a resume runs (the campaign was stuck).
		await addMember(organization.id, `late-${randomUUID()}`)
		await db
			.update(PlatformMarketingCampaign)
			.set({ status: 'Processing' })
			.where(eq(PlatformMarketingCampaign.id, campaign.id))
		await dispatchPlatformCampaign(campaign.id)

		expect((await campaignRow(campaign.id)).targetAudienceCount).toBe(2)
		expect(users).toHaveLength(2)
	})
})
