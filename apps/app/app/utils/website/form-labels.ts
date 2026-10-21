import { parseLocalizedString } from '@repo/common/site-locales'

/** Labels are stored as localized JSON, so a cleared label is `{"en":""}`. */
export function hasEveryFieldLabel(fields: { label: string }[]) {
	return fields.every(
		(field) => Object.keys(parseLocalizedString(field.label)).length > 0,
	)
}
