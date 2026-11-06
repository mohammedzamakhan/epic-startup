import {
	db,
	eq,
	NoteComment,
	NoteCommentImage,
	OrganizationMediaAsset,
	OrganizationNote,
	OrganizationNoteUpload,
	type OrganizationS3Config,
	StorageMigration,
} from '@repo/database'
import { encrypt, getSSOMasterKey } from '@repo/security'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestOrganization, createTestUser } from '#tests/test-utils.ts'
import {
	collectOrgMediaObjects,
	countOrgMediaObjectKeys,
	processStorageMigrationBatch,
	reportStorageMigrationProgress,
	resolveStorageMigrationPlan,
} from './storage-migration.server.ts'

describe('countOrgMediaObjectKeys', () => {
	it('counts distinct media keys without loading the object list', async () => {
		const user = await createTestUser()
		const organization = await createTestOrganization(user.id, 'admin')
		const [note] = await db
			.insert(OrganizationNote)
			.values({
				title: 'Media note',
				content: 'Contains media',
				organizationId: organization.id,
				createdById: user.id,
			})
			.returning()

		await db.insert(OrganizationNoteUpload).values([
			{
				type: 'image',
				objectKey: 'media/photo.jpg',
				thumbnailKey: 'media/photo-thumb.jpg',
				noteId: note!.id,
			},
			{
				type: 'image',
				objectKey: 'media/photo.jpg',
				noteId: note!.id,
			},
		])
		const [comment] = await db
			.insert(NoteComment)
			.values({
				content: 'Media comment',
				noteId: note!.id,
				userId: user.id,
			})
			.returning()
		await db.insert(NoteCommentImage).values({
			objectKey: 'media/photo-thumb.jpg',
			commentId: comment!.id,
		})
		await db.insert(OrganizationMediaAsset).values({
			organizationId: organization.id,
			objectKey: 'media/library-image.png',
			mimeType: 'image/png',
			fileName: 'library-image.png',
			fileSize: 512,
			source: 'library',
			createdById: user.id,
		})
		await db.insert(OrganizationMediaAsset).values({
			organizationId: organization.id,
			objectKey: 'media/photo-thumb.jpg',
			mimeType: 'image/png',
			fileName: 'reused-library-image.png',
			fileSize: 256,
			source: 'library',
			createdById: user.id,
		})

		await expect(countOrgMediaObjectKeys(organization.id)).resolves.toBe(3)
		await expect(
			collectOrgMediaObjects(organization.id),
		).resolves.toContainEqual({
			objectKey: 'media/photo-thumb.jpg',
			contentType: 'image/png',
		})
	})
})

