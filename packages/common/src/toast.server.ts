import { createId as cuid } from '@paralleldrive/cuid2'
import { ENV } from './package-env.js'
import {
	createCookieSessionStorage,
	redirect,
	type SessionStorage,
} from 'react-router'
import { z } from 'zod'
import { combineHeaders } from './misc.js'

export const toastKey = 'toast'

const ToastSchema = z.object({
	description: z.string(),
	id: z.string().default(() => cuid()),
	title: z.string().optional(),
	type: z.enum(['message', 'success', 'error']).default('message'),
})

export type Toast = z.infer<typeof ToastSchema>
export type ToastInput = z.input<typeof ToastSchema>

/**
 * Read at first use, not at module load: on Cloudflare Workers the bindings
 * reach `ENV` only after the server build has loaded, so a top-level read
 * would capture the build default instead of the deployed secret.
 */
function getToastSecrets(): string[] {
	if (!ENV.SESSION_SECRET) {
		throw new Error(
			'SESSION_SECRET environment variable is required but not set. ' +
				'Please add SESSION_SECRET to your .env file. ' +
				'Example: SESSION_SECRET=your-secret-key-here',
		)
	}
	const secrets = ENV.SESSION_SECRET.split(',').map((s) => s.trim())
	if (secrets.length === 0 || secrets.some((s) => s.length === 0)) {
		throw new Error(
			'SESSION_SECRET must contain at least one non-empty secret. ' +
				'Example: SESSION_SECRET=your-secret-key-here',
		)
	}
	return secrets
}

let _toastSessionStorage: SessionStorage | undefined

function getToastSessionStorage(): SessionStorage {
	return (_toastSessionStorage ??= createCookieSessionStorage({
		cookie: {
			name: 'en_toast',
			sameSite: 'lax',
			path: '/',
			httpOnly: true,
			secrets: getToastSecrets(),
			secure: ENV.NODE_ENV === 'production',
		},
	}))
}

export const toastSessionStorage: SessionStorage = {
	getSession(...args) {
		return getToastSessionStorage().getSession(...args)
	},
	commitSession(...args) {
		return getToastSessionStorage().commitSession(...args)
	},
	destroySession(...args) {
		return getToastSessionStorage().destroySession(...args)
	},
}

export async function redirectWithToast(
	url: string,
	toast: ToastInput,
	init?: ResponseInit,
) {
	return redirect(url, {
		...init,
		headers: combineHeaders(init?.headers, await createToastHeaders(toast)),
	})
}

export async function createToastHeaders(toastInput: ToastInput) {
	const session = await toastSessionStorage.getSession()
	const toast = ToastSchema.parse(toastInput)
	session.flash(toastKey, toast)
	const cookie = await toastSessionStorage.commitSession(session)
	return new Headers({ 'set-cookie': cookie })
}

export async function getToast(request: Request) {
	const session = await toastSessionStorage.getSession(
		request.headers.get('cookie'),
	)
	const result = ToastSchema.safeParse(session.get(toastKey))
	const toast = result.success ? result.data : null
	return {
		toast,
		headers: toast
			? new Headers({
					'set-cookie': await toastSessionStorage.destroySession(session),
				})
			: null,
	}
}
