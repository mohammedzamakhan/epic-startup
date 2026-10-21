export const REDIRECT_DESTINATION_ERROR =
	'Destination must be an internal path (e.g. /page) or a valid http:// or https:// URL.'

export function isValidRedirectDestination(val: string): boolean {
	const trimmed = val.trim()
	if (!trimmed) return false
	// Reject scheme-relative URLs like //evil.com
	if (trimmed.startsWith('//')) return false
	if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
		try {
			const parsed = new URL(trimmed)
			return parsed.protocol === 'http:' || parsed.protocol === 'https:'
		} catch {
			return false
		}
	}
	// Internal relative path must start with exactly one slash and not backslash
	return trimmed.startsWith('/') && !trimmed.startsWith('/\\')
}
