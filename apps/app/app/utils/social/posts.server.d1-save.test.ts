import { beforeEach, describe, expect, it, vi } from 'vitest'

const batchMock = vi.hoisted(() =>
	vi.fn(async () => [[{ id: 'post-1' }], { meta: { changes: 0 } }]),
)
const isD1Mock = vi.hoisted(() => vi.fn(() => true))

vi.mock('@repo/database', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@repo/database')>()
	const selectMock = vi.fn(() => ({
		from: () => ({
			where: () =>
				Promise.resolve([
					{
						id: 'acct-1',
						platform: 'facebook',
						name: 'Page',
						username: null,
					},
				]),
		}),
	}))
	return {
		...actual,
		isD1Bound: isD1Mock,
		db: new Proxy(actual.db, {
			get(target, prop, receiver) {
				if (prop === 'batch') return batchMock
				if (prop === 'select') return selectMock
				return Reflect.get(target, prop, receiver)
			},
		}),
	}
})

vi.mock('#app/utils/media-signing.server.ts', () => ({
	signMediaId: vi.fn(() => 'sig'),
}))

const { saveSocialPost } = await import('./posts.server.ts')

describe('saveSocialPost D1 edit batch', () => {
	beforeEach(() => {
		batchMock.mockClear()
		isD1Mock.mockReturnValue(true)
	})

	it('updates, deletes, and inserts targets in one batch', async () => {
		await saveSocialPost(
			{ userId: 'user-1', organization: { id: 'org-1' } },
			{
				body: 'Hello',
				mediaIds: [],
				accountIds: ['acct-1'],
				status: 'draft',
				scheduledAt: null,
			},
			'post-1',
		)

		expect(batchMock).toHaveBeenCalledTimes(1)
		const statements = batchMock.mock.calls[0]![0] as unknown[]
		expect(statements).toHaveLength(3)
	})
})
