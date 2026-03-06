# Agent Chat Feature — Design Document

**Date:** 2026-03-01
**Status:** Approved
**Author:** Claude Code (with security review by self + Codex)

---

## Overview

Add real-time chat between users and their OpenClaw agents via an Intercom-style floating chat bubble. Users can create, resume, and switch between chat sessions. Agents can proactively message users and attract their attention via escalating notification channels.

### Key Design Decisions

1. **Extend existing infrastructure** — `agent_chat` is a new channel type on the existing `external_thread`/`external_message` tables, maximizing code reuse
2. **Webhook + streaming** — User messages trigger webhooks to OpenClaw gateway; agent streams response tokens back via HTTP callback → WebSocket relay
3. **Dedicated streaming WebSocket** — Streaming tokens use a separate WebSocket (like terminal), not the global RealtimeProvider
4. **All-channel notifications** — Agent has urgency-based escalation: in-app → push → SMS → email
5. **Full rich content** — Markdown, code blocks, interactive cards with action buttons

---

## 1. Happy Path Flow

### Opening a chat
1. User clicks floating chat bubble (bottom-right, visible on all authenticated pages)
2. Bubble expands to chat panel with session list + active conversation
3. If no sessions exist, shows "Start a conversation" prompt
4. User types message and hits Enter/Send

### Message flow
1. Frontend sends message via REST `POST /api/chat/sessions/:id/messages` with `idempotency_key`
2. Message stored as `external_message` (direction: `outbound`, status: `delivered`)
3. Server dispatches webhook to OpenClaw gateway with `session_key` and `stream_secret`
4. Gateway invokes agent; agent streams response tokens back via `POST /api/chat/sessions/:id/stream`
5. Server validates `stream_secret` + `agent_id`, broadcasts `stream:chunk` events via chat WebSocket
6. On completion, final message stored as `external_message` (direction: `inbound`, status: `delivered`)
7. All connected devices receive the complete message in real-time

### Session management
- Multiple concurrent sessions supported
- Sessions persist across page navigations
- Sessions can be ended by user or agent
- Inactive sessions auto-expire after 30 minutes (configurable)

### Multi-device sync
- All messages broadcast to all WebSocket connections for the user
- Read cursor synced via `chat:read_cursor_updated` events (forward-only)
- Typing indicators and session lifecycle events synced across devices
- Messages persisted in DB (source of truth); WebSocket is delivery optimization

### Default agent
- Settings page has "Default Agent" dropdown
- Can override per-session via dropdown in chat panel header

---

## 2. User Experience Impacts

### Global UI
1. **Floating chat bubble** — bottom-right on every authenticated page; unread badge; position-aware (above mobile nav)
2. **Chat panel overlay** — ~400px wide, ~600px tall; resizable/minimizable; persists during navigation
3. **Toast notifications** — agent messages trigger toasts when panel closed (via Sonner)
4. **Browser push notifications** — when app backgrounded (requires user opt-in)
5. **Connection status** — banner inside panel shows reconnecting/offline/degraded

### Navigation & Routing
6. **Deep links** — `?chat=<session_id>` query parameter opens chat to specific session
7. **Keyboard shortcut** — registered in KeyboardShortcutsHandler (e.g., `g m` for "go to messages")
8. **Settings integration** — new "Chat" section for default agent, notification prefs, quiet hours

### Notification System
9. **New notification type** — `agent_message` with separate preference controls
10. **Escalation chain** — low=in-app, normal=in-app+push, high=+SMS, urgent=+email
11. **Deduplication** — `reason_key` based, 15-minute cooldown window
12. **Rate limits** — 3/hour, 10/day per user for `chat_attract_attention`

### Accessibility
13. **Keyboard navigation** — Escape to close, focus trap when open, arrow keys in session list
14. **Screen reader** — `aria-live="polite"` for completed messages (not streaming tokens)
15. **Reduced motion** — respect `prefers-reduced-motion` for typing/streaming animations

### Mobile/Responsive
16. **Mobile view** — full-screen via Sheet component; positioned above mobile nav bar
17. **Safe area** — handle virtual keyboard overlap, keep input docked above keyboard
18. **Touch targets** — minimum 44px

### Error States
19. **Send failure** — per-message retry button with failed status indicator
20. **Stream interruption** — "Response was interrupted" with "Regenerate" button
21. **Agent timeout** — "Agent is taking longer than expected" after 60s, with Cancel option
22. **Session ended by agent** — disabled input, "Start new session" button
23. **No agents available** — link to Settings to configure
24. **Offline queue** — messages queued while offline, sent on reconnect

