import { createId } from '@paralleldrive/cuid2'
import {
	and,
	type db,
	eq,
	sql,
	NoteCommentImage,
	OrganizationMediaAsset,
	OrganizationNoteUpload,
} from '@repo/database'

type Executor = Pick<typeof db, 'insert' | 'select'>

/**
 * Media library delete and replace remove the asset row (or move it to a new
 * object) first and only then check for references before deleting the
 * storage object. Attaching a library item therefore inserts the reference in
 * one statement that requires the asset row to still exist with the object
 * key the caller read. Either the insert lands before the delete's reference
 * check (the object is kept), or it inserts nothing.
 */
function assetStillMatches(input: {
	organizationId: string
	assetId: string
	objectKey: string
}) {
	return and(
		eq(OrganizationMediaAsset.id, input.assetId),
		eq(OrganizationMediaAsset.organizationId, input.organizationId),
		eq(OrganizationMediaAsset.objectKey, input.objectKey),
	)
}

function value<T>(input: T, name: string) {
	return sql`${input}`.as(name)
}

/** Returns false when the library item was deleted or replaced meanwhile. */
export async function attachLibraryAssetToNote(
	executor: Executor,
	input: {
		organizationId: string
		assetId: string
		objectKey: string
		noteId: string
		altText?: string | null
		mimeType?: string | null
		fileSize?: number | null
	},
) {
	const now = Date.now()
	const inserted = await executor
		.insert(OrganizationNoteUpload)
		.select(
			executor
				.select({
					id: value(createId(), 'id'),
					type: value('image', 'type'),
					altText: value(input.altText ?? null, 'altText'),
					objectKey: value(input.objectKey, 'objectKey'),
					thumbnailKey: value(null, 'thumbnailKey'),
					duration: value(null, 'duration'),
					fileSize: value(input.fileSize ?? null, 'fileSize'),
					mimeType: value(input.mimeType ?? null, 'mimeType'),
					status: value('completed', 'status'),
					createdAt: value(now, 'createdAt'),
					updatedAt: value(now, 'updatedAt'),
					noteId: value(input.noteId, 'noteId'),
				})
				.from(OrganizationMediaAsset)
				.where(assetStillMatches(input)),
		)
		.returning({ id: OrganizationNoteUpload.id })
	return inserted.length > 0
}

/** Returns false when the library item was deleted or replaced meanwhile. */
export async function attachLibraryAssetToComment(
	executor: Executor,
	input: {
		organizationId: string
		assetId: string
		objectKey: string
		commentId: string
		altText?: string | null
	},
) {
	const now = Date.now()
	const inserted = await executor
		.insert(NoteCommentImage)
		.select(
			executor
				.select({
					id: value(createId(), 'id'),
					altText: value(input.altText ?? null, 'altText'),
					objectKey: value(input.objectKey, 'objectKey'),
					createdAt: value(now, 'createdAt'),
					updatedAt: value(now, 'updatedAt'),
					commentId: value(input.commentId, 'commentId'),
				})
				.from(OrganizationMediaAsset)
				.where(assetStillMatches(input)),
		)
		.returning({ id: NoteCommentImage.id })
	return inserted.length > 0
}
