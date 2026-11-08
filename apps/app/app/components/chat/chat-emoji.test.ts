// @vitest-environment jsdom
import { Editor } from '@tiptap/core'
import { gitHubEmojis } from '@tiptap/extension-emoji'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { expect, test } from 'vitest'
import { ChatEmoji } from './chat-emoji.ts'

function markdownFor(text: string) {
	const editor = new Editor({
		element: document.createElement('div'),
		extensions: [
			StarterKit.configure({ heading: false }),
			Markdown.configure({ html: false }),
			ChatEmoji.configure({ emojis: gitHubEmojis, enableEmoticons: true }),
		],
	})
	for (const ch of text) {
		const { from, to } = editor.state.selection
		const handled = editor.view.someProp('handleTextInput', (f) =>
			f(editor.view, from, to, ch, () =>
				editor.state.tr.insertText(ch, from, to),
			),
		)
		if (!handled) editor.view.dispatch(editor.state.tr.insertText(ch, from, to))
	}
	const out = (editor.storage as any).markdown.getMarkdown() as string
	editor.destroy()
	return out
}

test('an emoji node serializes to its unicode character', () => {
	const out = markdownFor('<script>alert(1)</script> hello :grinning: **bold**')
	expect(out).toContain('😀')
	expect(out).not.toContain('[emoji]')
	expect(out).toContain('**bold**')
})
