/** Mention token stored in message bodies: `@[Display Name](user:userId)` */
export const CHAT_MENTION_RE = /@\[([^\]]+)\]\(user:([^)]+)\)/g

export function chatMentionMarkdown(label: string, userId: string) {
	const safeLabel = label.replace(/\]/g, '').trim() || 'Member'
	return `@[${safeLabel}](user:${userId})`
}

export function extractChatMentionUserIds(body: string): string[] {
	const ids: string[] = []
	for (const match of body.matchAll(CHAT_MENTION_RE)) {
		const id = match[2]
		if (id) ids.push(id)
	}
	return [...new Set(ids)]
}

/** Plain-text preview for emails and notifications. */
export function chatBodyPreview(body: string, max = 160) {
	const plain = body
		.replace(CHAT_MENTION_RE, (_, label: string) => `@${label}`)
		.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
		.replace(/[*_`>#]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
	if (plain.length <= max) return plain
	return `${plain.slice(0, max - 1)}…`
}
