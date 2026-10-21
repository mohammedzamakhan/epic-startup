import { type FormMetadata } from '@conform-to/react'
import { Trans, msg } from '@lingui/macro'
import { useLingui } from '@lingui/react'
import { SaveBar as SaveBarView } from '@repo/ui/save-bar'
import { useEffect, useId, useRef, useSyncExternalStore } from 'react'
import {
	useConfirmBlocker,
	useDirtyBeforeUnload,
} from '#app/utils/navigation-guards.ts'

type SaveBarSource = {
	dirty: boolean
	saving: boolean
	guard: boolean
	save: () => void
	discard: () => void
}

type SaveBarSnapshot = {
	visible: boolean
	saving: boolean
	/** Block navigation: something is dirty and no source guards itself. */
	guard: boolean
}

// One bar for the whole app, like the leave prompt in navigation-guards: every
// form on the page registers a source and the bar acts on all dirty ones.
const sources = new Map<string, SaveBarSource>()
const listeners = new Set<() => void>()
const HIDDEN: SaveBarSnapshot = { visible: false, saving: false, guard: false }
let snapshot: SaveBarSnapshot = HIDDEN

function publish() {
	let visible = false
	let saving = false
	let dirty = false
	let selfGuarded = false
	for (const source of sources.values()) {
		if (source.dirty || source.saving) visible = true
		if (source.saving) saving = true
		if (source.dirty) {
			dirty = true
			if (!source.guard) selfGuarded = true
		}
	}
	const guard = dirty && !saving && !selfGuarded
	if (
		visible !== snapshot.visible ||
		saving !== snapshot.saving ||
		guard !== snapshot.guard
	) {
		snapshot = visible || saving ? { visible, saving, guard } : HIDDEN
		for (const listener of listeners) listener()
	}
}

function subscribe(callback: () => void) {
	listeners.add(callback)
	return () => listeners.delete(callback)
}

function useSaveBarSnapshot() {
	return useSyncExternalStore(
		subscribe,
		() => snapshot,
		() => HIDDEN,
	)
}

/** Registers a form with the global save bar. */
export function useSaveBar({
	dirty,
	saving,
	onSave,
	onDiscard,
	guard = true,
}: {
	dirty: boolean
	saving: boolean
	onSave: () => void
	onDiscard: () => void
	/**
	 * Set `false` when the page already blocks navigation itself (for example
	 * with `useUnsavedChangesWarning`). The bar registers the one leave guard
	 * (React Router honors a single blocker) and stands down while any dirty
	 * source sets this to `false`.
	 */
	guard?: boolean
}) {
	const id = useId()
	// The bar calls the latest handlers without re-registering on every render.
	const handlers = useRef({ onSave, onDiscard })
	useEffect(() => {
		handlers.current = { onSave, onDiscard }
	})

	useEffect(() => {
		sources.set(id, {
			dirty,
			saving,
			guard,
			save: () => handlers.current.onSave(),
			discard: () => handlers.current.onDiscard(),
		})
		publish()
	}, [id, dirty, saving, guard])

	useEffect(
		() => () => {
			sources.delete(id)
			publish()
		},
		[id],
	)
}

/** Whether an action response reports a failed save (edits must be kept). */
function isFailedSave(data: unknown) {
	if (!data || typeof data !== 'object') return false
	const { result, error } = data as {
		result?: { status?: string }
		error?: unknown
	}
	return result?.status === 'error' || Boolean(error)
}

/**
 * Registers a Conform form with the save bar: Save submits the form, Discard
 * resets it to its default values. Pass the fetcher that submits the form.
 */
export function useConformSaveBar(
	form: Pick<FormMetadata<any, any>, 'id' | 'dirty' | 'reset'>,
	fetcher: { state: string; data?: unknown },
) {
	const saving = fetcher.state !== 'idle'
	// Conform adopts new `defaultValue`s only on reset, so a saved form would
	// stay dirty after the loader returns the new values. A fetcher goes idle
	// only after the action and the revalidation landed, so reset then, but
	// only when the action reported no error: failures keep the edits.
	const latest = useRef({ form, failed: isFailedSave(fetcher.data) })
	const wasSaving = useRef(false)
	useEffect(() => {
		latest.current = { form, failed: isFailedSave(fetcher.data) }
	})
	useEffect(() => {
		const finished = wasSaving.current && !saving
		wasSaving.current = saving
		if (finished && !latest.current.failed) latest.current.form.reset()
	}, [saving])

	useSaveBar({
		dirty: form.dirty,
		saving,
		onSave: () => {
			const element = document.getElementById(form.id)
			if (element instanceof HTMLFormElement) element.requestSubmit()
		},
		onDiscard: () => {
			const element = document.getElementById(form.id)
			if (element instanceof HTMLFormElement) element.reset()
		},
	})
}

function run(action: 'save' | 'discard') {
	for (const source of [...sources.values()]) {
		if (source.dirty && !source.saving) source[action]()
	}
}

/**
 * The one leave guard for every registered form (React Router honors a single
 * blocker). Mounted once in root.tsx, inside the router.
 */
export function SaveBarGuard() {
	const { _ } = useLingui()
	const { guard } = useSaveBarSnapshot()
	useDirtyBeforeUnload(guard)
	useConfirmBlocker(
		guard,
		_(msg`You have unsaved changes. Leave this page and lose them?`),
	)
	return null
}

/** Global "Unsaved changes" bar (mounted once in root.tsx). */
export function SaveBar() {
	const { _ } = useLingui()
	const { visible, saving } = useSaveBarSnapshot()
	useEffect(() => {
		if (!visible) return
		// Ctrl/Cmd+S saves, like the browser's own habit for documents.
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key.toLowerCase() !== 's' || !(event.metaKey || event.ctrlKey))
				return
			event.preventDefault()
			if (!snapshot.saving) run('save')
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [visible])
	if (!visible) return null

	return (
		<SaveBarView
			aria-label={_(msg`Unsaved changes`)}
			savingLabel={_(msg`Saving…`)}
			message={<Trans>Unsaved changes</Trans>}
			discardLabel={<Trans>Discard</Trans>}
			saveLabel={<Trans>Save</Trans>}
			saving={saving}
			onDiscard={() => run('discard')}
			onSave={() => run('save')}
		/>
	)
}
