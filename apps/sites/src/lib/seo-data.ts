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
 * its pages out.
 */
export async function loadSiteSeoData(
	organization: PublicOrganization,
	where: { slug: string | null; host: string | null },
): Promise<SiteSeoData> {
	const locales: SeoLocales = {
		locales: organization.locales?.length ? organization.locales : ['en'],
		defaultLocale: organization.defaultLocale ?? 'en',
	}

	const [pages, careers, shop] = await Promise.all([
		fetchPublishedSitePages(where),
		fetchPublishedCareers({ ...where, locale: locales.defaultLocale }),
		fetchPublishedShopProduct(where),
	])

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
	if (!sitemap.some((entry) => entry.path === '/')) {
		sitemap.unshift({ path: '/' })
	}

	if (shop?.available) {
		sitemap.push({ path: '/shop' })
		links.push({ title: shop.product.name, path: '/shop' })
	}

	const postings = careers?.postings ?? []
	if (postings.length) {
		sitemap.push({ path: '/careers' })
		links.push({ title: 'Careers', path: '/careers' })
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
