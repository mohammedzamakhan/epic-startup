import { Trans, msg, plural } from '@lingui/macro'
import { useLingui } from '@lingui/react'
import { type ChatChannelSummary, type ChatMessage } from '@repo/common/chat'
import { cn } from '@repo/ui'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@repo/ui/alert-dialog'
import { Badge } from '@repo/ui/badge'
import { Button } from '@repo/ui/button'
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from '@repo/ui/empty'
import { Icon } from '@repo/ui/icon'
import { Spinner } from '@repo/ui/spinner'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useRevalidator } from 'react-router'
import { toast } from 'sonner'
import { useChat } from '#app/hooks/use-chat.ts'
import { typingUserIds } from '#app/modules/chat/chat-state.ts'
import { ChatComposeDialog } from './chat-compose-dialog.tsx'
import { ChatGroupSettingsDialog } from './chat-group-settings-dialog.tsx'
import { Composer, MessageItem } from './chat-message.tsx'

const GROUP_GAP_MS = 5 * 60 * 1000
const STICK_THRESHOLD_PX = 80

export function ChatView({
	orgSlug,
	channels,
	activeChannelId,
	canManage,
	canCreateGroup,
	members,
	groupMemberIds,
}: {
	orgSlug: string
	channels: ChatChannelSummary[]
	activeChannelId: string | null
	canManage: boolean
	canCreateGroup: boolean
	members: { id: string; label: string }[]
	groupMemberIds: Record<string, string[]>
}) {
	const { _, i18n } = useLingui()
	const revalidator = useRevalidator()
	const active = channels.find((channel) => channel.id === activeChannelId)
	const channelIds = channels.map((channel) => channel.id)
	const chat = useChat({
		orgSlug,
		channelIds,
		activeChannel: active?.id ?? null,
		enabled: channels.length > 0,
		onChannelsChanged: () => {
			void revalidator.revalidate()
		},
	})
	const { state } = chat
	const connected = state.connection === 'open'
	const view = active ? state.channels[active.id] : undefined

	const [historyError, setHistoryError] = useState<string | null>(null)
	const [loadingOlder, setLoadingOlder] = useState(false)
	const [loadingEarlierReplies, setLoadingEarlierReplies] = useState(false)
	const [thread, setThread] = useState<{
		channel: string
		parent: number
	} | null>(null)
	const [pendingDelete, setPendingDelete] = useState<ChatMessage | null>(null)
	const [composing, setComposing] = useState(false)
	const [groupSettings, setGroupSettings] = useState(false)
	const teamChannels = channels.filter((channel) => channel.kind === 'channel')
	const directMessages = channels.filter((channel) => channel.kind === 'dm')
	const groupChats = channels.filter((channel) => channel.kind === 'group')

	// ── history ────────────────────────────────────────────────────────────
	const activeId = active?.id
	const loaded = view?.loaded ?? false
	const { loadHistory } = chat
	const fetchHistory = useCallback(() => {
		if (!activeId) return
		setHistoryError(null)
		loadHistory(activeId).catch((cause: unknown) =>
			setHistoryError(
				cause instanceof Error
					? cause.message
					: _(msg`Could not load messages.`),
			),
		)
	}, [activeId, loadHistory, _])
	useEffect(() => {
		if (connected && activeId && !loaded) fetchHistory()
	}, [connected, activeId, loaded, fetchHistory])

	// Leaving a channel closes its thread.
	useEffect(() => {
		setThread((current) =>
			current && current.channel !== activeId ? null : current,
		)
	}, [activeId])

	// ── scrolling ──────────────────────────────────────────────────────────
	const scroller = useRef<HTMLDivElement>(null)
	const stuckToBottom = useRef(true)
	const lastMessageId = view?.messages.at(-1)?.id
	const lastMessageMine = view?.messages.at(-1)?.author === state.me?.id
	useEffect(() => {
		stuckToBottom.current = true
	}, [activeId])
	useEffect(() => {
		const element = scroller.current
		if (!element) return
		if (stuckToBottom.current || lastMessageMine) {
			element.scrollTop = element.scrollHeight
		}
	}, [lastMessageId, lastMessageMine, activeId, loaded])

	async function loadOlder() {
		const first = view?.messages[0]
		const element = scroller.current
		if (!active || !first || !element || loadingOlder) return
		setLoadingOlder(true)
		const previousHeight = element.scrollHeight
		try {
			await loadHistory(active.id, first.id)
			requestAnimationFrame(() => {
				element.scrollTop += element.scrollHeight - previousHeight
			})
		} catch (cause) {
			toast.error(
				cause instanceof Error
					? cause.message
					: _(msg`Could not load messages.`),
			)
		} finally {
			setLoadingOlder(false)
		}
	}

	// ── typing indicator ───────────────────────────────────────────────────
	const [now, setNow] = useState(() => Date.now())
	const hasTyping = view ? Object.keys(view.typing).length > 0 : false
	useEffect(() => {
		if (!hasTyping) return
		setNow(Date.now())
		const timer = setInterval(() => setNow(Date.now()), 1000)
		return () => clearInterval(timer)
	}, [hasTyping, view?.typing])
	const typingNames = typingUserIds(view, now).map(
		(id) => state.people[id]?.name ?? _(msg`Someone`),
	)
	const firstTypingName = typingNames[0] ?? ''
	const activeName = active?.name ?? ''
	const threadLoadedReplies = thread
		? (state.threads[thread.parent] ?? []).length
		: 0
	const threadMore = thread ? (state.threadMore[thread.parent] ?? false) : false

	// ── actions ────────────────────────────────────────────────────────────
	const fail = (cause: unknown) =>
		toast.error(
			cause instanceof Error ? cause.message : _(msg`Something went wrong.`),
		)
	const onReact = (message: ChatMessage, emoji: string) => {
		chat.react(message.id, emoji).catch(fail)
	}
	const onEdit = async (message: ChatMessage, body: string) => {
		await chat.edit(message.id, body)
	}
	const openThread = (message: ChatMessage) => {
		setThread({ channel: message.channel, parent: message.id })
		chat.openThread(message.channel, message.id).catch(fail)
	}

	if (channels.length === 0) {
		return (
			<Empty className="flex-1">
				<EmptyHeader>
					<EmptyTitle>
						<Trans>No channels yet</Trans>
					</EmptyTitle>
					<EmptyDescription>
						{canManage ? (
							<Trans>
								Create a channel to start talking with your team. You can limit
								a channel to certain roles or people.
							</Trans>
						) : (
							<Trans>
								You don't have access to any channels yet. Ask an admin to add
								you to one.
							</Trans>
						)}
					</EmptyDescription>
				</EmptyHeader>
				{canManage ? (
					<EmptyContent>
						<Button render={<Link to={`/${orgSlug}/settings/chat`} />}>
							<Trans>Create a channel</Trans>
						</Button>
					</EmptyContent>
				) : null}
			</Empty>
		)
	}

	const threadParent = thread
		? state.channels[thread.channel]?.messages.find(
				(message) => message.id === thread.parent,
			)
		: undefined
	const threadReplies = thread ? (state.threads[thread.parent] ?? []) : []
	// The parent's server-side count covers replies that are not loaded yet.
	const threadTotalReplies = Math.max(
		threadParent?.replyCount ?? 0,
		threadLoadedReplies,
	)

	async function loadEarlierReplies() {
		const first = threadReplies[0]
		if (!thread || !first || loadingEarlierReplies) return
		setLoadingEarlierReplies(true)
		try {
			await chat.openThread(thread.channel, thread.parent, first.id)
		} catch (cause) {
			toast.error(
				cause instanceof Error
					? cause.message
					: _(msg`Could not load replies.`),
			)
		} finally {
			setLoadingEarlierReplies(false)
		}
	}
	const messages = view?.messages ?? []

	function channelLink(channel: ChatChannelSummary) {
		const unread = state.channels[channel.id]?.unread ?? 0
		const isActive = channel.id === activeChannelId
		const iconName =
			channel.kind === 'dm'
				? 'user'
				: channel.kind === 'group'
					? 'users'
					: channel.access === 'restricted'
						? 'lock'
						: 'message-square'
		return (
			<Link
				key={channel.id}
				to={{ search: `?channel=${channel.id}` }}
				replace
				aria-current={isActive ? 'page' : undefined}
				className={cn(
					'hover:bg-muted flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm',
					isActive && 'bg-muted font-medium',
					!isActive && unread > 0 && 'font-semibold',
				)}
			>
				<Icon name={iconName} className="text-muted-foreground" />
				<span className="min-w-0 flex-1 truncate">{channel.name}</span>
				{unread > 0 && !isActive ? (
					<Badge>
						<span aria-hidden>{unread > 99 ? '99+' : unread}</span>
						<span className="sr-only">{_(msg`${unread} unread`)}</span>
					</Badge>
				) : null}
			</Link>
		)
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col md:flex-row">
			<nav
				aria-label={_(msg`Channels`)}
				className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 md:w-60 md:flex-col md:overflow-y-auto md:border-e md:border-b-0"
			>
				<Button
					type="button"
					size="sm"
					className="mb-2 w-full justify-start"
					onClick={() => setComposing(true)}
				>
					<Icon name="plus" />
					<Trans>New message</Trans>
				</Button>
				{[
					{ title: _(msg`Channels`), items: teamChannels },
					{ title: _(msg`Direct messages`), items: directMessages },
					{ title: _(msg`Groups`), items: groupChats },
				]
					.filter((section) => section.items.length > 0)
					.map((section) => (
						<div key={section.title} className="mb-2 w-full">
							<p className="text-muted-foreground px-3 py-1 text-xs font-medium">
								{section.title}
							</p>
							{section.items.map((channel) => channelLink(channel))}
						</div>
					))}
				{channels.length === 0 ? (
					<p className="text-muted-foreground px-3 py-2 text-xs">
						<Trans>Start a conversation with someone on your team.</Trans>
					</p>
				) : null}
				{canManage ? (
					<Link
						to={`/${orgSlug}/settings/chat`}
						className="text-muted-foreground hover:text-foreground mt-2 flex shrink-0 items-center gap-2 px-3 py-1.5 text-sm"
					>
						<Icon name="settings" />
						<Trans>Manage channels</Trans>
					</Link>
				) : null}
			</nav>

			{composing ? (
				<ChatComposeDialog
					members={members.filter((member) => member.id !== state.me?.id)}
					canCreateGroup={canCreateGroup}
					onClose={() => setComposing(false)}
					onCreated={() => revalidator.revalidate()}
				/>
			) : null}
			{groupSettings && active?.kind === 'group' ? (
				<ChatGroupSettingsDialog
					channelId={active.id}
					channelName={active.name}
					createdById={active.createdById}
					meId={state.me?.id ?? ''}
					showHistoryToNewMembers={active.showHistoryToNewMembers ?? false}
					members={members}
					rosterIds={groupMemberIds[active.id] ?? []}
					onClose={() => setGroupSettings(false)}
					onUpdated={() => revalidator.revalidate()}
				/>
			) : null}

			<section className="flex min-h-0 min-w-0 flex-1 flex-col">
				{active ? (
					<header className="flex items-center gap-2 border-b px-4 py-2">
						<Icon
							name={
								active.kind === 'dm'
									? 'user'
									: active.kind === 'group'
										? 'users'
										: active.access === 'restricted'
											? 'lock'
											: 'message-square'
							}
							className="text-muted-foreground shrink-0"
						/>
						<h2 className="min-w-0 truncate text-sm font-semibold">
							{active.name}
						</h2>
						{active.description ? (
							<p className="text-muted-foreground min-w-0 truncate text-sm">
								{active.description}
							</p>
						) : null}
						{active.kind === 'group' ? (
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								className="ms-auto shrink-0"
								aria-label={_(msg`Group settings`)}
								onClick={() => setGroupSettings(true)}
							>
								<Icon name="settings" />
							</Button>
						) : null}
					</header>
				) : null}

				<ConnectionBanner status={state.connection} />

				<div
					ref={scroller}
					role="log"
					aria-live="polite"
					aria-label={_(msg`Messages`)}
					className="min-h-0 flex-1 overflow-y-auto py-2"
					onScroll={(event) => {
						const element = event.currentTarget
						stuckToBottom.current =
							element.scrollHeight - element.scrollTop - element.clientHeight <
							STICK_THRESHOLD_PX
					}}
				>
					{!active ? (
						<p className="text-muted-foreground p-6 text-sm">
							<Trans>Select a channel to start.</Trans>
						</p>
					) : historyError ? (
						<div className="flex flex-col items-start gap-2 p-6">
							<p className="text-destructive text-sm">{historyError}</p>
							<Button variant="outline" size="sm" onClick={fetchHistory}>
								<Trans>Try again</Trans>
							</Button>
						</div>
					) : !loaded ? (
						<div className="text-muted-foreground flex items-center gap-2 p-6 text-sm">
							<Spinner />
							<Trans>Loading messages…</Trans>
						</div>
					) : (
						<>
							{view?.hasMore ? (
								<div className="flex justify-center py-2">
									<Button
										variant="outline"
										size="sm"
										disabled={loadingOlder}
										onClick={() => void loadOlder()}
									>
										{loadingOlder ? <Spinner /> : null}
										<Trans>Load older messages</Trans>
									</Button>
								</div>
							) : null}
							{messages.length === 0 ? (
								<p className="text-muted-foreground p-6 text-sm">
									<Trans>No messages yet. Say hello!</Trans>
								</p>
							) : null}
							{messages.map((message, index) => {
								const previous = messages[index - 1]
								const showHeader =
									!previous ||
									previous.deleted ||
									previous.author !== message.author ||
									message.createdAt - previous.createdAt > GROUP_GAP_MS
								return (
									<MessageItem
										key={message.id}
										message={message}
										people={state.people}
										meId={state.me?.id ?? ''}
										canModerate={state.me?.canModerate ?? false}
										online={state.online}
										locale={i18n.locale}
										showHeader={showHeader}
										onReact={onReact}
										onReply={openThread}
										onEdit={onEdit}
										onDelete={setPendingDelete}
									/>
								)
							})}
						</>
					)}
				</div>

				{active ? (
					<div className="border-t p-3">
						<p className="text-muted-foreground h-4 text-xs" aria-live="polite">
							{typingNames.length === 0
								? null
								: typingNames.length === 1
									? _(msg`${firstTypingName} is typing…`)
									: _(msg`Several people are typing…`)}
						</p>
						<Composer
							placeholder={_(msg`Message #${activeName}`)}
							disabled={!connected}
							onTyping={() => chat.typing(active.id)}
							onSend={async (body) => {
								await chat.send(active.id, body)
							}}
						/>
					</div>
				) : null}
			</section>

			{thread ? (
				<aside
					aria-label={_(msg`Thread`)}
					className="flex min-h-0 shrink-0 flex-col border-t md:w-96 md:border-s md:border-t-0"
				>
					<header className="flex items-center justify-between border-b px-4 py-2">
						<h2 className="text-sm font-semibold">
							<Trans>Thread</Trans>
						</h2>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={_(msg`Close thread`)}
							onClick={() => setThread(null)}
						>
							<Icon name="x" />
						</Button>
					</header>
					<div className="min-h-0 flex-1 overflow-y-auto py-2">
						{threadParent ? (
							<MessageItem
								message={threadParent}
								people={state.people}
								meId={state.me?.id ?? ''}
								canModerate={state.me?.canModerate ?? false}
								online={state.online}
								locale={i18n.locale}
								showHeader
								inThread
								onReact={onReact}
								onEdit={onEdit}
								onDelete={setPendingDelete}
							/>
						) : null}
						<div className="text-muted-foreground px-4 py-2 text-xs">
							{_(
								plural(threadTotalReplies, {
									one: '# reply',
									other: '# replies',
								}),
							)}
						</div>
						{threadMore ? (
							<div className="flex justify-center pb-2">
								<Button
									variant="outline"
									size="sm"
									disabled={loadingEarlierReplies}
									onClick={() => void loadEarlierReplies()}
								>
									{loadingEarlierReplies ? <Spinner /> : null}
									<Trans>Load earlier replies</Trans>
								</Button>
							</div>
						) : null}
						{threadReplies.map((reply, index) => {
							const previous = threadReplies[index - 1]
							return (
								<MessageItem
									key={reply.id}
									message={reply}
									people={state.people}
									meId={state.me?.id ?? ''}
									canModerate={state.me?.canModerate ?? false}
									online={state.online}
									locale={i18n.locale}
									showHeader={
										!previous ||
										previous.author !== reply.author ||
										reply.createdAt - previous.createdAt > GROUP_GAP_MS
									}
									inThread
									onReact={onReact}
									onEdit={onEdit}
									onDelete={setPendingDelete}
								/>
							)
						})}
					</div>
					<div className="border-t p-3">
						<Composer
							placeholder={_(msg`Reply…`)}
							disabled={!connected || !threadParent || threadParent.deleted}
							onSend={async (body) => {
								await chat.send(thread.channel, body, thread.parent)
							}}
						/>
					</div>
				</aside>
			) : null}

			<DeleteMessageDialog
				message={pendingDelete}
				onClose={() => setPendingDelete(null)}
				onConfirm={(message) => {
					setPendingDelete(null)
					chat.remove(message.id).catch(fail)
				}}
			/>
		</div>
	)
}

