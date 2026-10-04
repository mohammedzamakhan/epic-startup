import { Trans, msg } from '@lingui/macro'
import { useLingui } from '@lingui/react'
import { CHAT_LIMITS } from '@repo/common/chat'
import { chatMentionMarkdown } from '@repo/common/chat-markdown'
import { Button } from '@repo/ui/button'
import { Icon } from '@repo/ui/icon'
import { Emoji, gitHubEmojis } from '@tiptap/extension-emoji'
import Mention from '@tiptap/extension-mention'
import Placeholder from '@tiptap/extension-placeholder'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import {
	useEffect,
	useRef,
	useState,
	type FormEvent,
	type KeyboardEvent,
} from 'react'
import { CommentImagePreview } from '#app/components/note/comment-image-preview.tsx'
import { CommentImageUpload } from '#app/components/note/comment-image-upload.tsx'
import { EmojiPickerButton } from '#app/components/note/emoji-picker-button.tsx'
import getSuggestions from '#app/components/note/suggestions.tsx'

export type ChatComposerMember = {
	id: string
	label: string
}

function mentionUsers(members: ChatComposerMember[]) {
	return members.map((member) => ({
		id: member.id,
		name: member.label,
		email: '',
	}))
}

function markdownFromEditor(editor: Editor | null) {
	if (!editor) return ''
	const storage = editor.storage as { markdown?: { getMarkdown(): string } }
	if (storage.markdown?.getMarkdown) {
		return storage.markdown.getMarkdown().trim()
	}
	return editor.getText().trim()
}

export function ChatComposer({
	placeholder,
	initialValue = '',
	submitLabel,
	autoFocus,
	disabled,
	members,
	orgSlug,
	onSend,
	onTyping,
	onCancel,
}: {
	placeholder?: string
	initialValue?: string
	submitLabel?: string
	autoFocus?: boolean
	disabled?: boolean
	members: ChatComposerMember[]
	orgSlug: string
	onSend(body: string, attachmentKeys?: string[]): Promise<void>
	onTyping?(): void
	onCancel?(): void
}) {
	const { _ } = useLingui()
	const [pending, setPending] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [images, setImages] = useState<File[]>([])
	const [uploading, setUploading] = useState(false)
	const mentionList = useRef(members)
	mentionList.current = members

	const editor = useEditor({
		extensions: [
			StarterKit.configure({ heading: false }),
			Markdown,
			Placeholder.configure({ placeholder }),
			Mention.configure({
				suggestion: getSuggestions(mentionUsers(members)),
				renderText({ node }) {
					const label =
						(node.attrs.label as string) || (node.attrs.id as string) || ''
					return chatMentionMarkdown(label, String(node.attrs.id))
				},
				HTMLAttributes: {
					class:
						'mention bg-primary/10 text-primary px-1 py-0.5 rounded text-sm font-medium',
				},
			}),
			Emoji.configure({
				emojis: gitHubEmojis,
				enableEmoticons: true,
			}),
		],
		content: initialValue,
		editorProps: {
			attributes: {
				class:
					'prose prose-sm max-w-none min-h-9 max-h-40 overflow-y-auto px-3 py-2 text-sm focus-visible:outline-none',
			},
		},
		onUpdate: () => {
			onTyping?.()
		},
	})

	useEffect(() => {
		if (autoFocus && editor) editor.commands.focus('end')
	}, [autoFocus, editor])

	async function uploadImages(): Promise<string[]> {
		if (images.length === 0) return []
		setUploading(true)
		const keys: string[] = []
		try {
			for (const file of images) {
				const form = new FormData()
				form.append('file', file)
				const response = await fetch(
					`/${encodeURIComponent(orgSlug)}/chat/upload`,
					{ method: 'POST', body: form },
				)
				const payload: unknown = await response.json().catch(() => null)
				if (!response.ok) {
					const message =
						payload &&
						typeof payload === 'object' &&
						'error' in payload &&
						typeof payload.error === 'string'
							? payload.error
							: _(msg`Could not upload image.`)
					throw new Error(message)
				}
				if (
					payload &&
					typeof payload === 'object' &&
					'objectKey' in payload &&
					typeof payload.objectKey === 'string'
				) {
					keys.push(payload.objectKey)
				}
			}
			return keys
		} finally {
			setUploading(false)
		}
	}

	async function submit(event?: FormEvent) {
		event?.preventDefault()
		if (!editor || pending || disabled || uploading) return
		const body = markdownFromEditor(editor)
		if (!body && images.length === 0) return
		if (body.length > CHAT_LIMITS.bodyMax) {
			setError(_(msg`Message is too long.`))
			return
		}
		setPending(true)
		setError(null)
		try {
			const attachmentKeys = await uploadImages()
			await onSend(body, attachmentKeys.length > 0 ? attachmentKeys : undefined)
			editor.commands.clearContent()
			setImages([])
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: _(msg`Could not send message.`),
			)
		} finally {
			setPending(false)
		}
	}

	function onKeyDown(event: KeyboardEvent) {
		if (
			event.key === 'Enter' &&
			!event.shiftKey &&
			!event.nativeEvent.isComposing
		) {
			event.preventDefault()
			void submit()
		}
		if (event.key === 'Escape' && onCancel) onCancel()
	}

	return (
		<form
			onSubmit={submit}
			className="flex flex-col gap-1"
			onKeyDown={onKeyDown}
		>
			<div className="rounded-md border">
				<EditorContent editor={editor} />
				{images.length > 0 ? (
					<CommentImagePreview
						files={images}
						onRemove={(index) =>
							setImages((current) => current.filter((_, i) => i !== index))
						}
					/>
				) : null}
				<div className="flex items-center gap-1 border-t px-2 py-1">
					<CommentImageUpload
						onImagesSelected={(files) =>
							setImages((current) =>
								[...current, ...files].slice(0, CHAT_LIMITS.attachmentsMax),
							)
						}
						maxImages={CHAT_LIMITS.attachmentsMax - images.length}
						disabled={disabled || images.length >= CHAT_LIMITS.attachmentsMax}
					/>
					<EmojiPickerButton
						onEmojiSelect={(emoji) =>
							editor?.chain().focus().insertContent(emoji).run()
						}
					/>
				</div>
			</div>
			<div className="flex items-center justify-end gap-2">
				{onCancel ? (
					<Button type="button" variant="ghost" size="sm" onClick={onCancel}>
						<Trans>Cancel</Trans>
					</Button>
				) : null}
				<Button
					type="submit"
					size={onCancel ? 'sm' : 'icon'}
					disabled={pending || uploading || disabled}
					aria-label={submitLabel ?? _(msg`Send message`)}
				>
					{onCancel ? submitLabel : <Icon name="send" />}
				</Button>
			</div>
			{error ? (
				<p role="alert" className="text-destructive text-xs">
					{error}
				</p>
			) : null}
		</form>
	)
}
