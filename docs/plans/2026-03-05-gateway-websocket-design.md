# Gateway WebSocket Connection — Design Document

**Date:** 2026-03-05
**Status:** Approved for implementation
**Author:** Claude Code

---

## Overview

Add a permanent WebSocket connection from the openclaw-projects API server to the
OpenClaw gateway. This replaces the current one-way HTTP webhook dispatch for chat
with a bidirectional WS channel, enabling:

1. **Lower latency chat dispatch** — `chat.send` via WS, no HTTP webhook round-trip
2. **Agent response streaming via WS** — gateway pushes `ChatEvent` frames directly
   (delta/final/aborted/error); HTTP streaming callback endpoint retained as fallback
3. **Live agent discovery** — `agents.list` via WS replaces DB-history-based lookup
4. **Agent presence** — track online/busy/offline from gateway events
5. **Connection transparency** — health endpoint + chat UI status banner

---

## Current Architecture

```
User Browser <-> Chat WS (local) <-> API Server
                                       |
                                   enqueueWebhook (HTTP POST)
                                       |
                                   OpenClaw Gateway
                                       |
                                   Agent processes...
                                       |
                              POST /api/chat/sessions/:id/stream
                              (HTTP callback from agent)
                                       |
                                   API Server -> RealtimeHub -> Browser
```

## Proposed Architecture

```
User Browser <-> Chat WS (local) <-> API Server <-> Gateway WS (permanent)
                                       |              |
                                       |          chat.send (outbound)
                                       |          ChatEvent (inbound)
                                       |          agents.list (query)
                                       |
                                   POST /stream (HTTP fallback, retained)
```

---

## Gateway Protocol (from OpenClaw source)

### Connection

The `GatewayClient` (`.local/openclaw-gateway/src/gateway/client.ts`) handles:
- WebSocket connection to `OPENCLAW_GATEWAY_URL` (http→ws, https→wss)
- `connect.challenge` → `connect` request with auth token
- Automatic reconnect with exponential backoff (1s → 30s)
- Tick heartbeat monitoring (close if no tick for 2× interval)

### Chat Methods

**`chat.send`** — dispatch user message to agent:
```ts
{
  sessionKey: string;     // "agent:{agentId}:agent_chat:{threadId}"
  message: string;        // user's text content
  idempotencyKey: string; // prevents duplicate processing (use message UUID)
  deliver?: boolean;
  timeoutMs?: number;
}
```

**`ChatEvent`** — streaming response from agent (received as WS events):
```ts
{
  runId: string;
  sessionKey: string;
  seq: number;           // monotonically increasing
  state: "delta" | "final" | "aborted" | "error";
  message?: unknown;     // content chunks for delta/final
  errorMessage?: string;
  stopReason?: string;
}
```

**`chat.abort`** — cancel in-flight agent run.

**`chat.history`** — retrieve session history from gateway.

### Agent Methods

**`agents.list`** — list configured agents with status.

---

## 1. User Happy Path

1. User opens app — chat bubble appears immediately (agents from live gateway query,
   not from DB history — fixes the chicken-and-egg issue on fresh installs)
2. User opens chat panel — agent selector shows each agent's status badge
   (green=online, yellow=busy, gray=offline/unknown)
3. User selects agent, types message, hits Send
4. Message dispatched via WS `chat.send` (not HTTP webhook) — lower latency
5. Typing indicator appears as agent begins processing (WS `delta` events)
6. Agent response streams incrementally in chat bubble
7. On `final` event: message persisted to `external_message`, UI completes stream
8. On WS disconnect: banner shows "Reconnecting...", HTTP fallback activates
9. On WS reconnect: banner clears, real-time resumes automatically

---

## 2. User Experience Analysis

| Aspect | Before | After |
|--------|--------|-------|
| Message dispatch | HTTP webhook (async, ~100–500ms overhead) | WS `chat.send` (immediate) |
| Agent response | HTTP callback from agent | WS events pushed to server |
| Agent list on fresh install | Empty (chicken-and-egg) | Live from gateway |
| Agent availability | Unknown | Online/busy/offline badge |
| Connection status | Browser WS only | Gateway WS status visible |
| Typing indicator | Agent calls HTTP | Gateway WS event |
| Proactive messages | Not supported yet | Foundation laid (future) |

---

## 3. User Interface Requirements

### Existing Components Modified

| Component | Change |
|-----------|--------|
| `ChatConnectionBanner` | Receives `gatewayStatus` prop; shows gateway connection state |
| `ChatAgentSelector` | Renders `AgentStatusBadge` per agent from `status` field |
| `ChatPanel` | Renders `ChatConnectionBanner` with gateway status |
| `ChatBubble` | Shows when live agents exist (not only from DB history) |

### New Components

| Component | Purpose |
|-----------|---------|
| `AgentStatusBadge` | Colored dot: green=online, yellow=busy, gray=offline/unknown |
| `useGatewayStatus` | Hook; polls `GET /api/gateway/status`; returns connection state |

---

## 4. TDD Plan — Frontend

### Unit Tests

- `use-gateway-status.test.ts`
  - Returns `{ connected: false, loading: true }` on initial render
  - Returns `{ connected: true }` on successful API response
  - Handles fetch errors gracefully (returns `{ connected: false }`)
  - Polls at configured interval

- `agent-status-badge.test.tsx`
  - Renders green dot for "online"
  - Renders yellow dot for "busy"
  - Renders gray dot for "offline" / "unknown"
  - Has accessible label (`aria-label`)

- `chat-agent-selector.test.tsx` (update existing)
  - Shows status badge when agent has status
  - Falls back gracefully when status is undefined

- `chat-connection-banner.test.tsx` (update existing)
  - Renders gateway status when gateway is disconnected
  - Hides when both browser WS and gateway WS are connected

