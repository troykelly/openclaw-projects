# Chat Agent Selection & Visibility — Design Spec

**Date:** 2026-03-11
**Issues:** #2423, #2424, #2425
**Status:** Draft

---

## Problem Statement

Three related issues with chat agent selection in the Web UI:

1. **#2423**: Default agent setting ignored — new conversations use gateway `is_default` instead of user's saved preference
2. **#2424**: No agent visibility preferences — users cannot control which agents appear in chat
3. **#2425**: No agent picker — users cannot choose which agent to start a conversation with

## Architecture Decisions

### AD-1: Server-side enforcement of visibility (H1, H2, L2)

Client-side filtering is cosmetic. The server MUST:
- Validate `agent_id` against `visible_agent_ids` on `POST /chat/sessions` (NULL = all allowed)
- Validate `default_agent_id` is in `visible_agent_ids` on `PATCH /settings`
- Validate `visible_agent_ids` entries: dedup, max length (50), non-empty strings, max element length (255)
- Enforce invariant: `default_agent_id` must be NULL or present in `visible_agent_ids`

### AD-2: Single settings source of truth (H5, M5)

Do NOT rename or expand `useDefaultAgent`. Instead:
- Add `visible_agent_ids` to `UserSettings` interface and `SettingsUpdatePayload` in `src/ui/components/settings/types.ts`
- Create a new `useChatAgentPreferences` hook that derives from the existing `useSettings` hook
  - **NOTE:** `useSettings` returns `{ state, isSaving, updateSettings }` where `state` is a discriminated union `{ kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'loaded'; data: UserSettings }` — NOT TanStack Query shape
  - `useChatAgentPreferences` must destructure accordingly (see New Hooks section)
  - `useSettings` uses raw `useEffect`/`useState`, NOT TanStack Query — each mount triggers its own `/settings` fetch. This is acceptable for now as settings are only mounted once in the settings page and once in chat components. Migrating `useSettings` to TanStack Query is out of scope.
- `ChatSettingsSection` switches from raw `apiClient.get` to `useAvailableAgents()` for the agent list
- Delete `use-default-agent.ts` — its functionality moves into `useChatAgentPreferences`
- **File path note:** `useChatAgentPreferences` lives at `src/ui/components/chat/use-chat-agent-preferences.ts` (co-located with chat components, avoids cross-layer import from `hooks/queries/` → `components/settings/`)

### AD-3: Debounced array saves (H3)

Visibility checkboxes use a 400ms debounce for the PATCH call:
- Rapid checkbox toggles accumulate locally
- After 400ms of no activity, a single PATCH sends the final state
- Optimistic UI shows changes immediately
- On failure, rollback to last confirmed server state
- Only one PATCH in flight at a time (queue if debounce fires during inflight request)

### AD-4: Shared agent picker component using Popover+Command (M4, H4)

Create a single `AgentPickerPopover` component using the existing `Popover + Command` pattern (per `inbound-routing-section.tsx`). Used by ALL four entry points:
- `chat-session-list.tsx` — "New Conversation" button
- `chat-header.tsx` — "+" button
- `chat-session-ended-state.tsx` — "Start new conversation" button (MISSED in original design)
- `chat-empty-state.tsx` — CTA when no sessions

### AD-5: Agent visibility applies everywhere (M2)

`ChatAgentSelector` (active session agent switcher) also filters by `visible_agent_ids`. Visibility is a user preference that applies globally to the chat UI — not just to new conversation creation.

### AD-6: Stale agent ID normalization (M3)

On read/display:
- `visible_agent_ids` entries that don't match any current agent are silently ignored (filtered out)
- `default_agent_id` that doesn't match any current agent falls back to gateway `is_default`, then first visible agent
- Settings UI shows only current agents (stale IDs not displayed)

On save:
- Server normalizes `visible_agent_ids` by deduping and stripping empty strings
- Server does NOT validate against gateway agent list (agents are transient; user settings are persistent)
- Client sends only agent IDs from the current agent list

### AD-7: Three-branch empty state (M1)

