// Simple JavaScript export for development
export type {
	StorageConfig,
	OrganizationS3Config,
	GetOrganizationConfigFn,
	DecryptFn,
} from './src/types'
export type { UploadOptions } from './src/upload-helpers'

export {
	createStorageClient,
	uploadToStorage,
	testS3Connection,
	getSignedGetRequestInfo,
	getSignedHeadRequestInfo,
	getSignedGetRequestInfoAsync,
	getSignedPutRequestInfoForKey,
	getSignedDeleteRequestInfo,
	getPresignedGetUrl,
	getPresignedPutUrl,
} from './src/client'

export {
	uploadProfileImage,
	uploadOrganizationImage,
	uploadOrganizationMediaImage,
	uploadNoteImage,
	uploadCommentImage,
	uploadNoteVideo,
	uploadVideoThumbnail,
	uploadSiteIcon,
	uploadWebsiteSeoImage,
	uploadWebsiteAsset,
	uploadSiteFont,
} from './src/upload-helpers'
