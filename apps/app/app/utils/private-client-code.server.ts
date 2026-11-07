import {
	isPrivateManifestRoute,
	PRIVATE_ASSETS_URL_PREFIX,
	ROUTE_MANIFEST_FILE,
} from './route-visibility.ts'

/** React Router's lazy route discovery endpoint (`routeDiscovery.manifestPath`). */
export const ROUTE_DISCOVERY_PATH = '/__manifest'

type AssetFetcher = { fetch(request: Request): Promise<Response> }
type SessionCheck = (request: Request) => Promise<boolean>

function notFound() {
	return new Response('Not Found', {
		status: 404,
		headers: {
			'Content-Type': 'text/plain; charset=utf-8',
			'Cache-Control': 'no-store',
		},
	})
}

/**
 * Serves `/assets/app/*` (logged-in UI code) only with a valid session and
 * hides React Router's full route manifest file. Returns null for any other
 * path, so the caller continues with the React Router handler.
 *
 * `wrangler.jsonc` routes these paths to the Worker first
 * (`assets.run_worker_first`); everything else in `/assets/` is served by
 * Cloudflare before the Worker runs.
 */
export async function serveGatedAsset(
	request: Request,
	{ assets, hasSession }: { assets?: AssetFetcher; hasSession: SessionCheck },
): Promise<Response | null> {
	const { pathname } = new URL(request.url)

	if (ROUTE_MANIFEST_FILE.test(pathname)) return notFound()
	if (!pathname.startsWith(PRIVATE_ASSETS_URL_PREFIX)) return null
	// Same answer for a missing file and a missing session, so the 404 does not
	// confirm that a guessed file name exists.
	if (!assets || !(await hasSession(request))) return notFound()

	const response = await assets.fetch(request)
	if (!response.ok) return notFound()
	const headers = new Headers(response.headers)
	// Hashed file names never change, but no shared cache may keep a copy and
	// hand it to someone without a session.
	headers.set('Cache-Control', 'private, max-age=31536000, immutable')
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	})
}

/**
 * Filters React Router's `/__manifest` answer by session.
 *
 * With a session, the answer is passed through, marked private (React Router
 * marks it public and immutable). Without one, any answer that would name a
 * private route becomes `204` + `X-Remix-Reload-Document`, which tells the
 * client to load the URL as a document instead: the server then redirects to
 * the login page as usual. Answers that name only public routes pass through.
 */
export async function filterRouteDiscovery(
	request: Request,
	response: Response,
	{ hasSession }: { hasSession: SessionCheck },
): Promise<Response> {
	const { pathname } = new URL(request.url)
	if (pathname !== ROUTE_DISCOVERY_PATH || response.status !== 200) {
		return response
	}

	const headers = new Headers(response.headers)
	if (await hasSession(request)) {
		headers.set('Cache-Control', 'private, max-age=3600')
		return new Response(response.body, { status: 200, headers })
	}

	let patches: Record<string, unknown>
	try {
		patches = (await response.json()) as Record<string, unknown>
	} catch {
		return notFound()
	}
	const namesPrivateRoute = Object.values(patches).some((route) =>
		isPrivateManifestRoute(
			route as Parameters<typeof isPrivateManifestRoute>[0],
		),
	)
	if (namesPrivateRoute) {
		return new Response(null, {
			status: 204,
			headers: {
				'X-Remix-Reload-Document': 'true',
				'Cache-Control': 'no-store',
			},
		})
	}
	headers.set('Cache-Control', 'private, no-store')
	headers.delete('Content-Length')
	return Response.json(patches, { status: 200, headers })
}

type DocumentContext = {
	manifest: { routes: Record<string, unknown> }
	staticHandlerContext: { matches: ReadonlyArray<{ route: { id: string } }> }
}

/**
 * The route manifest a document may carry. React Router serializes the
 * routes matched for the URL and for its ancestor paths into the page; for
 * `/signup` that includes `/`, the logged-in dashboard. Without a session,
 * every private route that is not matched for this request is left out, so a
 * public page names no private module. The client discovers the rest through
 * `/__manifest` ({@link filterRouteDiscovery}).
 */
export function documentContextFor<Context extends DocumentContext>(
	context: Context,
	{ authenticated }: { authenticated: boolean },
): Context {
	if (authenticated) return context
	const matched = new Set(
		context.staticHandlerContext.matches.map((match) => match.route.id),
	)
	const routes = Object.fromEntries(
		Object.entries(context.manifest.routes).filter(
			([id, route]) =>
				matched.has(id) ||
				!isPrivateManifestRoute(
					route as Parameters<typeof isPrivateManifestRoute>[0],
				),
		),
	)
	return { ...context, manifest: { ...context.manifest, routes } }
}