`ChatEmptyState` now distinguishes:
1. `agents.length === 0` → "No agents configured" + link to Settings
2. `visibleAgents.length === 0 && agents.length > 0` → "All agents are hidden. Update your Chat settings to make agents visible." + link to Chat settings
3. `visibleAgents.length > 0 && sessions.length === 0` → "No conversations yet" + agent picker CTA

### AD-8: Namespace scoping (M6)

`visible_agent_ids` is a global (not per-namespace) preference. This matches `default_agent_id` behavior. The agent list is namespace-scoped, so filtering happens after namespace resolution. This means a user's visibility preference may include IDs not present in the current namespace — those are silently filtered out (same as AD-6).

### AD-9: Realtime invalidation consolidation (L3)

Create a new `useRealtimeAgentInvalidation()` hook (separate from `useRealtimeChatInvalidation()` which handles session-level events). Move `agent:status_changed` handler from `ChatAgentSelector` into this new hook. Call `useRealtimeAgentInvalidation()` from `ChatBubble` (already rendered on all pages) so all consumers of `chatKeys.agents()` get invalidated.

### AD-10: Popover loading state (L1)

When agents are loading, the "New Conversation" button:
- Shows a loading spinner in the button
- Clicking while loading is disabled
- Once loaded, if single visible agent: create directly; if multiple: show popover

### AD-11: Avatar URL handling (L4)

Agent `avatar_url` from gateway is rendered via `<img>` tags. To prevent tracking:
- Add `referrerpolicy="no-referrer"` to avatar images
- Existing pattern in the codebase should be followed

---

## Database Changes

### Migration 162: `user_setting_visible_agents`

Files:
- `migrations/162_user_setting_visible_agents.up.sql`
- `migrations/162_user_setting_visible_agents.down.sql`

```sql
-- UP (migrations/162_user_setting_visible_agents.up.sql)
ALTER TABLE user_setting
  ADD COLUMN IF NOT EXISTS visible_agent_ids text[];

COMMENT ON COLUMN user_setting.visible_agent_ids IS
  'Agent IDs visible in chat UI. NULL = all agents visible.';

-- DOWN (migrations/162_user_setting_visible_agents.down.sql)
ALTER TABLE user_setting
  DROP COLUMN IF EXISTS visible_agent_ids;
```

No default value — NULL means all visible (backward compatible).

---

## API Changes

### GET /settings

Response adds:
```typescript
{
  // existing fields...
  default_agent_id: string | null;
  visible_agent_ids: string[] | null; // NEW — null = all visible
}
```

### PATCH /settings

Accepts:
```typescript
{
  default_agent_id?: string | null;
  visible_agent_ids?: string[] | null; // NEW
}
```

Server-side validation:
1. If `visible_agent_ids` provided:
   - Must be array or null
   - Dedup entries
   - Max 50 entries
   - Each entry: non-empty string, max 255 chars
2. If both `default_agent_id` and `visible_agent_ids` provided:
   - `default_agent_id` must be in `visible_agent_ids` (or null)
3. If only `default_agent_id` provided and `visible_agent_ids` already set:
   - New `default_agent_id` must be in existing `visible_agent_ids` (or null)
