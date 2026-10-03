# Team chat

Realtime chat for the **team members of a tenant** (operators in `apps/app`),
not for tenant customers. Admins create channels and decide which roles or
people can read and post in each.

Built on one Cloudflare **Durable Object per organization** (`ChatOrg`). No
third-party chat service.

## What members get

- Channels with realtime messages and history (paged, newest first)
- Threads (one level of replies), edit and delete, emoji reactions
- Unread counts, typing indicators, online presence
- **Direct messages** between any two active members (no extra permission)
- **Group chats** for members with `create:chat:group` (admins by default); any
  member can invite others; the creator can let new members read earlier history
  or only messages from after they joined

## Access model

### Team channels

Two channel types, set by an admin under **Settings → Chat channels**:

| Access       | Who gets in                                                              |
| ------------ | ------------------------------------------------------------------------ |
| `everyone`   | Every **active** member of the organization                              |
| `restricted` | Active members whose **role** is selected, or who are named **directly** |

Rules that are easy to get wrong:

- **Admins do not automatically read restricted channels.** `update:chat:any`
  lets someone create, edit and delete channels and remove messages in channels
  they can already open. It does not grant entry to a restricted channel.
- The channel creator is added as an explicit member of a restricted channel so
  they can't lock themselves out.
- Roles and members must belong to the organization; the server rejects ids from
  another tenant.
- A user who is removed from the organization or deactivated loses access to
  every channel.

The permission is `org_perm_update_chat_any` (`update:chat:any`), granted to the
built-in admin role and available to custom roles under **Roles → Team chat**.

### DMs and groups

| Kind    | Who can open it | Admin visibility        |
| ------- | --------------- | ----------------------- |
| `dm`    | The two members | No — private to them    |
| `group` | Listed members  | No — private to members |

Group creation uses `org_perm_create_chat_group` (`create:chat:group`). DMs are
created from **New message** on the chat page (`findOrCreateDirectMessage` in
`conversations.server.ts`).

## Architecture

```
Browser ──WebSocket──▶ App Worker (/:orgSlug/chat/ws)
                         │ authenticate, Origin check, org membership,
                         │ moderator flag → trusted x-chat-* headers
                         ▼
                      ChatOrg Durable Object (one per org)
                         ├─ SQLite: messages, reactions, read markers, people
                         └─ asks D1 who may see which channel (cached ~30s)
```

- **D1 is the authority for access.** Channels, roles and members live in the
  control plane (`OrganizationChatChannel*` tables). The room never decides
  access itself: `resolveChannelAudiences()` in
  `apps/app/app/utils/chat/audience.server.ts` is the single implementation, and
  the member-facing channel list (`listChannelsForUser`) is tested to agree with
  it.
- **Messages live only in the Durable Object.** D1 is not written per message,
  so chat volume doesn't load the control plane.
- **One WebSocket per tab** carries every channel. The hibernation API means an
  idle room costs nothing.
- Message bodies are stored as **Markdown** (same direction as notes). Rendering
  must sanitize output (no raw HTML injection).

### Revoking access

| Change                                                                     | Takes effect                                           |
| -------------------------------------------------------------------------- | ------------------------------------------------------ |
| Member removed (Settings → Members)                                        | Immediately: sockets closed with code `4403`           |
| Member's role changed                                                      | Immediately: room re-reads access and moderator rights |
| Channel created, edited or deleted                                         | Immediately: room caches cleared, open tabs refresh    |
| Anything else (SSO deprovision, admin app, custom role permissions edited) | Within ~30 seconds, when the room's cache expires      |

The in-app hooks are best-effort nudges (`notifyChat`); the 30 second re-check
is the guarantee. A failed nudge never fails the admin's action.

Moderation (`canModerate`) is also re-checked against D1 with the same cache, so
a demoted moderator cannot delete others' messages on a long-lived socket.

### Limits

| Limit                          | Value                |
| ------------------------------ | -------------------- |
| Message length                 | 4,000 chars          |
| Channels per organization      | 200                  |
| Roles + members on a channel   | 500                  |
| History page                   | 50 (max 100)         |
| Distinct reactions per message | 20                   |
| Frame size                     | 16 KB                |
| Tabs per user                  | 8                    |
| Mutations                      | 30 per 10 s per user |

## Code map

| Piece                    | Path                                                     |
| ------------------------ | -------------------------------------------------------- |
| Wire protocol + schemas  | `packages/common/src/chat.ts` (`@repo/common/chat`)      |
| Durable Object           | `apps/app/workers/chat-org.ts`                           |
| Rules (auth, rate limit) | `apps/app/app/modules/chat/chat-engine.ts`               |
| Message storage          | `apps/app/app/modules/chat/chat-store.ts`                |
| Client state reducer     | `apps/app/app/modules/chat/chat-state.ts`                |
| Socket hook              | `apps/app/app/hooks/use-chat.ts`                         |
| WebSocket upgrade        | `apps/app/app/utils/chat/upgrade.server.ts`              |
| Channel CRUD + audiences | `apps/app/app/utils/chat/*.server.ts`                    |
| Pages                    | `routes/_app+/$orgSlug_+/chat.tsx`, `settings+/chat.tsx` |

The engine and store depend only on small interfaces, so the rules are unit
tested under Node with `node:sqlite` and fake connections.

## Local development

The plain Node dev server (`npm run dev:app`) has no Durable Objects, so
`/:orgSlug/chat` shows an "unavailable" message there. To use chat locally run
the Cloudflare runtime:

```bash
# once: apply control-plane migrations (incl. the chat tables) to local D1
cd apps/app && npx wrangler d1 migrations apply DB --local && cd ../..

npm run dev:cf -w app
```

The Worker reads its secrets from gitignored `apps/app/.dev.vars` (or `.env`).
Every `@required` variable in `apps/app/.env.schema` must be present or requests
fail with `... environment variable is not set`.

`dev:cf` runs the repo-root Vite on purpose: `apps/app` pins its own Vite 6, but
`@cloudflare/vite-plugin` is installed against the root Vite 8, and mixing the
two crashes the dev server at startup with `require_react is not a function`.

## Deployment

`apps/app/wrangler.jsonc` declares the `CHAT_ORG` binding and a SQLite migration
(`new_sqlite_classes: ["ChatOrg"]`) for production and `env.staging`. Deploying
the Worker applies it; there is nothing else to provision. The control plane
migration `0015_team_chat_channels` adds the channel tables and the permission.

## Not included (yet)

- Rich composer (mentions, emoji, image upload) wired like notes
- File attachments (R2), full-text search in the Durable Object
- A global unread badge in the app sidebar (unread shows inside the chat page)

**Retention:** per-organization setting under **Settings → Chat** (30 / 90 / 365
days or forever). The `ChatOrg` alarm prunes old rows in the DO SQLite store.
