import { getNoteImgSrc } from '@repo/common'
import { and, db, eq, inArray, OrganizationMediaAsset } from '@repo/database'

export function getOrganizationMediaImageUrl(
	assetId: string,
	updatedAt: Date | number,
) {
	const version =
		typeof updatedAt === 'number' ? updatedAt : updatedAt.getTime()
	return `/resources/images?mediaId=${encodeURIComponent(assetId)}&v=${version}`
}

type NoteUploadRow = {
	type: string
	objectKey: string
	altText?: string | null
	id?: string
}

export async function enrichNoteUploadsWithImageSrc<T extends NoteUploadRow>(
	uploads: T[],
	organizationId: string,
): Promise<Array<T & { imageSrc: string }>> {
	const imageKeys = [
		...new Set(
			uploads
				.filter((upload) => upload.type === 'image')
				.map((u) => u.objectKey),
		),
	]

	if (imageKeys.length === 0) {
		return uploads.map((upload) => ({
			...upload,
			imageSrc: getNoteImgSrc(upload.objectKey, organizationId),
		}))
	}

	const assets = await db
		.select({
			id: OrganizationMediaAsset.id,
			objectKey: OrganizationMediaAsset.objectKey,
			updatedAt: OrganizationMediaAsset.updatedAt,
		})
		.from(OrganizationMediaAsset)
		.where(
			and(
				eq(OrganizationMediaAsset.organizationId, organizationId),
				inArray(OrganizationMediaAsset.objectKey, imageKeys),
			),
		)

	const assetByObjectKey = new Map(
		assets.map((asset) => [asset.objectKey, asset] as const),
	)

	return uploads.map((upload) => {
		if (upload.type !== 'image') {
			return {
				...upload,
				imageSrc: getNoteImgSrc(upload.objectKey, organizationId),
			}
		}

		const asset = assetByObjectKey.get(upload.objectKey)
		return {
			...upload,
			imageSrc: asset
				? getOrganizationMediaImageUrl(asset.id, asset.updatedAt)
				: getNoteImgSrc(upload.objectKey, organizationId),
		}
	})
}