4. If only `visible_agent_ids` provided and `default_agent_id` already set:
   - Existing `default_agent_id` must be in new `visible_agent_ids` (auto-add if missing, don't reject)

**Implementation note for PATCH /settings:** The existing `params` array is typed as `(string | boolean | number | null)[]`. For `visible_agent_ids` (a `text[]` column), the handler must:
- Handle `visible_agent_ids` separately from the `allowedFields` loop (not push `string[]` into scalar params)
- Use `$N::text[]` cast in the SQL for the array parameter
- Widen the `params` type to `unknown[]` or handle the array field in a separate SQL clause
- Add `visible_agent_ids` to the `body` type annotation in the handler

### POST /chat/sessions

After resolving `agentId` (existing logic), add:
```typescript
// Validate against visible_agent_ids
const visResult = await pool.query(
  `SELECT visible_agent_ids FROM user_setting WHERE email = $1`,
  [userEmail],
);
const visibleIds: string[] | null = visResult.rows[0]?.visible_agent_ids ?? null;
if (visibleIds !== null && !visibleIds.includes(agentId)) {
  return reply.code(400).send({ error: 'Agent is not in your visible agents list' });
}
```

---

## UI Components

### New: `AgentPickerPopover`

Location: `src/ui/components/chat/agent-picker-popover.tsx`

Uses shadcn `Popover` + `Command` pattern:
```tsx
interface AgentPickerPopoverProps {
  agents: ChatAgent[];
  defaultAgentId: string | null;
  onSelect: (agentId: string) => void;
  trigger: React.ReactNode;
  disabled?: boolean;
}
```

- Shows agent list with `display_name`, `name`, and `AgentStatusBadge`
- Pre-selects default agent
- Keyboard navigable (Command handles this)
- Single agent: bypasses popover, calls `onSelect` directly

### Modified: `ChatSettingsSection`

Add "Visible Agents" section below "Default Agent":
- Checkbox list of all agents from `useAvailableAgents()`
- Default agent checkbox: checked + disabled
- Each checkbox: agent `display_name ?? name` + `AgentStatusBadge`
- Changes debounced (400ms) before PATCH

### Modified: `ChatSessionList`, `ChatHeader`, `ChatSessionEndedState`

Replace direct `createSession.mutate({ agent_id: defaultAgent?.id })` with `AgentPickerPopover` usage:
- Read `defaultAgentId` and `visibleAgentIds` from `useChatAgentPreferences()`
- Filter agents by visibility
- If 1 visible agent: create directly with that agent
- If 2+ visible agents: show `AgentPickerPopover`

### Modified: `ChatEmptyState`

Three-branch rendering (see AD-7). When visible agents exist but no sessions, show `AgentPickerPopover` as CTA.

### Modified: `ChatAgentSelector`

Filter displayed agents by `visible_agent_ids` (AD-5).

### Modified: `ChatBubble`

**Current behavior note:** `ChatBubble` currently fetches agents via `useAvailableAgents()` but does NOT hide itself when `agents.length === 0` — it always renders. The change needed is:
- Import `useChatAgentPreferences` instead of `useAvailableAgents`
- Add early return `if (visibleAgents.length === 0) return null` — hide bubble when no visible agents
- Call `useRealtimeAgentInvalidation()` here (consolidation point for agent status updates)

---

## New Hooks

### `useChatAgentPreferences`

Location: `src/ui/components/chat/use-chat-agent-preferences.ts`

Derives from `useSettings()` (co-located with chat components to avoid cross-layer imports):
```typescript
import { useMemo } from 'react';
import { useSettings } from '@/ui/components/settings/use-settings';
import { useAvailableAgents } from '@/ui/hooks/queries/use-chat';
import type { ChatAgent } from '@/ui/lib/api-types';

export function useChatAgentPreferences() {
  // useSettings returns { state, isSaving, updateSettings }
  // state is discriminated: { kind: 'loading' } | { kind: 'error'; message } | { kind: 'loaded'; data }
  const { state, isSaving, updateSettings } = useSettings();
  const { data: agentsData } = useAvailableAgents();

  const isLoading = state.kind === 'loading';
  const error = state.kind === 'error' ? state.message : null;
  const settings = state.kind === 'loaded' ? state.data : null;

  const defaultAgentId = settings?.default_agent_id ?? null;
  const visibleAgentIds = settings?.visible_agent_ids ?? null;

  const allAgents = useMemo(
    () => (Array.isArray(agentsData?.agents) ? agentsData.agents : []),
    [agentsData?.agents],
  );

  const visibleAgents: ChatAgent[] = useMemo(() => {
    if (visibleAgentIds === null) return allAgents;
    return allAgents.filter(a => visibleAgentIds.includes(a.id));
  }, [allAgents, visibleAgentIds]);

  const resolvedDefaultAgent: ChatAgent | null = useMemo(() => {
    if (visibleAgents.length === 0) return null;
    // Priority: user setting → gateway is_default → first visible
    const byUserSetting = defaultAgentId
      ? visibleAgents.find(a => a.id === defaultAgentId)
      : undefined;
    if (byUserSetting) return byUserSetting;
    const byGateway = visibleAgents.find(a => a.is_default);
    if (byGateway) return byGateway;
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

---

## Type Changes

### `src/ui/components/settings/types.ts`

Add to `UserSettings` interface:
```typescript
visible_agent_ids: string[] | null;
```

Add to `SettingsUpdatePayload` Pick list:
```typescript
| 'visible_agent_ids'
```

---

## Cleanup

### Delete: `use-default-agent.ts`

All consumers migrate to `useChatAgentPreferences`.

### Move: Realtime invalidation

Create `useRealtimeAgentInvalidation()` hook in `src/ui/hooks/queries/use-chat.ts`. Move `agent:status_changed` handler from `ChatAgentSelector` into this new hook. Call from `ChatBubble`.

---

## Testing Plan

### Unit Tests
- `useChatAgentPreferences` — priority chain, filtering, null handling, stale ID filtering
- `AgentPickerPopover` — render agents, pre-select default, single-agent bypass, keyboard nav
- `ChatSettingsSection` — checkbox rendering, default disabled, debounced save, **debounce fires while prior PATCH in flight → queued not dropped**
- `ChatEmptyState` — three-branch rendering (**branch order matters**: `sessions.length > 0` early-return must stay first, then `agents.length === 0`, then `visibleAgents.length === 0`, then "no sessions")

### Integration Tests
- `POST /chat/sessions` — rejects hidden agent, accepts visible agent, NULL = all allowed
- `PATCH /settings` — validates `default_agent_id` in `visible_agent_ids`, dedup, bounds
- `GET /settings` — returns `visible_agent_ids`
- Migration 162 — up/down

### E2E Tests (if time permits)
- Set default agent → create conversation → verify correct agent
- Hide agent → verify not shown in picker → verify session creation rejected

---

## Peer Review Findings Addressed

| Finding | Resolution |
|---------|-----------|
| H1: No server-side enforcement | AD-1: Server validates on POST /chat/sessions |
| H2: No PATCH validation | AD-1: Server validates invariants on PATCH /settings |
| H3: Race condition on array saves | AD-3: 400ms debounce with queue |
| H4: Missed entry point | AD-4: All four entry points use shared component |
| H5: Hook state duplication | AD-2: Single source of truth via useSettings |
| M1: Missing empty state branch | AD-7: Three-branch empty state |
| M2: ChatAgentSelector ignores visibility | AD-5: Visibility applies everywhere |
| M3: Stale agent IDs | AD-6: Normalization on read, sanitization on save |
| M4: Use Popover+Command | AD-4: Follows existing pattern |
| M5: Settings fetches outside TanStack Query | AD-2: Migrates to useAvailableAgents |
| M6: Namespace scoping | AD-8: Global preference, filtered after namespace |
| L1: Popover loading state | AD-10: Disabled + spinner while loading |
| L2: Default-always-visible client-only | AD-1: Server enforces invariant |
| L3: Realtime invalidation duplication | AD-9: New useRealtimeAgentInvalidation hook |
| L4: Avatar URL privacy | AD-11: referrerpolicy="no-referrer" |

---

## Spec Review Fixes Applied

| # | Issue | Fix |
|---|-------|-----|
| SR-1 | `useSettings` return shape mismatched | Fixed `useChatAgentPreferences` to use `{ state, isSaving, updateSettings }` discriminated union |
| SR-2 | `visible_agent_ids` missing from types | Added explicit "Type Changes" section for `types.ts` |
| SR-3 | Migration path not specified | Added file paths to migration section |
| SR-4 | PATCH /settings params type incompatible | Added implementation note for array handling |
| SR-5 | ChatBubble behavior described inaccurately | Updated description with accurate current behavior |
| SR-6 | Cross-layer import concern | Moved hook to `src/ui/components/chat/` |
| SR-7 | agent:status_changed mixes concerns | Changed to separate `useRealtimeAgentInvalidation` hook |
| SR-8 | ChatEmptyState branch ordering not explicit | Added ordering note to testing plan |
| SR-9 | Debounce concurrent-request test missing | Added explicit test case |
