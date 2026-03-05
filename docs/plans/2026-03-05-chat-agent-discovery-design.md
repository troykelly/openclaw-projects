# Chat Agent Discovery & Session UX Fix

**Issue:** #2151
**Epic:** #1940 (Agent Chat)
**Date:** 2026-03-05
**Status:** Approved

## Problem

The chat feature is fully implemented but invisible to users. Three interrelated bugs:

1. **`GET /chat/agents` chicken-and-egg** — derives agents solely from existing `chat_session` rows. On fresh installs, returns empty → `ChatBubble` hides itself → no way to start a chat.
2. **`createSession.mutate({})` sends no `agent_id`** — three frontend call sites pass empty body, but `POST /chat/sessions` requires `agent_id` → HTTP 400.
3. **No "End Session" UI** — `ChatHeader` has back/minimize/close-panel buttons but no way to end an active chat session.

## Design

### Layer 1: Plugin pushes agent list to backend on startup

The OpenClaw plugin (`packages/openclaw-plugin/src/register-openclaw.ts`) already receives `api.config` containing the full gateway config including `agents.list`. On registration:

1. Read `api.config.agents?.list` (array of `{ id, name?, workspace?, identity? }`)
2. POST to new backend endpoint `POST /agents/sync` with `{ agents: [...], default_id }`
3. Backend stores in `gateway_agent_cache` table (namespace-scoped, with TTL)

**Schema:**
```sql
CREATE TABLE IF NOT EXISTS gateway_agent_cache (
  namespace text NOT NULL,
  agent_id text NOT NULL,
  display_name text,
  avatar_url text,
  is_default boolean NOT NULL DEFAULT false,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (namespace, agent_id)
);
```

### Layer 2: Fix `GET /chat/agents`

Replace session-only query with:
1. Read from `gateway_agent_cache` (primary source — what the gateway knows about)
2. UNION with agents from existing `chat_session` rows (covers edge cases)
3. Deduplicate by `agent_id`

Always returns agents if gateway has synced. Falls back to session-based discovery if sync hasn't happened.

### Layer 3: Fix frontend session creation

All three `createSession.mutate({})` call sites (`chat-header.tsx`, `chat-session-list.tsx`, `chat-session-ended-state.tsx`):
1. Resolve agent ID: `user_setting.default_agent_id` → first available agent from `useAvailableAgents()`
2. Pass `{ agent_id: resolvedAgentId }` to mutation

### Layer 4: Server-side `agent_id` fallback

In `POST /chat/sessions`, when `agent_id` is missing:
1. Look up `user_setting.default_agent_id` for the user
2. If unset, query `gateway_agent_cache` for the default agent (or first agent) in the namespace
3. If still nothing, return 400 (graceful — means gateway hasn't synced and no default configured)

### Layer 5: "End Session" button in ChatHeader

Add an "End conversation" button to `ChatHeader` when session is active:
- Calls `POST /chat/sessions/:id/end` (already implemented)
- Shows confirmation dialog
- On success, transitions to `ChatSessionEndedState`

### Layer 6: ChatBubble visibility

Remove the `agents.length === 0 → return null` gate. Instead:
- Always show bubble when user is authenticated and gateway is configured
- If no agents available, show an empty state in the panel ("No agents configured — check your OpenClaw gateway settings")

## Files to Create/Modify

**New files:**
- `migrations/130_gateway_agent_cache.up.sql` — cache table
- `migrations/130_gateway_agent_cache.down.sql` — rollback
- `src/api/agents/routes.ts` — `POST /agents/sync`, updated `GET /chat/agents` logic
- `tests/unit/agents-sync.test.ts` — unit tests for sync endpoint
- `tests/integration/agents-sync.test.ts` — integration tests with DB

**Modified files (backend):**
- `src/api/chat/routes.ts` — update `GET /chat/agents` to use cache, add `agent_id` fallback in `POST /chat/sessions`
- `src/api/server.ts` — register agents routes
- `packages/openclaw-plugin/src/register-openclaw.ts` — push agent list on startup

**Modified files (frontend):**
- `src/ui/components/chat/chat-bubble.tsx` — remove `agents.length === 0` gate
- `src/ui/components/chat/chat-header.tsx` — add "End session" button
- `src/ui/components/chat/chat-session-list.tsx` — pass `agent_id` to `createSession`
- `src/ui/components/chat/chat-session-ended-state.tsx` — pass `agent_id` to `createSession`
- `src/ui/hooks/mutations/use-chat.ts` — ensure `CreateChatSessionBody` includes `agent_id`

**OpenAPI spec:**
- `src/api/openapi/paths/chat.ts` — update `GET /chat/agents` response schema
- New spec file for `POST /agents/sync`

## Non-goals

- Real-time agent list updates (heartbeat/polling) — sync on plugin startup is sufficient for now
- Agent health/status checking — out of scope
- Multi-gateway support — single gateway per deployment