describe('saving S3 settings for the bucket the media already lives in', () => {
	beforeEach(() => {
		vi.stubEnv('SSO_ENCRYPTION_KEY', 'a'.repeat(64))
	})
	afterEach(() => {
		vi.unstubAllEnvs()
		vi.restoreAllMocks()
	})

	function enabledConfig(): typeof OrganizationS3Config.$inferSelect {
		return {
			id: 'cfg',
			organizationId: 'org',
			isEnabled: true,
			endpoint: 'https://s3.example.com',
			bucketName: 'org-media',
			accessKeyId: 'OLD-KEY',
			secretAccessKey: encrypt('old-secret', getSSOMasterKey()),
			region: 'us-east-1',
			previousEndpoint: null,
			previousBucketName: null,
			previousAccessKeyId: null,
			previousSecretAccessKey: null,
			previousRegion: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		}
	}

	it('plans no migration when only the key, region or endpoint spelling changes', () => {
		expect(
			resolveStorageMigrationPlan({
				existingConfig: enabledConfig(),
				dest: {
					endpoint: 'https://S3.example.com/',
					bucketName: 'org-media',
					accessKeyId: 'NEW-KEY',
					secretAccessKey: 'new-secret',
					region: 'eu-west-1',
				},
			}),
		).toBeNull()
	})

	it('still moves media when the bucket really changes', () => {
		const plan = resolveStorageMigrationPlan({
			existingConfig: enabledConfig(),
			dest: {
				endpoint: 'https://s3.example.com',
				bucketName: 'org-media-2',
				accessKeyId: 'NEW-KEY',
				secretAccessKey: 'new-secret',
				region: 'us-east-1',
			},
		})
		expect(plan).toMatchObject({
			sourceType: 'custom',
			source: { bucketName: 'org-media' },
			destType: 'custom',
			dest: { bucketName: 'org-media-2' },
		})
	})

	it('touches no object when a stored migration names the same bucket on both sides', async () => {
		const user = await createTestUser()
		const organization = await createTestOrganization(user.id, 'admin')
		await db.insert(OrganizationMediaAsset).values({
			organizationId: organization.id,
			objectKey: `orgs/${organization.id}/media/only-copy.png`,
			mimeType: 'image/png',
			fileName: 'only-copy.png',
			fileSize: 512,
			source: 'library',
			createdById: user.id,
		})
		const side = (accessKeyId: string, region: string) => ({
			Endpoint: 'https://s3.example.com',
			BucketName: 'org-media',
			AccessKeyId: accessKeyId,
			SecretAccessKey: encrypt('secret', getSSOMasterKey()),
			Region: region,
		})
		const source = side('OLD-KEY', 'us-east-1')
		const dest = side('NEW-KEY', 'eu-west-1')
		const [migration] = await db
			.insert(StorageMigration)
			.values({
				organizationId: organization.id,
				status: 'running',
				sourceType: 'custom',
				sourceEndpoint: source.Endpoint,
				sourceBucketName: source.BucketName,
				sourceAccessKeyId: source.AccessKeyId,
				sourceSecretAccessKey: source.SecretAccessKey,
				sourceRegion: source.Region,
				destType: 'custom',
				destEndpoint: dest.Endpoint,
				destBucketName: dest.BucketName,
				destAccessKeyId: dest.AccessKeyId,
				destSecretAccessKey: dest.SecretAccessKey,
				destRegion: dest.Region,
				totalObjects: 1,
			})
			.returning()
		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockImplementation(async () => new Response('bytes', { status: 200 }))

		const result = await processStorageMigrationBatch(migration!.id)

		const objectRequests = fetchSpy.mock.calls.map(([url, init]) => ({
			method: init?.method ?? 'GET',
			url: String(url),
		}))
		expect(objectRequests).toEqual([])
		expect(result.done).toBe(true)
		const [stored] = await db
			.select()
			.from(StorageMigration)
			.where(eq(StorageMigration.id, migration!.id))
		expect(stored).toMatchObject({
			status: 'failed',
			lastError: 'Source and destination are the same bucket',
			processedObjects: 0,
		})
	})
})

