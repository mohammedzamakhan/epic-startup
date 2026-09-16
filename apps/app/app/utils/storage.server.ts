import { type FileUpload } from '@mjackson/form-data-parser'
import {
	and,
	db,
	eq,
	Organization,
	OrganizationMediaAsset,
	OrganizationS3Config,
} from '@repo/database'
import { decrypt, getSSOMasterKey } from '@repo/security'
import {
	createStorageClient,
	uploadProfileImage as _uploadProfileImage,
	uploadOrganizationImage as _uploadOrganizationImage,
	uploadOrganizationMediaImage as _uploadOrganizationMediaImage,
	uploadNoteImage as _uploadNoteImage,
	uploadCommentImage as _uploadCommentImage,
	uploadNoteVideo as _uploadNoteVideo,
	uploadVideoThumbnail as _uploadVideoThumbnail,
	uploadSiteIcon as _uploadSiteIcon,
	uploadWebsiteSeoImage as _uploadWebsiteSeoImage,
	uploadWebsiteAsset as _uploadWebsiteAsset,
	uploadSiteFont as _uploadSiteFont,
	getSignedGetRequestInfo as _getSignedGetRequestInfo,
	getSignedHeadRequestInfo as _getSignedHeadRequestInfo,
	testS3Connection as _testS3Connection,
	type StorageConfig,
	type UploadOptions,
} from '@repo/storage'

// Validate required environment variables
const requiredEnvVars = [
	'AWS_ENDPOINT_URL_S3',
	'BUCKET_NAME',
	'AWS_ACCESS_KEY_ID',
	'AWS_SECRET_ACCESS_KEY',
	'AWS_REGION',
] as const

for (const envVar of requiredEnvVars) {
	if (!process.env[envVar]) {
		throw new Error(`Missing required environment variable: ${envVar}`)
	}
}

// Default storage configuration from environment variables
const DEFAULT_STORAGE_CONFIG: StorageConfig = {
	endpoint: process.env.AWS_ENDPOINT_URL_S3!,
	bucket: process.env.BUCKET_NAME!,
	accessKey: process.env.AWS_ACCESS_KEY_ID!,
	secretKey: process.env.AWS_SECRET_ACCESS_KEY!,
	region: process.env.AWS_REGION!,
}

// Create the storage client
const storageClient = createStorageClient(DEFAULT_STORAGE_CONFIG)

// Create upload options with app-specific configuration
function createUploadOptions(): UploadOptions {
	return {
		getConfig: async (organizationId?: string) => {
			return await storageClient.getConfig(organizationId, {
				getOrganizationConfig: async (orgId) => {
					const [config] = await db
						.select()
						.from(OrganizationS3Config)
						.where(eq(OrganizationS3Config.organizationId, orgId))
						.limit(1)
					return config ?? null
				},
				decrypt: (encrypted) => decrypt(encrypted, getSSOMasterKey()),
			})
		},
	}
}

type MediaSource =
	| 'comment'
	| 'library'
	| 'note'
	| 'organization-logo'
	| 'site-icon'
	| 'video-thumbnail'
	| 'website-asset'
	| 'website-seo'

export async function registerOrganizationMediaAsset({
	organizationId,
	objectKey,
	file,
	storageScope,
	source,
	createdById,
}: {
	organizationId: string
	objectKey: string
	file: File | FileUpload
	storageScope: 'organization' | 'platform'
	source: MediaSource
	createdById?: string
}) {
	if (!file.type.startsWith('image/')) return null

	const [asset] = await db
		.insert(OrganizationMediaAsset)
		.values({
			organizationId,
			objectKey,
			storageScope,
			mimeType: file.type,
			fileName: file.name || null,
			fileSize: file.size || null,
			source,
			createdById: createdById ?? null,
		})
		.onConflictDoNothing()
		.returning()

	if (asset) return asset

	const [existing] = await db
		.select()
		.from(OrganizationMediaAsset)
		.where(
			and(
				eq(OrganizationMediaAsset.organizationId, organizationId),
				eq(OrganizationMediaAsset.objectKey, objectKey),
			),
		)
		.limit(1)

	return existing ?? null
}

// Export upload functions with app-specific configuration
export async function uploadProfileImage(
	userId: string,
	file: File | FileUpload,
	organizationId?: string,
) {
	return _uploadProfileImage(
		userId,
		file,
		createUploadOptions(),
		organizationId,
	)
}

export async function uploadOrganizationImage(
	organizationId: string,
	file: File | FileUpload,
) {
	const defaultOptions = createUploadOptions()
	const objectKey = await _uploadOrganizationImage(organizationId, file, {
		...defaultOptions,
		// Force organization logos to be stored in the platform's default bucket
		getConfig: () => defaultOptions.getConfig(undefined),
	})
	const [organization] = await db
		.select({ id: Organization.id })
		.from(Organization)
		.where(eq(Organization.id, organizationId))
		.limit(1)
	if (organization) {
		await registerOrganizationMediaAsset({
			organizationId,
			objectKey,
			file,
			storageScope: 'platform',
			source: 'organization-logo',
		})
	}
	return objectKey
}

export async function uploadOrganizationMediaImage(
	organizationId: string,
	file: File | FileUpload,
	createdById?: string,
) {
	const objectKey = await _uploadOrganizationMediaImage(
		organizationId,
		file,
		createUploadOptions(),
	)
	await registerOrganizationMediaAsset({
		organizationId,
		objectKey,
		file,
		storageScope: 'organization',
		source: 'library',
		createdById,
	})
	return objectKey
}

