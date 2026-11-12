import { getLocaleHref } from '@repo/common/site-locales'

/**
 * Builders for the per-site `robots.txt`, `sitemap.xml` and `llms.txt`.
 * Pure: the routes in `src/pages` fetch the data and pass it in.
 *
 * Only public content goes in: published pages and open job postings. Never
 * customer data.
 */

export type SitemapEntry = {
	/** Root-relative path in the default language, e.g. `/` or `/about`. */
	path: string
	lastModified?: string | null
}

export type SeoLocales = {
	locales: string[]
	defaultLocale: string
}

/** Paths that are never useful in search results. */
const DISALLOWED_PATHS = [
	'/api/',
	'/login',
	'/verify',
	'/complete-name',
	'/profile',
	'/shop/',
]

export function buildRobotsTxt(options: {
	origin: string
	/** False when the host serves no published site. */
	indexable: boolean
}): string {
	if (!options.indexable) {
		return 'User-agent: *\nDisallow: /\n'
	}
	return [
		'User-agent: *',
		'Allow: /',
		...DISALLOWED_PATHS.map((path) => `Disallow: ${path}`),
		'',
		`Sitemap: ${options.origin}/sitemap.xml`,
		'',
	].join('\n')
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;')
}

function localizedUrl(
	origin: string,
	path: string,
	locale: string,
	defaultLocale: string,
): string {
	return `${origin}${getLocaleHref(path, locale, null, defaultLocale)}`
}

/** Normalize a page slug into a root-relative path (`''` / `home` is `/`). */
export function pagePath(slug: string, isHomePage = false): string {
	const clean = slug.replace(/^\/+|\/+$/g, '')
	if (isHomePage || clean === '' || clean === 'home') return '/'
	return `/${clean
		.split('/')
		.map((segment) => encodeURIComponent(segment))
		.join('/')}`
}

/**
 * One `<url>` per path and language, each listing every language version
 * (`xhtml:link` hreflang), matching the alternates the pages themselves emit.
 */
export function buildSitemapXml(
	origin: string,
	entries: SitemapEntry[],
	{ locales, defaultLocale }: SeoLocales,
): string {
	const languages = locales.length ? locales : [defaultLocale]
	const seen = new Set<string>()
	const unique = entries.filter((entry) => {
		if (seen.has(entry.path)) return false
		seen.add(entry.path)
		return true
	})
	const multilingual = languages.length > 1

	const urls = unique.flatMap((entry) =>
		languages.map((locale) => {
			const lines = [
				'  <url>',
				`    <loc>${escapeXml(localizedUrl(origin, entry.path, locale, defaultLocale))}</loc>`,
			]
			const lastModified = entry.lastModified?.slice(0, 10)
			if (lastModified && /^\d{4}-\d{2}-\d{2}$/.test(lastModified)) {
				lines.push(`    <lastmod>${lastModified}</lastmod>`)
			}
			if (multilingual) {
				for (const alternate of languages) {
					lines.push(
						`    <xhtml:link rel="alternate" hreflang="${escapeXml(alternate)}" href="${escapeXml(localizedUrl(origin, entry.path, alternate, defaultLocale))}"/>`,
					)
				}
				lines.push(
					`    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(localizedUrl(origin, entry.path, defaultLocale, defaultLocale))}"/>`,
				)
			}
			lines.push('  </url>')
			return lines.join('\n')
		}),
	)

	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${multilingual ? ' xmlns:xhtml="http://www.w3.org/1999/xhtml"' : ''}>`,
		...urls,
		'</urlset>',
		'',
	].join('\n')
}

// ---------------------------------------------------------------------------
// llms.txt (https://llmstxt.org): a Markdown summary written for AI assistants.
// ---------------------------------------------------------------------------

export type LlmsInput = {
	origin: string
	name: string
	description?: string | null
	locales: SeoLocales
	links: Array<{ title: string; path: string; description?: string | null }>
}

/** One line of Markdown text: no line breaks, no stray link syntax. */
function inline(value: string | null | undefined): string {
	return (value ?? '')
		.replace(/\s+/g, ' ')
		.replace(/([[\]])/g, '\\$1')
		.trim()
}

export function buildLlmsTxt(input: LlmsInput): string {
	const { origin, locales } = input
	const lines: string[] = [`# ${inline(input.name)}`, '']
	if (input.description) {
		lines.push(`> ${inline(input.description)}`, '')
	}
	lines.push(`Official website: ${origin}/`)
	if (locales.locales.length > 1) {
		lines.push(`Languages: ${locales.locales.join(', ')}`)
	}
	lines.push('')

	if (input.links.length) {
		lines.push('## Pages', '')
		for (const link of input.links) {
			const description = inline(link.description)
			lines.push(
				`- [${inline(link.title)}](${origin}${getLocaleHref(link.path, locales.defaultLocale, null, locales.defaultLocale)})${description ? `: ${description}` : ''}`,
			)
		}
		lines.push('')
	}

	return `${lines.join('\n').trimEnd()}\n`
}
