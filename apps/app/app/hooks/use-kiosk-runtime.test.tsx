// @vitest-environment jsdom

import 'fake-indexeddb/auto'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createKioskQueue } from '#app/utils/kiosk/kiosk-queue.ts'
import { useKioskRuntime } from './use-kiosk-runtime.ts'

const HOUR = 60 * 60 * 1000

describe('useKioskRuntime', () => {
	beforeEach(() => {
		localStorage.setItem(
			'kiosk.device.v1',
			JSON.stringify({
				deviceSecret: 'a'.repeat(32),
				tenantApiUrl: 'https://tenant.example.com',
				config: {
					device: {
						id: 'd1',
						name: 'Front',
						scopeId: 'main',
						identifyMode: 'pin',
						showNextShifts: false,
					},
					scope: { name: null, timeZone: null },
				},
			}),
		)
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new TypeError('Failed to fetch')
			}),
		)
	})

	afterEach(() => {
		localStorage.clear()
		vi.unstubAllGlobals()
	})

	it('sets aside stale queued punches (and their PINs) even when offline', async () => {
		const queue = createKioskQueue()
		await queue.enqueue({
			id: 'stale-1',
			kind: 'clock_in',
			clientAt: Date.now() - 50 * HOUR,
			pin: '4821',
		})
		const { unmount } = renderHook(() =>
			useKioskRuntime({
				us: 'https://us.example.com',
				ksa: 'https://ksa.example.com',
			}),
		)
		await waitFor(async () => {
			const failed = await queue.failed()
			expect(failed).toHaveLength(1)
			expect(failed[0]).toMatchObject({
				id: 'stale-1',
				failure: 'punch_too_old',
				pin: null,
			})
		})
		unmount()
	})
})
