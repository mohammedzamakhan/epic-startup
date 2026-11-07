import { useLingui } from '@lingui/react'
import { useNonce } from '@repo/common'
import { useEffect, useRef, useState } from 'react'
import { useOptionalTheme } from '#app/routes/resources+/theme-switch.tsx'

const TURNSTILE_SCRIPT_URL =
	'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

type TurnstileApi = {
	render: (
		container: HTMLElement,
		options: {
			sitekey: string
			action?: string
			theme?: 'light' | 'dark' | 'auto'
			language?: string
			size?: 'normal' | 'flexible' | 'compact'
			callback?: (token: string) => void
			'expired-callback'?: () => void
			'error-callback'?: () => void
		},
	) => string | undefined
	reset: (widgetId: string) => void
	remove: (widgetId: string) => void
}

declare global {
	interface Window {
		turnstile?: TurnstileApi
		/** In-flight api.js load, on `window` so it survives hot updates. */
		__turnstileLoad?: Promise<TurnstileApi>
	}
}

/**
 * Loads api.js once. The script is inserted by the App's own nonce'd bundle,
 * which `'strict-dynamic'` trusts; it also carries the nonce when one is known.
 * The challenge needs `https://challenges.cloudflare.com` in `frame-src`,
 * `connect-src` and `script-src` (added in entry.server.tsx when Turnstile is
 * configured). A failed load removes its script so the next attempt starts
 * clean.
 */
function loadTurnstile(nonce: string): Promise<TurnstileApi> {
	if (window.turnstile) return Promise.resolve(window.turnstile)
	if (window.__turnstileLoad) return window.__turnstileLoad
	const script = document.createElement('script')
	const load = new Promise<TurnstileApi>((resolve, reject) => {
		script.src = TURNSTILE_SCRIPT_URL
		script.async = true
		if (nonce) script.nonce = nonce
		script.onload = () => {
			if (window.turnstile) resolve(window.turnstile)
			else reject(new Error('Turnstile did not load'))
		}
		script.onerror = () => reject(new Error('Turnstile did not load'))
		document.head.appendChild(script)
	}).catch((error: unknown) => {
		script.remove()
		window.__turnstileLoad = undefined
		throw error
	})
	window.__turnstileLoad = load
	return load
}

const MAX_LOAD_ATTEMPTS = 5

/**
 * Whether a form with this site key may be submitted: always when Turnstile is
 * off, otherwise once the widget holds a token. Pass the setter to the widget
 * as `onReadyChange` and disable the submit button while this is false.
 */
export function useTurnstileReady(siteKey: string | null | undefined) {
	const [ready, setReady] = useState(false)
	return [!siteKey || ready, setReady] as const
}

/**
 * Cloudflare Turnstile challenge for a form. Renders nothing without a site
 * key. The widget adds a hidden `cf-turnstile-response` input to the
 * surrounding form; the action verifies it with `checkOperatorTurnstile`.
 *
 * A token is single use, so pass the latest action result as `resetKey`: the
 * widget fetches a new token whenever it changes. `onReadyChange` reports
 * whether the widget currently holds a token (see `useTurnstileReady`).
 */
export function TurnstileWidget({
	siteKey,
	action,
	resetKey,
	onReadyChange,
}: {
	siteKey: string | null | undefined
	action: string
	resetKey?: unknown
	onReadyChange?: (ready: boolean) => void
}) {
	const containerRef = useRef<HTMLDivElement>(null)
	const widgetIdRef = useRef<string | null>(null)
	const onReadyRef = useRef(onReadyChange)
	onReadyRef.current = onReadyChange
	const [attempt, setAttempt] = useState(1)
	const nonce = useNonce()
	const theme = useOptionalTheme()
	const { i18n } = useLingui()
	const locale = i18n.locale

	useEffect(() => {
		const container = containerRef.current
		if (!siteKey || !container) return
		let cancelled = false
		let retryTimer: ReturnType<typeof setTimeout> | undefined
		loadTurnstile(nonce)
			.then((turnstile) => {
				if (cancelled) return
				widgetIdRef.current =
					turnstile.render(container, {
						sitekey: siteKey,
						action,
						theme: theme ?? 'auto',
						language: locale || 'auto',
						size: 'flexible',
						callback: () => onReadyRef.current?.(true),
						'expired-callback': () => onReadyRef.current?.(false),
						'error-callback': () => onReadyRef.current?.(false),
					}) ?? null
			})
			.catch(() => {
				// Blocked or offline: try again with a growing delay. Until then
				// the form stays disabled, and the server refuses a missing token.
				if (cancelled || attempt >= MAX_LOAD_ATTEMPTS) return
				retryTimer = setTimeout(() => setAttempt((n) => n + 1), attempt * 2000)
			})
		return () => {
			cancelled = true
			clearTimeout(retryTimer)
			const widgetId = widgetIdRef.current
			widgetIdRef.current = null
			onReadyRef.current?.(false)
			if (widgetId) window.turnstile?.remove(widgetId)
		}
	}, [siteKey, action, theme, locale, nonce, attempt])

	useEffect(() => {
		if (resetKey === undefined) return
		const widgetId = widgetIdRef.current
		if (widgetId) {
			onReadyRef.current?.(false)
			window.turnstile?.reset(widgetId)
		} else {
			// The script never loaded: a new form result is a good moment to retry.
			setAttempt((n) => (n >= MAX_LOAD_ATTEMPTS ? 1 : n))
		}
	}, [resetKey])

	if (!siteKey) return null
	return <div ref={containerRef} className="min-h-16.25 w-full" />
}
