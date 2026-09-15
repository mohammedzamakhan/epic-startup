import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ENV } from 'varlock/env'

import {
	getGlobalSendMax,
	rateLimitByKey,
	resetRateLimits,
} from './rate-limit.ts'

describe('rate-limit getGlobalSendMax', () => {
	const original = process.env.GLOBAL_SMS_CAP

	beforeEach(() => {
		delete process.env.GLOBAL_SMS_CAP
	})

	afterEach(() => {
		if (original !== undefined) {
			process.env.GLOBAL_SMS_CAP = original
		} else {
			delete process.env.GLOBAL_SMS_CAP
		}
	})

	it('returns default 500 when unset', () => {
		expect(getGlobalSendMax()).toBe(500)
	})

	it('returns parsed integer when valid positive integer', () => {
		process.env.GLOBAL_SMS_CAP = '250'
		expect(getGlobalSendMax()).toBe(250)
	})

	it('falls back to 500 when invalid or non-positive', () => {
		process.env.GLOBAL_SMS_CAP = 'invalid-number'
		expect(getGlobalSendMax()).toBe(500)

		process.env.GLOBAL_SMS_CAP = '-10'
		expect(getGlobalSendMax()).toBe(500)

		process.env.GLOBAL_SMS_CAP = '0'
		expect(getGlobalSendMax()).toBe(500)
	})
})

describe('rateLimitByKey', () => {
	beforeEach(() => {
		resetRateLimits()
	})

	afterEach(() => {
		resetRateLimits()
	})

	it('bypasses limiting when not in production', () => {
		const config = { maxRequests: 2, windowMs: 60 * 1000 }
		expect(rateLimitByKey('test', 'user-1', config)).toEqual({ limited: false })
		expect(rateLimitByKey('test', 'user-1', config)).toEqual({ limited: false })
		expect(rateLimitByKey('test', 'user-1', config)).toEqual({ limited: false })
	})

	it('enforces limit in production mode', () => {
		const originalNodeEnv = ENV.NODE_ENV
		try {
			// @ts-expect-error mutating ENV for testing
			ENV.NODE_ENV = 'production'
			const config = { maxRequests: 2, windowMs: 60 * 1000 }
			expect(rateLimitByKey('prod-test', '+15550001', config)).toEqual({
				limited: false,
			})
			expect(rateLimitByKey('prod-test', '+15550001', config)).toEqual({
				limited: false,
			})
			const third = rateLimitByKey('prod-test', '+15550001', config)
			expect(third.limited).toBe(true)
			if (third.limited) {
				expect(third.retryAfter).toBeGreaterThan(0)
			}
		} finally {
			// @ts-expect-error restoring ENV
			ENV.NODE_ENV = originalNodeEnv
		}
	})
})
