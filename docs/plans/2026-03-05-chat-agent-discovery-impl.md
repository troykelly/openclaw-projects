# Chat Agent Discovery & Session UX — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the chat feature visible and usable on fresh installs by fixing agent discovery, session creation, and adding end-session UI.

**Architecture:** Plugin pushes gateway agent list to backend via `POST /agents/sync` on startup. Backend caches agents in `gateway_agent_cache` table. `GET /chat/agents` reads from cache + existing sessions. Frontend always shows chat bubble, passes `agent_id` when creating sessions, and gains an "End session" button.

**Tech Stack:** PostgreSQL (migration), Fastify (API routes), React/TanStack Query (frontend), OpenClaw plugin SDK (gateway integration)

**Issue:** #2151 | **Epic:** #1940

---

### Task 1: DB Migration — `gateway_agent_cache` table

**Files:**
- Create: `migrations/134_gateway_agent_cache.up.sql`
- Create: `migrations/134_gateway_agent_cache.down.sql`

**Step 1: Write the up migration**

```sql
-- migrations/134_gateway_agent_cache.up.sql
-- Issue #2151: Cache gateway agent list for chat discovery
CREATE TABLE IF NOT EXISTS gateway_agent_cache (
  namespace text NOT NULL,
  agent_id text NOT NULL CHECK (length(trim(agent_id)) > 0),
  display_name text,
  avatar_url text,
  is_default boolean NOT NULL DEFAULT false,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (namespace, agent_id)
);

COMMENT ON TABLE gateway_agent_cache IS 'Cached agent list synced from OpenClaw gateway plugin (Issue #2151)';
```

**Step 2: Write the down migration**

```sql
-- migrations/134_gateway_agent_cache.down.sql
DROP TABLE IF EXISTS gateway_agent_cache;
```

**Step 3: Commit**

```bash
git add migrations/134_gateway_agent_cache.up.sql migrations/134_gateway_agent_cache.down.sql
git commit -m "[#2151] Add gateway_agent_cache migration"
```

---

### Task 2: Backend — `POST /agents/sync` endpoint

**Files:**
- Create: `src/api/agents/routes.ts`
- Modify: `src/api/server.ts:125` (add import)
- Modify: `src/api/server.ts:23665-23667` (register plugin)

**Step 1: Write failing test**

Create `tests/unit/agents-sync.test.ts`:

```typescript
/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Test the sync body validation logic (extracted function)
import { validateAgentSyncBody } from '../../src/api/agents/routes.ts';

describe('validateAgentSyncBody', () => {
  it('accepts valid body with agents and default_id', () => {
    const result = validateAgentSyncBody({
      agents: [{ id: 'assistant', name: 'Assistant' }],
      default_id: 'assistant',
    });
    expect(result.valid).toBe(true);
    expect(result.agents).toHaveLength(1);
    expect(result.default_id).toBe('assistant');
  });

  it('rejects body without agents array', () => {
    const result = validateAgentSyncBody({ default_id: 'x' });
    expect(result.valid).toBe(false);
  });

  it('rejects agents with empty id', () => {
    const result = validateAgentSyncBody({
      agents: [{ id: '', name: 'Bad' }],
    });
    expect(result.valid).toBe(true);
    expect(result.agents).toHaveLength(0); // filtered out
  });

  it('handles missing default_id', () => {
    const result = validateAgentSyncBody({
      agents: [{ id: 'a1' }],
    });
    expect(result.valid).toBe(true);
    expect(result.default_id).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm exec vitest run tests/unit/agents-sync.test.ts
```

Expected: FAIL — module not found

**Step 3: Write the agents routes module**

Create `src/api/agents/routes.ts`:

