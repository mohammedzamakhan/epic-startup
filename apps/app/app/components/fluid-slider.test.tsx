// @vitest-environment jsdom

import { FluidSlider } from '@repo/ui/fluid-slider'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
	vi.stubGlobal(
		'matchMedia',
		vi.fn(() => ({
			matches: false,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		})),
	)
})

describe('FluidSlider', () => {
	it('shows the label and the formatted value', () => {
		render(
			<FluidSlider
				variant="scrubber"
				label="Brightness"
				min={50}
				max={150}
				value={100}
				formatValue={(value) => `${value}%`}
				onChange={() => {}}
			/>,
		)
		expect(screen.getAllByText('Brightness').length).toBeGreaterThan(0)
		expect(screen.getByText('100%')).toBeTruthy()
	})

	it('exposes a named slider thumb that the arrow keys move', () => {
		const onChange = vi.fn()
		render(
			<FluidSlider
				variant="scrubber"
				label="Contrast"
				min={50}
				max={150}
				value={100}
				onChange={onChange}
			/>,
		)
		const thumb = screen.getByRole('slider', { name: 'Contrast' })
		expect(thumb.getAttribute('aria-valuenow')).toBe('100')
		fireEvent.keyDown(thumb, { key: 'ArrowRight' })
		expect(onChange).toHaveBeenCalledWith(101)
	})

	it('does not respond when disabled', () => {
		const onChange = vi.fn()
		const { container } = render(
			<FluidSlider
				variant="scrubber"
				label="Grayscale"
				value={0}
				disabled
				onChange={onChange}
			/>,
		)
		const row = container.querySelector('.cursor-ew-resize')
		if (row) fireEvent.pointerDown(row, { clientX: 10, pointerType: 'mouse' })
		expect(onChange).not.toHaveBeenCalled()
	})

	it('never renders NaN when min equals max', () => {
		const { container } = render(
			<FluidSlider
				variant="scrubber"
				label="Fixed"
				min={5}
				max={5}
				value={5}
				onChange={() => {}}
			/>,
		)
		const row = container.querySelector('.cursor-ew-resize')
		if (!row) throw new Error('row not found')
		fireEvent.pointerDown(row, { clientX: 10, pointerType: 'mouse' })
		expect(container.innerHTML).not.toContain('NaN')
	})

	it('names the slider from aria-label when there is no visible label', () => {
		render(
			<FluidSlider
				variant="scrubber"
				aria-label="Volume"
				value={10}
				onChange={() => {}}
			/>,
		)
		expect(screen.getByRole('slider', { name: 'Volume' })).toBeTruthy()
	})
})
