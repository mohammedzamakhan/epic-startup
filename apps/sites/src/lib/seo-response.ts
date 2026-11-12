import { type APIContext } from 'astro'

/**
 * Shared bits of the `robots.txt`, `sitemap.xml` and `llms.txt` routes. They
 * live only at the site root: a language-prefixed copy (`/ar/sitemap.xml`,
 * which the middleware rewrites here) is a 404.
 */
export function isRootSeoRequest(context: APIContext): boolean {
	return context.locals.requestedLocale === context.locals.defaultLocale
}

export function seoOrigin(context: APIContext): string {
	return context.url.origin
}

export function textResponse(
	body: string,
	contentType: string,
	status = 200,
	cacheControl?: string,
): Response {
	return new Response(body, {
		status,
		headers: {
			'Content-Type': contentType,
			// Short at the edge so a publish shows up within minutes. The
			// middleware leaves these paths out of its HTML cache, so this is the
			// header clients see.
			'Cache-Control':
				cacheControl ??
				(status === 200
					? 'public, max-age=300, s-maxage=300, stale-while-revalidate=3600'
					: 'no-store'),
		},
	})
}

export function notFound(): Response {
	return textResponse('Not Found', 'text/plain; charset=utf-8', 404)
}

/**
 * The page list could not be loaded (App down, rate limited). Crawlers retry a
 * 503 and do not trust it, unlike a short sitemap served as a 200.
 */
export function serviceUnavailable(): Response {
	const response = textResponse(
		'Service Unavailable',
		'text/plain; charset=utf-8',
		503,
	)
	response.headers.set('Retry-After', '60')
	return response
}
