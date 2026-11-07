import { db, eq, Session, User } from '@repo/database'
import { beforeEach, describe, expect, it } from 'vitest'
import { insertTestUser } from '#tests/dashboard-utils.ts'
import { createTestSession } from '#tests/test-utils.ts'
import {
	clearSessionGateCache,
	hasActiveSession,
} from './session-gate.server.ts'

function requestWith(cookie?: string) {
	return new Request('https://app.example.test/assets/app/x.js', {
		headers: cookie ? { Cookie: cookie } : {},
	})
}

describe('hasActiveSession', () => {
	beforeEach(() => clearSessionGateCache())

	it('is false without a cookie, with a forged cookie, or with an unknown session', async () => {
		expect(await hasActiveSession(requestWith())).toBe(false)
		expect(
			await hasActiveSession(
				requestWith('en_session=eyJzZXNzaW9uSWQiOiJ4In0%3D.forged'),
			),
		).toBe(false)

		const user = await insertTestUser()
		const { session, cookie } = await createTestSession(user.id)
		await db.delete(Session).where(eq(Session.id, session.id))
		expect(await hasActiveSession(requestWith(cookie))).toBe(false)
	})

	it('is true for a live session', async () => {
		const user = await insertTestUser()
		const { cookie } = await createTestSession(user.id)
		expect(await hasActiveSession(requestWith(cookie))).toBe(true)
	})

	it('is false for an expired session', async () => {
		const user = await insertTestUser()
		const { session, cookie } = await createTestSession(user.id)
		await db
			.update(Session)
			.set({ expirationDate: new Date(Date.now() - 1000) })
			.where(eq(Session.id, session.id))
		expect(await hasActiveSession(requestWith(cookie))).toBe(false)
	})

	it('is false for a banned user until the ban expires', async () => {
		const user = await insertTestUser()
		const { cookie } = await createTestSession(user.id)
		await db
			.update(User)
			.set({ isBanned: true, banExpiresAt: null })
			.where(eq(User.id, user.id))
		expect(await hasActiveSession(requestWith(cookie))).toBe(false)

		await db
			.update(User)
			.set({ banExpiresAt: new Date(Date.now() - 1000) })
			.where(eq(User.id, user.id))
		expect(await hasActiveSession(requestWith(cookie))).toBe(true)
	})
})
