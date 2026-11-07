import { useLingui } from '@lingui/react'
import { useNonce } from '@repo/common'
import { useEffect, useRef } from 'react'
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
		},
	) => string | undefined
	reset: (widgetId: string) => void
	remove: (widgetId: string) => void
}

declare global {
	interface Window {
		turnstile?: TurnstileApi
	}
}

let scriptPromise: Promise<TurnstileApi> | null = null

/**
 * Loads api.js once. The script is inserted by the App's own nonce'd bundle,
 * which `'strict-dynamic'` trusts; it also carries the nonce when one is known.
 * The challenge iframe needs `https://challenges.cloudflare.com` in
 * `frame-src` (added in entry.server.tsx when Turnstile is configured).
 */
function loadTurnstile(nonce: string): Promise<TurnstileApi> {
	if (window.turnstile) return Promise.resolve(window.turnstile)
	if (scriptPromise) return scriptPromise
	scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
		const script = document.createElement('script')
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
		scriptPromise = null
		throw error
	})
	return scriptPromise
}

/**
 * Cloudflare Turnstile challenge for a form. Renders nothing without a site
 * key. The widget adds a hidden `cf-turnstile-response` input to the
 * surrounding form; the action verifies it with `checkOperatorTurnstile`.
 *
 * A token is single use, so pass the latest action result as `resetKey`: the
 * widget fetches a new token whenever it changes.
 */
export function TurnstileWidget({
	siteKey,
	action,
	resetKey,
}: {
	siteKey: string | null | undefined
	action: string
	resetKey?: unknown
}) {
	const containerRef = useRef<HTMLDivElement>(null)
	const widgetIdRef = useRef<string | null>(null)
	const nonce = useNonce()
	const theme = useOptionalTheme()
	const { i18n } = useLingui()
	const locale = i18n.locale

	useEffect(() => {
		const container = containerRef.current
		if (!siteKey || !container) return
		let cancelled = false
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
					}) ?? null
			})
			.catch(() => {
				// Blocked or offline: the server answers with a form error.
			})
		return () => {
			cancelled = true
			const widgetId = widgetIdRef.current
			widgetIdRef.current = null
			if (widgetId) window.turnstile?.remove(widgetId)
		}
	}, [siteKey, action, theme, locale, nonce])

	useEffect(() => {
		if (resetKey === undefined) return
		const widgetId = widgetIdRef.current
		if (widgetId) window.turnstile?.reset(widgetId)
	}, [resetKey])

	if (!siteKey) return null
	return <div ref={containerRef} className="min-h-16.25 w-full" />
}
