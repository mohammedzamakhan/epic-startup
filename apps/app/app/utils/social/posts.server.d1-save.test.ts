import { beforeEach, describe, expect, it, vi } from 'vitest'

const FIXED_NOW = new Date('2026-10-28T12:00:00.000Z')

const batchMock = vi.hoisted(() =>
	vi.fn(async () => [[{ id: 'post-1' }], { meta: { changes: 0 } }]),
)
const insertMock = vi.hoisted(() =>
	vi.fn(() => ({
		values: vi.fn(() => Promise.resolve(undefined)),
	})),
)
const isD1Mock = vi.hoisted(() => vi.fn(() => true))
const selectCall = vi.hoisted(() => ({ n: 0 }))

vi.mock('@repo/database', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@repo/database')>()
	const selectMock = vi.fn(() => ({
		from: () => ({
			where: () => {
				selectCall.n += 1
				if (selectCall.n === 1) {
					return Promise.resolve([
						{
							id: 'acct-1',
							platform: 'facebook',
							name: 'Page',
							username: null,
						},
					])
				}
				return Promise.resolve([
					{ status: 'draft', updatedAt: FIXED_NOW },
				])
			},
		}),
	}))
	return {
		...actual,
		isD1Bound: isD1Mock,
		db: new Proxy(actual.db, {
			get(target, prop, receiver) {
				if (prop === 'batch') return batchMock
				if (prop === 'select') return selectMock
				if (prop === 'insert') return insertMock
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
		vi.useFakeTimers()
		vi.setSystemTime(FIXED_NOW)
		selectCall.n = 0
		batchMock.mockClear()
		insertMock.mockClear()
		isD1Mock.mockReturnValue(true)
	})

	it('updates and deletes in one batch, then inserts targets with builders', async () => {
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
		const statements = batchMock.mock.calls[0]?.[0]
		expect(statements).toHaveLength(2)
		expect(insertMock).toHaveBeenCalledTimes(1)
	})

	afterEach(() => {
		vi.useRealTimers()
	})
})
