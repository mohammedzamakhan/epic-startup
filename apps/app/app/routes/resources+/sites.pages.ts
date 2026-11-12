import {
	parseSiteLocalesConfig,
	pickLocalized,
} from '@repo/common/site-locales'
import {
	and,
	asc,
	db,
	eq,
	inArray,
	Organization,
	WebsitePage,
} from '@repo/database'
import { getClientIp } from '@repo/security'
import { type LoaderFunctionArgs } from 'react-router'
import {
	checkRateLimit,
	createRateLimitResponse,
	PUBLIC_SITE_RATE_LIMIT,
} from '#app/utils/rate-limit.server.ts'

/**
 * Most pages one answer lists. Search engines take 50,000 URLs per sitemap and
 * Sites repeats each page once per language, so 500 stays far below that. A
 * site with more pages is cut off here, and it is logged.
 */
const MAX_LISTED_PAGES = 500

export type PublicSitePageListing = {
	slug: string
	isHomePage: boolean
	/** In the site's default language. */
	title: string
	description: string | null
	updatedAt: string
}

export type PublicSitePagesPayload = {
	pages: PublicSitePageListing[]
	/**
	 * What the site's home page is, whether or not it is listed: `none` (no CMS
	 * home page, so Sites falls back to `/`), `indexable`, or `noindex` (marked
	 * "hide from search engines", so `/` must stay out of the sitemap).
	 */
	homePage: 'none' | 'indexable' | 'noindex'
}

/**
 * The published, indexable pages of an organization's site, for Sites'
 * `sitemap.xml` and `llms.txt`: `GET /resources/sites/pages?slug=acme` or
 * `?host=www.acme.com`.
 *
 * Public content only. Drafts and pages marked "hide from search engines" are
 * left out of `pages` (the home page's state is still reported in `homePage`),
 * and it answers 404 until the site is published.
 */
export async function loader({ request }: LoaderFunctionArgs) {
	const url = new URL(request.url)
	const slug = url.searchParams.get('slug')?.trim().toLowerCase() || null
	const host =
		url.searchParams.get('host')?.trim().toLowerCase().split(':')[0] || null
	if (!slug && !host) throw new Response('Not Found', { status: 404 })

	const rateLimit = await checkRateLimit(
		{ type: 'ip', value: getClientIp(request) },
		PUBLIC_SITE_RATE_LIMIT,
	)
	if (!rateLimit.allowed) return createRateLimitResponse(rateLimit.resetAt)

	const [org] = await db
		.select({
			id: Organization.id,
			siteLocales: Organization.siteLocales,
			siteDefaultLocale: Organization.siteDefaultLocale,
		})
		.from(Organization)
		.where(
			and(
				slug
					? eq(Organization.slug, slug)
					: and(
							eq(Organization.customDomain, host!),
							inArray(Organization.customDomainStatus, ['active', 'pending']),
						),
				eq(Organization.active, true),
				eq(Organization.sitePublished, true),
			),
		)
		.limit(1)
	if (!org) throw new Response('Not Found', { status: 404 })

	const { defaultLocale } = parseSiteLocalesConfig(
		org.siteLocales,
		org.siteDefaultLocale,
	)

	const rows = await db
		.select({
			slug: WebsitePage.slug,
			isHomePage: WebsitePage.isHomePage,
			title: WebsitePage.title,
			seoTitle: WebsitePage.seoTitle,
			seoDescription: WebsitePage.seoDescription,
			seoNoIndex: WebsitePage.seoNoIndex,
			updatedAt: WebsitePage.updatedAt,
		})
		.from(WebsitePage)
		.where(
			and(
				eq(WebsitePage.organizationId, org.id),
				eq(WebsitePage.status, 'published'),
			),
		)
		.orderBy(asc(WebsitePage.position), asc(WebsitePage.createdAt))
		.limit(MAX_LISTED_PAGES)

	if (rows.length === MAX_LISTED_PAGES) {
		console.warn(
			`sites/pages: organization ${org.id} reached the ${MAX_LISTED_PAGES} page cap`,
		)
	}

	const home = rows.find((row) => row.isHomePage)
	const homePage: PublicSitePagesPayload['homePage'] = !home
		? 'none'
		: home.seoNoIndex
			? 'noindex'
			: 'indexable'

	const pages: PublicSitePageListing[] = rows
		.filter((row) => !row.seoNoIndex)
		.map((row) => {
			const title =
				(row.seoTitle
					? pickLocalized(row.seoTitle, defaultLocale, defaultLocale)
					: '') ||
				pickLocalized(row.title, defaultLocale, defaultLocale) ||
				row.slug
			const description = row.seoDescription
				? pickLocalized(row.seoDescription, defaultLocale, defaultLocale) ||
					null
				: null
			return {
				slug: row.slug,
				isHomePage: row.isHomePage,
				title,
				description,
				updatedAt: row.updatedAt.toISOString(),
			}
		})

	return Response.json({ pages, homePage } satisfies PublicSitePagesPayload, {
		headers: { 'Cache-Control': 'public, max-age=300' },
	})
}
