// Export types
export type {
	StorageConfig,
	OrganizationS3Config,
	GetOrganizationConfigFn,
	DecryptFn,
} from './types'
export type { UploadOptions } from './upload-helpers'

// Export client functions
export {
	createStorageClient,
	uploadToStorage,
	testS3Connection,
	getSignedGetRequestInfo,
	getSignedGetRequestInfoAsync,
} from './client'

// Export upload helpers
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
} from './upload-helpers'
