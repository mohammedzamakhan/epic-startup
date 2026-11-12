import { serializeJsonLd } from '@repo/common/job-posting'
import { getLocaleHref } from '@repo/common/site-locales'

/**
 * schema.org `Organization` and `WebSite` structured data for a site's home
 * page (https://developers.google.com/search/docs/appearance/structured-data/organization).
 * It helps search engines show the site's name and logo.
 *
 * Pure: the page passes in what it already has. Only public facts the
 * organization published go in, and a field with no data is left out rather
 * than guessed. Never customer data. A vertical with a more specific type (a
 * `Restaurant`, say) can replace or extend this graph.
 */

export type SiteJsonLdInput = {
	/** Site origin, e.g. `https://example.com` (no trailing slash). */
	origin: string
	name: string
	/** Language of the page. */
	locale: string
	defaultLocale: string
	/** Absolute URL of the site icon. */
	logoUrl?: string | null
	description?: string | null
}

type JsonObject = Record<string, unknown>

function clean(value: string | null | undefined): string {
	return (value ?? '').replace(/\s+/g, ' ').trim()
}

function isHttpUrl(value: string | null | undefined): value is string {
	return !!value && /^https?:\/\//i.test(value)
}

export function buildSiteJsonLd(input: SiteJsonLdInput): JsonObject | null {
	const name = clean(input.name)
	if (!name) return null

	const homeUrl = `${input.origin}${getLocaleHref('/', input.locale, null, input.defaultLocale)}`
	const organizationId = `${input.origin}/#organization`
	const description = clean(input.description)

	const organization: JsonObject = {
		'@type': 'Organization',
		'@id': organizationId,
		name,
		url: `${input.origin}/`,
	}
	if (isHttpUrl(input.logoUrl)) {
		organization.logo = { '@type': 'ImageObject', url: input.logoUrl }
	}

	const website: JsonObject = {
		'@type': 'WebSite',
		'@id': `${input.origin}/#website`,
		name,
		url: homeUrl,
		inLanguage: input.locale,
		publisher: { '@id': organizationId },
	}
	if (description) website.description = description

	return {
		'@context': 'https://schema.org',
		'@graph': [organization, website],
	}
}

/** The `application/ld+json` text for the home page, or `null` without a name. */
export function siteStructuredData(input: SiteJsonLdInput): string | null {
	const data = buildSiteJsonLd(input)
	return data ? serializeJsonLd(data) : null
}
