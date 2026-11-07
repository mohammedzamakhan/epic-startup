import { describe, expect, it, vi } from 'vitest'
import {
	documentContextFor,
	filterRouteDiscovery,
	serveGatedAsset,
} from './private-client-code.server.ts'
import { isPublicRouteFile } from './route-visibility.ts'

const ORIGIN = 'https://app.example.test'

function request(path: string) {
	return new Request(`${ORIGIN}${path}`)
}

const assets = {
	fetch: vi.fn(
		async () =>
			new Response('export const x = 1', {
				headers: {
					'Content-Type': 'text/javascript',
					'Cache-Control': 'public, max-age=31536000, immutable',
				},
			}),
	),
}

const withSession = async () => true
const withoutSession = async () => false

describe('serveGatedAsset', () => {
	it('answers 404 for a private chunk without a session, without reading it', async () => {
		assets.fetch.mockClear()
		const response = await serveGatedAsset(
			request('/assets/app/_layout-abc123.js'),
			{ assets, hasSession: withoutSession },
		)
		expect(response?.status).toBe(404)
		expect(response?.headers.get('Cache-Control')).toBe('no-store')
		expect(assets.fetch).not.toHaveBeenCalled()
	})

	it('serves a private chunk with a session, never as a shared-cacheable file', async () => {
		const response = await serveGatedAsset(
			request('/assets/app/_layout-abc123.js'),
			{ assets, hasSession: withSession },
		)
		expect(response?.status).toBe(200)
		expect(await response?.text()).toBe('export const x = 1')
		expect(response?.headers.get('Cache-Control')).toBe(
			'private, max-age=31536000, immutable',
		)
	})

	it('answers a missing private file like a missing session', async () => {
		const response = await serveGatedAsset(request('/assets/app/nope.js'), {
			assets: { fetch: async () => new Response('gone', { status: 404 }) },
			hasSession: withSession,
		})
		expect(response?.status).toBe(404)
		expect(await response?.text()).toBe('Not Found')
	})

	it('always hides the full route manifest file', async () => {
		for (const hasSession of [withSession, withoutSession]) {
			const response = await serveGatedAsset(
				request('/assets/manifest-e7d2b1da.js'),
				{ assets, hasSession },
			)
			expect(response?.status).toBe(404)
		}
	})

	it('leaves public assets and pages to the next handler', async () => {
		for (const path of [
			'/assets/login-abc.js',
			'/signup',
			'/assets/application.js',
		]) {
			expect(
				await serveGatedAsset(request(path), {
					assets,
					hasSession: withoutSession,
				}),
			).toBeNull()
		}
	})
})

const privateRoute = {
	id: 'routes/_app+/_layout',
	module: '/assets/app/_layout-abc.js',
	imports: ['/assets/components-1.js'],
}
const publicRoute = {
	id: 'routes/_auth+/login',
	module: '/assets/login-abc.js',
	imports: ['/assets/components-1.js'],
}

function manifestResponse(routes: Record<string, unknown>) {
	return Response.json(routes, {
		headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
	})
}

describe('filterRouteDiscovery', () => {
	it('turns a private route into a document reload for a logged-out visitor', async () => {
		const response = await filterRouteDiscovery(
			request('/__manifest?paths=%2F&version=1'),
			manifestResponse({ [privateRoute.id]: privateRoute }),
			{ hasSession: withoutSession },
		)
		expect(response.status).toBe(204)
		expect(response.headers.get('X-Remix-Reload-Document')).toBe('true')
		expect(response.headers.get('Cache-Control')).toBe('no-store')
		expect(await response.text()).toBe('')
	})

	it('also hides a private route that only appears in imports', async () => {
		const response = await filterRouteDiscovery(
			request('/__manifest?paths=%2Fx&version=1'),
			manifestResponse({
				x: { ...publicRoute, imports: ['/assets/app/settings-1.js'] },
			}),
			{ hasSession: withoutSession },
		)
		expect(response.status).toBe(204)
	})

	it('passes public routes to a logged-out visitor, marked private', async () => {
		const response = await filterRouteDiscovery(
			request('/__manifest?paths=%2Flogin&version=1'),
			manifestResponse({ [publicRoute.id]: publicRoute }),
			{ hasSession: withoutSession },
		)
		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ [publicRoute.id]: publicRoute })
		expect(response.headers.get('Cache-Control')).toBe('private, no-store')
	})

	it('passes private routes through with a session, marked private', async () => {
		const response = await filterRouteDiscovery(
			request('/__manifest?paths=%2F&version=1'),
			manifestResponse({ [privateRoute.id]: privateRoute }),
			{ hasSession: withSession },
		)
		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ [privateRoute.id]: privateRoute })
		expect(response.headers.get('Cache-Control')).toBe('private, max-age=3600')
	})

	it('leaves version-mismatch answers and other paths alone', async () => {
		const reload = new Response(null, {
			status: 204,
			headers: { 'X-Remix-Reload-Document': 'true' },
		})
		expect(
			await filterRouteDiscovery(request('/__manifest?version=old'), reload, {
				hasSession: withoutSession,
			}),
		).toBe(reload)
		const page = new Response('<html>')
		expect(
			await filterRouteDiscovery(request('/signup'), page, {
				hasSession: withoutSession,
			}),
		).toBe(page)
	})
})

