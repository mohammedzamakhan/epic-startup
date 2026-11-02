import { getUserId } from '@repo/auth'
import {
	and,
	db,
	eq,
	OrganizationMediaAsset,
	UserOrganization,
} from '@repo/database'

const PUBLIC_MEDIA_SOURCES = new Set([
	'organization-logo',
	'site-icon',
	'website-seo',
	'website-asset',
])

/** Platform-scoped assets and organization branding assets are public. */
export function isPublicMediaAsset(asset: {
	storageScope: string
	source: string
}) {
	return (
		asset.storageScope === 'platform' || PUBLIC_MEDIA_SOURCES.has(asset.source)
	)
}

/** Throws 401/403 unless the signed-in user is a member of the organization. */
export async function requireOrganizationMember(
	request: Request,
	organizationId: string,
) {
	const userId = await getUserId(request)
	if (!userId) throw new Response('Unauthorized', { status: 401 })
	const [membership] = await db
		.select({ userId: UserOrganization.userId })
		.from(UserOrganization)
		.where(
			and(
				eq(UserOrganization.userId, userId),
				eq(UserOrganization.organizationId, organizationId),
			),
		)
		.limit(1)
	if (!membership) throw new Response('Forbidden', { status: 403 })
	return userId
}

/**
 * Authorizes a direct read of a stored object by key. Registered public assets
 * are open; registered private assets need organization membership. Returns the
 * storage scope to sign with, taken from the registered asset, never the query.
 */
export async function authorizeRegisteredObject(
	request: Request,
	objectKey: string,
) {
	const [asset] = await db
		.select({
			organizationId: OrganizationMediaAsset.organizationId,
			storageScope: OrganizationMediaAsset.storageScope,
			source: OrganizationMediaAsset.source,
		})
		.from(OrganizationMediaAsset)
		.where(eq(OrganizationMediaAsset.objectKey, objectKey))
		.limit(1)
	if (!asset) return null
	const isPublic = isPublicMediaAsset(asset)
	if (!isPublic) await requireOrganizationMember(request, asset.organizationId)
	return {
		isPublic,
		organizationId:
			asset.storageScope === 'organization' ? asset.organizationId : null,
	}
}