---

## 5. Database Schema Changes

### Migration 134: gateway_connection (HA coordination)

```sql
-- Track which API instance holds the gateway WS connection.
-- Used for multi-instance deployments to coordinate the single connector.
CREATE TABLE gateway_connection (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id   TEXT        NOT NULL UNIQUE,
  gateway_url   TEXT        NOT NULL,
  status        TEXT        NOT NULL
                CHECK (status IN ('connecting', 'connected', 'disconnected')),
  connected_at  TIMESTAMPTZ,
  last_tick_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX gateway_connection_updated_at_idx ON gateway_connection (updated_at);

-- pg_cron: remove stale entries from dead instances every minute
SELECT cron.schedule(
  'gateway_connection_cleanup',
  '* * * * *',
  $$DELETE FROM gateway_connection WHERE updated_at < NOW() - INTERVAL '5 minutes'$$
);
```

---

## 6. Database Seeding Requirements

N/A — `gateway_connection` rows are ephemeral. Each API instance upserts its own
row on startup and deletes it on graceful shutdown.

---

## 7. API Requirements

### New Endpoints

#### `GET /api/gateway/status`
Returns gateway WebSocket connection state.

**Response (200):**
```json
{
  "connected": true,
  "gateway_url": "wss://gateway.example.com",
  "connected_at": "2026-03-05T10:00:00Z",
  "last_tick_at": "2026-03-05T10:00:30Z"
}
```

**Response when disconnected:**
```json
{
  "connected": false,
  "gateway_url": "wss://gateway.example.com",
  "connected_at": null,
  "last_tick_at": null
}
```

### Modified Endpoints

#### `GET /api/chat/agents`
- Prefers live `agents.list` from gateway when WS connected
- Falls back to DB query when WS unavailable
- Now includes `status: "online" | "busy" | "offline" | "unknown"` per agent

**Response (200):**
```json
{
  "agents": [
    {
      "id": "my-agent",
      "name": "My Agent",
      "status": "online"
    }
  ]
}
```

#### `POST /api/chat/sessions/:id/messages`
- When WS connected: dispatches via `chat.send` (primary path)
- When WS unavailable: falls back to `enqueueWebhook` (existing path)
- Idempotency key derived from message UUID

#### `GET /api/health`
- Adds `gateway_ws: { connected: boolean }` to response body

### Unchanged Endpoints (retained for fallback)

- `POST /api/chat/sessions/:id/stream` — HTTP streaming callback for agents that
  call back directly (keep working; gateway WS is the preferred path, not a forced replacement)
- All other chat endpoints

### Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `OPENCLAW_GATEWAY_URL` | Gateway base URL (existing) | — |
| `OPENCLAW_GATEWAY_TOKEN` | Token for WS auth (new alias) | falls back to `OPENCLAW_HOOK_TOKEN` |
| `OPENCLAW_GATEWAY_WS_ENABLED` | Opt-in WS connection | `true` if `OPENCLAW_GATEWAY_URL` set |

The WS URL is derived automatically: `http://` → `ws://`, `https://` → `wss://`.

---

## 8. TDD Plan — Backend

### Unit Tests

**`src/api/gateway/connection.test.ts`**
- Connects on `initialize()`, disconnects on `shutdown()`
- Exponential backoff on reconnect (1s → 30s cap)
- `getStatus()` returns correct state transitions
- Event handler registration and dispatch
- Tick timeout triggers reconnect

**`src/api/gateway/chat-dispatch.test.ts`**
- Uses WS `chat.send` when connection is active
- Falls back to `enqueueWebhook` when WS unavailable
- Idempotency key is stable (deterministic from message ID)
- Non-retryable errors propagate correctly

**`src/api/gateway/event-router.test.ts`**
- `delta` event → `stream:chunk` to RealtimeHub
- `final` event → persists message, emits `chat:message_received`
- `aborted` event → marks stream aborted, notifies user
- `error` event → marks stream failed, notifies user
- Unknown `sessionKey` → logged and discarded (no crash)
- Sequence gap detection (logs warning)

**`src/api/gateway/agent-cache.test.ts`**
- Returns cached results within TTL window
- Refreshes after TTL expires
- Falls back to DB query when WS unavailable
- Cache cleared on WS disconnect

### Integration Tests

**`src/api/gateway/connection.integration.test.ts`**
- Runs a mock WS server using `ws` npm package
- Tests full connect/authenticate/event flow
- Tests reconnect after server drops connection
- Tests clean shutdown

**`src/api/chat/ws-dispatch.integration.test.ts`**
- Full round-trip: send message → WS dispatch → mock event → stored → notified
- Fallback path: disable WS → HTTP webhook used instead

---

## 9. Documentation Changes

- This design document (`docs/plans/2026-03-05-gateway-websocket-design.md`)
- `AGENTS.md` — add `OPENCLAW_GATEWAY_TOKEN` and `OPENCLAW_GATEWAY_WS_ENABLED` to
  environment variable documentation
- `src/api/openapi/paths/gateway.ts` — OpenAPI spec for `GET /api/gateway/status`
- Architecture diagram updated (in this doc)

---

## Implementation Phases

All phases ship in a **single omnibus PR**.

| Phase | Issues | Content |
|-------|--------|---------|
| 1 — Core | #2154 | Gateway connection service |
| 2 — Dispatch | #2155, #2156 | Chat send via WS; event router |
| 3 — Discovery | #2157, #2158 | Live agents; presence tracking |
| 4 — Frontend | #2159, #2160 | Gateway status hook; agent status badge |
| 5 — Schema | #2161 | DB migration 134 |
| 6 — Docs | #2162 | OpenAPI + architecture docs |

**Epic tracker:** #2153