function ConnectionBanner({
	status,
}: {
	status: 'connecting' | 'open' | 'reconnecting' | 'forbidden'
}) {
	if (status === 'open') return null
	return (
		<div
			role="status"
			className={cn(
				'border-b px-4 py-1.5 text-xs',
				status === 'forbidden'
					? 'bg-destructive/10 text-destructive'
					: 'bg-muted text-muted-foreground',
			)}
		>
			{status === 'forbidden' ? (
				<Trans>
					You no longer have access to this chat. Reload the page to check your
					channels.
				</Trans>
			) : status === 'reconnecting' ? (
				<Trans>Connection lost. Reconnecting…</Trans>
			) : (
				<Trans>Connecting…</Trans>
			)}
		</div>
	)
}

function DeleteMessageDialog({
	message,
	onClose,
	onConfirm,
}: {
	message: ChatMessage | null
	onClose(): void
	onConfirm(message: ChatMessage): void
}) {
	return (
		<AlertDialog
			open={message !== null}
			onOpenChange={(open) => {
				if (!open) onClose()
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						<Trans>Delete message?</Trans>
					</AlertDialogTitle>
					<AlertDialogDescription>
						<Trans>
							This removes the message for everyone in the channel. This can't
							be undone.
						</Trans>
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>
						<Trans>Cancel</Trans>
					</AlertDialogCancel>
					<AlertDialogAction
						variant="destructive"
						onClick={() => {
							if (message) onConfirm(message)
						}}
					>
						<Trans>Delete</Trans>
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