export async function uploadNoteImage(
	userId: string,
	noteId: string,
	file: File | FileUpload,
	organizationId?: string,
) {
	const objectKey = await _uploadNoteImage(
		userId,
		noteId,
		file,
		createUploadOptions(),
		organizationId,
	)
	if (organizationId) {
		await registerOrganizationMediaAsset({
			organizationId,
			objectKey,
			file,
			storageScope: 'organization',
			source: 'note',
			createdById: userId,
		})
	}
	return objectKey
}

export async function uploadCommentImage(
	userId: string,
	commentId: string,
	file: File | FileUpload,
	organizationId?: string,
) {
	const objectKey = await _uploadCommentImage(
		userId,
		commentId,
		file,
		createUploadOptions(),
		organizationId,
	)
	if (organizationId) {
		await registerOrganizationMediaAsset({
			organizationId,
			objectKey,
			file,
			storageScope: 'organization',
			source: 'comment',
			createdById: userId,
		})
	}
	return objectKey
}

export async function uploadNoteVideo(
	userId: string,
	noteId: string,
	file: File | FileUpload,
	organizationId?: string,
) {
	return _uploadNoteVideo(
		userId,
		noteId,
		file,
		createUploadOptions(),
		organizationId,
	)
}

export async function uploadVideoThumbnail(
	userId: string,
	noteId: string,
	videoId: string,
	thumbnailBuffer: Buffer,
	organizationId?: string,
) {
	const objectKey = await _uploadVideoThumbnail(
		userId,
		noteId,
		videoId,
		thumbnailBuffer,
		createUploadOptions(),
		organizationId,
	)
	if (organizationId) {
		const thumbnailFile = new File(
			[new Uint8Array(thumbnailBuffer)],
			'thumbnail.jpg',
			{ type: 'image/jpeg' },
		)
		await registerOrganizationMediaAsset({
			organizationId,
			objectKey,
			file: thumbnailFile,
			storageScope: 'organization',
			source: 'video-thumbnail',
			createdById: userId,
		})
	}
	return objectKey
}

export async function uploadSiteIcon(
	organizationId: string,
	file: File | FileUpload,
) {
	const defaultOptions = createUploadOptions()
	const objectKey = await _uploadSiteIcon(organizationId, file, {
		...defaultOptions,
		// Force site icons to be stored in the platform's default bucket
		getConfig: () => defaultOptions.getConfig(undefined),
	})
	await registerOrganizationMediaAsset({
		organizationId,
		objectKey,
		file,
		storageScope: 'platform',
		source: 'site-icon',
	})
	return objectKey
}

export async function uploadWebsiteSeoImage(
	organizationId: string,
	pageId: string,
	file: File | FileUpload,
) {
	const defaultOptions = createUploadOptions()
	const objectKey = await _uploadWebsiteSeoImage(organizationId, pageId, file, {
		...defaultOptions,
		// Force SEO images to be stored in the platform's default bucket
		getConfig: () => defaultOptions.getConfig(undefined),
	})
	await registerOrganizationMediaAsset({
		organizationId,
		objectKey,
		file,
		storageScope: 'platform',
		source: 'website-seo',
	})
	return objectKey
}

export async function uploadWebsiteAsset(
	organizationId: string,
	pageId: string,
	file: File | FileUpload,
) {
	const defaultOptions = createUploadOptions()
	const objectKey = await _uploadWebsiteAsset(organizationId, pageId, file, {
		...defaultOptions,
		// Force assets to be stored in the platform's default bucket
		getConfig: () => defaultOptions.getConfig(undefined),
	})
	await registerOrganizationMediaAsset({
		organizationId,
		objectKey,
		file,
		storageScope: 'platform',
		source: 'website-asset',
	})
	return objectKey
}

export async function uploadSiteFont(
	organizationId: string,
	role: 'heading' | 'body',
	file: File | FileUpload,
) {
	const defaultOptions = createUploadOptions()
	return _uploadSiteFont(organizationId, role, file, {
		...defaultOptions,
		getConfig: () => defaultOptions.getConfig(undefined),
	})
}

// Export client functions
export function getSignedGetRequestInfo(key: string, _organizationId?: string) {
	// For synchronous calls, use default config only
	return _getSignedGetRequestInfo(key, DEFAULT_STORAGE_CONFIG)
}

export async function getSignedGetRequestInfoAsync(
	key: string,
	organizationId?: string,
) {
	const { url, headers } = await storageClient.getSignedGetUrl(
		key,
		organizationId,
		{
			getOrganizationConfig: async (orgId) => {
				const [config] = await db
					.select()
					.from(OrganizationS3Config)
					.where(eq(OrganizationS3Config.organizationId, orgId))
					.limit(1)
				return config ?? null
			},
			decrypt: (encrypted) => decrypt(encrypted, getSSOMasterKey()),
		},
	)
	return { url, headers }
}

export async function getSignedHeadRequestInfoAsync(
	key: string,
	organizationId?: string,
) {
	const config = await storageClient.getConfig(organizationId, {
		getOrganizationConfig: async (orgId) => {
			const [configRow] = await db
				.select()
				.from(OrganizationS3Config)
				.where(eq(OrganizationS3Config.organizationId, orgId))
				.limit(1)
			return configRow ?? null
		},
		decrypt: (encrypted) => decrypt(encrypted, getSSOMasterKey()),
	})
	return _getSignedHeadRequestInfo(key, config)
}

export async function testS3Connection(config: StorageConfig) {
	return _testS3Connection(config)
}

// Re-export types
export type { StorageConfig }
