import { Trans } from '@lingui/macro'
import { Button } from '@repo/ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@repo/ui/dropdown-menu'
import { Icon } from '@repo/ui/icon'
import { Link, useParams } from 'react-router'

/** Org-scoped "New" menu in the top bar; only on organization routes. */
export function WorkspaceHeaderActions() {
	// From the matched `$orgSlug` route, not the path: `/security` and
	// `/profile` share this layout but are not organizations.
	const { orgSlug } = useParams()
	if (!orgSlug) return null

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button variant="outline" size="sm" className="hidden md:inline-flex">
						<Icon name="plus" />
						<Trans>New</Trans>
						<Icon
							name="chevron-down"
							className="text-muted-foreground size-3.5"
						/>
					</Button>
				}
			/>
			<DropdownMenuContent align="end" sideOffset={6} className="min-w-48">
				<DropdownMenuItem render={<Link to={`/${orgSlug}/notes/new`} />}>
					<Icon name="sticky-note" />
					<Trans>New note</Trans>
				</DropdownMenuItem>
				<DropdownMenuItem render={<Link to={`/${orgSlug}/reports/new`} />}>
					<Icon name="file-text" />
					<Trans>New report</Trans>
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem render={<Link to={`/${orgSlug}/settings/members`} />}>
					<Icon name="user-plus" />
					<Trans>Invite member</Trans>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
