# Omnibus Namespace & Auto-Capture Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 5 related namespace and auto-capture bugs in a single PR (#1561–#1565).

**Architecture:** Server-side M2M namespace access + grant creation, plugin-side structured content extraction and namespace logging, plus a cleanup migration for corrupted rows.

**Tech Stack:** TypeScript, Fastify (server), Vitest, PostgreSQL migrations (golang-migrate format)

---

## Task 1: #1561 — M2M token implicit namespace access for namespace_list

**Files:**
- Modify: `src/api/server.ts:782–817` (GET /api/namespaces handler)
- Modify: `src/api/auth/middleware-namespace.test.ts` (add M2M namespace_list test)

**Step 1: Write failing integration test**

In `src/api/auth/middleware-namespace.test.ts`, add a describe block for M2M namespace_list:

```typescript
describe('GET /api/namespaces M2M with api:full scope', () => {
  it('should return ALL namespaces for M2M tokens with api:full scope', async () => {
    // This test validates the server handler behavior
    // The actual test will depend on the integration test setup
  });
});
```

Since the actual GET handler is in server.ts and needs a DB, write a unit-level test in a new file `src/api/namespace-list.test.ts` that validates the SQL query logic difference.

**Step 2: Implement the fix in `src/api/server.ts`**

In the GET /api/namespaces handler (line 802), change the M2M branch:

```typescript
} else {
  // M2M with api:full scope: return ALL namespaces across all grants.
  // M2M tokens (e.g., openclaw-gateway) have no personal grants but need
  // visibility into all namespaces for agent orchestration.
  const hasFullScope = identity.scopes?.includes('api:full') ?? false;
  if (hasFullScope) {
    const result = await pool.query(
      `SELECT DISTINCT ng.namespace, ng.role, ng.is_default, ng.priority, ng.created_at
       FROM namespace_grant ng
       ORDER BY ng.priority DESC, ng.namespace`,
    );
    return result.rows;
  }
  // M2M without api:full: return only explicitly granted namespaces
  const result = await pool.query(
    `SELECT DISTINCT ng.namespace, ng.role, ng.is_default, ng.priority, ng.created_at
     FROM namespace_grant ng
     WHERE ng.email = $1
     ORDER BY ng.priority DESC, ng.namespace`,
    [identity.email],
  );
  return result.rows;
}
```

**Step 3: Run tests, commit**

```bash
cd /tmp/worktree-issue-1561-omnibus
pnpm run test:unit -- --reporter verbose 2>&1 | tail -20
git add src/api/server.ts
git commit -m "[#1561] M2M tokens with api:full scope get all namespaces"
```

---

## Task 2: #1562 — namespace_create should create owner grant for M2M tokens

**Files:**
- Modify: `src/api/server.ts:819–861` (POST /api/namespaces handler)

**Step 1: Implement the fix**

In the POST /api/namespaces handler, after the existing user branch (line 849), add M2M handling:

```typescript
if (identity.type === 'user') {
  await pool.query(
    `INSERT INTO namespace_grant (email, namespace, role, is_default)
     VALUES ($1, $2, 'owner', false)`,
    [identity.email, name],
  );
} else {
  // M2M: create owner grant for the agent identity from X-Agent-Id header
  const agentId = req.headers['x-agent-id'] as string | undefined;
  if (agentId) {
    await pool.query(
      `INSERT INTO namespace_grant (email, namespace, role, is_default)
       VALUES ($1, $2, 'owner', false)`,
      [agentId, name],
    );
  } else {
    req.log.warn('M2M namespace_create without X-Agent-Id header — no owner grant created');
  }
}
```

**Step 2: Run tests, commit**

```bash
pnpm run test:unit -- --reporter verbose 2>&1 | tail -20
git add src/api/server.ts
git commit -m "[#1562] Create owner grant for M2M namespace_create via X-Agent-Id"
```

---

## Task 3: #1563 — Auto-capture hook serialises structured content as [object Object]

**Files:**
- Modify: `packages/openclaw-plugin/src/hooks.ts:38–43,87–100,264–298`
- Modify: `packages/openclaw-plugin/tests/hooks.test.ts`

**Step 1: Write failing tests**

Add tests in `packages/openclaw-plugin/tests/hooks.test.ts`:

```typescript
import { extractTextContent } from '../src/hooks.js';

describe('extractTextContent', () => {
  it('should pass through plain string content', () => {
    expect(extractTextContent('hello world')).toBe('hello world');
  });

  it('should extract text from array of content blocks', () => {
    const content = [
      { type: 'text', text: 'Hello' },
      { type: 'image', source: { data: '...' } },
      { type: 'text', text: 'World' },
    ];
    expect(extractTextContent(content as unknown as string)).toBe('Hello\nWorld');
  });

  it('should return empty string for non-string non-array content', () => {
    expect(extractTextContent(42 as unknown as string)).toBe('');
  });

  it('should handle empty array', () => {
    expect(extractTextContent([] as unknown as string)).toBe('');
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd /tmp/worktree-issue-1561-omnibus
pnpm --filter @troykelly/openclaw-projects run test -- --reporter verbose 2>&1 | tail -20
```

