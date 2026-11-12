import { msg } from '@lingui/core/macro'
import { createSiteI18n } from '~/lib/i18n'
import {
	type PublicOrganization,
	fetchPublishedCareers,
	fetchPublishedShopProduct,
	fetchPublishedSitePages,
} from '~/lib/org'
import {
	type LlmsInput,
	type SeoLocales,
	type SitemapEntry,
	pagePath,
} from '~/lib/seo-files'

export type SiteSeoData = {
	locales: SeoLocales
	sitemap: SitemapEntry[]
	llms: Omit<LlmsInput, 'origin'>
}

/**
 * Everything public that `sitemap.xml` and `llms.txt` list for one site. Each
 * source is optional: a module that is off (or a call that fails) just leaves
 * its pages out. `null` means the page list itself could not be loaded, so the
 * caller answers 503 instead of publishing a near-empty file.
 */
export async function loadSiteSeoData(
	organization: PublicOrganization,
	where: { slug: string | null; host: string | null },
): Promise<SiteSeoData | null> {
	const locales: SeoLocales = {
		locales: organization.locales?.length ? organization.locales : ['en'],
		defaultLocale: organization.defaultLocale ?? 'en',
	}

	const [pageList, careers, shop] = await Promise.all([
		fetchPublishedSitePages(where),
		fetchPublishedCareers({ ...where, locale: locales.defaultLocale }),
		fetchPublishedShopProduct(where),
	])

	if (!pageList) return null
	const { pages, homePage } = pageList

	const sitemap: SitemapEntry[] = []
	const links: LlmsInput['links'] = []
	let description: string | null = null

	for (const page of pages) {
		const path = pagePath(page.slug, page.isHomePage)
		sitemap.push({ path, lastModified: page.updatedAt })
		if (path === '/') {
			description ??= page.description
			continue
		}
		links.push({ title: page.title, path, description: page.description })
	}
	// A site with no CMS home page still serves `/`. One whose home page is
	// marked "hide from search engines" must not list it.
	if (homePage === 'none' && !sitemap.some((entry) => entry.path === '/')) {
		sitemap.unshift({ path: '/' })
	}

	if (shop?.available) {
		sitemap.push({ path: '/shop' })
		links.push({ title: shop.product.name, path: '/shop' })
	}

	const postings = careers?.postings ?? []
	if (postings.length) {
		sitemap.push({ path: '/careers' })
		const careersTitle = createSiteI18n(locales.defaultLocale)._(msg`Careers`)
		links.push({ title: careersTitle, path: '/careers' })
		for (const posting of postings) {
			sitemap.push({ path: `/careers/${encodeURIComponent(posting.slug)}` })
		}
	}

	return {
		locales,
		sitemap,
		llms: {
			name: organization.name,
			description,
			locales,
			links,
		},
	}
}
