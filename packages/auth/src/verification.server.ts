import { createCookieSessionStorage, type SessionStorage } from 'react-router'
import { ENV } from './package-env.js'

/**
 * Read at first use, not at module load: on Cloudflare Workers the bindings
 * reach `ENV` only after the server build has loaded, so a top-level read
 * would capture the build default instead of the deployed secret.
 */
function getVerificationSecrets(): string[] {
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

let _verifySessionStorage: SessionStorage | undefined

function getVerifySessionStorage(): SessionStorage {
	return (_verifySessionStorage ??= createCookieSessionStorage({
		cookie: {
			name: 'en_verification',
			sameSite: 'lax',
			path: '/',
			httpOnly: true,
			maxAge: 60 * 10, // 10 minutes
			secrets: getVerificationSecrets(),
			secure: ENV.NODE_ENV === 'production',
		},
	}))
}

export const verifySessionStorage: SessionStorage = {
	getSession(...args) {
		return getVerifySessionStorage().getSession(...args)
	},
	commitSession(...args) {
		return getVerifySessionStorage().commitSession(...args)
	},
	destroySession(...args) {
		return getVerifySessionStorage().destroySession(...args)
	},
}
