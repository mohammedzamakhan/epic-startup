import { createId } from '@paralleldrive/cuid2'
import {
	db,
	desc,
	eq,
	lt,
	Organization,
	PlatformMarketingCampaign,
	PlatformMarketingMessage,
	User,
	UserOrganization,
} from '@repo/database'
import { getEmailProvider, sendEmail } from '@repo/email'
import { buildPlatformMarketingResendTags } from '@repo/config/marketing-email'
import { and } from 'drizzle-orm'
import {
	type CampaignDetail,
	type CampaignListItem,
	type CampaignRecipient,
	type CampaignStatus,
	type MarketingMetrics,
} from '../types/campaign.ts'
import {
	buildRecipientMergeTags,
	escapeHtml,
	interpolateMergeTags,
	interpolateMergeTagsHtml,
} from '../utils/merge-tags.ts'
import {
	createPlatformCampaignSchema,
	type CreatePlatformCampaignInput,
	type PlatformAudience,
} from '../types/platform.ts'
import { ensurePlatformEmailEngagementSynced } from './platform-oci-engagement-sync.server.ts'

async function maybeSyncPlatformEngagement() {
	if (getEmailProvider() === 'oci') {
		await ensurePlatformEmailEngagementSynced()
	}
}

export async function listPlatformCampaigns(): Promise<CampaignListItem[]> {
	const campaigns = await db
		.select()
		.from(PlatformMarketingCampaign)
		.orderBy(desc(PlatformMarketingCampaign.createdAt))

	return campaigns.map((campaign) => ({
		id: campaign.id,
		name: campaign.name,
		status: campaign.status as CampaignStatus,
		channel: campaign.channel as CampaignListItem['channel'],
		targetAudienceCount: campaign.targetAudienceCount,
		createdAt: campaign.createdAt,
		scheduledAt: campaign.scheduledAt,
	}))
}

export async function getPlatformCampaign(
	campaignId: string,
): Promise<CampaignDetail | null> {
	await maybeSyncPlatformEngagement()

	const [campaign] = await db
		.select()
		.from(PlatformMarketingCampaign)
		.where(eq(PlatformMarketingCampaign.id, campaignId))

	if (!campaign) return null

	const messages = await db
		.select({
			id: PlatformMarketingMessage.id,
			status: PlatformMarketingMessage.status,
			sentAt: PlatformMarketingMessage.sentAt,
			openedAt: PlatformMarketingMessage.openedAt,
			clickedAt: PlatformMarketingMessage.clickedAt,
			name: User.name,
			email: User.email,
		})
		.from(PlatformMarketingMessage)
		.innerJoin(User, eq(PlatformMarketingMessage.userId, User.id))
		.where(eq(PlatformMarketingMessage.campaignId, campaignId))

	const recipients: CampaignRecipient[] = messages.map((message) => ({
		id: message.id,
		name: message.name,
		email: message.email,
		status: message.status,
		sentAt: message.sentAt,
		openedAt: message.openedAt,
		clickedAt: message.clickedAt,
	}))

	return {
		id: campaign.id,
		name: campaign.name,
		status: campaign.status as CampaignStatus,
		channel: campaign.channel as CampaignDetail['channel'],
		subject: campaign.subject,
		content: campaign.content,
		contentBlocks: campaign.contentBlocks,
		contentHtml: campaign.contentHtml,
		targetAudienceCount: campaign.targetAudienceCount,
		audience: campaign.audience,
		createdAt: campaign.createdAt,
		scheduledAt: campaign.scheduledAt,
		recipients,
	}
}

export async function getPlatformMarketingMetrics(): Promise<MarketingMetrics> {
	await maybeSyncPlatformEngagement()

	const campaigns = await db.select().from(PlatformMarketingCampaign)
	const messages = await db.select().from(PlatformMarketingMessage)

	const emailsSent = messages.filter((message) =>
		['Sent', 'Opened', 'Clicked'].includes(message.status),
	).length
	const openCount = messages.filter((message) =>
		['Opened', 'Clicked'].includes(message.status),
	).length
	const clickCount = messages.filter(
		(message) => message.status === 'Clicked',
	).length
	const activeCampaigns = campaigns.filter((c) =>
		['Processing', 'Scheduled'].includes(c.status),
	).length

	const openRate = emailsSent > 0 ? (openCount / emailsSent) * 100 : 0
	const clickRate = emailsSent > 0 ? (clickCount / emailsSent) * 100 : 0

	return {
		emailsSent,
		openRate: openRate.toFixed(1),
		clickRate: clickRate.toFixed(1),
		activeCampaigns,
	}
}

/**
 * Keeps background work alive after the response. On Workers this is the
 * request's `ctx.waitUntil`; without one (Node) the promise simply runs.
 */
export type RunInBackground = (task: () => Promise<unknown>) => void

const runDetached: RunInBackground = (task) => {
	void task().catch((error: unknown) => {
		console.error('Platform campaign background work failed', error)
	})
}

