import { describe, expect, it, vi, beforeEach } from 'vitest'
import type * as DatabaseModule from '@repo/database'
import {
	mockDb,
	mockSelectResults,
	resetMockDb,
} from '#tests/setup/drizzle-mock.ts'
import { enrichNoteUploadsWithImageSrc } from './note-upload-url.server.ts'

vi.mock('@repo/database', async (importOriginal) => {
	const actual = await importOriginal<typeof DatabaseModule>()
	const { mockDb, drizzleTable, drizzleOperator } =
		await import('#tests/setup/drizzle-mock.ts')
	return {
		...actual,
		db: mockDb,
		OrganizationMediaAsset: drizzleTable,
		and: drizzleOperator,
		eq: drizzleOperator,
		inArray: drizzleOperator,
	}
})

describe('enrichNoteUploadsWithImageSrc', () => {
	beforeEach(() => {
		resetMockDb()
	})

	it('uses mediaId URLs for registered library assets', async () => {
		mockSelectResults([
			{
				id: 'asset-1',
				objectKey: 'orgs/org-1/media/images/photo.webp',
				updatedAt: new Date('2026-01-01T00:00:00.000Z'),
			},
		])

		const uploads = await enrichNoteUploadsWithImageSrc(
			[
				{
					type: 'image',
					objectKey: 'orgs/org-1/media/images/photo.webp',
					altText: 'Photo',
				},
			],
			'org-1',
		)

		expect(uploads[0]?.imageSrc).toBe(
			'/resources/images?mediaId=asset-1&v=1767225600000',
		)
	})
})
