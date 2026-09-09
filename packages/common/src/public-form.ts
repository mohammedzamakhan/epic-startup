import { z } from 'zod'

export const publicFormFieldSchema = z.object({
	id: z.string().min(1).max(50),
	label: z.string().min(1).max(100),
	type: z.enum(['text', 'email', 'tel', 'textarea']),
	required: z.boolean(),
})

export const publicFormProjectionSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1).max(120),
	description: z.string().max(500).nullable(),
	fields: z.array(publicFormFieldSchema).min(1).max(20),
	submitLabel: z.string().min(1).max(50),
	successMessage: z.string().min(1).max(300),
	status: z.literal('published'),
	revision: z.string().min(1),
})

export type PublicFormField = z.infer<typeof publicFormFieldSchema>
export type PublicFormProjection = z.infer<typeof publicFormProjectionSchema>

export function publicFormKvKey(organizationId: string, formId: string) {
	return `public-form:v1:${organizationId}:${formId}`
}

export function toPublicFormProjection(form: {
	id: string
	name: string
	description: string | null
	fields: PublicFormField[]
	submitLabel: string
	successMessage: string
	status: string
	updatedAt?: string | Date | null
}): PublicFormProjection | null {
	if (form.status !== 'published') return null
	return {
		id: form.id,
		name: form.name,
		description: form.description,
		fields: form.fields,
		submitLabel: form.submitLabel,
		successMessage: form.successMessage,
		status: 'published',
		revision:
			form.updatedAt instanceof Date
				? form.updatedAt.toISOString()
				: form.updatedAt || new Date(0).toISOString(),
	}
}