describe('documentContextFor', () => {
	const context = {
		manifest: {
			version: '1',
			routes: {
				root: { id: 'root', module: '/assets/root-1.js' },
				'routes/_auth+/_layout': {
					id: 'routes/_auth+/_layout',
					module: '/assets/_layout-1.js',
				},
				'routes/_auth+/signup': {
					id: 'routes/_auth+/signup',
					module: '/assets/signup-1.js',
				},
				// `/` (an ancestor of every path) is the logged-in dashboard.
				'routes/_app+/_layout': privateRoute,
				'routes/_app+/index': {
					id: 'routes/_app+/index',
					module: '/assets/app/index-1.js',
				},
			},
		},
		staticHandlerContext: {
			matches: [
				{ route: { id: 'root' } },
				{ route: { id: 'routes/_auth+/_layout' } },
				{ route: { id: 'routes/_auth+/signup' } },
			],
		},
	}

	it('leaves unmatched private routes out of a logged-out page', () => {
		const result = documentContextFor(context, { authenticated: false })
		expect(Object.keys(result.manifest.routes)).toEqual([
			'root',
			'routes/_auth+/_layout',
			'routes/_auth+/signup',
		])
		expect(JSON.stringify(result.manifest)).not.toContain('/assets/app/')
		expect(result.manifest.version).toBe('1')
		// The original context is not changed.
		expect(Object.keys(context.manifest.routes)).toHaveLength(5)
	})

	it('keeps matched routes even when private', () => {
		const result = documentContextFor(
			{
				...context,
				staticHandlerContext: {
					matches: [
						{ route: { id: 'root' } },
						{ route: { id: 'routes/_app+/_layout' } },
					],
				},
			},
			{ authenticated: false },
		)
		expect(result.manifest.routes).toHaveProperty('routes/_app+/_layout')
	})

	it('changes nothing for a signed-in visitor', () => {
		expect(documentContextFor(context, { authenticated: true })).toBe(context)
	})
})

describe('isPublicRouteFile', () => {
	it.each([
		'_auth+/login.tsx',
		'_auth+/signup.tsx',
		'_auth+/verify.tsx',
		'_auth+/forgot-password.tsx',
		'_auth+/reset-password.tsx',
		'_auth+/auth.$provider.callback.ts',
		'_auth+/auth.sso.$organizationSlug.callback.ts',
		'$.tsx',
		'kiosk.pair.tsx',
		'my-schedule.tsx',
		'join+/$token.tsx',
		'resources+/theme-switch.tsx',
	])('%s is public', (file) => {
		expect(isPublicRouteFile(file)).toBe(true)
	})

	it.each([
		'_app+/_layout.tsx',
		'_app+/index.tsx',
		'_app+/security.tsx',
		'_app+/$orgSlug_+/settings+/general.tsx',
		'_app+/$orgSlug_+/mailbox-token.ts',
		'api+/mock-env.ts',
		'api+/organizations.ts',
		'resources+/theme-switch.test.ts',
		'my-schedule.server.ts',
	])('%s is private', (file) => {
		expect(isPublicRouteFile(file)).toBe(false)
	})
})
