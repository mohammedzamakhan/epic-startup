import { initVarlockEnv } from 'varlock/env'

/**
 * Cloudflare bindings are the production source of truth. Keep the Varlock
 * proxy and process.env aligned for shared packages that read ENV.* while
 * avoiding any build-time environment snapshot in the Worker bundle.
 *
 * Shared by the Worker entry and Durable Object classes: each runs with its own
 * `env` and must apply it before touching code that reads ENV.*.
 */
export function applyWorkerEnv(env: Env) {
	const existingConfig = (globalThis as any).__varlockLoadedEnv?.config ?? {}
	const newConfig: Record<string, { value: unknown }> = {}
	for (const [key, value] of Object.entries(env)) {
		if (
			typeof value === 'string' ||
			typeof value === 'number' ||
			typeof value === 'boolean'
		) {
			// Preserve Varlock's sensitivity metadata when a legacy bootstrap blob is
			// present, but never retain a value that is absent from Cloudflare `env`.
			newConfig[key] = { ...existingConfig[key], value: String(value) }
			if (typeof process !== 'undefined' && process.env) {
				process.env[key] = String(value)
			}
		}
	}
	;(globalThis as any).__varlockLoadedEnv = {
		...(globalThis as any).__varlockLoadedEnv,
		config: newConfig,
	}
	initVarlockEnv({ allowFail: true })
}
