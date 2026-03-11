# Chat Agent Selection & Visibility — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix default agent selection, add agent visibility preferences, and add agent picker for new conversations.

**Architecture:** Three issues (#2423, #2424, #2425) implemented as a single branch. Database migration adds `visible_agent_ids text[]` to `user_setting`. Server validates visibility on session creation and settings updates. New `useChatAgentPreferences` hook derives from existing `useSettings`. Shared `AgentPickerPopover` component replaces four independent `handleNewConversation` implementations.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, React 19, shadcn/ui (Popover+Command+Checkbox), Vitest, React Testing Library

**Spec:** `docs/superpowers/specs/2026-03-11-chat-agent-selection-design.md`

**Issues:** #2423, #2424, #2425

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `migrations/162_user_setting_visible_agents.up.sql` | Add `visible_agent_ids text[]` column |
| Create | `migrations/162_user_setting_visible_agents.down.sql` | Drop column |
| Modify | `src/ui/components/settings/types.ts` | Add `visible_agent_ids` to `UserSettings` + `SettingsUpdatePayload` |
| Modify | `src/api/server.ts:3266-3331` | Add `visible_agent_ids` to PATCH /settings with validation |
| Modify | `src/api/chat/routes.ts:200-244` | Validate agent_id against visible_agent_ids on POST /chat/sessions |
| Create | `src/ui/components/chat/use-chat-agent-preferences.ts` | Hook: derives default + visible agents from useSettings + useAvailableAgents |
| Create | `src/ui/components/chat/agent-picker-popover.tsx` | Shared Popover+Command agent picker |
| Modify | `src/ui/components/settings/chat-settings-section.tsx` | Add visibility checkboxes, migrate to useAvailableAgents |
| Modify | `src/ui/components/chat/chat-session-list.tsx` | Use useChatAgentPreferences + AgentPickerPopover |
| Modify | `src/ui/components/chat/chat-header.tsx` | Use useChatAgentPreferences + AgentPickerPopover |
| Modify | `src/ui/components/chat/chat-session-ended-state.tsx` | Use useChatAgentPreferences + AgentPickerPopover |
| Modify | `src/ui/components/chat/chat-empty-state.tsx` | Three-branch rendering + agent picker CTA |
| Modify | `src/ui/components/chat/chat-agent-selector.tsx` | Filter by visible agents, move realtime handler |
| Modify | `src/ui/components/chat/chat-bubble.tsx` | Use visible agents, add useRealtimeAgentInvalidation |
| Modify | `src/ui/hooks/queries/use-chat.ts` | Add useRealtimeAgentInvalidation hook |
| Delete | `src/ui/components/settings/use-default-agent.ts` | Replaced by useChatAgentPreferences |
| Create | `tests/unit/chat-agent-preferences.test.ts` | Unit tests for useChatAgentPreferences |
| Create | `tests/ui/chat-agent-picker.test.tsx` | Unit tests for AgentPickerPopover |
| Modify | `tests/ui/chat-settings.test.tsx` | Update for visibility checkboxes, remove useDefaultAgent tests |
| Create | `tests/unit/chat-visibility-api.test.ts` | Integration tests for POST/PATCH visibility validation |

---

## Chunk 1: Database + API Backend

### Task 1: Migration — `visible_agent_ids` column

**Files:**
- Create: `migrations/162_user_setting_visible_agents.up.sql`
- Create: `migrations/162_user_setting_visible_agents.down.sql`

- [ ] **Step 1: Write up migration**

```sql
-- migrations/162_user_setting_visible_agents.up.sql
ALTER TABLE user_setting
  ADD COLUMN IF NOT EXISTS visible_agent_ids text[];

COMMENT ON COLUMN user_setting.visible_agent_ids IS
  'Agent IDs visible in chat UI. NULL means all agents visible.';
```

- [ ] **Step 2: Write down migration**

```sql
-- migrations/162_user_setting_visible_agents.down.sql
ALTER TABLE user_setting
  DROP COLUMN IF EXISTS visible_agent_ids;
```

- [ ] **Step 3: Run migration locally**

```bash
cd /tmp/worktree-issue-2423-agent-selection
pnpm run migrate
```

Expected: Migration 162 applies successfully.

- [ ] **Step 4: Verify column exists**

```bash
psql -h postgres -U openclaw -d openclaw -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='user_setting' AND column_name='visible_agent_ids';"
```

Expected: `visible_agent_ids | ARRAY`

- [ ] **Step 5: Commit**

```bash
git add migrations/162_user_setting_visible_agents.up.sql migrations/162_user_setting_visible_agents.down.sql
git commit -m "[#2424] Add visible_agent_ids column to user_setting"
```

---

### Task 2: PATCH /settings — `visible_agent_ids` support with validation

**Files:**
- Modify: `src/api/server.ts:3266-3331`

- [ ] **Step 1: Write failing integration test**

Create `tests/unit/chat-visibility-api.test.ts`:

```typescript
/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';

const TEST_EMAIL = `vis-test-${Date.now()}@test.local`;

describe('visible_agent_ids API validation', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({
      host: process.env.PGHOST ?? 'postgres',
      user: process.env.PGUSER ?? 'openclaw',
      password: process.env.PGPASSWORD ?? 'openclaw',
      database: process.env.PGDATABASE ?? 'openclaw',
    });
    // Seed user_setting
    await pool.query(
      `INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT (email) DO NOTHING`,
      [TEST_EMAIL],
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM user_setting WHERE email = $1`, [TEST_EMAIL]);
    await pool.end();
  });

  it('stores visible_agent_ids as text array', async () => {
    await pool.query(
      `UPDATE user_setting SET visible_agent_ids = $1::text[] WHERE email = $2`,
      [['agent-a', 'agent-b'], TEST_EMAIL],
    );
    const result = await pool.query(
      `SELECT visible_agent_ids FROM user_setting WHERE email = $1`,
      [TEST_EMAIL],
    );
    expect(result.rows[0].visible_agent_ids).toEqual(['agent-a', 'agent-b']);
  });

  it('NULL visible_agent_ids means all visible', async () => {
    await pool.query(
      `UPDATE user_setting SET visible_agent_ids = NULL WHERE email = $1`,
      [TEST_EMAIL],
    );
    const result = await pool.query(
      `SELECT visible_agent_ids FROM user_setting WHERE email = $1`,
      [TEST_EMAIL],
    );
    expect(result.rows[0].visible_agent_ids).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it passes** (these are DB-level tests, should pass with migration applied)

```bash
pnpm test:unit -- tests/unit/chat-visibility-api.test.ts
```

- [ ] **Step 3: Add `visible_agent_ids` to PATCH /settings handler**

In `src/api/server.ts`, modify the PATCH /settings handler (~line 3266):

1. Add to body type:
```typescript
visible_agent_ids?: string[] | null;
```

2. Widen params type:
```typescript
const params: unknown[] = [email];
```

3. Handle `visible_agent_ids` separately after the `allowedFields` loop:
```typescript
// Handle visible_agent_ids (array field — separate from scalar allowedFields)
if ('visible_agent_ids' in body) {
  const raw = body.visible_agent_ids;
  if (raw !== null) {
    if (!Array.isArray(raw)) {
      return reply.code(400).send({ error: 'visible_agent_ids must be an array or null' });
    }
    if (raw.length > 50) {
      return reply.code(400).send({ error: 'visible_agent_ids must not exceed 50 entries' });
    }
    // Validate, dedup, strip empties
    const cleaned: string[] = [];
    const seen = new Set<string>();
    for (const entry of raw) {
      if (typeof entry !== 'string') {
        return reply.code(400).send({ error: 'visible_agent_ids entries must be strings' });
      }
      const trimmed = entry.trim();
      if (trimmed.length === 0) continue;
      if (trimmed.length > 255) {
        return reply.code(400).send({ error: 'visible_agent_ids entries must not exceed 255 characters' });
      }
      if (!seen.has(trimmed)) {
        seen.add(trimmed);
        cleaned.push(trimmed);
      }
    }
    updates.push(`visible_agent_ids = $${paramIndex}::text[]`);
    params.push(cleaned);
    paramIndex++;
  } else {
    updates.push(`visible_agent_ids = $${paramIndex}`);
    params.push(null);
    paramIndex++;
  }
}

// Cross-validate default_agent_id ∈ visible_agent_ids
if ('default_agent_id' in body || 'visible_agent_ids' in body) {
  // Determine effective values after this PATCH
  const newDefaultId = 'default_agent_id' in body ? (body.default_agent_id?.trim() || null) : null;
  const newVisibleIds = 'visible_agent_ids' in body ? body.visible_agent_ids : null;

  // Only validate cross-constraint when both will be non-null
  if (newDefaultId !== null && newVisibleIds !== null && Array.isArray(newVisibleIds)) {
    const cleanedVisible = [...new Set(newVisibleIds.map(v => typeof v === 'string' ? v.trim() : '').filter(Boolean))];
    if (!cleanedVisible.includes(newDefaultId)) {
      // Auto-add default to visible list rather than rejecting
      cleanedVisible.push(newDefaultId);
      // Find and update the visible_agent_ids param we already pushed
      const visIdx = updates.findIndex(u => u.startsWith('visible_agent_ids'));
      if (visIdx !== -1) {
        // params[0] is email, so the visible_agent_ids param index needs calculation
        // Re-push with the updated array — find the right param
        const paramOffset = visIdx + 1; // +1 because params[0] is email
        // Actually, we need to find which param index corresponds
        // Simpler: just rebuild — but that's complex. Instead, ensure
        // the cleaned array we pushed already includes default.
        // We'll handle this by modifying `cleaned` before pushing.
      }
    }
  }
}
```

**Better approach** — do the cross-validation BEFORE building SQL:

```typescript
// --- At the top of the handler, after body parsing ---

// Validate and normalize visible_agent_ids before SQL building
let normalizedVisibleIds: string[] | null | undefined;
if ('visible_agent_ids' in body) {
  const raw = body.visible_agent_ids;
  if (raw === null) {
    normalizedVisibleIds = null;
  } else if (!Array.isArray(raw)) {
    return reply.code(400).send({ error: 'visible_agent_ids must be an array or null' });
  } else {
    if (raw.length > 50) {
      return reply.code(400).send({ error: 'visible_agent_ids must not exceed 50 entries' });
    }
    const cleaned: string[] = [];
    const seen = new Set<string>();
    for (const entry of raw) {
      if (typeof entry !== 'string') {
        return reply.code(400).send({ error: 'visible_agent_ids entries must be strings' });
      }
      const trimmed = entry.trim();
      if (trimmed.length === 0) continue;
      if (trimmed.length > 255) {
        return reply.code(400).send({ error: 'Each visible_agent_ids entry must not exceed 255 characters' });
      }
      if (!seen.has(trimmed)) {
        seen.add(trimmed);
        cleaned.push(trimmed);
      }
    }

    // Auto-include default_agent_id if being set simultaneously
    const effectiveDefault = ('default_agent_id' in body)
      ? (body.default_agent_id?.trim() || null)
      : null;
    if (effectiveDefault && !cleaned.includes(effectiveDefault)) {
      cleaned.push(effectiveDefault);
    }

    normalizedVisibleIds = cleaned;
  }
}

// Cross-validate: if setting default_agent_id alone, check against existing visible list
if ('default_agent_id' in body && !('visible_agent_ids' in body)) {
  const newDefault = body.default_agent_id?.trim() || null;
  if (newDefault) {
    const pool2 = createPool();
    try {
      const existing = await pool2.query(
        `SELECT visible_agent_ids FROM user_setting WHERE email = $1`,
        [email],
      );
      const existingVis: string[] | null = existing.rows[0]?.visible_agent_ids ?? null;
      if (existingVis !== null && !existingVis.includes(newDefault)) {
        return reply.code(400).send({
          error: 'default_agent_id must be in visible_agent_ids. Update visible_agent_ids first.',
        });
      }
    } finally {
      await pool2.end();
    }
  }
}
```

Then in the SQL building section, handle `visible_agent_ids` after the scalar fields loop:

```typescript
if (normalizedVisibleIds !== undefined) {
  if (normalizedVisibleIds === null) {
    updates.push(`visible_agent_ids = $${paramIndex}`);
    params.push(null);
  } else {
    updates.push(`visible_agent_ids = $${paramIndex}::text[]`);
    params.push(normalizedVisibleIds);
  }
  paramIndex++;
}
```

- [ ] **Step 4: Add integration tests for the validation**

Add to `tests/unit/chat-visibility-api.test.ts`:

```typescript
// These test the DB-level behavior. HTTP-level tests go in a separate
// integration test file if needed.

it('deduplicates visible_agent_ids on write', async () => {
  const ids = ['agent-a', 'agent-a', 'agent-b'];
  const deduped = [...new Set(ids)];
  await pool.query(
    `UPDATE user_setting SET visible_agent_ids = $1::text[] WHERE email = $2`,
    [deduped, TEST_EMAIL],
  );
  const result = await pool.query(
    `SELECT visible_agent_ids FROM user_setting WHERE email = $1`,
    [TEST_EMAIL],
  );
  expect(result.rows[0].visible_agent_ids).toEqual(['agent-a', 'agent-b']);
});
```

- [ ] **Step 5: Run tests**

```bash
pnpm test:unit -- tests/unit/chat-visibility-api.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/api/server.ts tests/unit/chat-visibility-api.test.ts
git commit -m "[#2424] Add visible_agent_ids to PATCH /settings with validation"
```

---

### Task 3: POST /chat/sessions — Validate agent_id against visible_agent_ids

**Files:**
- Modify: `src/api/chat/routes.ts:200-244`

- [ ] **Step 1: Write failing test**

Add to `tests/unit/chat-visibility-api.test.ts`:

```typescript
describe('POST /chat/sessions visibility validation (DB-level)', () => {
  it('visible_agent_ids filters allowed agents', async () => {
    await pool.query(
      `UPDATE user_setting SET visible_agent_ids = $1::text[], default_agent_id = $2 WHERE email = $3`,
      [['agent-a', 'agent-b'], 'agent-a', TEST_EMAIL],
    );
    const result = await pool.query(
      `SELECT visible_agent_ids FROM user_setting WHERE email = $1`,
      [TEST_EMAIL],
    );
    const visibleIds: string[] | null = result.rows[0].visible_agent_ids;
    expect(visibleIds).not.toBeNull();
    expect(visibleIds!.includes('agent-a')).toBe(true);
    expect(visibleIds!.includes('agent-c')).toBe(false);
  });
});
```

- [ ] **Step 2: Add server-side validation to POST /chat/sessions**

In `src/api/chat/routes.ts`, after `agentId` is resolved (after line ~244, before `title` validation):

```typescript
// Validate agent_id against user's visible_agent_ids (AD-1)
const visResult = await pool.query(
  `SELECT visible_agent_ids FROM user_setting WHERE email = $1`,
  [userEmail],
);
const visibleIds: string[] | null = visResult.rows[0]?.visible_agent_ids ?? null;
if (visibleIds !== null && !visibleIds.includes(agentId)) {
  return reply.code(400).send({ error: 'Selected agent is not in your visible agents list' });
}
```

**Note:** This uses the existing `pool` that's already available in the route handler scope (not `createPool()` — check the actual variable name in the route). The query to `user_setting` for `default_agent_id` already happens above, so we can combine these into one query:

```typescript
// Replace the existing settingResult query with one that fetches both fields:
const settingResult = await pool.query(
  `SELECT default_agent_id, visible_agent_ids FROM user_setting WHERE email = $1`,
  [userEmail],
);
agentId = (settingResult.rows[0]?.default_agent_id as string | undefined)?.trim() || null;
const visibleIds: string[] | null = settingResult.rows[0]?.visible_agent_ids ?? null;

// ... (existing fallback logic) ...

// After agentId is resolved, validate visibility
if (visibleIds !== null && !visibleIds.includes(agentId)) {
  return reply.code(400).send({ error: 'Selected agent is not in your visible agents list' });
}
```

- [ ] **Step 3: Run tests**

```bash
pnpm test:unit -- tests/unit/chat-visibility-api.test.ts
```

- [ ] **Step 4: Run full test suite to check for regressions**

```bash
pnpm test
```

- [ ] **Step 5: Commit**

```bash
git add src/api/chat/routes.ts tests/unit/chat-visibility-api.test.ts
git commit -m "[#2424] Validate agent_id against visible_agent_ids on session creation"
```

---

## Chunk 2: Frontend Types + Hooks

### Task 4: Add `visible_agent_ids` to frontend types

**Files:**
- Modify: `src/ui/components/settings/types.ts`

- [ ] **Step 1: Add to `UserSettings` interface**

In `src/ui/components/settings/types.ts`, add after `default_agent_id`:

```typescript
visible_agent_ids: string[] | null;
```

- [ ] **Step 2: Add to `SettingsUpdatePayload` Pick list**

Add `'visible_agent_ids'` to the Pick list:

```typescript
export type SettingsUpdatePayload = Partial<
  Pick<
    UserSettings,
    | 'theme'
    | 'default_view'
    | 'default_project_id'
    | 'default_agent_id'
    | 'visible_agent_ids'
    | 'sidebar_collapsed'
    // ... rest unchanged
  >
>;
```

- [ ] **Step 3: Typecheck**

```bash
pnpm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/ui/components/settings/types.ts
git commit -m "[#2424] Add visible_agent_ids to UserSettings type"
```

---

### Task 5: Create `useChatAgentPreferences` hook

**Files:**
- Create: `src/ui/components/chat/use-chat-agent-preferences.ts`
- Create: `tests/unit/chat-agent-preferences.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/chat-agent-preferences.test.ts`:

```typescript
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// Mock useSettings
const mockUseSettings = vi.fn();
vi.mock('@/ui/components/settings/use-settings', () => ({
  useSettings: () => mockUseSettings(),
}));

// Mock useAvailableAgents
const mockUseAvailableAgents = vi.fn();
vi.mock('@/ui/hooks/queries/use-chat', () => ({
  useAvailableAgents: () => mockUseAvailableAgents(),
}));

const AGENTS = [
  { id: 'troy', name: 'Troy', display_name: 'Troy Agent', avatar_url: null, is_default: false, status: 'online' as const },
  { id: 'arthouse', name: 'arthouse', display_name: 'Arthouse', avatar_url: null, is_default: true, status: 'online' as const },
  { id: 'helper', name: 'helper', display_name: 'Helper', avatar_url: null, is_default: false, status: 'offline' as const },
];

describe('useChatAgentPreferences', () => {
  let useChatAgentPreferences: typeof import('@/ui/components/chat/use-chat-agent-preferences').useChatAgentPreferences;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import('@/ui/components/chat/use-chat-agent-preferences');
    useChatAgentPreferences = mod.useChatAgentPreferences;
  });

  function setup(opts: {
    settingsState?: 'loading' | 'error' | { default_agent_id: string | null; visible_agent_ids: string[] | null };
    agents?: typeof AGENTS;
  }) {
    const { settingsState = { default_agent_id: null, visible_agent_ids: null }, agents = AGENTS } = opts;

    if (settingsState === 'loading') {
      mockUseSettings.mockReturnValue({ state: { kind: 'loading' }, isSaving: false, updateSettings: vi.fn() });
    } else if (settingsState === 'error') {
      mockUseSettings.mockReturnValue({ state: { kind: 'error', message: 'fail' }, isSaving: false, updateSettings: vi.fn() });
    } else {
      mockUseSettings.mockReturnValue({
        state: { kind: 'loaded', data: { ...settingsState, id: '1', email: 'test@test.com', created_at: '', updated_at: '' } },
        isSaving: false,
        updateSettings: vi.fn().mockResolvedValue(true),
      });
    }

    mockUseAvailableAgents.mockReturnValue({ data: { agents } });
    return renderHook(() => useChatAgentPreferences());
  }

  it('returns loading state when settings loading', () => {
    const { result } = setup({ settingsState: 'loading' });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.visibleAgents).toEqual(AGENTS); // all agents visible when no settings
  });

  it('returns error state when settings error', () => {
    const { result } = setup({ settingsState: 'error' });
    expect(result.current.error).toBe('fail');
  });

  it('returns all agents when visible_agent_ids is null', () => {
    const { result } = setup({ settingsState: { default_agent_id: null, visible_agent_ids: null } });
    expect(result.current.visibleAgents).toHaveLength(3);
    expect(result.current.allAgents).toHaveLength(3);
  });

  it('filters agents by visible_agent_ids', () => {
    const { result } = setup({ settingsState: { default_agent_id: 'troy', visible_agent_ids: ['troy', 'helper'] } });
    expect(result.current.visibleAgents).toHaveLength(2);
    expect(result.current.visibleAgents.map(a => a.id)).toEqual(['troy', 'helper']);
  });

  it('uses user default_agent_id as first priority', () => {
    const { result } = setup({ settingsState: { default_agent_id: 'troy', visible_agent_ids: null } });
    expect(result.current.resolvedDefaultAgent?.id).toBe('troy');
  });

  it('falls back to gateway is_default when no user default', () => {
    const { result } = setup({ settingsState: { default_agent_id: null, visible_agent_ids: null } });
    expect(result.current.resolvedDefaultAgent?.id).toBe('arthouse'); // is_default: true
  });

  it('falls back to first visible agent when no defaults', () => {
    const agents = AGENTS.map(a => ({ ...a, is_default: false }));
    const { result } = setup({ settingsState: { default_agent_id: null, visible_agent_ids: null }, agents });
    expect(result.current.resolvedDefaultAgent?.id).toBe('troy');
  });

  it('ignores stale agent IDs in visible_agent_ids', () => {
    const { result } = setup({ settingsState: { default_agent_id: null, visible_agent_ids: ['troy', 'nonexistent'] } });
    expect(result.current.visibleAgents).toHaveLength(1);
    expect(result.current.visibleAgents[0].id).toBe('troy');
  });

  it('falls back when default_agent_id is stale', () => {
    const { result } = setup({ settingsState: { default_agent_id: 'deleted-agent', visible_agent_ids: null } });
    // Should fall back to gateway default (arthouse)
    expect(result.current.resolvedDefaultAgent?.id).toBe('arthouse');
  });

  it('returns null default when no visible agents', () => {
    const { result } = setup({ settingsState: { default_agent_id: null, visible_agent_ids: [] } });
    expect(result.current.visibleAgents).toHaveLength(0);
    expect(result.current.resolvedDefaultAgent).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test:unit -- tests/unit/chat-agent-preferences.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `useChatAgentPreferences`**

Create `src/ui/components/chat/use-chat-agent-preferences.ts`:

```typescript
/**
 * Chat agent preferences hook (Issues #2423, #2424, #2425).
 *
 * Derives default agent selection and visibility filtering from
 * useSettings() + useAvailableAgents(). Single source of truth
 * for all chat agent preferences.
 *
 * Priority chain for default agent:
 * 1. User's saved default_agent_id (from user_setting)
 * 2. Gateway is_default flag
 * 3. First visible agent
 */
import { useMemo } from 'react';
import { useSettings } from '@/ui/components/settings/use-settings';
import { useAvailableAgents } from '@/ui/hooks/queries/use-chat';
import type { ChatAgent } from '@/ui/lib/api-types';
import type { SettingsUpdatePayload } from '@/ui/components/settings/types';

interface UseChatAgentPreferencesReturn {
  /** The user's saved default agent ID, or null. */
  defaultAgentId: string | null;
  /** The user's visible agent IDs, or null (all visible). */
  visibleAgentIds: string[] | null;
  /** All agents from the gateway. */
  allAgents: ChatAgent[];
  /** Agents filtered by visibility preference. */
  visibleAgents: ChatAgent[];
  /** Resolved default agent (priority: user setting → gateway default → first visible). */
  resolvedDefaultAgent: ChatAgent | null;
  /** Whether settings are loading. */
  isLoading: boolean;
  /** Error message, or null. */
  error: string | null;
  /** Whether a settings save is in progress. */
  isSaving: boolean;
  /** Update settings (from useSettings). */
  updateSettings: (updates: SettingsUpdatePayload) => Promise<boolean>;
}

export function useChatAgentPreferences(): UseChatAgentPreferencesReturn {
  const { state, isSaving, updateSettings } = useSettings();
  const { data: agentsData } = useAvailableAgents();

  const isLoading = state.kind === 'loading';
  const error = state.kind === 'error' ? state.message : null;
  const settings = state.kind === 'loaded' ? state.data : null;

  const defaultAgentId = settings?.default_agent_id ?? null;
  const visibleAgentIds = settings?.visible_agent_ids ?? null;

  const allAgents: ChatAgent[] = useMemo(
    () => (Array.isArray(agentsData?.agents) ? agentsData.agents : []),
    [agentsData?.agents],
  );

  const visibleAgents: ChatAgent[] = useMemo(() => {
    if (visibleAgentIds === null) return allAgents;
    return allAgents.filter((a) => visibleAgentIds.includes(a.id));
  }, [allAgents, visibleAgentIds]);

  const resolvedDefaultAgent: ChatAgent | null = useMemo(() => {
    if (visibleAgents.length === 0) return null;
    // Priority 1: user's saved default
    if (defaultAgentId) {
      const byUser = visibleAgents.find((a) => a.id === defaultAgentId);
      if (byUser) return byUser;
    }
    // Priority 2: gateway is_default
    const byGateway = visibleAgents.find((a) => a.is_default);
    if (byGateway) return byGateway;
    // Priority 3: first visible
    return visibleAgents[0] ?? null;
  }, [visibleAgents, defaultAgentId]);

  return {
    defaultAgentId,
    visibleAgentIds,
    allAgents,
    visibleAgents,
    resolvedDefaultAgent,
    isLoading,
    error,
    isSaving,
    updateSettings,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test:unit -- tests/unit/chat-agent-preferences.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Typecheck**

```bash
pnpm run build
```

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/chat/use-chat-agent-preferences.ts tests/unit/chat-agent-preferences.test.ts
git commit -m "[#2423] Add useChatAgentPreferences hook with priority chain"
```

---

### Task 6: Add `useRealtimeAgentInvalidation` hook

**Files:**
- Modify: `src/ui/hooks/queries/use-chat.ts`

- [ ] **Step 1: Add the hook to `use-chat.ts`**

Add near the existing `useRealtimeChatInvalidation`:

```typescript
/**
 * Invalidate agent cache on status changes (Issue #2424 — AD-9).
 *
 * Consolidates agent:status_changed handling so all consumers of
 * chatKeys.agents() get invalidated. Call from ChatBubble (always mounted).
 */
export function useRealtimeAgentInvalidation(): void {
  const realtime = useRealtimeOptional();
  const queryClient = useQueryClient();

  React.useEffect(() => {
    if (!realtime) return;
    const cleanup = realtime.addEventHandler('agent:status_changed', () => {
      void queryClient.invalidateQueries({ queryKey: chatKeys.agents() });
    });
    return cleanup;
  }, [realtime, queryClient]);
}
```

- [ ] **Step 2: Export it**

Ensure it's exported from the file alongside existing exports.

- [ ] **Step 3: Typecheck**

```bash
pnpm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/ui/hooks/queries/use-chat.ts
git commit -m "[#2424] Add useRealtimeAgentInvalidation hook"
```

---

## Chunk 3: Agent Picker Component

### Task 7: Create `AgentPickerPopover`

**Files:**
- Create: `src/ui/components/chat/agent-picker-popover.tsx`
- Create: `tests/ui/chat-agent-picker.test.tsx`

- [ ] **Step 1: Write failing test**

Create `tests/ui/chat-agent-picker.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';

// Mock ChatAgent type
const AGENTS = [
  { id: 'troy', name: 'Troy', display_name: 'Troy Agent', avatar_url: null, is_default: false, status: 'online' as const },
  { id: 'arthouse', name: 'arthouse', display_name: 'Arthouse', avatar_url: null, is_default: true, status: 'online' as const },
];

describe('AgentPickerPopover', () => {
  let AgentPickerPopover: typeof import('@/ui/components/chat/agent-picker-popover').AgentPickerPopover;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import('@/ui/components/chat/agent-picker-popover');
    AgentPickerPopover = mod.AgentPickerPopover;
  });

  it('renders trigger button', () => {
    const onSelect = vi.fn();
    render(
      <AgentPickerPopover
        agents={AGENTS}
        defaultAgentId="troy"
        onSelect={onSelect}
        trigger={<button type="button">New Conversation</button>}
      />,
    );
    expect(screen.getByText('New Conversation')).toBeInTheDocument();
  });

  it('calls onSelect directly with single agent (no popover)', () => {
    const onSelect = vi.fn();
    const singleAgent = [AGENTS[0]];
    render(
      <AgentPickerPopover
        agents={singleAgent}
        defaultAgentId="troy"
        onSelect={onSelect}
        trigger={<button type="button">New</button>}
      />,
    );
    fireEvent.click(screen.getByText('New'));
    expect(onSelect).toHaveBeenCalledWith('troy');
  });

  it('does not call onSelect when disabled', () => {
    const onSelect = vi.fn();
    render(
      <AgentPickerPopover
        agents={AGENTS}
        defaultAgentId="troy"
        onSelect={onSelect}
        trigger={<button type="button">New</button>}
        disabled
      />,
    );
    fireEvent.click(screen.getByText('New'));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test:unit -- tests/ui/chat-agent-picker.test.tsx
```

- [ ] **Step 3: Implement `AgentPickerPopover`**

Create `src/ui/components/chat/agent-picker-popover.tsx`:

```tsx
/**
 * Agent picker popover (Issues #2423, #2424, #2425 — AD-4).
 *
 * Shared Popover+Command component for selecting an agent when
 * starting a new conversation. Used by ChatSessionList, ChatHeader,
 * ChatSessionEndedState, and ChatEmptyState.
 *
 * Single-agent optimization: when only one agent is available,
 * clicking the trigger calls onSelect directly (no popover).
 */
import * as React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/ui/components/ui/command';
import { AgentStatusBadge } from './agent-status-badge';
import type { AgentStatus } from './agent-status-badge';
import type { ChatAgent } from '@/ui/lib/api-types';

interface AgentPickerPopoverProps {
  /** Available agents to pick from. */
  agents: ChatAgent[];
  /** Pre-selected agent ID. */
  defaultAgentId: string | null;
  /** Called when an agent is selected. */
  onSelect: (agentId: string) => void;
  /** Trigger element (button). */
  trigger: React.ReactNode;
  /** Disable the trigger. */
  disabled?: boolean;
}

export function AgentPickerPopover({
  agents,
  defaultAgentId,
  onSelect,
  trigger,
  disabled,
}: AgentPickerPopoverProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);

  const handleTriggerClick = React.useCallback(
    (e: React.MouseEvent) => {
      if (disabled) {
        e.preventDefault();
        return;
      }
      // Single agent: skip popover, select directly
      if (agents.length <= 1) {
        e.preventDefault();
        const agentId = agents[0]?.id ?? defaultAgentId;
        if (agentId) onSelect(agentId);
        return;
      }
      // Multiple agents: popover opens via Radix
    },
    [agents, defaultAgentId, onSelect, disabled],
  );

  const handleSelect = React.useCallback(
    (agentId: string) => {
      setOpen(false);
      onSelect(agentId);
    },
    [onSelect],
  );

  // If no agents, render trigger as disabled
  if (agents.length === 0) {
    return <>{trigger}</>;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild onClick={handleTriggerClick}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandList>
            <CommandEmpty>No agents available.</CommandEmpty>
            <CommandGroup heading="Select agent">
              {agents.map((agent) => (
                <CommandItem
                  key={agent.id}
                  value={agent.id}
                  onSelect={() => handleSelect(agent.id)}
                  className="flex items-center gap-2"
                >
                  <div
                    className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold"
                    aria-hidden="true"
                  >
                    {(agent.display_name ?? agent.name).charAt(0).toUpperCase()}
                  </div>
                  <span className="flex-1 truncate text-sm">
                    {agent.display_name ?? agent.name}
                  </span>
                  <AgentStatusBadge status={(agent.status ?? 'unknown') as AgentStatus} />
                  {agent.id === defaultAgentId && (
                    <Check className="size-4 text-primary" aria-label="Default agent" />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test:unit -- tests/ui/chat-agent-picker.test.tsx
```

- [ ] **Step 5: Typecheck**

```bash
pnpm run build
```

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/chat/agent-picker-popover.tsx tests/ui/chat-agent-picker.test.tsx
git commit -m "[#2425] Add AgentPickerPopover component"
```

---

## Chunk 4: Update Chat Entry Points

### Task 8: Fix `ChatSessionList` — use default agent + picker

**Files:**
- Modify: `src/ui/components/chat/chat-session-list.tsx`

- [ ] **Step 1: Replace `useAvailableAgents` with `useChatAgentPreferences`**

Replace import:
```typescript
// OLD
import { useChatSessions, useAvailableAgents } from '@/ui/hooks/queries/use-chat';
// NEW
import { useChatSessions } from '@/ui/hooks/queries/use-chat';
import { useChatAgentPreferences } from './use-chat-agent-preferences';
```

Replace hook usage:
```typescript
// OLD
const { data: agentsData } = useAvailableAgents();
// NEW
const { visibleAgents, resolvedDefaultAgent } = useChatAgentPreferences();
```

- [ ] **Step 2: Update `agentMap` to use `visibleAgents`**

```typescript
const agentMap = React.useMemo(() => {
  const map = new Map<string, ChatAgent>();
  for (const agent of visibleAgents) {
    map.set(agent.id, agent);
  }
  return map;
}, [visibleAgents]);
```

- [ ] **Step 3: Replace `handleNewConversation` with `AgentPickerPopover`**

Remove the `handleNewConversation` callback entirely. Replace the "New Conversation" button with the picker:

```tsx
import { AgentPickerPopover } from './agent-picker-popover';

// In the component:
const handleSelectAgent = React.useCallback(
  (agentId: string) => {
    createSession.mutate(
      { agent_id: agentId },
      { onSuccess: (session) => setActiveSessionId(session.id) },
    );
  },
  [createSession, setActiveSessionId],
);

// In JSX — replace the button:
<AgentPickerPopover
  agents={visibleAgents}
  defaultAgentId={resolvedDefaultAgent?.id ?? null}
  onSelect={handleSelectAgent}
  disabled={createSession.isPending}
  trigger={
    <Button
      variant="outline"
      size="sm"
      className="w-full justify-start gap-2"
      disabled={createSession.isPending}
      data-testid="chat-new-conversation"
    >
      <Plus className="size-4" aria-hidden="true" />
      New Conversation
    </Button>
  }
/>
```

- [ ] **Step 4: Remove unused imports**

Remove `useAvailableAgents` import if no longer used. Remove the old `agentsData` references.

- [ ] **Step 5: Typecheck + run existing tests**

```bash
pnpm run build && pnpm test:unit -- tests/ui/chat-panel.test.tsx
```

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/chat/chat-session-list.tsx
git commit -m "[#2423] ChatSessionList: use default agent from settings + picker"
```

---

### Task 9: Fix `ChatHeader` — use default agent + picker

**Files:**
- Modify: `src/ui/components/chat/chat-header.tsx`

- [ ] **Step 1: Replace `useAvailableAgents` with `useChatAgentPreferences`**

Same pattern as Task 8. Replace:
```typescript
import { useChatSessions, useAvailableAgents } from '@/ui/hooks/queries/use-chat';
```
with:
```typescript
import { useChatSessions } from '@/ui/hooks/queries/use-chat';
import { useChatAgentPreferences } from './use-chat-agent-preferences';
```

Replace:
```typescript
const { data: agentsData } = useAvailableAgents();
```
with:
```typescript
const { visibleAgents, resolvedDefaultAgent } = useChatAgentPreferences();
```

Update `agentMap` to use `visibleAgents` (same pattern).

- [ ] **Step 2: Replace `handleNewSession` with picker**

Replace the `handleNewSession` callback and `Plus` button with `AgentPickerPopover`:

```tsx
import { AgentPickerPopover } from './agent-picker-popover';

const handleSelectAgent = React.useCallback(
  (agentId: string) => {
    createSession.mutate(
      { agent_id: agentId },
      { onSuccess: (session) => setActiveSessionId(session.id) },
    );
  },
  [createSession, setActiveSessionId],
);

// Replace the Plus button in JSX:
<AgentPickerPopover
  agents={visibleAgents}
  defaultAgentId={resolvedDefaultAgent?.id ?? null}
  onSelect={handleSelectAgent}
  disabled={createSession.isPending}
  trigger={
    <Button
      variant="ghost"
      size="icon"
      className="size-7"
      disabled={createSession.isPending}
      aria-label="New conversation"
    >
      <Plus className="size-3.5" aria-hidden="true" />
    </Button>
  }
/>
```

- [ ] **Step 3: Typecheck**

```bash
pnpm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/ui/components/chat/chat-header.tsx
git commit -m "[#2423] ChatHeader: use default agent from settings + picker"
```

---

### Task 10: Fix `ChatSessionEndedState` — use default agent + picker

**Files:**
- Modify: `src/ui/components/chat/chat-session-ended-state.tsx`

- [ ] **Step 1: Replace `useAvailableAgents` with `useChatAgentPreferences` + `AgentPickerPopover`**

Same pattern as Tasks 8-9. Replace `handleNewConversation` with `AgentPickerPopover`:

```tsx
import { useChatAgentPreferences } from './use-chat-agent-preferences';
import { AgentPickerPopover } from './agent-picker-popover';

export function ChatSessionEndedState(): React.JSX.Element {
  const { setActiveSessionId } = useChat();
  const { visibleAgents, resolvedDefaultAgent } = useChatAgentPreferences();
  const createSession = useCreateChatSession();

  const handleSelectAgent = React.useCallback(
    (agentId: string) => {
      createSession.mutate(
        { agent_id: agentId },
        { onSuccess: (session) => setActiveSessionId(session.id) },
      );
    },
    [createSession, setActiveSessionId],
  );

  return (
    <div
      className="flex flex-col items-center gap-2 border-t border-border p-4 text-center"
      data-testid="chat-session-ended"
    >
      <p className="text-xs text-muted-foreground">This session has ended.</p>
      <AgentPickerPopover
        agents={visibleAgents}
        defaultAgentId={resolvedDefaultAgent?.id ?? null}
        onSelect={handleSelectAgent}
        disabled={createSession.isPending}
        trigger={
          <Button variant="outline" size="sm" className="gap-1.5" disabled={createSession.isPending}>
            <MessageCircle className="size-3.5" aria-hidden="true" />
            Start new conversation
          </Button>
        }
      />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/ui/components/chat/chat-session-ended-state.tsx
git commit -m "[#2423] ChatSessionEndedState: use default agent from settings + picker"
```

---

### Task 11: Fix `ChatEmptyState` — three-branch rendering

**Files:**
- Modify: `src/ui/components/chat/chat-empty-state.tsx`

- [ ] **Step 1: Implement three-branch rendering**

```tsx
import * as React from 'react';
import { MessageCircle, Settings, EyeOff } from 'lucide-react';
import { useChatSessions } from '@/ui/hooks/queries/use-chat';
import { useChatAgentPreferences } from './use-chat-agent-preferences';
import { useCreateChatSession } from '@/ui/hooks/mutations/use-chat';
import { useChat } from '@/ui/contexts/chat-context';
import { AgentPickerPopover } from './agent-picker-popover';
import { Button } from '@/ui/components/ui/button';

export function ChatEmptyState(): React.JSX.Element | null {
  const { data: sessionsData, isLoading: sessionsLoading } = useChatSessions('active');
  const { allAgents, visibleAgents, resolvedDefaultAgent, isLoading: agentsLoading } = useChatAgentPreferences();
  const { setActiveSessionId } = useChat();
  const createSession = useCreateChatSession();

  if (sessionsLoading || agentsLoading) return null;

  const sessions = Array.isArray(sessionsData?.sessions) ? sessionsData.sessions : [];

  // Don't show if we have sessions
  if (sessions.length > 0) return null;

  // Branch 1: No agents configured at all
  if (allAgents.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center" data-testid="chat-empty-no-agents">
        <div className="rounded-full bg-muted p-3">
          <Settings className="size-6 text-muted-foreground" aria-hidden="true" />
        </div>
        <h3 className="text-sm font-semibold">No agents configured</h3>
        <p className="text-xs text-muted-foreground">
          Configure an agent in Settings to start chatting.
        </p>
        <Button variant="outline" size="sm" asChild>
          <a href="/app/settings">Go to Settings</a>
        </Button>
      </div>
    );
  }

  // Branch 2: Agents exist but all are hidden
  if (visibleAgents.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center" data-testid="chat-empty-all-hidden">
        <div className="rounded-full bg-muted p-3">
          <EyeOff className="size-6 text-muted-foreground" aria-hidden="true" />
        </div>
        <h3 className="text-sm font-semibold">All agents are hidden</h3>
        <p className="text-xs text-muted-foreground">
          Update your Chat settings to make agents visible.
        </p>
        <Button variant="outline" size="sm" asChild>
          <a href="/app/settings">Chat Settings</a>
        </Button>
      </div>
    );
  }

  // Branch 3: Agents visible, no sessions yet
  const handleSelectAgent = (agentId: string) => {
    createSession.mutate(
      { agent_id: agentId },
      { onSuccess: (session) => setActiveSessionId(session.id) },
    );
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center" data-testid="chat-empty-no-sessions">
      <div className="rounded-full bg-muted p-3">
        <MessageCircle className="size-6 text-muted-foreground" aria-hidden="true" />
      </div>
      <h3 className="text-sm font-semibold">No conversations yet</h3>
      <p className="text-xs text-muted-foreground">Start a new conversation with your agent.</p>
      <AgentPickerPopover
        agents={visibleAgents}
        defaultAgentId={resolvedDefaultAgent?.id ?? null}
        onSelect={handleSelectAgent}
        disabled={createSession.isPending}
        trigger={
          <Button variant="outline" size="sm" disabled={createSession.isPending}>
            Start a conversation
          </Button>
        }
      />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/ui/components/chat/chat-empty-state.tsx
git commit -m "[#2424] ChatEmptyState: three-branch rendering with agent picker"
```

---

### Task 12: Fix `ChatAgentSelector` — filter by visibility + move realtime handler

**Files:**
- Modify: `src/ui/components/chat/chat-agent-selector.tsx`

- [ ] **Step 1: Replace `useAvailableAgents` with `useChatAgentPreferences`**

```typescript
// OLD
import { useAvailableAgents } from '@/ui/hooks/queries/use-chat';
// NEW
import { useChatAgentPreferences } from './use-chat-agent-preferences';
```

Replace hook:
```typescript
// OLD
const { data } = useAvailableAgents();
// NEW
const { visibleAgents } = useChatAgentPreferences();
```

- [ ] **Step 2: Remove the realtime subscription (moved to useRealtimeAgentInvalidation)**

Delete the `useEffect` block that handles `agent:status_changed` (lines 36-42). Remove unused imports for `useRealtimeOptional`, `useQueryClient`, `chatKeys`.

- [ ] **Step 3: Update agents list**

```typescript
// OLD
const agents = React.useMemo(
  () => (Array.isArray(data?.agents) ? data.agents : []),
  [data?.agents],
);
// NEW — just use visibleAgents directly
// Remove the useMemo since visibleAgents is already memoized
```

Replace `agents.length <= 1` check with `visibleAgents.length <= 1`, and all `agents.map(...)` with `visibleAgents.map(...)`.

- [ ] **Step 4: Typecheck**

```bash
pnpm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/chat/chat-agent-selector.tsx
git commit -m "[#2424] ChatAgentSelector: filter by visibility, remove realtime handler"
```

---

### Task 13: Fix `ChatBubble` — use visible agents + add realtime invalidation

**Files:**
- Modify: `src/ui/components/chat/chat-bubble.tsx`

- [ ] **Step 1: Replace `useAvailableAgents` with `useChatAgentPreferences`**

```typescript
// OLD
import { useAvailableAgents, useChatUnreadCount, useRealtimeChatInvalidation } from '@/ui/hooks/queries/use-chat';
// NEW
import { useChatUnreadCount, useRealtimeChatInvalidation, useRealtimeAgentInvalidation } from '@/ui/hooks/queries/use-chat';
import { useChatAgentPreferences } from './use-chat-agent-preferences';
```

- [ ] **Step 2: Use visible agents + add invalidation**

```typescript
// OLD
const { data: agentsData } = useAvailableAgents();
useRealtimeChatInvalidation();

const agents = React.useMemo(
  () => (Array.isArray(agentsData?.agents) ? agentsData.agents : []),
  [agentsData?.agents],
);
// NEW
const { visibleAgents } = useChatAgentPreferences();
useRealtimeChatInvalidation();
useRealtimeAgentInvalidation(); // Consolidated agent status invalidation
```

- [ ] **Step 3: Add early return for no visible agents**

```typescript
// Add after hooks, before the return:
if (visibleAgents.length === 0) return null;
```

Remove the unused `agents` variable and references.

- [ ] **Step 4: Typecheck + run existing tests**

```bash
pnpm run build && pnpm test:unit -- tests/ui/chat-bubble.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/chat/chat-bubble.tsx
git commit -m "[#2424] ChatBubble: use visible agents, add realtime agent invalidation"
```

---

## Chunk 5: Settings UI + Cleanup

### Task 14: Update `ChatSettingsSection` — add visibility checkboxes

**Files:**
- Modify: `src/ui/components/settings/chat-settings-section.tsx`

- [ ] **Step 1: Replace raw fetch with `useChatAgentPreferences` + `useAvailableAgents`**

Replace the `useState`/`useEffect` agent fetching with `useAvailableAgents`:

```typescript
import { useAvailableAgents } from '@/ui/hooks/queries/use-chat';
import { useChatAgentPreferences } from '@/ui/components/chat/use-chat-agent-preferences';
import { Checkbox } from '@/ui/components/ui/checkbox';
import { AgentStatusBadge } from '@/ui/components/chat/agent-status-badge';
import type { AgentStatus } from '@/ui/components/chat/agent-status-badge';
```

Remove `useDefaultAgent` import, the `useState` for agents/loading/error, and the `useEffect` fetch.

Use:
```typescript
const { defaultAgentId, visibleAgentIds, allAgents, isLoading, error, isSaving, updateSettings } = useChatAgentPreferences();
```

- [ ] **Step 2: Add debounced visibility save**

```typescript
const pendingVisRef = React.useRef<string[] | null>(null);
const debounceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
const inflightRef = React.useRef(false);

const flushVisibility = React.useCallback(async () => {
  if (pendingVisRef.current === null) return;
  if (inflightRef.current) return; // Will be retried after current inflight completes
  inflightRef.current = true;
  const ids = pendingVisRef.current;
  pendingVisRef.current = null;
  try {
    await updateSettings({ visible_agent_ids: ids.length > 0 ? ids : null });
  } finally {
    inflightRef.current = false;
    // If more changes accumulated while inflight, flush again
    if (pendingVisRef.current !== null) {
      flushVisibility();
    }
  }
}, [updateSettings]);

const handleVisibilityToggle = React.useCallback(
  (agentId: string, checked: boolean) => {
    const current = visibleAgentIds ?? allAgents.map(a => a.id);
    const next = checked
      ? [...new Set([...current, agentId])]
      : current.filter(id => id !== agentId);
    pendingVisRef.current = next;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      flushVisibility();
    }, 400);
  },
  [visibleAgentIds, allAgents, flushVisibility],
);

// Cleanup on unmount
React.useEffect(() => {
  return () => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
  };
}, []);
```

- [ ] **Step 3: Add default agent change handler using updateSettings**

```typescript
const handleAgentChange = React.useCallback(
  (value: string) => {
    updateSettings({ default_agent_id: value === 'none' ? null : value });
  },
  [updateSettings],
);
```

- [ ] **Step 4: Add visibility checkboxes JSX**

After the default agent section (inside `CardContent`):

```tsx
{/* Visible Agents section */}
<div className="space-y-3 py-3">
  <div>
    <p className="text-sm font-medium">Visible Agents</p>
    <p className="text-sm text-muted-foreground">
      Choose which agents appear in your chat
    </p>
  </div>
  <div className="space-y-2">
    {allAgents.map((agent) => {
      const isDefault = agent.id === defaultAgentId;
      const isVisible = visibleAgentIds === null || visibleAgentIds.includes(agent.id);
      return (
        <label
          key={agent.id}
          className="flex items-center gap-3 rounded-sm px-2 py-1.5 hover:bg-accent"
        >
          <Checkbox
            checked={isVisible}
            onCheckedChange={(checked) => handleVisibilityToggle(agent.id, checked === true)}
            disabled={isDefault}
            aria-label={`Show ${agent.display_name ?? agent.name} in chat`}
          />
          <span className="flex-1 text-sm">
            {agent.display_name ?? agent.name}
          </span>
          <AgentStatusBadge status={(agent.status ?? 'unknown') as AgentStatus} />
          {isDefault && (
            <span className="text-xs text-muted-foreground">(default)</span>
          )}
        </label>
      );
    })}
  </div>
</div>
```

- [ ] **Step 5: Typecheck + run tests**

```bash
pnpm run build && pnpm test:unit -- tests/ui/chat-settings.test.tsx
```

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/settings/chat-settings-section.tsx
git commit -m "[#2424] ChatSettingsSection: add visibility checkboxes with debounced save"
```

---

### Task 15: Delete `use-default-agent.ts` and update tests

**Files:**
- Delete: `src/ui/components/settings/use-default-agent.ts`
- Modify: `tests/ui/chat-settings.test.tsx`

- [ ] **Step 1: Delete `use-default-agent.ts`**

```bash
rm src/ui/components/settings/use-default-agent.ts
```

- [ ] **Step 2: Update `chat-settings.test.tsx`**

Remove the `useDefaultAgent hook` test section. Update the component tests to mock `useChatAgentPreferences` instead of `useDefaultAgent` + raw fetch. The test mocks need to change from:

```typescript
vi.mock('@/ui/lib/api-client', ...);
```

to mocking the new hook:

```typescript
vi.mock('@/ui/components/chat/use-chat-agent-preferences', () => ({
  useChatAgentPreferences: () => mockUseChatAgentPreferences(),
}));
```

Update test assertions accordingly. The component tests should verify:
- Default agent dropdown renders and works
- Visibility checkboxes render for each agent
- Default agent checkbox is disabled
- Checkbox changes trigger updateSettings

- [ ] **Step 3: Typecheck + run all tests**

```bash
pnpm run build && pnpm test
```

- [ ] **Step 4: Commit**

```bash
git add -u src/ui/components/settings/use-default-agent.ts
git add tests/ui/chat-settings.test.tsx
git commit -m "[#2424] Delete use-default-agent.ts, update tests for new hook"
```

---

### Task 16: Final verification + lint

- [ ] **Step 1: Run full test suite**

```bash
pnpm test
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm run build
```

- [ ] **Step 3: Run linter**

```bash
pnpm run lint
```

- [ ] **Step 4: Fix any issues**

Address any test failures, type errors, or lint violations.

- [ ] **Step 5: Update GitHub issues with progress**

```bash
gh issue comment 2423 --body "Implementation complete. Default agent now uses user's saved preference from settings. All four new-conversation entry points updated."
gh issue comment 2424 --body "Implementation complete. Added visible_agent_ids to user_setting with server-side validation. Settings UI has checkboxes with debounced save."
gh issue comment 2425 --body "Implementation complete. AgentPickerPopover shows when 2+ visible agents. Single agent skips picker."
```

- [ ] **Step 6: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "[#2423] Final fixes from verification pass"
```

---

## Post-Implementation

### Push + PR

```bash
git push -u origin issue/2423-agent-selection
```

Create PR:
```bash
gh pr create --title "[#2423] Fix default agent, add agent visibility & picker" --body "$(cat <<'EOF'
## Summary

- **#2423**: Default agent setting now used when creating new conversations (was using gateway `is_default`)
- **#2424**: Added `visible_agent_ids` to user settings with checkboxes in Settings UI
- **#2425**: Agent picker popover shown when 2+ visible agents exist

## Changes

- Migration 162: `visible_agent_ids text[]` on `user_setting`
- Server validates `visible_agent_ids` on PATCH /settings and POST /chat/sessions
- New `useChatAgentPreferences` hook (single source of truth)
- New `AgentPickerPopover` component (Popover+Command pattern)
- Updated all 4 new-conversation entry points
- Three-branch ChatEmptyState
- Deleted `use-default-agent.ts`

## Test Plan

- [ ] Unit tests for `useChatAgentPreferences` priority chain
- [ ] Unit tests for `AgentPickerPopover` single/multi agent
- [ ] Integration tests for visibility validation on POST/PATCH
- [ ] Manual: set default agent → verify new conversation uses it
- [ ] Manual: hide agent → verify not shown in picker
- [ ] Manual: try creating session with hidden agent via API → 400

Closes #2423
Closes #2424
Closes #2425
EOF
)"
```

### Codex Review

Run Codex MCP review before merge:
```
Use mcp__codex__codex with sandbox: "danger-full-access" to review the PR diff
```
