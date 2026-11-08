import { Emoji, shortcodeToEmoji } from '@tiptap/extension-emoji'
import { type MarkdownNodeSpec } from 'tiptap-markdown'

/**
 * `tiptap-markdown` cannot serialize the Emoji node in non-HTML mode: it
 * writes the literal text `[emoji]`. Write the unicode character instead (or
 * the `:shortcode:` when the name has no unicode form).
 */
const SAFE_SHORTCODE = /^[a-z0-9_+-]+$/i

export const ChatEmoji = Emoji.extend({
	addStorage() {
		const parentStorage = this.parent!()
		const emojis = this.options.emojis
		const markdown: MarkdownNodeSpec = {
			serialize(state, node) {
				const name = String(node.attrs.name ?? '')
				const item = shortcodeToEmoji(name, emojis)
				// `name` can come from pasted HTML, so never write it unless it is a
				// plain shortcode (state.write does not escape markdown).
				state.write(
					item?.emoji ?? (SAFE_SHORTCODE.test(name) ? `:${name}:` : ''),
				)
			},
			parse: {},
		}
		return { ...parentStorage, markdown } as typeof parentStorage
	},
})
