import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/worker-env', () => ({
	getAppServiceBinding: () => null,
	getPublicAppUrl: () => 'https://app.example.test',
}))
vi.mock('~/lib/site-headers', () => ({ edgeCache: () => null }))

import {
	fetchPublishedOrganizationForHost,
	fetchPublishedOrganizationResultForHost,
} from './org.ts'

const originalFetch = globalThis.fetch

function appAnswers(response: () => Promise<Response>) {
	const fetchMock = vi.fn<typeof fetch>(() => response())
	globalThis.fetch = fetchMock
	return fetchMock
}

describe('fetchPublishedOrganizationResultForHost', () => {
	afterEach(() => {
		globalThis.fetch = originalFetch
	})

	it('returns the published organization', async () => {
		const fetchMock = appAnswers(async () =>
			Response.json({ id: 'org_1', name: 'Acme', slug: 'acme' }),
		)

		expect(
			await fetchPublishedOrganizationResultForHost('acme', null, 'ar'),
		).toEqual({
			organization: { id: 'org_1', name: 'Acme', slug: 'acme' },
			unavailable: false,
		})
		expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
			'https://app.example.test/resources/sites?slug=acme&lng=ar',
		)
	})

	it('looks a custom domain up by host', async () => {
		const fetchMock = appAnswers(async () =>
			Response.json({ id: 'org_1', name: 'Acme', slug: 'acme' }),
		)

		await fetchPublishedOrganizationResultForHost(null, 'shop.example.com')

		expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
			'https://app.example.test/resources/sites?host=shop.example.com',
		)
	})

	it('treats a 404 as "no published site", not as a failure', async () => {
		appAnswers(async () => new Response('Not Found', { status: 404 }))

		expect(await fetchPublishedOrganizationResultForHost('acme', null)).toEqual(
			{ organization: null, unavailable: false },
		)
	})

	it.each([
		['a server error', async () => new Response('', { status: 500 })],
		['a rate limit', async () => new Response('', { status: 429 })],
		[
			'a network failure or timeout',
			async (): Promise<Response> => {
				throw new Error('timed out')
			},
		],
		['an unreadable body', async () => new Response('<html>', { status: 200 })],
	])('reports %s as unavailable', async (_name, response) => {
		appAnswers(response)

		expect(await fetchPublishedOrganizationResultForHost('acme', null)).toEqual(
			{ organization: null, unavailable: true },
		)
		// The plain lookup keeps answering null for its existing callers.
		expect(await fetchPublishedOrganizationForHost('acme', null)).toBeNull()
	})

	it('does not call the App without a slug or a host', async () => {
		const fetchMock = appAnswers(async () => Response.json({}))

		expect(await fetchPublishedOrganizationResultForHost(null, null)).toEqual({
			organization: null,
			unavailable: false,
		})
		expect(fetchMock).not.toHaveBeenCalled()
	})
})
