import { resolveEmailTheme } from '@repo/common/email-theme'
import { describe, expect, it } from 'vitest'

import { renderMarketingEmail } from '../server/email-render.server'
import {
	escapeHtml,
	interpolateMergeTags,
	interpolateMergeTagsHtml,
} from './merge-tags'

describe('merge tag interpolation', () => {
	it('substitutes raw values for plaintext', () => {
		expect(interpolateMergeTags('Hi {{name}}', { name: 'A & B' })).toBe(
			'Hi A & B',
		)
	})

	it('escapes substituted values for html', () => {
		expect(
			interpolateMergeTagsHtml('<p>Hi {{name}}</p>', {
				name: '<script>alert(1)</script>',
			}),
		).toBe('<p>Hi &lt;script&gt;alert(1)&lt;/script&gt;</p>')
	})

	it('leaves unknown tags empty', () => {
		expect(interpolateMergeTagsHtml('<p>{{missing}}</p>', {})).toBe('<p></p>')
	})

	it('escapes each dangerous character', () => {
		expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
	})

	it('uses a fallback when the value is missing', () => {
		expect(
			interpolateMergeTags('Hey {{firstName|there}}', { firstName: '' }),
		).toBe('Hey there')
		expect(
			interpolateMergeTags('Hey {{firstName|there}}', { firstName: 'Alex' }),
		).toBe('Hey Alex')
	})

	it('uses the fallback for unknown tags and clears them otherwise', () => {
		expect(interpolateMergeTags('{{missing|fallback}}', {})).toBe('fallback')
		expect(interpolateMergeTags('{{missing}}', {})).toBe('')
	})

	it('escapes both the value and the fallback in html output', () => {
		expect(
			interpolateMergeTagsHtml('<p>{{firstName|a<b}}</p>', { firstName: '' }),
		).toBe('<p>a&lt;b</p>')
		expect(
			interpolateMergeTagsHtml('<p>{{firstName|there}}</p>', {
				firstName: '<script>',
			}),
		).toBe('<p>&lt;script&gt;</p>')
	})

	it('escapes the fallback of a designed email once', async () => {
		// React escapes the fallback when the email is designed.
		const { html } = await renderMarketingEmail({
			blocks: [
				{
					id: 'block-1',
					type: 'body',
					config: { text: `Hey {{firstName|friend's & co}}` },
				},
			],
			theme: resolveEmailTheme({ organizationName: 'Acme' }),
		})
		expect(html).toContain('{{firstName|friend&#x27;s &amp; co}}')

		const sent = interpolateMergeTagsHtml(html, { firstName: '' })
		expect(sent).toContain('Hey friend&#39;s &amp; co')
		expect(sent).not.toContain('&amp;amp;')
		expect(sent).not.toContain('&amp;#x27;')
	})

	it('treats an escaped and a raw fallback alike', () => {
		const escaped = '<p>{{firstName|a &lt;b&gt; &amp; &quot;c&quot;}}</p>'
		const raw = '<p>{{firstName|a <b> & "c"}}</p>'
		const expected = '<p>a &lt;b&gt; &amp; &quot;c&quot;</p>'
		expect(interpolateMergeTagsHtml(escaped, { firstName: '' })).toBe(expected)
		expect(interpolateMergeTagsHtml(raw, { firstName: '' })).toBe(expected)
		expect(interpolateMergeTagsHtml('{{missing|&lt;i&gt;}}', {})).toBe(
			'&lt;i&gt;',
		)
	})

	it('escapes recipient values as they are, entities included', () => {
		expect(
			interpolateMergeTagsHtml('<p>{{firstName|friend}}</p>', {
				firstName: 'AT&amp;T <b>',
			}),
		).toBe('<p>AT&amp;amp;T &lt;b&gt;</p>')
	})
})
