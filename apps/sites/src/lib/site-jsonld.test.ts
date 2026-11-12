import { describe, expect, it } from 'vitest'
import { buildSiteJsonLd, siteStructuredData } from './site-jsonld'

const base = {
	origin: 'https://studio.example',
	name: 'Studio North',
	locale: 'en',
	defaultLocale: 'en',
}

describe('buildSiteJsonLd', () => {
	it('links the WebSite to its Organization', () => {
		const data = buildSiteJsonLd({
			...base,
			logoUrl: 'https://studio.example/logo.png',
			description: 'Design   for\nsmall teams.',
		})
		expect(data).toEqual({
			'@context': 'https://schema.org',
			'@graph': [
				{
					'@type': 'Organization',
					'@id': 'https://studio.example/#organization',
					name: 'Studio North',
					url: 'https://studio.example/',
					logo: {
						'@type': 'ImageObject',
						url: 'https://studio.example/logo.png',
					},
				},
				{
					'@type': 'WebSite',
					'@id': 'https://studio.example/#website',
					name: 'Studio North',
					url: 'https://studio.example/',
					inLanguage: 'en',
					publisher: { '@id': 'https://studio.example/#organization' },
					description: 'Design for small teams.',
				},
			],
		})
	})

	it('leaves out what it has no data for', () => {
		const data = buildSiteJsonLd({
			...base,
			logoUrl: 'data:image/png;base64,AAA',
		})
		const [organization, website] = (
			data as { '@graph': Record<string, unknown>[] }
		)['@graph']
		expect(organization).not.toHaveProperty('logo')
		expect(website).not.toHaveProperty('description')
	})

	it('points the WebSite at the page language', () => {
		const data = buildSiteJsonLd({ ...base, locale: 'ar' }) as {
			'@graph': Record<string, unknown>[]
		}
		expect(data['@graph'][1]).toMatchObject({
			url: 'https://studio.example/ar',
			inLanguage: 'ar',
		})
		expect(data['@graph'][0]).toMatchObject({ url: 'https://studio.example/' })
	})

	it('writes nothing without a name', () => {
		expect(buildSiteJsonLd({ ...base, name: '  ' })).toBeNull()
		expect(siteStructuredData({ ...base, name: '' })).toBeNull()
	})
})

describe('siteStructuredData', () => {
	it('escapes characters that could close the script tag', () => {
		const text = siteStructuredData({ ...base, name: '</script><b>&' })!
		expect(text).not.toContain('</script>')
		expect(text).toContain('\\u003c')
		expect(JSON.parse(text)['@graph'][0].name).toBe('</script><b>&')
	})
})