---

## 3. UI Components

### New Components (19)

| Component | File | Description |
|-----------|------|-------------|
| `ChatProvider` | `contexts/chat-context.tsx` | Context: active session, panel state, drafts, WS lifecycle |
| `ChatBubble` | `components/chat/chat-bubble.tsx` | Floating FAB with unread badge, position-aware |
| `ChatPanel` | `components/chat/chat-panel.tsx` | Main container, error boundary wrapped, Sheet on mobile |
| `ChatSessionList` | `components/chat/chat-session-list.tsx` | Virtualized session list with skeletons |
| `ChatConversation` | `components/chat/chat-conversation.tsx` | Virtualized message list, auto-scroll, date separators |
| `ChatMessageBubble` | `components/chat/chat-message-bubble.tsx` | Message with `streaming` mode, sanitized markdown, status |
| `ChatInput` | `components/chat/chat-input.tsx` | Textarea, Cmd+Enter, draft persistence |
| `ChatHeader` | `components/chat/chat-header.tsx` | Agent info, minimize/close/new, agent selector, connection |
| `ChatTypingIndicator` | `components/chat/chat-typing-indicator.tsx` | Animated dots (reduced-motion aware) |
| `ChatRichCard` | `components/chat/chat-rich-card.tsx` | Interactive card with signed action payloads |
| `ChatActionButton` | `components/chat/chat-action-button.tsx` | Action in rich card (triggers agent tool call) |
| `ChatNotificationToast` | `components/chat/chat-notification-toast.tsx` | Toast via Sonner |
| `ChatEmptyState` | `components/chat/chat-empty-state.tsx` | No sessions / no agents states |
| `ChatAgentSelector` | `components/chat/chat-agent-selector.tsx` | Agent picker for new sessions |
| `ChatConnectionBanner` | `components/chat/chat-connection-banner.tsx` | Reconnecting/offline/degraded banner |
| `ChatMessageStatus` | `components/chat/chat-message-status.tsx` | Per-message delivery status with retry |
| `ChatSkeletonLoader` | `components/chat/chat-skeleton-loader.tsx` | Chat-specific skeletons |
| `ChatNewMessagesPill` | `components/chat/chat-new-messages-pill.tsx` | "X new messages" when scrolled up |
| `ChatSessionEndedState` | `components/chat/chat-session-ended-state.tsx` | Session ended UI |

### Modified Components (5)

| Component | Change |
|-----------|--------|
| `AppLayout` | Add `ChatProvider` + `ChatBubble` |
| `SettingsPage` | Add "Chat" section |
| `NotificationBell` | Exclude `agent_message` type |
| `realtime-context.tsx` | Add discrete chat events |
| `KeyboardShortcutsHandler` | Register chat shortcut |

### New Hooks (15)

| Hook | Purpose |
|------|---------|
| `useChatSessions` | Query — list sessions (chatKeys factory + Zod schema) |
| `useChatMessages` | Query — cursor-paginated messages |
| `useSendChatMessage` | Mutation — send with idempotency + optimistic insert |
| `useCreateChatSession` | Mutation — start session with agent |
| `useEndChatSession` | Mutation — end session |
| `useChatWebSocket` | Dedicated WS for streaming (like useTerminalWebSocket) |
| `useChatStream` | Subscribe to stream lifecycle events |
| `useChatTyping` | Send/receive typing indicators |
| `useChatReadCursor` | Track and sync read position (forward-only) |
| `useChatUnreadCount` | Unread count across all sessions |
| `useChatScrollPosition` | Auto-scroll with "new messages" detection |
| `useChatDraft` | Draft persistence per session (sessionStorage) |
| `useAvailableAgents` | Query — agents user has access to |
| `useDefaultAgent` | Query + mutation — get/set default agent |
| `useChatNotificationPermission` | Browser Notification API permission |

### Infrastructure Additions
- Zod schemas in `api-schemas.ts` for all chat responses
- TypeScript types in `api-types.ts` for chat entities
- OpenAPI spec updates in `src/api/openapi/chat.ts`
- shadcn additions: `avatar`, `sonner`

---

## 4. Backend API & Schema

### Database Schema

**New enum values:**
```sql
ALTER TYPE contact_endpoint_type ADD VALUE 'agent_chat';
CREATE TYPE chat_session_status AS ENUM ('active', 'ended', 'expired');
CREATE TYPE chat_message_status AS ENUM ('pending', 'streaming', 'delivered', 'failed');
```