```typescript
/**
 * Agent discovery routes (Issue #2151).
 *
 * POST /agents/sync — Receives agent list from OpenClaw gateway plugin.
 * Used by GET /chat/agents to return available agents on fresh installs.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { getAuthIdentity } from '../auth/middleware.ts';

/** Validate and normalize the sync request body. */
export function validateAgentSyncBody(body: unknown): {
  valid: boolean;
  agents: Array<{ id: string; name: string | null; display_name: string | null; avatar_url: string | null }>;
  default_id: string | null;
  error?: string;
} {
  if (!body || typeof body !== 'object') {
    return { valid: false, agents: [], default_id: null, error: 'Body is required' };
  }

  const raw = body as Record<string, unknown>;

  if (!Array.isArray(raw.agents)) {
    return { valid: false, agents: [], default_id: null, error: 'agents must be an array' };
  }

  const agents = raw.agents
    .filter((a): a is Record<string, unknown> => a !== null && typeof a === 'object')
    .map((a) => ({
      id: String(a.id ?? '').trim(),
      name: typeof a.name === 'string' ? a.name.trim() : null,
      display_name: typeof a.display_name === 'string' ? a.display_name.trim()
        : (a.identity && typeof a.identity === 'object' && typeof (a.identity as Record<string, unknown>).name === 'string')
          ? ((a.identity as Record<string, unknown>).name as string).trim()
          : null,
      avatar_url: (a.identity && typeof a.identity === 'object' && typeof (a.identity as Record<string, unknown>).avatarUrl === 'string')
        ? ((a.identity as Record<string, unknown>).avatarUrl as string).trim()
        : null,
    }))
    .filter((a) => a.id.length > 0);

  const default_id = typeof raw.default_id === 'string' && raw.default_id.trim()
    ? raw.default_id.trim()
    : null;

  return { valid: true, agents, default_id };
}

function getStoreNamespace(req: FastifyRequest): string {
  const header = req.headers['x-namespace'];
  return typeof header === 'string' && header.trim() ? header.trim() : 'default';
}

/** Fastify plugin registering agent sync routes. */
export async function agentRoutesPlugin(
  app: FastifyInstance,
  opts: { pool: Pool },
): Promise<void> {
  const { pool } = opts;

  // POST /agents/sync — Upsert gateway agent list
  app.post('/agents/sync', async (req, reply) => {
    // Authenticate: accept M2M (plugin) or user tokens
    const identity = await getAuthIdentity(req);
    if (!identity?.email) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const namespace = getStoreNamespace(req);
    const parsed = validateAgentSyncBody(req.body);
    if (!parsed.valid) {
      return reply.code(400).send({ error: parsed.error ?? 'Invalid body' });
    }

    if (parsed.agents.length === 0) {
      // Clear cache for this namespace
      await pool.query('DELETE FROM gateway_agent_cache WHERE namespace = $1', [namespace]);
      return reply.send({ synced: 0 });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Delete stale entries for this namespace
      await client.query('DELETE FROM gateway_agent_cache WHERE namespace = $1', [namespace]);

      // Insert fresh entries
      for (const agent of parsed.agents) {
        await client.query(
          `INSERT INTO gateway_agent_cache (namespace, agent_id, display_name, avatar_url, is_default, synced_at)
           VALUES ($1, $2, $3, $4, $5, now())`,
          [namespace, agent.id, agent.display_name ?? agent.name, agent.avatar_url, agent.id === parsed.default_id],
        );
      }

      await client.query('COMMIT');
      return reply.send({ synced: parsed.agents.length });
    } catch (err) {
      await client.query('ROLLBACK');
      req.log.error(err, 'Failed to sync agents');
      return reply.code(500).send({ error: 'Failed to sync agents' });
    } finally {
      client.release();
    }
  });
}
```

**Step 4: Run test to verify it passes**

```bash
pnpm exec vitest run tests/unit/agents-sync.test.ts
```

Expected: PASS

**Step 5: Register in server.ts**

In `src/api/server.ts`:
- Add import at line ~125: `import { agentRoutesPlugin } from './agents/routes.ts';`
- Register before chat routes (around line 23665):

```typescript
  // ── Agent Discovery Routes (Issue #2151) ────────────────────────
  const agentPool = createPool();
  app.register(agentRoutesPlugin, { pool: agentPool });
```

**Step 6: Commit**

```bash
git add src/api/agents/routes.ts tests/unit/agents-sync.test.ts src/api/server.ts
git commit -m "[#2151] Add POST /agents/sync endpoint and validation"
```

---

### Task 3: Backend — Fix `GET /chat/agents` to use cache

**Files:**
- Modify: `src/api/chat/routes.ts:175-201`

**Step 1: Replace the `GET /chat/agents` handler**

In `src/api/chat/routes.ts`, replace lines 175-201 (the existing handler body after the route declaration):

