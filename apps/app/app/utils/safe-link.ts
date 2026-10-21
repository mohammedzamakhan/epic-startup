/** Only http(s) URLs or same-site paths; blocks `javascript:` and similar. */
export function isSafeAnnouncementLink(value: string) {
	if (/^\/(?![/\\])/.test(value)) return true
	try {
		const { protocol } = new URL(value)
		return protocol === 'http:' || protocol === 'https:'
	} catch {
		return false
	}
}