**New table: `chat_session`**
```sql
CREATE TABLE chat_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL UNIQUE REFERENCES external_thread(id),
  user_email text NOT NULL REFERENCES user_setting(email) ON DELETE CASCADE,
  agent_id text NOT NULL,
  namespace text NOT NULL DEFAULT 'default',
  status chat_session_status NOT NULL DEFAULT 'active',
  title text CHECK (title IS NULL OR (length(trim(title)) > 0 AND length(title) <= 200)),
  stream_secret text NOT NULL,  -- 32-byte hex, for agent streaming auth
  version integer NOT NULL DEFAULT 1,  -- optimistic locking
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}' CHECK (pg_column_size(metadata) <= 16384),
  CONSTRAINT chat_session_status_transition CHECK (
    status != 'active' OR ended_at IS NULL
  )
);
CREATE INDEX idx_chat_session_user ON chat_session(user_email, namespace);
CREATE INDEX idx_chat_session_active ON chat_session(user_email) WHERE status = 'active';
CREATE INDEX idx_chat_session_agent ON chat_session(agent_id);
CREATE INDEX idx_chat_session_activity ON chat_session(last_activity_at);
```

**Extended `external_message`:**
```sql
ALTER TABLE external_message ADD COLUMN updated_at timestamptz;
ALTER TABLE external_message ADD COLUMN status chat_message_status DEFAULT 'delivered';
ALTER TABLE external_message ADD COLUMN idempotency_key text;
ALTER TABLE external_message ADD COLUMN agent_run_id text;
ALTER TABLE external_message ADD COLUMN content_type text DEFAULT 'text/plain'
  CHECK (content_type IN ('text/plain', 'text/markdown', 'application/vnd.openclaw.rich-card'));
CREATE UNIQUE INDEX idx_external_message_idempotency
  ON external_message(thread_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
```

**New table: `chat_read_cursor`**
```sql
CREATE TABLE chat_read_cursor (
  user_email text NOT NULL,
  session_id uuid NOT NULL REFERENCES chat_session(id) ON DELETE CASCADE,
  last_read_message_id uuid REFERENCES external_message(id) ON DELETE SET NULL,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_email, session_id)
);
```

**Extended `user_setting`:**
```sql
ALTER TABLE user_setting ADD COLUMN default_agent_id text;
ALTER TABLE user_setting ADD COLUMN chat_notification_prefs jsonb NOT NULL DEFAULT '{}'
  CHECK (pg_column_size(chat_notification_prefs) <= 4096);
```

### API Endpoints

**Chat Sessions:**
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/chat/sessions` | User JWT | Create session (`{ agent_id?, title? }`) |
| `GET` | `/api/chat/sessions` | User JWT | List sessions (`?status=active&limit=20`) |
| `GET` | `/api/chat/sessions/:id` | User JWT | Get session details |
| `PATCH` | `/api/chat/sessions/:id` | User JWT | Update title |
| `POST` | `/api/chat/sessions/:id/end` | User JWT | End session |

**Chat Messages:**
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/chat/sessions/:id/messages` | User JWT | Send message (`{ content, idempotency_key }`) |
| `GET` | `/api/chat/sessions/:id/messages` | User JWT | Cursor-paginated messages |

**Chat Streaming (agent callback):**
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/chat/sessions/:id/stream` | M2M + X-Stream-Secret | Agent streams response tokens |

**Chat Read Cursors:**
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/chat/sessions/:id/read` | User JWT | Update read cursor (forward-only) |

**Chat Agents & Preferences:**
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/chat/agents` | User JWT | List available agents |
| `GET` | `/api/chat/preferences` | User JWT | Get chat preferences |
| `PATCH` | `/api/chat/preferences` | User JWT | Update chat preferences |

**Chat WebSocket:**
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/chat/ws/ticket` | User JWT | Get one-time WS ticket (30s TTL) |
| `GET` | `/api/chat/ws` | Ticket | Streaming WebSocket |

### WebSocket Protocol

**Client → Server (chat WS):**
```
{ "type": "typing", "is_typing": true }
{ "type": "read_cursor", "last_read_message_id": "uuid" }
{ "type": "ping" }
```

**Server → Client (chat WS — streaming):**
```
{ "type": "stream:started", "message_id": "uuid", "agent_run_id": "..." }
{ "type": "stream:chunk", "message_id": "uuid", "chunk": "text", "seq": 42 }
{ "type": "stream:completed", "message_id": "uuid", "full_content": "..." }
{ "type": "stream:aborted", "message_id": "uuid", "reason": "timeout" }
{ "type": "stream:failed", "message_id": "uuid", "error": "..." }
{ "type": "pong" }
```

