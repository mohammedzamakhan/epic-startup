import { beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({
	GOOGLE_API_KEY: 'test-key' as string | undefined,
}))

vi.mock('#app/utils/env.server.ts', () => ({ ENV: env }))

const { isTranslationConfigured, translateTexts, TranslationUnavailableError } =
	await import('./translate.server.ts')

function reply(body: unknown, status = 200) {
	return vi.fn(async () => Response.json(body, { status }))
}

describe('translateTexts', () => {
	beforeEach(() => {
		env.GOOGLE_API_KEY = 'test-key'
	})

	it('sends the texts with the languages and format, and returns the translations', async () => {
		const fetchImpl = reply({
			data: {
				translations: [{ translatedText: 'Hola' }, { translatedText: 'Adiós' }],
			},
		})
		const result = await translateTexts({
			texts: ['Hello', 'Bye'],
			sourceLang: 'en',
			targetLang: 'es',
			format: 'text',
			fetchImpl: fetchImpl as never,
		})
		expect(result).toEqual(['Hola', 'Adiós'])
		const [url, init] = fetchImpl.mock.calls[0] as unknown as [
			string,
			RequestInit,
		]
		expect(url).not.toContain('key=')
		expect(init.headers).toMatchObject({ 'X-Goog-Api-Key': 'test-key' })
		expect(JSON.parse(init.body as string)).toEqual({
			q: ['Hello', 'Bye'],
			source: 'en',
			target: 'es',
			format: 'text',
		})
	})

	it('does not call the API for an empty list', async () => {
		const fetchImpl = reply({})
		await expect(
			translateTexts({
				texts: [],
				sourceLang: 'en',
				targetLang: 'es',
				format: 'html',
				fetchImpl: fetchImpl as never,
			}),
		).resolves.toEqual([])
		expect(fetchImpl).not.toHaveBeenCalled()
	})

	it('refuses when no API key is set', async () => {
		env.GOOGLE_API_KEY = undefined
		expect(isTranslationConfigured()).toBe(false)
		await expect(
			translateTexts({
				texts: ['Hi'],
				sourceLang: 'en',
				targetLang: 'es',
				format: 'text',
				fetchImpl: reply({}) as never,
			}),
		).rejects.toBeInstanceOf(TranslationUnavailableError)
	})

	it('fails when the API errors or returns the wrong number of texts', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {})
		const base = {
			texts: ['Hi'],
			sourceLang: 'en',
			targetLang: 'es',
			format: 'text' as const,
		}
		await expect(
			translateTexts({ ...base, fetchImpl: reply({}, 500) as never }),
		).rejects.toThrow('Failed to translate text.')
		await expect(
			translateTexts({
				...base,
				fetchImpl: reply({ data: { translations: [] } }) as never,
			}),
		).rejects.toThrow('Failed to translate text.')
	})
})
