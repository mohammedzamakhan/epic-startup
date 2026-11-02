import { invariantResponse } from '@epic-web/invariant'
import { authorizeRegisteredObject } from '#app/utils/media-access.server.ts'
import {
	getSignedGetRequestInfoAsync,
	getSignedHeadRequestInfoAsync,
} from '#app/utils/storage.server.ts'
import { type Route } from './+types/videos.source.ts'

const PASSTHROUGH_HEADERS = [
	'content-type',
	'content-length',
	'content-range',
	'accept-ranges',
	'etag',
	'last-modified',
] as const

function validateObjectKey(objectKey: string | null) {
	invariantResponse(objectKey, 'objectKey query parameter is required', {
		status: 400,
	})
	invariantResponse(
		objectKey.length >= 16 &&
			!objectKey.includes('..') &&
			/^[a-zA-Z0-9_\-./]+$/.test(objectKey),
		'Invalid or low-entropy objectKey parameter',
		{ status: 400 },
	)
	return objectKey
}

export async function loader({ request }: Route.LoaderArgs) {
	const url = new URL(request.url)
	const objectKey = validateObjectKey(url.searchParams.get('objectKey'))
	// Only registered library assets are served; public ones are open (site
	// visitors, media transforms), private ones need organization membership.
	// The storage scope comes from the registered asset, never the query.
	const access = await authorizeRegisteredObject(request, objectKey)
	invariantResponse(access, 'Not found', { status: 404 })
	const organizationId = access.organizationId ?? undefined
	const method = request.method === 'HEAD' ? 'HEAD' : 'GET'

	const { url: storageUrl, headers: signedHeaders } =
		method === 'HEAD'
			? await getSignedHeadRequestInfoAsync(objectKey, organizationId)
			: await getSignedGetRequestInfoAsync(objectKey, organizationId)

	const upstreamHeaders = new Headers(signedHeaders)
	const range = request.headers.get('Range')
	if (range) {
		upstreamHeaders.set('Range', range)
	}

	const upstream = await fetch(storageUrl, {
		method,
		headers: upstreamHeaders,
	})

	const responseHeaders = new Headers()
	for (const headerName of PASSTHROUGH_HEADERS) {
		const value = upstream.headers.get(headerName)
		if (value) {
			responseHeaders.set(headerName, value)
		}
	}
	responseHeaders.set('Accept-Ranges', 'bytes')
	responseHeaders.set(
		'Cache-Control',
		access.isPublic ? 'public, max-age=3600' : 'private, max-age=3600',
	)
	responseHeaders.set('X-Content-Type-Options', 'nosniff')
	responseHeaders.set('Access-Control-Allow-Origin', '*')

	if (method === 'HEAD') {
		return new Response(null, {
			status: upstream.status,
			headers: responseHeaders,
		})
	}

	return new Response(upstream.body, {
		status: upstream.status,
		headers: responseHeaders,
	})
}
