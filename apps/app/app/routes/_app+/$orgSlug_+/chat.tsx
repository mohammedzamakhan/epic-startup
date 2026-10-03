import { Trans } from '@lingui/macro'
import { requireUserId, userHasOrganizationPermission } from '@repo/auth'
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from '@repo/ui/empty'
import {
	data,
	useLoaderData,
	useParams,
	useSearchParams,
	type LoaderFunctionArgs,
	type ShouldRevalidateFunctionArgs,
} from 'react-router'
import { ChatView } from '#app/components/chat/chat-view.tsx'
import { listChannelsForUser } from '#app/utils/chat/channels.server.ts'
import { isChatAvailable } from '#app/utils/chat/namespace.server.ts'
import { requireUserOrganization } from '#app/utils/organization/loader.server.ts'
import { ORG_PERMISSIONS } from '#app/utils/organization/permissions.server.ts'

export async function loader({ request, params }: LoaderFunctionArgs) {
	const userId = await requireUserId(request)
	const organization = await requireUserOrganization(
		request,
		params.orgSlug || '',
		{ id: true },
	)
	const [channels, canManage] = await Promise.all([
		listChannelsForUser(organization.id, userId),
		userHasOrganizationPermission(
			userId,
			organization.id,
			ORG_PERMISSIONS.UPDATE_CHAT_ANY,
		),
	])
	return data(
		{ channels, canManage, available: isChatAvailable() },
		{ headers: { 'Cache-Control': 'private, no-store' } },
	)
}

/**
 * Switching channels only changes `?channel=`; the channel list is the same, so
 * skip the loader. An explicit revalidation (channels changed) keeps the same
 * URL and still runs it.
 */
export function shouldRevalidate({
	currentUrl,
	nextUrl,
	defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
	if (
		currentUrl.pathname === nextUrl.pathname &&
		currentUrl.search !== nextUrl.search
	) {
		return false
	}
	return defaultShouldRevalidate
}

export default function ChatRoute() {
	const { orgSlug = '' } = useParams()
	const { channels, canManage, available } = useLoaderData<typeof loader>()
	const [searchParams] = useSearchParams()
	const requested = searchParams.get('channel')
	const activeChannelId =
		channels.find((channel) => channel.id === requested)?.id ??
		channels[0]?.id ??
		null

	return (
		<div className="-mx-4 flex min-h-0 flex-1 flex-col md:-mx-2">
			{available ? (
				<ChatView
					// A fresh socket and state per organization.
					key={orgSlug}
					orgSlug={orgSlug}
					channels={channels}
					activeChannelId={activeChannelId}
					canManage={canManage}
				/>
			) : (
				<Empty className="flex-1">
					<EmptyHeader>
						<EmptyTitle>
							<Trans>Team chat isn't available here</Trans>
						</EmptyTitle>
						<EmptyDescription>
							<Trans>
								Chat runs on Cloudflare Durable Objects. Start the app with `npm
								run dev:cf -w app` to use it locally.
							</Trans>
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			)}
		</div>
	)
}
