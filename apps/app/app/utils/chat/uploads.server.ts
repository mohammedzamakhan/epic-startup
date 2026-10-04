import { uploadChatImage as uploadChatImageToStorage } from '#app/utils/storage.server.ts'

export async function uploadChatImage(
	organizationId: string,
	userId: string,
	file: File,
) {
	return uploadChatImageToStorage(userId, organizationId, file)
}
