import { uploadOrganizationMediaFileOnly } from '#app/utils/storage.server.ts'

export async function uploadChatImage(organizationId: string, file: File) {
	const result = await uploadOrganizationMediaFileOnly(organizationId, file)
	return result.key
}
