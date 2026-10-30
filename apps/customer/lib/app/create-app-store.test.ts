import { createMemoryTokenStorage } from '../session/token-storage'
import { createMemoryPreferences } from '../state/preferences'
import { createAppStore } from './create-app-store'
import { StubTransport } from '@/test/stub-transport'
import { makeConfiguration } from '@/test/support'

const ORGANIZATION = {
	id: 'org_1',
	name: 'Acme Coffee',
	slug: 'acme',
	dataRegion: 'us',
	locales: ['en', 'de', 'ar'],
	defaultLocale: 'en',
	theme: { theme: 'amber', radius: 'large', mode: 'light' },
	announcements: [],
}

function makeStore(deviceLanguages?: () => readonly string[]) {
	const transport = new StubTransport((request) =>
		new URL(request.url).pathname === '/resources/sites'
			? { json: ORGANIZATION }
			: { status: 404, raw: 'Not Found' },
	)
	return createAppStore({
		configuration: makeConfiguration(),
		preferences: createMemoryPreferences(),
		tokenStorage: createMemoryTokenStorage(null),
		transport: transport.send,
		deviceLanguages,
	})
}

describe('createAppStore', () => {
	it('creates the (empty) feature set once the site is ready', async () => {
		const store = makeStore()

		await store.start()

		const snapshot = store.getSnapshot()
		expect(snapshot.phase).toEqual({ kind: 'ready' })
		expect(snapshot.features).toEqual({})
	})

	it('resolves the language from the device and the organization', async () => {
		const store = makeStore(() => ['de-DE'])

		await store.start()

		expect(store.getSnapshot().language.code).toBe('de')
	})
})
