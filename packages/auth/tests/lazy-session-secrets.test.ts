import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * On Cloudflare Workers the secrets reach `ENV` after the modules have loaded.
 * These modules must therefore read `SESSION_SECRET` at first use: importing
 * them without it must not throw, and the cookie must be signed with the value
 * present when the storage is first used.
 */
const modules = [
	{
		name: 'session.server',
		load: async () =>
			(await import('../src/session.server')).authSessionStorage,
	},
	{
		name: 'verification.server',
		load: async () =>
			(await import('../src/verification.server')).verifySessionStorage,
	},
	{
		name: 'impersonation-session.server',
		load: async () =>
			(await import('../src/impersonation-session.server'))
				.impersonationSessionStorage,
	},
	{
		name: 'toast.server',
		load: async () => (await import('@repo/common/toast')).toastSessionStorage,
	},
]

describe.each(modules)('$name reads its secret at first use', ({ load }) => {
	const original = process.env.SESSION_SECRET
	const originalImpersonation = process.env.IMPERSONATION_SESSION_SECRET

	beforeEach(() => {
		vi.resetModules()
		delete process.env.IMPERSONATION_SESSION_SECRET
	})

	afterEach(() => {
		process.env.SESSION_SECRET = original
		if (originalImpersonation !== undefined) {
			process.env.IMPERSONATION_SESSION_SECRET = originalImpersonation
		}
	})

	it('signs with the secret set after the module was imported', async () => {
		process.env.SESSION_SECRET = 'secret-at-import-time'
		const storage = await load()
		process.env.SESSION_SECRET = 'secret-at-first-use'

		const session = await storage.getSession()
		session.set('value', 'kept')
		const cookie = (await storage.commitSession(session)).split(';')[0]!

		// A storage built later with the first-use secret reads the cookie...
		vi.resetModules()
		const same = await load()
		expect((await same.getSession(cookie)).get('value')).toBe('kept')

		// ...and one built with the import-time secret does not.
		vi.resetModules()
		process.env.SESSION_SECRET = 'secret-at-import-time'
		const other = await load()
		expect((await other.getSession(cookie)).get('value')).toBeUndefined()
	})
})
