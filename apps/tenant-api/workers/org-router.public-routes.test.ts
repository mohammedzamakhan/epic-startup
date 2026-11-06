import { SignJWT } from 'jose'
import { brand } from '@repo/config/brand'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TenantApiWorkerEnv } from './bindings.ts'

const resolveOrganizationForBrowserAuth = vi.hoisted(() => vi.fn())
vi.mock('../src/lib/origin.ts', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	resolveOrganizationForBrowserAuth,
}))

import { signConsentToken } from '../src/lib/email-consent.ts'
import { resolveOrgId } from './org-router.ts'

const ORG = 'clw9x0a12000008l00test79'
const OTHER = 'clw9x0a12000008l00test80'
const env = {
	TENANT_API_RUNTIME: 'workers',
	JWT_SECRET: 'test-jwt-secret-123456789',
} as TenantApiWorkerEnv

const base = 'https://tenant.example.test'

// Unsubscribe and confirm links, customer subscription toggles and public
// website forms must reach the organization's Durable Object; before, the
// edge answered 400 for all of them.
describe('resolveOrgId for consent, subscription and public form routes', () => {
	beforeEach(() => {
		process.env.AUTH_HMAC_SECRET = 'test-hmac-secret-123456789'
		resolveOrganizationForBrowserAuth.mockReset()
	})

	const token = () =>
		signConsentToken({ k: 'unsubscribe', o: ORG, c: 'cust1', t: 'marketing' })

	it('routes unsubscribe and confirm links by the token org claim', async () => {
		const confirm = signConsentToken({
			k: 'confirm',
			o: ORG,
			c: 'cust1',
			t: 'marketing',
			e: 'hash',
			x: Date.now() + 60_000,
		})
		for (const [path, raw] of [
			['/subscriptions/unsubscribe', token()],
			['/subscriptions/confirm', confirm],
		] as const) {
			const t = encodeURIComponent(raw)
			expect(
				await resolveOrgId(new Request(`${base}${path}?token=${t}`), env),
			).toBe(ORG)
			expect(
				await resolveOrgId(
					new Request(`${base}${path}?token=${t}`, { method: 'POST' }),
					env,
				),
			).toBe(ORG)
		}
	})

	it('routes a one-click unsubscribe POST with the token in a form body', async () => {
		const body = new URLSearchParams({ token: token() }).toString()
		const request = new Request(`${base}/subscriptions/unsubscribe`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				'Content-Length': String(body.length),
			},
			body,
		})
		expect(await resolveOrgId(request, env)).toBe(ORG)
	})

	it('routes nowhere for a forged or wrong-kind token, so no Durable Object wakes', async () => {
		const [body] = token().split('.')
		const forged = `${body}.${'0'.repeat(64)}`
		expect(
			await resolveOrgId(
				new Request(`${base}/subscriptions/unsubscribe?token=${forged}`),
				env,
			),
		).toBeNull()
		// An unsubscribe token is not a confirm token.
		expect(
			await resolveOrgId(
				new Request(
					`${base}/subscriptions/confirm?token=${encodeURIComponent(token())}`,
				),
				env,
			),
		).toBeNull()
	})

	it('still routes an expired confirm link, so the route can say it expired', async () => {
		const expired = signConsentToken({
			k: 'confirm',
			o: ORG,
			c: 'cust1',
			t: 'marketing',
			e: 'hash',
			x: Date.now() - 1000,
		})
		expect(
			await resolveOrgId(
				new Request(
					`${base}/subscriptions/confirm?token=${encodeURIComponent(expired)}`,
				),
				env,
			),
		).toBe(ORG)
	})

	it('does not parse a public body that is missing its length or too large', async () => {
		resolveOrganizationForBrowserAuth.mockResolvedValue({ id: ORG })
		const big = JSON.stringify({ slug: 'acme', pad: 'x'.repeat(20_000) })
		const request = new Request(`${base}/forms/f1/submissions`, {
			method: 'POST',
			headers: {
				Origin: 'https://acme.example',
				'Content-Type': 'application/json',
				'Content-Length': String(big.length),
			},
			body: big,
		})
		expect(await resolveOrgId(request, env)).toBeNull()
		expect(resolveOrganizationForBrowserAuth).not.toHaveBeenCalled()
	})

	it('routes nowhere for a malformed token, and ignores a body orgId', async () => {
		expect(
			await resolveOrgId(
				new Request(`${base}/subscriptions/unsubscribe?token=junk`),
				env,
			),
		).toBeNull()
		const request = new Request(`${base}/subscriptions/unsubscribe`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ orgId: OTHER }),
		})
		expect(await resolveOrgId(request, env)).toBeNull()
	})

	it('routes customer subscription toggles by the customer JWT only', async () => {
		const jwt = await new SignJWT({ orgId: ORG, type: 'access' })
			.setProtectedHeader({ alg: 'HS256' })
			.setIssuer(brand.slug)
			.setAudience('tenant-api')
			.setExpirationTime('5m')
			.sign(new TextEncoder().encode(env.JWT_SECRET))
		const put = new Request(`${base}/subscriptions/marketing/email`, {
			method: 'PUT',
			headers: { Authorization: `Bearer ${jwt}` },
		})
		expect(await resolveOrgId(put, env)).toBe(ORG)
		expect(
			await resolveOrgId(
				new Request(`${base}/subscriptions`, {
					headers: { Authorization: `Bearer ${jwt}` },
				}),
				env,
			),
		).toBe(ORG)
		const forged = new Request(`${base}/subscriptions/marketing/email`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ orgId: OTHER }),
		})
		expect(await resolveOrgId(forged, env)).toBeNull()
	})

	it('routes public forms by Origin and slug or host, never a body orgId', async () => {
		resolveOrganizationForBrowserAuth.mockImplementation(
			async (origin, identity) =>
				origin === 'https://acme.example' && identity.slug === 'acme'
					? { id: ORG }
					: null,
		)
		const get = new Request(`${base}/forms/f1?slug=acme`, {
			headers: { Origin: 'https://acme.example' },
		})
		expect(await resolveOrgId(get, env)).toBe(ORG)
		const formBody = JSON.stringify({ slug: 'acme', orgId: OTHER })
		const post = new Request(`${base}/forms/f1/submissions`, {
			method: 'POST',
			headers: {
				Origin: 'https://acme.example',
				'Content-Type': 'application/json',
				'Content-Length': String(formBody.length),
			},
			body: formBody,
		})
		expect(await resolveOrgId(post, env)).toBe(ORG)
		const foreign = new Request(`${base}/forms/f1/submissions`, {
			method: 'POST',
			headers: {
				Origin: 'https://evil.example',
				'Content-Type': 'application/json',
				'Content-Length': String(formBody.length),
			},
			body: formBody,
		})
		expect(await resolveOrgId(foreign, env)).toBeNull()
	})
})
