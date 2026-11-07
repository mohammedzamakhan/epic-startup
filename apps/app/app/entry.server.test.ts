import { afterEach, describe, expect, it } from 'vitest'
import { applyContentSecurity, handleDataRequest } from './entry.server.tsx'

describe('entry.server content security policy', () => {
	it('allows OAuth form redirects only to the supported providers', () => {
		const headers = new Headers()
		applyContentSecurity(headers, 'test-nonce')

		const formAction = headers
			.get('Content-Security-Policy')
			?.split(';')
			.find((directive) => directive.trim().startsWith('form-action '))
			?.trim()

		expect(formAction).toBe(
			"form-action 'self' https://accounts.google.com https://github.com",
		)
	})

	it('runs only nonce scripts and loads no stylesheet from other origins', () => {
		const headers = new Headers()
		applyContentSecurity(headers, 'test-nonce')
		const directives = Object.fromEntries(
			(headers.get('Content-Security-Policy') ?? '')
				.split(';')
				.map((directive) => directive.trim().split(/\s+/))
				.map(([name, ...values]) => [name, values]),
		)

		expect(directives['script-src']).toEqual([
			"'strict-dynamic'",
			"'self'",
			"'nonce-test-nonce'",
		])
		expect(directives['script-src']).not.toContain("'unsafe-inline'")
		expect(directives['style-src']).toEqual(["'self'", "'unsafe-inline'"])
		expect(directives['object-src']).toEqual(["'none'"])
		expect(directives['base-uri']).toEqual(["'self'"])
		expect(directives['frame-ancestors']).toEqual(["'self'"])
	})
})

describe('entry.server runtime headers', () => {
	const originalCaches = (globalThis as { caches?: unknown }).caches
	const originalDatacenter = process.env.CF_DATACENTER
	const originalRegion = process.env.REGION

	afterEach(() => {
		if (originalCaches !== undefined) {
			;(globalThis as { caches?: unknown }).caches = originalCaches
		} else {
			delete (globalThis as { caches?: unknown }).caches
		}
		if (originalDatacenter !== undefined) {
			process.env.CF_DATACENTER = originalDatacenter
		} else {
			delete process.env.CF_DATACENTER
		}
		if (originalRegion !== undefined) {
			process.env.REGION = originalRegion
		} else {
			delete process.env.REGION
		}
	})

	it('applies cf headers in cloudflare worker runtime without throwing', async () => {
		;(globalThis as { caches?: unknown }).caches = { default: {} }
		const response = new Response('ok')
		const result = await handleDataRequest(response)
		expect(result.headers.get('cf-worker')).toBe('epic-startup-app')
		expect(result.headers.get('cf-datacenter')).toBe('unknown')
	})

	it('uses process.env.CF_DATACENTER if available in worker runtime', async () => {
		;(globalThis as { caches?: unknown }).caches = { default: {} }
		process.env.CF_DATACENTER = 'iad'
		const response = new Response('ok')
		const result = await handleDataRequest(response)
		expect(result.headers.get('cf-worker')).toBe('epic-startup-app')
		expect(result.headers.get('cf-datacenter')).toBe('iad')
	})
})
