import { describe, expect, it, vi } from 'vitest'

const org = vi.hoisted(() => ({
	fetchPublishedSitePages: vi.fn(),
	fetchPublishedCareers: vi.fn(),
	fetchPublishedShopProduct: vi.fn(),
}))

vi.mock('~/lib/org', () => org)
// The real catalogs are loaded by the Lingui Vite plugin, which Vitest does not
// run; the test only needs to see that the default language is asked for.
vi.mock('~/lib/i18n', () => ({
	createSiteI18n: (locale: string) => ({
		_: (message: { message?: string; id?: string }) =>
			`${locale}:${message.message ?? message.id}`,
	}),
}))

const { loadSiteSeoData } = await import('./seo-data')

const where = { slug: 'studio', host: null }
const organization = {
	id: 'o1',
	name: 'Studio',
	slug: 'studio',
	locales: ['en', 'ar'],
	defaultLocale: 'ar',
}

const home = {
	slug: 'home',
	isHomePage: true,
	title: 'Home',
	description: 'Welcome',
	updatedAt: '2026-11-01T00:00:00.000Z',
}

function noOptionalModules() {
	org.fetchPublishedCareers.mockResolvedValue(null)
	org.fetchPublishedShopProduct.mockResolvedValue(null)
}

describe('loadSiteSeoData', () => {
	it('lists the home page and the other published pages', async () => {
		noOptionalModules()
		org.fetchPublishedSitePages.mockResolvedValue({
			pages: [
				home,
				{ ...home, slug: 'about', isHomePage: false, title: 'About' },
			],
			homePage: 'indexable',
		})
		const data = await loadSiteSeoData(organization as never, where)
		expect(data?.sitemap.map((entry) => entry.path)).toEqual(['/', '/about'])
		expect(data?.llms.description).toBe('Welcome')
		expect(data?.llms.links.map((link) => link.path)).toEqual(['/about'])
	})

	it('falls back to / only when the site has no CMS home page', async () => {
		noOptionalModules()
		org.fetchPublishedSitePages.mockResolvedValue({
			pages: [],
			homePage: 'none',
		})
		const data = await loadSiteSeoData(organization as never, where)
		expect(data?.sitemap).toEqual([{ path: '/' }])
	})

	it('keeps a noindex home page out of the sitemap', async () => {
		noOptionalModules()
		org.fetchPublishedSitePages.mockResolvedValue({
			pages: [{ ...home, slug: 'about', isHomePage: false, title: 'About' }],
			homePage: 'noindex',
		})
		const data = await loadSiteSeoData(organization as never, where)
		expect(data?.sitemap.map((entry) => entry.path)).toEqual(['/about'])
	})

	it('returns null when the page list could not be loaded', async () => {
		noOptionalModules()
		org.fetchPublishedSitePages.mockResolvedValue(null)
		await expect(
			loadSiteSeoData(organization as never, where),
		).resolves.toBeNull()
	})

	it('adds careers in the default language, and the shop', async () => {
		org.fetchPublishedSitePages.mockResolvedValue({
			pages: [home],
			homePage: 'indexable',
		})
		org.fetchPublishedCareers.mockResolvedValue({
			organization: { name: 'Studio' },
			postings: [{ slug: 'designer' }],
		})
		org.fetchPublishedShopProduct.mockResolvedValue({
			available: true,
			product: { name: 'Poster' },
		})
		const data = await loadSiteSeoData(organization as never, where)
		expect(data?.sitemap.map((entry) => entry.path)).toEqual([
			'/',
			'/shop',
			'/careers',
			'/careers/designer',
		])
		// The label comes from the site's default language, not hard-coded English.
		const careers = data?.llms.links.find((link) => link.path === '/careers')
		expect(careers?.title).toBe('ar:Careers')
	})
})
