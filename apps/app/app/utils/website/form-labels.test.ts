import { expect, test } from 'vitest'

import { hasEveryFieldLabel } from './form-labels.ts'

test('accepts plain and localized labels', () => {
	expect(
		hasEveryFieldLabel([{ label: 'Name' }, { label: '{"en":"Email"}' }]),
	).toBe(true)
})

test('rejects blank labels, including a cleared localized label', () => {
	expect(hasEveryFieldLabel([{ label: '{"en":""}' }])).toBe(false)
	expect(hasEveryFieldLabel([{ label: '{"en":"  "}' }])).toBe(false)
	expect(hasEveryFieldLabel([{ label: '' }])).toBe(false)
})
