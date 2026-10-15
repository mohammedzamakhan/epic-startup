import { t } from '@lingui/macro'
import { useLingui } from '@lingui/react'
import { FieldLegend, FieldSet } from '@repo/ui/field'
import {
	POSITION_COLOR_KEYS,
	type PositionColorKey,
} from '@repo/ui/position-color'
import { ColorSwatch } from '#app/components/color-swatch.tsx'

/**
 * Position colors are theme-token keys, so they follow light and dark themes:
 * each swatch paints with its `--position-*` variable rather than a hex value.
 * Uses the same swatch as the site Accent color picker.
 */
export function PositionColorField({
	value,
	onChange,
	legend,
}: {
	value: PositionColorKey
	onChange: (value: PositionColorKey) => void
	legend: string
}) {
	const { _ } = useLingui()
	const labels: Record<PositionColorKey, string> = {
		neutral: _(t`Neutral`),
		red: _(t`Red`),
		orange: _(t`Orange`),
		amber: _(t`Amber`),
		green: _(t`Green`),
		teal: _(t`Teal`),
		blue: _(t`Blue`),
		violet: _(t`Violet`),
		pink: _(t`Pink`),
	}
	return (
		<FieldSet>
			<FieldLegend variant="label">{legend}</FieldLegend>
			<div className="flex flex-wrap gap-2">
				{POSITION_COLOR_KEYS.map((key) => (
					<ColorSwatch
						key={key}
						label={labels[key]}
						swatch={`var(--position-${key})`}
						selected={value === key}
						onSelect={() => onChange(key)}
					/>
				))}
			</div>
		</FieldSet>
	)
}
