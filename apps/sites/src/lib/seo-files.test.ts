import { describe, expect, it } from 'vitest'
import {
	buildLlmsTxt,
	buildRobotsTxt,
	buildSitemapXml,
	pagePath,
} from './seo-files'

const origin = 'https://studio.example'

describe('robots.txt', () => {
	it('points at the sitemap and keeps account and checkout pages out', () => {
		const robots = buildRobotsTxt({ origin, indexable: true })
		expect(robots).toContain('Allow: /\n')
		expect(robots).toContain('Disallow: /login')
		expect(robots).toContain('Disallow: /profile')
		expect(robots).toContain('Disallow: /shop/')
		expect(robots).toContain('Sitemap: https://studio.example/sitemap.xml')
	})

	it('closes a host with no published site', () => {
		expect(buildRobotsTxt({ origin, indexable: false })).toBe(
			'User-agent: *\nDisallow: /\n',
		)
	})
})

describe('pagePath', () => {
	it('maps the home page and its legacy slugs to /', () => {
		expect(pagePath('about', true)).toBe('/')
		expect(pagePath('')).toBe('/')
		expect(pagePath('home')).toBe('/')
	})

	it('encodes each segment', () => {
		expect(pagePath('/our story/')).toBe('/our%20story')
		expect(pagePath('events/summer')).toBe('/events/summer')
	})
})

describe('sitemap.xml', () => {
	it('lists each page once, with a date-only lastmod', () => {
		const xml = buildSitemapXml(
			origin,
			[
				{ path: '/', lastModified: '2026-11-01T10:00:00.000Z' },
				{ path: '/careers' },
				{ path: '/careers' },
			],
			{ locales: ['en'], defaultLocale: 'en' },
		)
		expect(xml.match(/<url>/g)).toHaveLength(2)
		expect(xml).toContain('<loc>https://studio.example/</loc>')
		expect(xml).toContain('<lastmod>2026-11-01</lastmod>')
		expect(xml).not.toContain('xhtml')
	})

	it('lists every language with hreflang alternates', () => {
		const xml = buildSitemapXml(origin, [{ path: '/about' }], {
			locales: ['ar', 'en'],
			defaultLocale: 'ar',
		})
		expect(xml).toContain('<loc>https://studio.example/about</loc>')
		expect(xml).toContain('<loc>https://studio.example/en/about</loc>')
		expect(xml).toContain(
			'hreflang="x-default" href="https://studio.example/about"',
		)
		expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"')
	})

	it('escapes XML', () => {
		const xml = buildSitemapXml(origin, [{ path: '/a&b' }], {
			locales: ['en'],
			defaultLocale: 'en',
		})
		expect(xml).toContain('/a&amp;b')
	})
})

describe('llms.txt', () => {
	const base = {
		origin,
		name: 'Studio [North]',
		description: 'Design and print\nfor small teams.',
		locales: { locales: ['en', 'ar'], defaultLocale: 'en' },
		links: [
			{ title: 'Careers', path: '/careers' },
			{ title: 'About us', path: '/about', description: 'Our story' },
		],
	}

	it('summarizes the site in Markdown', () => {
		const text = buildLlmsTxt(base)
		expect(
			text.startsWith(
				'# Studio \\[North\\]\n\n> Design and print for small teams.\n',
			),
		).toBe(true)
		expect(text).toContain('Official website: https://studio.example/')
		expect(text).toContain('Languages: en, ar')
		expect(text).toContain('- [Careers](https://studio.example/careers)\n')
		expect(text).toContain(
			'- [About us](https://studio.example/about): Our story',
		)
		expect(text.endsWith('\n')).toBe(true)
	})

	it('leaves out the description, languages and pages when there are none', () => {
		const text = buildLlmsTxt({
			origin,
			name: 'Studio',
			locales: { locales: ['en'], defaultLocale: 'en' },
			links: [],
		})
		expect(text).toBe('# Studio\n\nOfficial website: https://studio.example/\n')
	})
})
