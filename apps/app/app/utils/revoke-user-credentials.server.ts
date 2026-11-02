import {
	and,
	ApiKey,
	db,
	eq,
	gt,
	isNull,
	MCPAuthorization,
	ne,
	or,
	RefreshToken,
	Session,
} from '@repo/database'
import { revokePendingAuthorizationCodes } from '#app/utils/mcp/oauth.server.ts'

/**
 * Revoke refresh tokens, MCP authorizations, and active API keys for a user.
 * Optionally delete sessions (all or all except one).
 */
export async function revokeUserCredentials(options: {
	userId: string
	exceptSessionId?: string | null
	revokePendingMcpCodes?: boolean
}) {
	const now = new Date()

	await db.transaction(async (tx) => {
		await tx
			.update(RefreshToken)
			.set({ revoked: true })
			.where(
				and(
					eq(RefreshToken.userId, options.userId),
					eq(RefreshToken.revoked, false),
				),
			)
		await tx
			.update(MCPAuthorization)
			.set({ isActive: false })
			.where(eq(MCPAuthorization.userId, options.userId))
		await tx
			.update(ApiKey)
			.set({ expiresAt: now })
			.where(
				and(
					eq(ApiKey.userId, options.userId),
					or(isNull(ApiKey.expiresAt), gt(ApiKey.expiresAt, now)),
				),
			)

		if (options.exceptSessionId) {
			await tx
				.delete(Session)
				.where(
					and(
						eq(Session.userId, options.userId),
						ne(Session.id, options.exceptSessionId),
					),
				)
		} else {
			await tx.delete(Session).where(eq(Session.userId, options.userId))
		}
	})

	if (options.revokePendingMcpCodes !== false) {
		revokePendingAuthorizationCodes(options.userId)
	}
}