describe('retried and overlapping migration steps', () => {
	beforeEach(() => {
		vi.stubEnv('SSO_ENCRYPTION_KEY', 'a'.repeat(64))
	})
	afterEach(() => {
		vi.unstubAllEnvs()
		vi.restoreAllMocks()
	})
	async function setupMigration() {
		const user = await createTestUser()
		const organization = await createTestOrganization(user.id, 'admin')
		await db.insert(OrganizationMediaAsset).values({
			organizationId: organization.id,
			objectKey: `orgs/${organization.id}/media/moved.png`,
			mimeType: 'image/png',
			fileName: 'moved.png',
			fileSize: 512,
			source: 'library',
			createdById: user.id,
		})
		const side = (bucket: string) => ({
			Endpoint: 'https://s3.example.com',
			BucketName: bucket,
			AccessKeyId: 'KEY',
			SecretAccessKey: encrypt('secret', getSSOMasterKey()),
			Region: 'us-east-1',
		})
		const source = side('old-media')
		const dest = side('new-media')
		const [migration] = await db
			.insert(StorageMigration)
			.values({
				organizationId: organization.id,
				status: 'running',
				sourceType: 'custom',
				sourceEndpoint: source.Endpoint,
				sourceBucketName: source.BucketName,
				sourceAccessKeyId: source.AccessKeyId,
				sourceSecretAccessKey: source.SecretAccessKey,
				sourceRegion: source.Region,
				destType: 'custom',
				destEndpoint: dest.Endpoint,
				destBucketName: dest.BucketName,
				destAccessKeyId: dest.AccessKeyId,
				destSecretAccessKey: dest.SecretAccessKey,
				destRegion: dest.Region,
				totalObjects: 1,
			})
			.returning()
		return migration!
	}

	it('counts an object already moved by an earlier attempt as done, not failed', async () => {
		const migration = await setupMigration()
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
			const method = init?.method ?? 'GET'
			// Gone from the source, present at the destination.
			if (method === 'GET') return new Response('missing', { status: 404 })
			if (method === 'HEAD' && String(url).includes('new-media'))
				return new Response(null, { status: 200 })
			return new Response('unexpected', { status: 500 })
		})

		await processStorageMigrationBatch(migration.id)

		const [stored] = await db
			.select()
			.from(StorageMigration)
			.where(eq(StorageMigration.id, migration.id))
		expect(stored).toMatchObject({ processedObjects: 1, failedObjects: 0 })
	})

	it('moves every listed object when media is deleted between batches', async () => {
		const migration = await setupMigration()
		const [first] = await db
			.select()
			.from(OrganizationMediaAsset)
			.where(
				eq(OrganizationMediaAsset.organizationId, migration.organizationId),
			)
		// 15 objects in all: two batches of up to 10.
		for (let i = 0; i < 14; i++) {
			await db.insert(OrganizationMediaAsset).values({
				organizationId: migration.organizationId,
				objectKey: `orgs/${migration.organizationId}/media/a-${String(i).padStart(2, '0')}.png`,
				mimeType: 'image/png',
				fileName: `a-${i}.png`,
				fileSize: 512,
				source: 'library',
				createdById: first!.createdById,
			})
		}
		const allKeys = (await collectOrgMediaObjects(migration.organizationId))
			.map((o) => o.objectKey)
			.sort()
		const putKeys: string[] = []
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
			const method = init?.method ?? 'GET'
			if (method === 'PUT') {
				putKeys.push(new URL(String(url)).pathname.split('/media/')[1]!)
			}
			return new Response(method === 'GET' ? 'bytes' : null, { status: 200 })
		})

		const firstBatch = await processStorageMigrationBatch(migration.id)
		expect(firstBatch.done).toBe(false)
		// An object the first batch already moved is deleted from the library.
		await db
			.delete(OrganizationMediaAsset)
			.where(eq(OrganizationMediaAsset.objectKey, allKeys[0]!))
		const second = await processStorageMigrationBatch(migration.id)

		expect(second.done).toBe(true)
		expect(putKeys.sort()).toEqual(
			allKeys.map((key) => key.split('/media/')[1]!),
		)
		const [stored] = await db
			.select()
			.from(StorageMigration)
			.where(eq(StorageMigration.id, migration.id))
		expect(stored).toMatchObject({
			status: 'completed',
			totalObjects: 15,
			processedObjects: 15,
			failedObjects: 0,
		})
	})

	it('applies a progress report for a cursor only once', async () => {
		const migration = await setupMigration()
		const report = () =>
			reportStorageMigrationProgress({
				migrationId: migration.id,
				processedCount: 3,
				failedCount: 0,
				expectedCursor: 0,
			})
		await Promise.all([report(), report()])

		const [stored] = await db
			.select()
			.from(StorageMigration)
			.where(eq(StorageMigration.id, migration.id))
		expect(stored).toMatchObject({ cursor: 3, processedObjects: 3 })
	})
})
