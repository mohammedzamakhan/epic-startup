import { db, eq, RefreshToken } from '@repo/database'
import { describe, expect, it } from 'vitest'
import {
	createTokenPair,
	REFRESH_TOKEN_REUSE_GRACE_MS,
} from '#app/utils/jwt.server.ts'
import { createTestUser, getResponseStatus } from '#tests/test-utils.ts'
import { action } from './auth.refresh.ts'

function refreshRequest(refreshToken: string, userId: string) {
	return new Request('http://localhost:3000/api/auth/refresh', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ refreshToken, userId }),
	})
}

describe('api/auth/refresh integration', () => {
	it('returns 400 when refreshToken or userId is missing', async () => {
		const request = new Request('http://localhost:3000/api/auth/refresh', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({}),
		})

		const response = await action({
			request,
			params: {},
			context: {},
		} as any)

		expect(getResponseStatus(response)).toBe(400)
		const body = (response as any).data
		expect(body.success).toBe(false)
		expect(body.error).toBe('invalid_request')
	})

	it('returns 401 when user does not exist', async () => {
		const request = new Request('http://localhost:3000/api/auth/refresh', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				refreshToken: 'fake-refresh-token',
				userId: 'non-existent-user-id',
			}),
		})

		const response = await action({
			request,
			params: {},
			context: {},
		} as any)

		expect(getResponseStatus(response)).toBe(401)
		const body = (response as any).data
		expect(body.success).toBe(false)
		expect(body.error).toBe('user_not_found')
	})

	it('returns 200 with rotated tokens on valid refresh request', async () => {
		const user = await createTestUser()
		const tokens = await createTokenPair(
			{
				id: user.id,
				email: user.email,
				username: user.username,
			},
			{ userAgent: 'test-agent', ip: '127.0.0.1' },
		)

		const request = new Request('http://localhost:3000/api/auth/refresh', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				refreshToken: tokens.refreshToken,
				userId: user.id,
			}),
		})

		const response = await action({
			request,
			params: {},
			context: {},
		} as any)

		expect(getResponseStatus(response)).toBe(200)
		const body = (response as any).data
		expect(body.success).toBe(true)
		expect(body.data.accessToken).toBeDefined()
		expect(body.data.refreshToken).toBeDefined()
		// Rotated refresh token should be distinct from the old one
		expect(body.data.refreshToken).not.toBe(tokens.refreshToken)
	})

	it('returns 401 when refresh token is invalid or already used', async () => {
		const user = await createTestUser()

		const request = new Request('http://localhost:3000/api/auth/refresh', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				refreshToken: 'invalid_corrupted_token',
				userId: user.id,
			}),
		})

		const response = await action({
			request,
			params: {},
			context: {},
		} as any)

		expect(getResponseStatus(response)).toBe(401)
		const body = (response as any).data
		expect(body.success).toBe(false)
		expect(body.error).toBe('invalid_refresh_token')
	})

	it('returns 401 when a refresh token is reused after rotation', async () => {
		const user = await createTestUser()
		const tokens = await createTokenPair(
			{
				id: user.id,
				email: user.email,
				username: user.username,
			},
			{ userAgent: 'test-agent', ip: '127.0.0.1' },
		)

		// First use: successfully rotates
		const firstRequest = new Request('http://localhost:3000/api/auth/refresh', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				refreshToken: tokens.refreshToken,
				userId: user.id,
			}),
		})

		const firstResponse = await action({
			request: firstRequest,
			params: {},
			context: {},
		} as any)

		expect(getResponseStatus(firstResponse)).toBe(200)

		// The successor is used, so the client clearly received it. (Re-presenting
		// the original before that, inside the grace window, is a retry after a
		// lost response and gets the same successor back; see the next test.)
		const successorResponse = await action({
			request: refreshRequest(
				(firstResponse as any).data.data.refreshToken,
				user.id,
			),
			params: {},
			context: {},
		} as any)
		expect(getResponseStatus(successorResponse)).toBe(200)

		// Reusing the same original refreshToken now fails
		const secondRequest = new Request(
			'http://localhost:3000/api/auth/refresh',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					refreshToken: tokens.refreshToken,
					userId: user.id,
				}),
			},
		)

		const secondResponse = await action({
			request: secondRequest,
			params: {},
			context: {},
		} as any)

		expect(getResponseStatus(secondResponse)).toBe(401)
		const secondBody = (secondResponse as any).data
		expect(secondBody.success).toBe(false)
		expect(secondBody.error).toBe('invalid_refresh_token')
	})

	it('gives a retry after a lost refresh response the same successor', async () => {
		const user = await createTestUser()
		const tokens = await createTokenPair(
			{ id: user.id, email: user.email, username: user.username },
			{ userAgent: 'test-agent', ip: '127.0.0.1' },
		)
		const run = (refreshToken: string) =>
			action({
				request: refreshRequest(refreshToken, user.id),
				params: {},
				context: {},
			} as any) as any

		// The response to this rotation never reaches the app.
		const lost = await run(tokens.refreshToken)
		expect(getResponseStatus(lost)).toBe(200)

		const retry = await run(tokens.refreshToken)
		expect(getResponseStatus(retry)).toBe(200)
		expect(retry.data.data.refreshToken).toBe(lost.data.data.refreshToken)

		// The successor keeps working.
		const next = await run(retry.data.data.refreshToken)
		expect(getResponseStatus(next)).toBe(200)
	})

	it('refuses a retry of a rotated token after the grace window', async () => {
		const user = await createTestUser()
		const tokens = await createTokenPair(
			{ id: user.id, email: user.email, username: user.username },
			{ userAgent: 'test-agent', ip: '127.0.0.1' },
		)
		const run = (refreshToken: string) =>
			action({
				request: refreshRequest(refreshToken, user.id),
				params: {},
				context: {},
			} as any) as any

		expect(getResponseStatus(await run(tokens.refreshToken))).toBe(200)
		await db
			.update(RefreshToken)
			.set({
				updatedAt: new Date(Date.now() - REFRESH_TOKEN_REUSE_GRACE_MS - 5_000),
			})
			.where(eq(RefreshToken.id, tokens.refreshToken.split('.')[0]!))
		expect(getResponseStatus(await run(tokens.refreshToken))).toBe(401)
	})

	it('returns 405 on GET request', async () => {
		const { loader } = await import('./auth.refresh.ts')
		const response = await loader()
		expect(getResponseStatus(response)).toBe(405)
		const body = (response as any).data
		expect(body.success).toBe(false)
		expect(body.error).toBe('method_not_allowed')
	})
})