**Server → Client (global RealtimeHub — discrete events):**
```
{ "event": "chat:message_received", "data": { "session_id", "message_id" } }
{ "event": "chat:session_created", "data": { "session_id" } }
{ "event": "chat:session_ended", "data": { "session_id" } }
{ "event": "chat:typing", "data": { "session_id", "agent_id", "is_typing" } }
{ "event": "chat:read_cursor_updated", "data": { "session_id", "last_read_message_id" } }
```

Note: NOTIFY payloads include only IDs (no message body) to respect 8KB limit.

### OpenClaw Integration

**New webhook type:** `chat_message_received`
```json
{
  "kind": "chat_message_received",
  "session_key": "agent:<agent_id>:agent_chat:<thread_id>",
  "payload": {
    "session_id": "uuid",
    "message_id": "uuid",
    "content": "User's message",
    "user_email": "user@example.com",
    "streaming_callback_url": "/api/chat/sessions/<id>/stream",
    "stream_secret": "<32-byte-hex>"
  }
}
```

**New plugin tools:**
- `chat_send_message` — agent sends message to user in active session
- `chat_attract_attention` — agent sends notification with urgency escalation and `reason_key` for dedup

---

## 5. Security Controls

### Authentication & Authorization
- One-time WS tickets (30s TTL) instead of JWT in query params
- Session-agent binding via `stream_secret` on streaming endpoint
- `user_email + namespace` enforced on ALL queries (defence-in-depth)
- M2M token + `agent_id` validation on streaming endpoint
- Session state machine enforced at DB level (no re-opening ended sessions)
- Optimistic locking via `version` column on session updates

### Rate Limiting
| Resource | Limit | Scope |
|----------|-------|-------|
| Messages | 10/min | Per user (across all sessions) |
| Session creation | 5/min | Per user |
| WS connections | 5 concurrent | Per user |
| Stream chunks | 100/sec, 256KB total | Per session per stream |
| Typing indicators | 2/sec | Per connection |
| `chat_attract_attention` | 3/hour, 10/day | Per user |
| SMS/email escalation | 5/hour | Per user |

### Input Validation
- Message body: max 64KB
- Session title: max 200 chars, no control chars
- metadata: max 16KB, schema-validated
- content_type: strict CHECK enum
- idempotency_key: UUID format, 24h TTL cleanup
- agent_run_id: server-generated, validated on stream endpoint
- All UUID path params: `isValidUUID()` validated

### Content Security
- Markdown sanitized via existing `sanitize.ts`
- Rich card actions require signed payloads + server-side auth
- No raw HTML in markdown
- XSS prevention via React JSX auto-escaping

### Data Privacy
- Configurable retention (default 90 days) per namespace
- Soft-delete with grace period before hard purge
- GDPR deletion cascade: cursors → messages → sessions
- Audit logging: session/message lifecycle events (never log content)
- pg_cron job for session expiration (30 min inactivity)

---

## 6. Issue Breakdown

See GitHub epic for the full issue list with dependency links and labels.

### Phase 1: Foundation (no dependencies)
1. Database schema migration
2. Chat session CRUD API
3. Chat message API (send + retrieve)

### Phase 2: Real-Time (depends on Phase 1)
4. Chat WebSocket with one-time tickets
5. Streaming callback endpoint
6. RealtimeHub chat events

### Phase 3: Frontend Core (depends on Phase 2)
7. ChatProvider context + ChatBubble
8. ChatPanel + ChatSessionList
9. ChatConversation + ChatMessageBubble
10. ChatInput with draft persistence

### Phase 4: Streaming & Rich Content (depends on Phase 3)
11. Streaming message rendering
12. Rich cards + action buttons
13. ChatTypingIndicator + ChatConnectionBanner

### Phase 5: Notifications & Attention (depends on Phase 2)
14. Agent notification tools (chat_send_message, chat_attract_attention)
15. Notification escalation system
16. Browser push notifications

### Phase 6: Settings & Multi-Device (depends on Phase 3)
17. Default agent settings
18. Chat notification preferences
19. Multi-device sync (read cursors, session state)

### Phase 7: Polish & Security Hardening (depends on all)
20. Rate limiting implementation
21. Session expiration (pg_cron)
22. Audit logging
23. OpenAPI spec
24. Data retention jobs
