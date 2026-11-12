import { type APIRoute } from 'astro'
import { buildRobotsTxt } from '~/lib/seo-files'
import {
	isRootSeoRequest,
	notFound,
	seoOrigin,
	textResponse,
} from '~/lib/seo-response'

export const prerender = false

/**
 * Per-site `robots.txt`: points crawlers at this site's sitemap, keeps account
 * and checkout pages out of search, and closes hosts with no published site.
 */
export const GET: APIRoute = (context) => {
	if (!isRootSeoRequest(context)) return notFound()
	const organization = context.locals.organization
	return textResponse(
		buildRobotsTxt({
			origin: seoOrigin(context),
			indexable: organization !== null,
			locales: {
				locales: organization?.locales?.length ? organization.locales : ['en'],
				defaultLocale: context.locals.defaultLocale,
			},
		}),
		'text/plain; charset=utf-8',
		200,
		// A host that is not published yet answers `Disallow: /`; never let that
		// outlive the publish.
		organization ? undefined : 'no-store',
	)
}
