import { requireUserId } from '@repo/auth'
import { type ActionFunctionArgs } from 'react-router'
import { uploadChatImage } from '#app/utils/chat/uploads.server.ts'
import { requireUserOrganization } from '#app/utils/organization/loader.server.ts'

export async function action({ request, params }: ActionFunctionArgs) {
	const userId = await requireUserId(request)
	const organization = await requireUserOrganization(
		request,
		params.orgSlug || '',
		{ id: true },
	)
	const form = await request.formData()
	const file = form.get('file')
	if (!(file instanceof File) || file.size === 0) {
		return { ok: false as const, error: 'Choose an image to upload.' }
	}
	if (!file.type.startsWith('image/')) {
		return { ok: false as const, error: 'Only images are supported in chat.' }
	}
	try {
		const objectKey = await uploadChatImage(organization.id, file)
		return { ok: true as const, objectKey }
	} catch (error) {
		return {
			ok: false as const,
			error:
				error instanceof Error ? error.message : 'Could not upload that image.',
		}
	}
}
