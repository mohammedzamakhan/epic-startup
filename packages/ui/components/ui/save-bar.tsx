import * as React from 'react'

import { cn } from '../../lib/utils'
import { Button } from './button'
import { Icon } from '../icon'

type SaveBarProps = Omit<React.ComponentProps<'div'>, 'children'> & {
	message: React.ReactNode
	discardLabel: React.ReactNode
	saveLabel: React.ReactNode
	saving?: boolean
	onDiscard: () => void
	onSave: () => void
}

/** Contextual "unsaved changes" pill; the caller owns state and wording. */
function SaveBar({
	message,
	discardLabel,
	saveLabel,
	saving = false,
	onDiscard,
	onSave,
	className,
	...props
}: SaveBarProps) {
	return (
		<div
			role="region"
			className={cn(
				'animate-in fade-in slide-in-from-top-2 bg-foreground text-background fixed top-2 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full p-1 ps-4 shadow-lg duration-150 motion-reduce:animate-none',
				className,
			)}
			{...props}
		>
			<span className="pe-4 text-sm font-medium whitespace-nowrap">
				{message}
			</span>
			<Button
				type="button"
				variant="secondary"
				size="sm"
				disabled={saving}
				onClick={onDiscard}
				className="bg-background/15 text-background hover:bg-background/25 px-3.5 text-sm"
			>
				{discardLabel}
			</Button>
			<Button
				type="button"
				size="sm"
				disabled={saving}
				onClick={onSave}
				className="bg-background text-foreground hover:bg-background/90 min-w-14 px-3.5 text-sm"
			>
				{saving ? (
					<Icon name="loader" className="size-4 animate-spin" />
				) : (
					saveLabel
				)}
			</Button>
		</div>
	)
}

export { SaveBar }