```typescript
  // GET /chat/agents — List available agents (Issue #2151: read from cache + sessions)
  app.get('/chat/agents', async (req, reply) => {
    const identity = await getAuthIdentity(req);
    if (!identity?.email) return reply.code(401).send({ error: 'Unauthorized' });

    const namespace = getStoreNamespace(req);

    try {
      // Primary: gateway agent cache (synced from plugin)
      // Fallback: agents from existing chat sessions
      const result = await pool.query(
        `SELECT agent_id AS id,
                COALESCE(display_name, agent_id) AS name,
                display_name,
                avatar_url,
                is_default
         FROM gateway_agent_cache
         WHERE namespace = $1
         UNION
         SELECT DISTINCT cs.agent_id AS id,
                cs.agent_id AS name,
                NULL AS display_name,
                NULL AS avatar_url,
                false AS is_default
         FROM chat_session cs
         WHERE cs.namespace = $1 AND cs.status != 'expired'
           AND cs.agent_id NOT IN (SELECT gac.agent_id FROM gateway_agent_cache gac WHERE gac.namespace = $1)
         ORDER BY is_default DESC, id`,
        [namespace],
      );

      const agents = result.rows.map((row: { id: string; name: string; display_name: string | null; avatar_url: string | null; is_default: boolean }) => ({
        id: row.id,
        name: row.name,
        display_name: row.display_name,
        avatar_url: row.avatar_url,
      }));

      return reply.send({ agents });
    } catch (err) {
      req.log.error(err, 'Failed to list chat agents');
      return reply.code(500).send({ error: 'Failed to list agents' });
    }
  });
```

**Step 2: Verify build passes**

```bash
pnpm run build
```

**Step 3: Commit**

```bash
git add src/api/chat/routes.ts
git commit -m "[#2151] Fix GET /chat/agents to read from gateway cache + sessions"
```

---

### Task 4: Backend — Server-side `agent_id` fallback in `POST /chat/sessions`

**Files:**
- Modify: `src/api/chat/routes.ts:222-228`

**Step 1: Replace the agent_id validation block**

Replace lines 222-228 in `src/api/chat/routes.ts`:

```typescript
    const body = req.body as Record<string, unknown> | null | undefined;
    let agentId = (body?.agent_id as string | undefined)?.trim() || null;
    const title = (body?.title as string | undefined)?.trim() || null;

    // Issue #2151: Resolve agent_id if not provided
    if (!agentId) {
      // Try user's default agent preference
      const prefResult = await pool.query(
        `SELECT default_agent_id FROM user_setting WHERE email = $1`,
        [userEmail],
      );
      agentId = (prefResult.rows[0] as { default_agent_id: string | null } | undefined)?.default_agent_id ?? null;
    }
    if (!agentId) {
      // Try default agent from gateway cache
      const cacheResult = await pool.query(
        `SELECT agent_id FROM gateway_agent_cache
         WHERE namespace = $1
         ORDER BY is_default DESC, agent_id
         LIMIT 1`,
        [namespace],
      );
      agentId = (cacheResult.rows[0] as { agent_id: string } | undefined)?.agent_id ?? null;
    }
    if (!agentId) {
      return reply.code(400).send({ error: 'agent_id is required and no default agent is configured' });
    }
```

**Step 2: Verify build passes**

```bash
pnpm run build
```

**Step 3: Commit**

```bash
git add src/api/chat/routes.ts
git commit -m "[#2151] Add server-side agent_id fallback in POST /chat/sessions"
```

---

### Task 5: Plugin — Push agent list on startup

**Files:**
- Modify: `packages/openclaw-plugin/src/register-openclaw.ts:4186` (after state creation)

**Step 1: Add agent sync call after plugin state initialization**

Insert after line 4186 (after `const state: PluginState = ...`):

```typescript
  // Issue #2151: Push gateway agent list to backend for chat discovery.
  // Fire-and-forget — plugin registration must remain synchronous (#4126).
  const gatewayAgents = (api.config as Record<string, unknown>)?.agents;
  const agentsList = gatewayAgents && typeof gatewayAgents === 'object'
    ? (gatewayAgents as Record<string, unknown>).list
    : undefined;
  if (Array.isArray(agentsList) && agentsList.length > 0) {
    const defaultAgentId = gatewayAgents && typeof gatewayAgents === 'object'
      ? (gatewayAgents as Record<string, unknown>).default
      : undefined;
    const syncPayload = {
      agents: agentsList
        .filter((entry): entry is Record<string, unknown> => entry !== null && typeof entry === 'object' && typeof entry.id === 'string')
        .map((entry) => ({
          id: entry.id,
          name: typeof entry.name === 'string' ? entry.name : undefined,
          identity: entry.identity,
        })),
      default_id: typeof defaultAgentId === 'string' ? defaultAgentId : undefined,
    };
    apiClient.post('/agents/sync', syncPayload, {
      namespace: resolvedNamespace.default,
      isAgent: true,
      user_id: user_id,
      user_email,
    }).then((result) => {
      if (result.success) {
        logger.info(`[openclaw-projects] Agent sync: ${(result.data as Record<string, unknown>)?.synced ?? 0} agents pushed`);
      } else {
        logger.warn(`[openclaw-projects] Agent sync failed: ${result.error.message}`);
      }
    }).catch((err: unknown) => {
      logger.warn(`[openclaw-projects] Agent sync error: ${err instanceof Error ? err.message : String(err)}`);
    });
  }
```