export async function createPlatformCampaign(
	input: CreatePlatformCampaignInput,
	createdById?: string,
	options: { runInBackground?: RunInBackground } = {},
) {
	const parsed = createPlatformCampaignSchema.parse(input)

	if (parsed.channel === 'email' && !parsed.subject) {
		throw new Error('Email campaigns require a subject')
	}

	if (parsed.audience === 'organization' && !parsed.targetOrganizationId) {
		throw new Error('Organization campaigns require a target organization')
	}

	const campaignId = createId()
	await db.insert(PlatformMarketingCampaign).values({
		id: campaignId,
		name: parsed.name,
		channel: parsed.channel,
		subject: parsed.subject || null,
		content: parsed.content,
		contentBlocks: parsed.contentBlocks || null,
		contentHtml: parsed.contentHtml || null,
		status: 'Processing',
		audience: parsed.audience,
		targetOrganizationId: parsed.targetOrganizationId || null,
		segmentationRules: JSON.stringify({ audience: parsed.audience }),
		createdById: createdById || null,
	})

	;(options.runInBackground ?? runDetached)(() =>
		dispatchPlatformCampaign(campaignId),
	)

	return { campaignId, status: 'Processing' as const }
}

async function resolvePlatformRecipients(
	audience: PlatformAudience,
	targetOrganizationId?: string | null,
) {
	if (audience === 'organization') {
		// Never widen an organization-scoped campaign to every operator.
		if (!targetOrganizationId) return []
		const memberships = await db
			.select({
				userId: UserOrganization.userId,
				email: User.email,
				name: User.name,
				organizationName: Organization.name,
			})
			.from(UserOrganization)
			.innerJoin(User, eq(UserOrganization.userId, User.id))
			.innerJoin(
				Organization,
				eq(UserOrganization.organizationId, Organization.id),
			)
			.where(
				and(
					eq(UserOrganization.organizationId, targetOrganizationId),
					eq(UserOrganization.active, true),
					eq(User.isBanned, false),
				),
			)

		return memberships
	}

	const operators = await db
		.select({
			userId: UserOrganization.userId,
			email: User.email,
			name: User.name,
			organizationName: Organization.name,
		})
		.from(UserOrganization)
		.innerJoin(User, eq(UserOrganization.userId, User.id))
		.innerJoin(
			Organization,
			eq(UserOrganization.organizationId, Organization.id),
		)
		.where(and(eq(UserOrganization.active, true), eq(User.isBanned, false)))

	const uniqueByUser = new Map<string, (typeof operators)[number]>()
	for (const row of operators) {
		if (!uniqueByUser.has(row.userId)) {
			uniqueByUser.set(row.userId, row)
		}
	}

	return [...uniqueByUser.values()]
}

/** Sends in flight at once. Bounded so one campaign cannot exhaust the provider. */
export const PLATFORM_CAMPAIGN_SEND_CONCURRENCY = 5

/**
 * A Processing campaign whose row has not been touched for this long lost its
 * dispatcher (the Worker was cut off after `waitUntil`, a deploy, a crash).
 * Every batch bumps `updatedAt`, so a live dispatch never looks stale.
 */
export const PLATFORM_CAMPAIGN_STALE_MS = 10 * 60 * 1000

/**
 * Message statuses that end a recipient's turn. `Processing` is included on
 * purpose: the row is written before the send, so a Processing row left by an
 * interrupted dispatch means the outcome is unknown and the email may well
 * have gone out. Re-sending it would double-mail; it is left for review.
 */
const RECIPIENT_HANDLED_STATUSES = new Set([
	'Processing',
	'Sent',
	'Opened',
	'Clicked',
	'Failed',
])

async function touchCampaign(campaignId: string) {
	await db
		.update(PlatformMarketingCampaign)
		.set({ updatedAt: new Date() })
		.where(eq(PlatformMarketingCampaign.id, campaignId))
}

/**
 * Sends a platform campaign. Idempotent per (campaign, user): recipients who
 * already have a message row for this campaign are skipped, so resuming an
 * interrupted dispatch only reaches the users it never got to.
 */