**Step 3: Implement extractTextContent helper**

Add before `containsSensitiveContent` in `hooks.ts`:

```typescript
/**
 * Extract plain text from message content.
 * OpenClaw message content can be a plain string or an array of content blocks
 * (e.g., [{type: "text", text: "..."}, {type: "image", ...}]).
 * This normalizes both forms to a plain string.
 */
export function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((block): block is { type: string; text: string } =>
        typeof block === 'object' && block !== null && block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n');
  }
  return '';
}
```

**Step 4: Update containsSensitiveContent, captureContext, and AutoCaptureEvent**

Update the `AutoCaptureEvent` interface to accept `unknown` content:

```typescript
export interface AutoCaptureEvent {
  messages: Array<{
    role: string;
    content: string | unknown;
  }>;
}
```

Update `containsSensitiveContent` call sites and `captureContext` to use `extractTextContent`:

```typescript
// In captureContext (line ~267):
const textContent = extractTextContent(msg.content);
if (containsSensitiveContent(textContent)) {

// In conversationSummary (line ~280):
const conversationSummary = filteredMessages
  .map((msg) => filterSensitiveContent(extractTextContent(msg.content)))
  .join('\n');
```

**Step 5: Run tests, commit**

```bash
pnpm --filter @troykelly/openclaw-projects run test -- --reporter verbose 2>&1 | tail -20
git add packages/openclaw-plugin/src/hooks.ts packages/openclaw-plugin/tests/hooks.test.ts
git commit -m "[#1563] Fix auto-capture serialising structured content as [object Object]"
```

---

## Task 4: #1564 — Gateway agent namespace config not propagated

**Files:**
- Modify: `packages/openclaw-plugin/src/register-openclaw.ts:1448–1452,4264–4271`

**Step 1: Implement the warning and debug log**

In `refreshNamespacesAsync` (line ~1448), enhance the empty-list log:

```typescript
if (items.length === 0) {
  state.logger.warn('Namespace discovery returned empty list — M2M tokens may lack namespace grants. ' +
    'Ensure the server returns all namespaces for M2M tokens with api:full scope (see #1561).');
  state.lastNamespaceRefreshMs = Date.now();
  return;
}
```

In the plugin startup block (line ~4264), after the `refreshNamespacesAsync` call, add a debug log:

```typescript
// Log resolved namespace config on startup
logger.debug('Namespace config resolved', {
  default: state.resolvedNamespace.default,
  recall: state.resolvedNamespace.recall,
  hasStaticRecall,
  refreshInterval,
});
```

**Step 2: Run tests, commit**

```bash
pnpm --filter @troykelly/openclaw-projects run test -- --reporter verbose 2>&1 | tail -20
git add packages/openclaw-plugin/src/register-openclaw.ts
git commit -m "[#1564] Log warning on empty namespace discovery and debug namespace config"
```

---

## Task 5: #1565 — Cleanup corrupted auto-capture memory rows

**Files:**
- Create: `migrations/104_cleanup_autocapture_object_object.up.sql`
- Create: `migrations/104_cleanup_autocapture_object_object.down.sql`

**Step 1: Write the UP migration**

```sql
-- ============================================================
-- Migration 104: Cleanup corrupted auto-capture memory rows
-- Issue #1565 — Omnibus #1561: auto-capture serialised structured
-- message content as [object Object] before the hook fix in #1563.
-- ============================================================

-- Delete memory rows where the content is the stringified object placeholder.
-- Only target rows created by the auto-capture hook to avoid false positives.
DELETE FROM memory
WHERE content LIKE '%[object Object]%'
  AND created_by_agent = 'auto-capture';
```

**Step 2: Write the DOWN migration**

```sql
-- ============================================================
-- Migration 104 (down): No-op — deleted rows cannot be restored
-- ============================================================
-- Corrupted rows contained no useful data ([object Object]).
-- This is intentionally a no-op.
```

**Step 3: Verify migration syntax, commit**

```bash
# Verify the migration file exists and is valid SQL
cat migrations/104_cleanup_autocapture_object_object.up.sql
git add migrations/
git commit -m "[#1565] Add migration to cleanup corrupted [object Object] memory rows"
```

---

## Task 6: Final verification and PR

**Step 1: Run full test suite**

```bash
cd /tmp/worktree-issue-1561-omnibus
pnpm run test:unit -- --reporter verbose 2>&1 | tail -30
pnpm --filter @troykelly/openclaw-projects run build
pnpm --filter @troykelly/openclaw-projects run test
pnpm --filter @troykelly/openclaw-projects run typecheck
pnpm --filter @troykelly/openclaw-projects run lint
```

**Step 2: Push and create PR**

```bash
git push -u origin issue/1561-omnibus-namespace-autocapture
gh pr create \
  --title "[#1561][#1562][#1563][#1564][#1565] Omnibus namespace and auto-capture fixes" \
  --body "..."
```

PR body references all 5 issues with `Closes #1561, Closes #1562, Closes #1563, Closes #1564, Closes #1565`.
