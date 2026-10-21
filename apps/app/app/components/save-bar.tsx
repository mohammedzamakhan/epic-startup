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
	save: () => void
	discard: () => void
}

type SaveBarSnapshot = {
	visible: boolean
	saving: boolean
}

// One bar for the whole app, like the leave prompt in navigation-guards: every
// form on the page registers a source and the bar acts on all dirty ones.
const sources = new Map<string, SaveBarSource>()
const listeners = new Set<() => void>()
const HIDDEN: SaveBarSnapshot = { visible: false, saving: false }
let snapshot: SaveBarSnapshot = HIDDEN

function publish() {
	let visible = false
	let saving = false
	for (const source of sources.values()) {
		if (source.dirty || source.saving) visible = true
		if (source.saving) saving = true
	}
	if (visible !== snapshot.visible || saving !== snapshot.saving) {
		snapshot = visible || saving ? { visible, saving } : HIDDEN
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
	 * with `useUnsavedChangesWarning`): React Router honors one blocker only.
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
			save: () => handlers.current.onSave(),
			discard: () => handlers.current.onDiscard(),
		})
		publish()
	}, [id, dirty, saving])

	useEffect(
		() => () => {
			sources.delete(id)
			publish()
		},
		[id],
	)

	useDirtyBeforeUnload(guard && dirty)
	useConfirmBlocker(
		guard && dirty && !saving,
		'You have unsaved changes. Leave this page and lose them?',
	)
}

/**
 * Registers a Conform form with the save bar: Save submits the form, Discard
 * resets it to its default values. Pass `saving` while the submit is in flight.
 */
export function useConformSaveBar(
	form: Pick<FormMetadata<any, any>, 'id' | 'dirty' | 'reset' | 'valid'>,
	saving: boolean,
) {
	// Conform adopts new `defaultValue`s only on reset, so without this a saved
	// form stays dirty (and the bar visible) after the loader returns the new
	// values. Wait a tick so a server-side validation error has been reported
	// first, and keep the edits in that case.
	const latestForm = useRef(form)
	const wasSaving = useRef(false)
	useEffect(() => {
		latestForm.current = form
	})
	useEffect(() => {
		const finished = wasSaving.current && !saving
		wasSaving.current = saving
		if (!finished) return
		const timer = setTimeout(() => {
			if (latestForm.current.valid) latestForm.current.reset()
		}, 0)
		return () => clearTimeout(timer)
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

/** Global "Unsaved changes" bar (mounted once in root.tsx). */
export function SaveBar() {
	const { _ } = useLingui()
	const { visible, saving } = useSaveBarSnapshot()
	if (!visible) return null

	function run(action: 'save' | 'discard') {
		for (const source of [...sources.values()]) {
			if (source.dirty && !source.saving) source[action]()
		}
	}

	return (
		<SaveBarView
			aria-label={_(msg`Unsaved changes`)}
			message={<Trans>Unsaved changes</Trans>}
			discardLabel={<Trans>Discard</Trans>}
			saveLabel={<Trans>Save</Trans>}
			saving={saving}
			onDiscard={() => run('discard')}
			onSave={() => run('save')}
		/>
	)
}