export async function dispatchPlatformCampaign(campaignId: string) {
	try {
		const [campaign] = await db
			.select()
			.from(PlatformMarketingCampaign)
			.where(eq(PlatformMarketingCampaign.id, campaignId))

		if (!campaign) return
		if (campaign.status !== 'Processing') return

		const recipients = await resolvePlatformRecipients(
			campaign.audience as PlatformAudience,
			campaign.targetOrganizationId,
		)

		await db
			.update(PlatformMarketingCampaign)
			.set({ targetAudienceCount: recipients.length })
			.where(eq(PlatformMarketingCampaign.id, campaignId))

		const existingMessages = await db
			.select({
				userId: PlatformMarketingMessage.userId,
				status: PlatformMarketingMessage.status,
			})
			.from(PlatformMarketingMessage)
			.where(eq(PlatformMarketingMessage.campaignId, campaignId))
		const handledUserIds = new Set(
			(existingMessages ?? [])
				.filter((message) => RECIPIENT_HANDLED_STATUSES.has(message.status))
				.map((message) => message.userId),
		)
		const pending = recipients.filter(
			(recipient) => !handledUserIds.has(recipient.userId),
		)

		async function sendToRecipient(recipient: (typeof recipients)[number]) {
			const messageId = createId()
			// Written before the send: if the dispatch dies mid-send this row
			// stays Processing and a resume does not send to this user again.
			// The row is unique per (campaign, user): when another dispatch
			// already wrote it, that dispatch owns this recipient.
			const claimed = await db
				.insert(PlatformMarketingMessage)
				.values({
					id: messageId,
					campaignId,
					userId: recipient.userId,
					status: 'Processing',
				})
				.onConflictDoNothing()
				.returning({ id: PlatformMarketingMessage.id })
			if (claimed.length === 0) return

			const mergeTags = buildRecipientMergeTags({
				name: recipient.name,
				email: recipient.email,
				organizationName: recipient.organizationName,
			})
			const parsedContent = interpolateMergeTags(campaign!.content, mergeTags)

			let deliveryStatus = 'Sent'
			let providerMessageId: string | null = null
			try {
				if (campaign!.channel === 'email') {
					if (!recipient.email) throw new Error('No email address')
					const html = campaign!.contentHtml
						? interpolateMergeTagsHtml(campaign!.contentHtml, mergeTags)
						: `<p>${escapeHtml(parsedContent).replace(/\n/g, '<br/>')}</p>`

					const emailRes = await sendEmail({
						to: recipient.email,
						subject: interpolateMergeTags(
							campaign!.subject || campaign!.name,
							mergeTags,
						),
						text: parsedContent,
						html,
						tags: buildPlatformMarketingResendTags(messageId, campaignId),
					})
					if (emailRes.status === 'error') {
						throw new Error(emailRes.error.message)
					}
					providerMessageId = emailRes.data.id
				} else {
					deliveryStatus = 'Failed'
				}
			} catch (error) {
				console.error(
					`Failed to send platform campaign to ${recipient.userId}`,
					error,
				)
				deliveryStatus = 'Failed'
			}

			await db
				.update(PlatformMarketingMessage)
				.set({
					status: deliveryStatus,
					sentAt: deliveryStatus === 'Sent' ? new Date() : null,
					providerMessageId:
						deliveryStatus === 'Sent' ? providerMessageId : null,
				})
				.where(eq(PlatformMarketingMessage.id, messageId))
		}

		for (
			let index = 0;
			index < pending.length;
			index += PLATFORM_CAMPAIGN_SEND_CONCURRENCY
		) {
			const batch = pending.slice(
				index,
				index + PLATFORM_CAMPAIGN_SEND_CONCURRENCY,
			)
			await Promise.all(batch.map(sendToRecipient))
			// Heartbeat: keeps a live dispatch from looking stale to a resume.
			await touchCampaign(campaignId)
		}

		await db
			.update(PlatformMarketingCampaign)
			.set({ status: 'Completed' })
			.where(eq(PlatformMarketingCampaign.id, campaignId))
	} catch (error) {
		console.error(`Platform campaign dispatch failed for ${campaignId}`, error)
		await db
			.update(PlatformMarketingCampaign)
			.set({ status: 'Failed' })
			.where(eq(PlatformMarketingCampaign.id, campaignId))
	}
}

/**
 * Restarts dispatch for campaigns stuck in Processing with no heartbeat for
 * `PLATFORM_CAMPAIGN_STALE_MS`. Each campaign is claimed with a conditional
 * update first, so two callers cannot both resume it. Resumed dispatch skips
 * every user who already has a message row, so nobody is mailed twice.
 */
export async function resumeStalePlatformCampaigns(
	options: { now?: Date; runInBackground?: RunInBackground } = {},
) {
	const now = options.now ?? new Date()
	const cutoff = new Date(now.getTime() - PLATFORM_CAMPAIGN_STALE_MS)
	const stale = await db
		.select({ id: PlatformMarketingCampaign.id })
		.from(PlatformMarketingCampaign)
		.where(
			and(
				eq(PlatformMarketingCampaign.status, 'Processing'),
				lt(PlatformMarketingCampaign.updatedAt, cutoff),
			),
		)

	const resumed: string[] = []
	for (const { id } of stale) {
		const claimed = await db
			.update(PlatformMarketingCampaign)
			.set({ updatedAt: now })
			.where(
				and(
					eq(PlatformMarketingCampaign.id, id),
					eq(PlatformMarketingCampaign.status, 'Processing'),
					lt(PlatformMarketingCampaign.updatedAt, cutoff),
				),
			)
			.returning({ id: PlatformMarketingCampaign.id })
		if (claimed.length === 0) continue
		resumed.push(id)
		;(options.runInBackground ?? runDetached)(() =>
			dispatchPlatformCampaign(id),
		)
	}
	return { resumed }
}
