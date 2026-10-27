import { and, db, eq, PrintCanvaConnection } from '@repo/database'
import { decryptAsync, encryptAsync, getEncryptionKey } from '@repo/security'
import { type PrintShopAccess } from '../access.server.ts'
import {
	canvaApi,
	CanvaError,
	refreshCanvaTokens,
	revokeCanvaToken,
	type CanvaApi,
	type CanvaTokens,
} from './client.server.ts'

/**
 * A member's Canva connection (one per organization and user). Tokens are
 * stored encrypted with INTEGRATION_ENCRYPTION_KEY and never leave the App
 * server. Canva refresh tokens are single use: a refresh is written only if
 * the stored token is still the one we used, so two requests refreshing at
 * once cannot leave a spent token behind.
 */

type Owner = Pick<PrintShopAccess, 'userId'> & {
	organization: { id: string }
}

/** Refresh this long before the access token runs out. */
const REFRESH_MARGIN_MS = 2 * 60_000

const key = () => getEncryptionKey('INTEGRATION_ENCRYPTION_KEY')

const ownedBy = (owner: Owner) =>
	and(
		eq(PrintCanvaConnection.organizationId, owner.organization.id),
		eq(PrintCanvaConnection.userId, owner.userId),
	)

export async function getCanvaConnection(owner: Owner) {
	const [row] = await db
		.select({
			displayName: PrintCanvaConnection.displayName,
			createdAt: PrintCanvaConnection.createdAt,
		})
		.from(PrintCanvaConnection)
		.where(ownedBy(owner))
		.limit(1)
	return row ?? null
}

export async function saveCanvaConnection(
	owner: Owner,
	tokens: CanvaTokens,
	profile: { userId: string | null; displayName: string | null },
) {
	const values = {
		accessToken: await encryptAsync(tokens.accessToken, key()),
		refreshToken: await encryptAsync(tokens.refreshToken, key()),
		expiresAt: tokens.expiresAt,
		scope: tokens.scope,
		canvaUserId: profile.userId,
		displayName: profile.displayName,
	}
	await db
		.insert(PrintCanvaConnection)
		.values({
			organizationId: owner.organization.id,
			userId: owner.userId,
			...values,
		})
		.onConflictDoUpdate({
			target: [
				PrintCanvaConnection.organizationId,
				PrintCanvaConnection.userId,
			],
			set: values,
		})
}

/** Disconnects: revokes the grant at Canva (best effort) and forgets it. */
export async function deleteCanvaConnection(owner: Owner) {
	const [row] = await db
		.select({ refreshToken: PrintCanvaConnection.refreshToken })
		.from(PrintCanvaConnection)
		.where(ownedBy(owner))
		.limit(1)
	await db.delete(PrintCanvaConnection).where(ownedBy(owner))
	if (row) {
		const token = await decryptAsync(row.refreshToken, key()).catch(() => null)
		if (token) await revokeCanvaToken(token)
	}
}

async function readTokens(owner: Owner) {
	const [row] = await db
		.select()
		.from(PrintCanvaConnection)
		.where(ownedBy(owner))
		.limit(1)
	if (!row) return null
	return {
		row,
		accessToken: await decryptAsync(row.accessToken, key()),
		refreshToken: await decryptAsync(row.refreshToken, key()),
	}
}

async function refresh(
	owner: Owner,
	current: NonNullable<Awaited<ReturnType<typeof readTokens>>>,
): Promise<string> {
	let tokens: CanvaTokens
	try {
		tokens = await refreshCanvaTokens(current.refreshToken)
	} catch (error) {
		if (error instanceof CanvaError && error.code === 'unauthorized') {
			// Another request may have used the token a moment ago.
			const latest = await readTokens(owner)
			if (latest && latest.row.refreshToken !== current.row.refreshToken) {
				return latest.accessToken
			}
			// The grant is gone (revoked in Canva, or expired): connect again.
			await db.delete(PrintCanvaConnection).where(ownedBy(owner))
		}
		throw error
	}
	const updated = await db
		.update(PrintCanvaConnection)
		.set({
			accessToken: await encryptAsync(tokens.accessToken, key()),
			refreshToken: await encryptAsync(tokens.refreshToken, key()),
			expiresAt: tokens.expiresAt,
			scope: tokens.scope,
		})
		.where(
			and(
				ownedBy(owner),
				eq(PrintCanvaConnection.refreshToken, current.row.refreshToken),
			),
		)
		.returning({ id: PrintCanvaConnection.id })
	if (updated.length === 0) {
		// A concurrent refresh won; ours is the spare. Use what it stored.
		const latest = await readTokens(owner)
		if (latest) return latest.accessToken
		throw new CanvaError('unauthorized', 'Canva is not connected')
	}
	return tokens.accessToken
}

/**
 * Runs `work` with this member's Canva API, refreshing the access token
 * first when it is about to run out, and once more if Canva refuses it.
 */
export async function withCanva<T>(
	owner: Owner,
	work: (api: CanvaApi) => Promise<T>,
): Promise<T> {
	const current = await readTokens(owner)
	if (!current) throw new CanvaError('unauthorized', 'Canva is not connected')
	let accessToken =
		current.row.expiresAt.getTime() - Date.now() < REFRESH_MARGIN_MS
			? await refresh(owner, current)
			: current.accessToken
	try {
		return await work(canvaApi(accessToken))
	} catch (error) {
		if (!(error instanceof CanvaError) || error.code !== 'unauthorized') {
			throw error
		}
		const latest = await readTokens(owner)
		if (!latest) throw error
		accessToken = await refresh(owner, latest)
		return work(canvaApi(accessToken))
	}
}
