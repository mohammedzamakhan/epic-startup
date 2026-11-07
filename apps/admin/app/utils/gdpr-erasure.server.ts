import { ENV } from 'varlock/env'

export type AppErasureOutcome =
	| {
			ok: true
			processed: number
			failed: number
			held: number
			errors: string[]
	  }
	| { ok: false; error: string }

/**
 * Asks the App to run one due erasure request now
 * (`POST /resources/jobs/gdpr-erasure` with `{ requestId }`). The App owns
 * erasure: the sole-admin re-check, the claim, the regional staff erasure and
 * retries all live there, so Admin never deletes the account itself.
 */
export async function runErasureInApp(
	requestId: string,
	fetchImpl: typeof fetch = fetch,
): Promise<AppErasureOutcome> {
	const base = ENV.APP_URL?.replace(/\/$/, '')
	const token = ENV.INTERNAL_COMMAND_TOKEN
	if (!base || !token) {
		return { ok: false, error: 'APP_URL or INTERNAL_COMMAND_TOKEN is not set' }
	}
	const response = await fetchImpl(`${base}/resources/jobs/gdpr-erasure`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ requestId }),
		signal: AbortSignal.timeout(60_000),
	}).catch(() => null)
	if (!response) return { ok: false, error: 'The App did not answer' }
	const body = (await response.json().catch(() => null)) as {
		processed?: number
		failed?: number
		held?: number
		errors?: Array<{ error?: string }>
	} | null
	if (!response.ok || !body) {
		return { ok: false, error: `The App answered ${response.status}` }
	}
	return {
		ok: true,
		processed: body.processed ?? 0,
		failed: body.failed ?? 0,
		held: body.held ?? 0,
		errors: (body.errors ?? []).map((entry) => entry.error ?? 'unknown'),
	}
}
