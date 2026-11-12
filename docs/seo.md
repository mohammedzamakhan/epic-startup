# SEO

Remix has built-in support for setting up `meta` tags on a per-route basis which
you can read about
[in the Remix Metadata docs](https://remix.run/docs/en/main/route/meta).

The Epic Stack also has built-in support for `/robots.txt` and `/sitemap.xml`
via [resource routes](https://remix.run/docs/en/main/guides/resource-routes)
using [`@nasa-gcn/remix-seo`](https://github.com/nasa-gcn/remix-seo). By
default, all routes are included in the `sitemap.xml` file, but you can
configure which routes are included using the `handle` export in the route. Only
public-facing pages should be included in the `sitemap.xml` file.

Here are two quick examples of how to customize the sitemap on a per-route basis
from the `@nasa-gcn/remix-seo` docs:

```tsx
// routes/blog/_layout.tsx
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { serverOnly$ } from 'vite-env-only/macros'

export const handle: SEOHandle = {
	getSitemapEntries: serverOnly$(async (request) => {
		const blogs = await db.blog.findMany()
		return blogs.map((blog) => {
			return { route: `/blog/${blog.slug}`, priority: 0.7 }
		})
	}),
}
```

Note the use of
[`vite-env-only/macros`](https://github.com/pcattori/vite-env-only). This is
because `handle` is a route export object that goes in both the client as well
as the server, but our sitemap function should only be run on the server. So we
use `vite-env-only/macros` to make sure the function is removed for the client
build. Support for this is pre-configured in the `vite.config.ts` file.

```tsx
// in your routes/url-that-doesnt-need-sitemap
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { type Route } from './+types/sitemap[.]xml.ts'

export async function loader({ request }: Route.LoaderArgs) {
	/**/
}

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}
```

## Tenant sites (`apps/sites`)

Each published site answers its own `/robots.txt`, `/sitemap.xml` and
`/llms.txt` on its own host (a `*.<sites domain>` subdomain or a custom domain).
They are Astro routes in `apps/sites/src/pages`, not static files, so every site
lists its own pages. Builders live in `apps/sites/src/lib/seo-files.ts` and the
data comes from `loadSiteSeoData` (`seo-data.ts`).

- `robots.txt` points at that site's sitemap and keeps account, login and
  checkout pages out of search, once per language prefix (`/login` and
  `/ar/login`), because robots rules match by prefix. A host with no published
  site gets `Disallow: /`, never cached.
- `sitemap.xml` lists the home page, every published page that is not marked
  "hide from search engines", the shop product when there is one, and the
  careers page and open postings when hiring is on. A home page marked "hide
  from search engines" is left out too; `/` is listed only when the site has no
  CMS home page at all. Each URL is listed once per language with `hreflang`
  alternates.
- `llms.txt` ([llmstxt.org](https://llmstxt.org)) is a short Markdown summary
  for AI assistants: the site name, its description and its pages.
- All three exist only at the site root. A language-prefixed copy such as
  `/ar/sitemap.xml` is a 404. Responses are cached for five minutes by the
  route's own `Cache-Control`; the middleware keeps these paths out of its
  published-HTML edge cache so that header is the one clients see.
- If the page list cannot be loaded (App down, rate limited), `sitemap.xml` and
  `llms.txt` answer `503` with `Retry-After` and `no-store` rather than a
  near-empty 200 that crawlers would trust.
- Page data comes from the App's public `GET /resources/sites/pages` (by `slug`
  or custom `host`). It is rate limited, public content only, and answers 404
  until the site is published. Drafts and `seoNoIndex` pages are never listed;
  `homePage` (`none`, `indexable` or `noindex`) tells Sites whether to add `/`.
  At most 500 pages are listed (logged when reached).
- A vertical that adds public pages (a menu, say) extends `loadSiteSeoData` with
  its own paths and `llms.txt` links.

### Structured data on the home page

The home page also carries a `<script type="application/ld+json">` block with
schema.org [`Organization`](https://schema.org/Organization) and
[`WebSite`](https://schema.org/WebSite) data
(`apps/sites/src/lib/site-jsonld.ts`, pure and unit tested), which helps search
engines show the site's name and logo.

- One `@graph`: the `Organization` (name, URL, logo from the site icon) and the
  `WebSite` (name, the home URL in the page's language, `inLanguage`, the search
  description when the page has one), linked with `publisher`.
- A field without data is left out, never guessed. Public facts only; no extra
  fetch. Preview renders skip it.
- The JSON is escaped with `serializeJsonLd`, like the careers `JobPosting`
  data, so it cannot close the script tag.
- A vertical with a more specific type (a `Restaurant`, a `LocalBusiness`) can
  replace or extend this graph on its own home page.

Validate a live site with Google's
[Rich Results Test](https://search.google.com/test/rich-results) or the
[Schema Markup Validator](https://validator.schema.org/).
