import { Emoji, shortcodeToEmoji } from '@tiptap/extension-emoji'
import { type MarkdownNodeSpec } from 'tiptap-markdown'

/**
 * `tiptap-markdown` cannot serialize the Emoji node in non-HTML mode: it
 * writes the literal text `[emoji]`. Write the unicode character instead (or
 * the `:shortcode:` when the name has no unicode form).
 */
export const ChatEmoji = Emoji.extend({
	addStorage() {
		const parentStorage = this.parent!()
		const emojis = this.options.emojis
		const markdown: MarkdownNodeSpec = {
			serialize(state, node) {
				const name = String(node.attrs.name ?? '')
				const item = shortcodeToEmoji(name, emojis)
				state.write(item?.emoji ?? `:${name}:`)
			},
			parse: {},
		}
		return { ...parentStorage, markdown } as typeof parentStorage
	},
})