**Step 2: Verify build passes**

```bash
pnpm run build
```

**Step 3: Commit**

```bash
git add packages/openclaw-plugin/src/register-openclaw.ts
git commit -m "[#2151] Push gateway agent list to backend on plugin startup"
```

---

### Task 6: Frontend — Always show ChatBubble

**Files:**
- Modify: `src/ui/components/chat/chat-bubble.tsx:32-33`
- Modify: `tests/ui/chat-bubble.test.tsx:69-79`

**Step 1: Update the test for new behavior**

In `tests/ui/chat-bubble.test.tsx`, update the "hidden when no agents" test (lines 69-79):

```typescript
  it('renders the chat bubble even when no agents are available', () => {
    vi.mocked(useAvailableAgents).mockReturnValue({
      data: { agents: [] },
    } as ReturnType<typeof useAvailableAgents>);
    vi.mocked(useChatUnreadCount).mockReturnValue({
      data: { count: 0 },
    } as ReturnType<typeof useChatUnreadCount>);

    render(<ChatBubble />, { wrapper: createWrapper() });
    expect(screen.getByTestId('chat-bubble')).toBeInTheDocument();
  });
```

Also update the "handles missing agents data" test (lines 149-160):

```typescript
  it('renders the chat bubble even when agents data is undefined', () => {
    vi.mocked(useAvailableAgents).mockReturnValue({
      data: undefined,
    } as ReturnType<typeof useAvailableAgents>);
    vi.mocked(useChatUnreadCount).mockReturnValue({
      data: undefined,
    } as ReturnType<typeof useChatUnreadCount>);

    render(<ChatBubble />, { wrapper: createWrapper() });
    expect(screen.getByTestId('chat-bubble')).toBeInTheDocument();
  });
```

**Step 2: Run tests to verify they fail**

```bash
pnpm exec vitest run tests/ui/chat-bubble.test.tsx
```

Expected: FAIL (bubble still returns null when no agents)

**Step 3: Remove the `agents.length === 0` gate**

In `src/ui/components/chat/chat-bubble.tsx`, remove lines 32-33:

```typescript
  // Hidden when no agents available
  if (agents.length === 0) return null;
```

**Step 4: Run tests to verify they pass**

```bash
pnpm exec vitest run tests/ui/chat-bubble.test.tsx
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/ui/components/chat/chat-bubble.tsx tests/ui/chat-bubble.test.tsx
git commit -m "[#2151] Always show chat bubble regardless of agent availability"
```

---

### Task 7: Frontend — Pass `agent_id` in session creation calls

**Files:**
- Modify: `src/ui/components/chat/chat-header.tsx:77-83`
- Modify: `src/ui/components/chat/chat-session-list.tsx:58-64`
- Modify: `src/ui/components/chat/chat-session-ended-state.tsx:19-25`

**Step 1: Fix `chat-header.tsx`**

Add `useAvailableAgents` import (already imported at line 12). Replace `handleNewSession` (lines 77-83):

```typescript
  const handleNewSession = React.useCallback(() => {
    const defaultAgent = Array.isArray(agentsData?.agents) ? agentsData.agents.find((a) => a.id) : null;
    createSession.mutate(
      { agent_id: activeSession?.agent_id ?? defaultAgent?.id },
      {
        onSuccess: (session) => {
          setActiveSessionId(session.id);
        },
      },
    );
  }, [createSession, setActiveSessionId, activeSession?.agent_id, agentsData?.agents]);
```

**Step 2: Fix `chat-session-list.tsx`**

Replace `handleNewConversation` (lines 58-64):

```typescript
  const handleNewConversation = React.useCallback(() => {
    const defaultAgent = Array.isArray(agentsData?.agents) ? agentsData.agents.find((a) => a.id) : null;
    createSession.mutate(
      { agent_id: defaultAgent?.id },
      {
        onSuccess: (session) => {
          setActiveSessionId(session.id);
        },
      },
    );
  }, [createSession, setActiveSessionId, agentsData?.agents]);
```

**Step 3: Fix `chat-session-ended-state.tsx`**

Add agents hook. Replace lines 12-25:

```typescript
import { useAvailableAgents } from '@/ui/hooks/queries/use-chat';

export function ChatSessionEndedState(): React.JSX.Element {
  const { setActiveSessionId } = useChat();
  const createSession = useCreateChatSession();
  const { data: agentsData } = useAvailableAgents();

  const handleNewConversation = React.useCallback(() => {
    const defaultAgent = Array.isArray(agentsData?.agents) ? agentsData.agents.find((a) => a.id) : null;
    createSession.mutate(
      { agent_id: defaultAgent?.id },
      {
        onSuccess: (session) => {
          setActiveSessionId(session.id);
        },
      },
    );
  }, [createSession, setActiveSessionId, agentsData?.agents]);
```

**Step 4: Verify build passes**

```bash
pnpm run build
```

**Step 5: Commit**

```bash
git add src/ui/components/chat/chat-header.tsx src/ui/components/chat/chat-session-list.tsx src/ui/components/chat/chat-session-ended-state.tsx
git commit -m "[#2151] Pass agent_id when creating chat sessions"
```

---

### Task 8: Frontend — "End Session" button in ChatHeader

**Files:**
- Modify: `src/ui/components/chat/chat-header.tsx`

**Step 1: Add end session handler and UI**

Import `useEndChatSession` (add to existing imports from `use-chat`). Import `PhoneOff` from lucide-react. Add state and handler after `handleNewSession`:

```typescript
  const endSession = useEndChatSession();
  const [showEndConfirm, setShowEndConfirm] = React.useState(false);

  const handleEndSession = React.useCallback(() => {
    if (!activeSessionId) return;
    endSession.mutate(activeSessionId, {
      onSuccess: () => {
        setShowEndConfirm(false);
      },
    });
  }, [endSession, activeSessionId]);
```

Add end session button in the action buttons `div` (before the New conversation button at line 143):

```tsx
        {activeSession?.status === 'active' && !showEndConfirm && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-destructive hover:text-destructive"
            onClick={() => setShowEndConfirm(true)}
            aria-label="End conversation"
          >
            <PhoneOff className="size-3.5" aria-hidden="true" />
          </Button>
        )}
        {showEndConfirm && (
          <Button
            variant="destructive"
            size="sm"
            className="h-7 text-xs"
            onClick={handleEndSession}
            disabled={endSession.isPending}
          >
            {endSession.isPending ? 'Ending...' : 'End?'}
          </Button>
        )}
```

**Step 2: Verify build passes**

```bash
pnpm run build
```

**Step 3: Commit**

```bash
git add src/ui/components/chat/chat-header.tsx
git commit -m "[#2151] Add end session button to ChatHeader"
```

---

### Task 9: Typecheck and full test run

**Step 1: Run typecheck**

```bash
pnpm run build
```

**Step 2: Run UI tests**

```bash
pnpm exec vitest run tests/ui/chat-bubble.test.tsx tests/ui/chat-panel.test.tsx tests/ui/chat-settings.test.tsx
```

**Step 3: Run unit tests**

```bash
pnpm exec vitest run tests/unit/agents-sync.test.ts tests/unit/chat-openapi.test.ts
```

**Step 4: Fix any failures, commit fixes**

---

### Task 10: Final commit and PR

**Step 1: Verify all changes**

```bash
git log --oneline main..HEAD
git diff --stat main..HEAD
```

**Step 2: Push and create PR**

```bash
git push -u origin issue/2151-chat-agent-discovery
gh pr create --title "[#2151] Fix chat agent discovery and session UX" --body "$(cat <<'EOF'
## Summary

- **Agent discovery**: Plugin pushes gateway agent list to backend on startup via `POST /agents/sync`, stored in `gateway_agent_cache` table
- **`GET /chat/agents` fixed**: Reads from cache (gateway source of truth) + existing sessions (fallback), no longer empty on fresh installs
- **Session creation fixed**: All 3 frontend call sites now pass `agent_id`; server falls back to user default or first cached agent
- **Chat bubble always visible**: Removed `agents.length === 0` gate; empty state handled in panel
- **End session UI**: New button in `ChatHeader` with confirmation

Closes #2151

## Test plan

- [ ] Fresh install: chat bubble visible, panel shows "No agents configured" until gateway syncs
- [ ] After gateway plugin starts: `GET /chat/agents` returns agent list
- [ ] Click "New Conversation" creates session with resolved agent_id
- [ ] "End conversation" button shows confirmation, ends session
- [ ] Settings page agent dropdowns populate from cache
- [ ] Existing chat functionality (streaming, unread, WS) still works
- [ ] `pnpm run build` passes
- [ ] `pnpm exec vitest run tests/ui/chat-bubble.test.tsx` passes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
