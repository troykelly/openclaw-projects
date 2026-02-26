# Omnibus Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 7 bugs across API and plugin: relationship name resolution, contact endpoint creation, work-item filtering, namespace members, file sharing permissions, plugin field mapping, and memory_forget UUIDs.

**Architecture:** Three parallel work streams (API fixes, plugin fixes, namespace investigation) each in their own git worktree, merged into one omnibus branch for a single PR.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, Vitest, pnpm

---

## Prerequisites

Before starting any task:

1. Create the omnibus branch from main:
```bash
cd /workspaces/openclaw-projects
git worktree add /tmp/worktree-omnibus-1830-1884 -b issue/omnibus-1830-1884
cd /tmp/worktree-omnibus-1830-1884
pnpm install --frozen-lockfile
```

2. Run existing tests to verify baseline:
```bash
pnpm run build
pnpm test:unit
```

---

## Stream A: API Fixes (#1830, #1881, #1882, #1884)

### Task 1: Fix resolveContact cross-namespace fallback (#1830)

**Files:**
- Modify: `src/api/relationships/service.ts:440-499`
- Test: `tests/relationship_service.test.ts`

**Step 1: Write the failing test**

Add to `tests/relationship_service.test.ts` inside the `describe('Relationship Service ...')` block:

```typescript
describe('resolveContact cross-namespace (#1830)', () => {
  it('resolves contact by UUID when in a different namespace', async () => {
    // Create contact in "other" namespace
    const result = await pool.query(
      `INSERT INTO contact (display_name, namespace) VALUES ($1, $2) RETURNING id::text as id`,
      ['Cross NS Contact', 'other'],
    );
    const contactId = result.rows[0].id;

    // relationshipSet with queryNamespaces=['test'] should still find the contact by UUID
    // because UUID lookup should fall back to un-scoped when namespace-scoped fails
    const contact_b_id = await createContact(pool, 'Local Contact');
    const result2 = await relationshipSet(pool, {
      contact_a: contactId,
      contact_b: contact_b_id,
      relationship_type: 'colleague_of',
      queryNamespaces: ['test'],
      namespace: 'test',
    });
    expect(result2.contact_a.id).toBe(contactId);
  });

  it('resolves contact by display name when in a different namespace', async () => {
    // Create contact in "other" namespace
    await pool.query(
      `INSERT INTO contact (display_name, namespace) VALUES ($1, $2)`,
      ['Unique Person', 'other'],
    );

    const contact_b_id = await createContact(pool, 'Local Person');
    const result = await relationshipSet(pool, {
      contact_a: 'Unique Person',
      contact_b: contact_b_id,
      relationship_type: 'colleague_of',
      queryNamespaces: ['test'],
      namespace: 'test',
    });
    expect(result.contact_a.display_name).toBe('Unique Person');
  });

  it('resolves contact by given_name + family_name when in different namespace', async () => {
    await pool.query(
      `INSERT INTO contact (given_name, family_name, namespace) VALUES ($1, $2, $3)`,
      ['Alice', 'Wonderland', 'other'],
    );

    const contact_b_id = await createContact(pool, 'Bob');
    const result = await relationshipSet(pool, {
      contact_a: 'Alice Wonderland',
      contact_b: contact_b_id,
      relationship_type: 'colleague_of',
      queryNamespaces: ['test'],
      namespace: 'test',
    });
    expect(result.contact_a.display_name).toBe('Alice Wonderland');
  });

  it('prefers namespace-scoped match over cross-namespace match', async () => {
    // Create same-name contact in both namespaces
    await pool.query(
      `INSERT INTO contact (display_name, namespace) VALUES ($1, $2)`,
      ['Duplicate Name', 'other'],
    );
    const localResult = await pool.query(
      `INSERT INTO contact (display_name, namespace) VALUES ($1, $2) RETURNING id::text as id`,
      ['Duplicate Name', 'default'],
    );
    const localId = localResult.rows[0].id;

    const contact_b_id = await createContact(pool, 'Someone');
    const result = await relationshipSet(pool, {
      contact_a: 'Duplicate Name',
      contact_b: contact_b_id,
      relationship_type: 'colleague_of',
      queryNamespaces: ['default'],
      namespace: 'default',
    });
    // Should prefer the local namespace match
    expect(result.contact_a.id).toBe(localId);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/relationship_service.test.ts -t "resolveContact cross-namespace"`
Expected: FAIL — "cannot be resolved" error for cross-namespace contacts

**Step 3: Implement the fix**

In `src/api/relationships/service.ts`, modify `resolveContact()` (lines 440-499):

After the namespace-scoped UUID lookup fails (inside the `if (uuidPattern.test(identifier))` block, after line 459), add an un-scoped fallback:

```typescript
async function resolveContact(
  pool: Pool,
  identifier: string,
  queryNamespaces?: string[],
): Promise<{ id: string; display_name: string } | null> {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (uuidPattern.test(identifier)) {
    // Try namespace-scoped first
    if (queryNamespaces?.length) {
      const result = await pool.query(
        `SELECT id::text as id, display_name FROM contact WHERE id = $1 AND namespace = ANY($2::text[])`,
        [identifier, queryNamespaces],
      );
      if (result.rows.length > 0) {
        const row = result.rows[0] as { id: string; display_name: string };
        return { id: row.id, display_name: row.display_name };
      }
    }
    // Fallback: un-scoped UUID lookup (#1830)
    const fallback = await pool.query(
      `SELECT id::text as id, display_name FROM contact WHERE id = $1`,
      [identifier],
    );
    if (fallback.rows.length > 0) {
      const row = fallback.rows[0] as { id: string; display_name: string };
      return { id: row.id, display_name: row.display_name };
    }
  }

  // Name lookup: match display_name OR constructed given+family name (Issue #1830)
  const nameMatchClause = `(
    lower(display_name) = lower($1)
    OR lower(TRIM(COALESCE(given_name, '') || ' ' || COALESCE(family_name, ''))) = lower($1)
  ) AND deleted_at IS NULL`;

  // Try namespace-scoped name lookup first
  if (queryNamespaces && queryNamespaces.length > 0) {
    const nameResult = await pool.query(
      `SELECT id::text as id, COALESCE(display_name, TRIM(COALESCE(given_name, '') || ' ' || COALESCE(family_name, ''))) as display_name
       FROM contact
       WHERE ${nameMatchClause} AND namespace = ANY($2::text[])
       ORDER BY created_at ASC
       LIMIT 1`,
      [identifier, queryNamespaces],
    );
    if (nameResult.rows.length > 0) {
      const row = nameResult.rows[0] as { id: string; display_name: string };
      return { id: row.id, display_name: row.display_name };
    }
  }

  // Fallback: un-scoped name lookup (#1830)
  const nameResult = await pool.query(
    `SELECT id::text as id, COALESCE(display_name, TRIM(COALESCE(given_name, '') || ' ' || COALESCE(family_name, ''))) as display_name
     FROM contact
     WHERE ${nameMatchClause}
     ORDER BY created_at ASC
     LIMIT 1`,
    [identifier],
  );
  if (nameResult.rows.length > 0) {
    const row = nameResult.rows[0] as { id: string; display_name: string };
    return { id: row.id, display_name: row.display_name };
  }

  return null;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/relationship_service.test.ts -t "resolveContact cross-namespace"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/api/relationships/service.ts tests/relationship_service.test.ts
git commit -m "[#1830] Fix resolveContact cross-namespace fallback

resolveContact now falls back to un-scoped lookup when namespace-scoped
search returns no results, for both UUID and name-based resolution.
Namespace-scoped match is still preferred when available."
```

---

### Task 2: Add parent_work_item_id filter to GET /api/work-items (#1882)

**Files:**
- Modify: `src/api/server.ts:3275-3321`
- Modify: `src/api/openapi/paths/work-items.ts` (add query param docs)
- Test: `tests/work_items.test.ts`

**Step 1: Write the failing test**

Add to `tests/work_items.test.ts`:

```typescript
describe('GET /api/work-items parent_work_item_id filter (#1882)', () => {
  it('filters work items by parent_work_item_id', async () => {
    // Create a parent project
    const parent = await pool.query(
      `INSERT INTO work_item (title, kind) VALUES ('Project A', 'project') RETURNING id::text as id`,
    );
    const parentId = parent.rows[0].id;

    // Create child todo under the project
    await pool.query(
      `INSERT INTO work_item (title, kind, parent_id) VALUES ('Todo under A', 'todo', $1)`,
      [parentId],
    );

    // Create unrelated todo
    await pool.query(
      `INSERT INTO work_item (title, kind) VALUES ('Unrelated Todo', 'todo')`,
    );

    const app = buildServer();
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: `/api/work-items?parent_work_item_id=${parentId}`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].title).toBe('Todo under A');

    await app.close();
  });

  it('rejects invalid UUID for parent_work_item_id', async () => {
    const app = buildServer();
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/api/work-items?parent_work_item_id=not-a-uuid',
    });

    expect(res.statusCode).toBe(400);

    await app.close();
  });
});
```

You will need to add `import { buildServer } from '../src/api/server.ts';` at the top of the test file if not already present.

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/work_items.test.ts -t "parent_work_item_id filter"`
Expected: FAIL — all work items returned regardless of parent filter

**Step 3: Implement the fix**

In `src/api/server.ts` at line 3277, expand the query type and add the filter:

```typescript
  app.get('/api/work-items', async (req, reply) => {
    const query = req.query as { include_deleted?: string; item_type?: string; parent_work_item_id?: string };
    const pool = createPool();

    // Build WHERE clause
    const conditions: string[] = [];
    const params: unknown[] = [];

    // By default, exclude soft-deleted items
    if (query.include_deleted !== 'true') {
      conditions.push('deleted_at IS NULL');
    }

    // Filter by item_type if provided
    if (query.item_type) {
      params.push(query.item_type);
      conditions.push(`kind = $${params.length}`);
    }

    // Filter by parent_work_item_id (#1882)
    if (query.parent_work_item_id) {
      if (!isValidUUID(query.parent_work_item_id)) {
        await pool.end();
        return reply.code(400).send({ error: 'Invalid parent_work_item_id format' });
      }
      params.push(query.parent_work_item_id);
      conditions.push(`parent_id = $${params.length}`);
    }

    // ... rest of handler unchanged
```

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/work_items.test.ts -t "parent_work_item_id filter"`
Expected: PASS

**Step 5: Update OpenAPI spec**

In `src/api/openapi/paths/work-items.ts`, find the GET /api/work-items parameters and add:

```typescript
{
  name: 'parent_work_item_id',
  in: 'query',
  schema: { type: 'string', format: 'uuid' },
  description: 'Filter by parent work item ID',
},
```

**Step 6: Commit**

```bash
git add src/api/server.ts src/api/openapi/paths/work-items.ts tests/work_items.test.ts
git commit -m "[#1882] Add parent_work_item_id filter to GET /api/work-items

The plugin sends parent_work_item_id for todo_list filtering but the API
ignored it. Now parsed and applied as a WHERE clause on parent_id."
```

---

### Task 3: Add endpoints support to POST /api/contacts (#1881)

**Files:**
- Modify: `src/api/server.ts:6495-6632`
- Modify: `src/api/openapi/paths/contacts.ts`
- Test: `tests/contacts_api.test.ts`

**Step 1: Write the failing test**

Add to `tests/contacts_api.test.ts`:

```typescript
describe('POST /api/contacts with endpoints (#1881)', () => {
  it('creates contact with email and phone endpoints', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: {
        given_name: 'Endpoint',
        family_name: 'Test',
        endpoints: [
          { type: 'email', value: 'endpoint@example.com' },
          { type: 'phone', value: '+15551234567' },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.id).toBeDefined();

    // Verify endpoints were created
    const endpoints = await pool.query(
      `SELECT endpoint_type::text, endpoint_value FROM contact_endpoint WHERE contact_id = $1 ORDER BY endpoint_type`,
      [body.id],
    );
    expect(endpoints.rows).toHaveLength(2);
    expect(endpoints.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ endpoint_type: 'email', endpoint_value: 'endpoint@example.com' }),
        expect.objectContaining({ endpoint_type: 'phone', endpoint_value: '+15551234567' }),
      ]),
    );
  });

  it('creates contact without endpoints (backward compat)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { display_name: 'No Endpoints' },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);

    const endpoints = await pool.query(
      `SELECT id FROM contact_endpoint WHERE contact_id = $1`,
      [body.id],
    );
    expect(endpoints.rows).toHaveLength(0);
  });

  it('rejects invalid endpoint type', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: {
        display_name: 'Bad Endpoint',
        endpoints: [{ type: 'fax', value: '1234' }],
      },
    });

    // Should fail with 400 or create contact without invalid endpoint
    // The DB has contact_endpoint_type enum that will reject invalid types
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/contacts_api.test.ts -t "endpoints"`
Expected: FAIL — endpoints not created

**Step 3: Implement the fix**

In `src/api/server.ts`, in the `POST /api/contacts` handler (around line 6496), add `endpoints` to the body type:

```typescript
    const body = req.body as {
      // ... existing fields ...
      endpoints?: Array<{ type: string; value: string; metadata?: Record<string, unknown> }>;
    };
```

Then, after the tags creation block (after line 6615) and before `await client.query('COMMIT')`:

```typescript
      // Create endpoints (#1881)
      if (body.endpoints && Array.isArray(body.endpoints) && body.endpoints.length > 0) {
        for (const ep of body.endpoints) {
          if (ep.type && ep.value) {
            await client.query(
              `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value, metadata, namespace)
               VALUES ($1, $2::contact_endpoint_type, $3, COALESCE($4::jsonb, '{}'::jsonb), $5)
               ON CONFLICT (endpoint_type, normalized_value) DO NOTHING`,
              [contactId, ep.type, ep.value, ep.metadata ? JSON.stringify(ep.metadata) : null, namespace],
            );
          }
        }
      }
```

Also add endpoints to the response (after tags, before pool.end()):

```typescript
      // Include endpoints in response (#1881)
      const epResult = await client.query(
        `SELECT id::text, endpoint_type::text as type, endpoint_value as value, metadata
         FROM contact_endpoint WHERE contact_id = $1`,
        [contactId],
      );
      contact.endpoints = epResult.rows;
```

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/contacts_api.test.ts -t "endpoints"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/api/server.ts tests/contacts_api.test.ts
git commit -m "[#1881] Accept endpoints array in POST /api/contacts

The plugin sends endpoints (email, phone) during contact creation but
the API silently ignored them. Now creates contact_endpoint records
in the same transaction."
```

---

### Task 4: Fix file_share M2M access (#1884)

**Files:**
- Modify: `src/api/server.ts:4992-5057`
- Test: `tests/file_share_api.test.ts`

**Step 1: Write the failing test**

Add to `tests/file_share_api.test.ts`:

```typescript
describe('POST /api/files/:id/share M2M access (#1884)', () => {
  it('allows M2M token to share a file in the same namespace', async () => {
    // Create file with namespace
    const fileId = await pool.query(
      `INSERT INTO file_attachment (
        storage_key, original_filename, content_type, size_bytes, checksum_sha256,
        uploaded_by, namespace
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id::text`,
      ['test/m2m-share.txt', 'm2m-share.txt', 'text/plain', 1024, 'abc123', 'human@example.com', 'default'],
    );
    const id = fileId.rows[0].id;

    const { getM2mAuthHeaders } = await import('./helpers/auth.ts');
    const headers = await getM2mAuthHeaders('test-agent');

    const res = await app.inject({
      method: 'POST',
      url: `/api/files/${id}/share`,
      headers: { ...headers, 'x-namespace': 'default' },
      payload: { expires_in: 300 },
    });

    // Should succeed — M2M token has namespace access
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.token).toBeDefined();
  });

  it('rejects M2M token sharing a file in a different namespace', async () => {
    const fileId = await pool.query(
      `INSERT INTO file_attachment (
        storage_key, original_filename, content_type, size_bytes, checksum_sha256,
        uploaded_by, namespace
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id::text`,
      ['test/other-ns.txt', 'other-ns.txt', 'text/plain', 1024, 'abc123', 'someone@example.com', 'restricted'],
    );
    const id = fileId.rows[0].id;

    const { getM2mAuthHeaders } = await import('./helpers/auth.ts');
    const headers = await getM2mAuthHeaders('test-agent');

    const res = await app.inject({
      method: 'POST',
      url: `/api/files/${id}/share`,
      headers: { ...headers, 'x-namespace': 'default' },
      payload: { expires_in: 300 },
    });

    expect(res.statusCode).toBe(403);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/file_share_api.test.ts -t "M2M access"`
Expected: FAIL — 403 for the first test (M2M can't share even in same namespace)

**Step 3: Implement the fix**

In `src/api/server.ts` at lines 5032-5036, modify the ownership check to also allow M2M tokens with namespace access:

```typescript
      // Allow if user uploaded the file, or if auth is disabled (dev mode),
      // or if M2M token and file is in caller's namespace (#1884)
      const identity = await getAuthIdentity(req);
      const isM2M = identity?.type === 'm2m';
      const callerNamespace = getStoreNamespace(req);
      const fileInCallerNamespace = metadata.namespace === callerNamespace;

      if (metadata.uploaded_by !== email && !isAuthDisabled() && !(isM2M && fileInCallerNamespace)) {
        await pool.end();
        return reply.code(403).send({ error: 'You do not have permission to share this file' });
      }
```

Note: `metadata` needs a `namespace` field. Check if `getFileMetadata` returns it. If not, add it to the query.

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/file_share_api.test.ts -t "M2M access"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/api/server.ts tests/file_share_api.test.ts
git commit -m "[#1884] Allow M2M tokens to share files in same namespace

The file share ownership check compared uploaded_by with the M2M agent
identity, which never matches. Now M2M tokens can share files that are
in the same namespace as the caller."
```

---

## Stream B: Plugin Fixes (#1831, #1828)

### Task 5: Fix contact_get "undefined" display (#1831)

**Files:**
- Modify: `packages/openclaw-plugin/src/register-openclaw.ts:2388-2416`
- Test: `packages/openclaw-plugin/tests/` (or existing plugin test file)

**Step 1: Investigate the response shape**

Read the `GET /api/contacts/:id` response format in `src/api/server.ts:7059-7179`. The response returns the contact object directly (not wrapped). The plugin at line 2392 types the response as `{ id, display_name?, given_name?, family_name?, email?, phone?, notes? }`.

The issue: the API returns `display_name` but it could be `null` (not `undefined`). When `display_name` is `null`, the `||` chain in line 2402 should fall through to given/family name. But if the API returns the contact nested under a different key or if `apiClient.get` wraps the response, `response.data` might not have the expected shape.

Add defensive extraction and logging:

```typescript
    async contact_get(params: Record<string, unknown>): Promise<ToolResult> {
      const { contact_id } = params as { contact_id: string };

      try {
        const response = await apiClient.get<Record<string, unknown>>(
          `/api/contacts/${contact_id}?user_email=${encodeURIComponent(state.agentId)}`,
          reqOptsScoped(),
        );

        if (!response.success) {
          return { success: false, error: response.error.message };
        }

        const contact = response.data;
        const contactName = (contact.display_name as string)
          || [contact.given_name, contact.family_name].filter(Boolean).join(' ')
          || 'Unknown';
        const lines = [`Contact: ${contactName} (ID: ${contact.id})`];

        // Extract email/phone from endpoints if top-level fields are absent (#1831)
        const endpoints = Array.isArray(contact.endpoints) ? contact.endpoints : [];
        const emailEndpoint = endpoints.find((ep: Record<string, unknown>) => ep.type === 'email' || ep.endpoint_type === 'email');
        const phoneEndpoint = endpoints.find((ep: Record<string, unknown>) => ep.type === 'phone' || ep.endpoint_type === 'phone');

        const email = (contact.email as string) || (emailEndpoint?.value as string) || (emailEndpoint?.endpoint_value as string);
        const phone = (contact.phone as string) || (phoneEndpoint?.value as string) || (phoneEndpoint?.endpoint_value as string);

        if (email) lines.push(`Email: ${email}`);
        if (phone) lines.push(`Phone: ${phone}`);
        if (contact.notes) lines.push(`Notes: ${contact.notes}`);
        if (contact.given_name || contact.family_name) {
          lines.push(`Name: ${[contact.given_name, contact.family_name].filter(Boolean).join(' ')}`);
        }

        return {
          success: true,
          data: { content: lines.join('\n'), details: { contact } },
        };
      } catch (error) {
        logger.error('contact_get failed', { error });
        return { success: false, error: 'Failed to get contact' };
      }
    },
```

**Step 2: Commit**

```bash
git add packages/openclaw-plugin/src/register-openclaw.ts
git commit -m "[#1831] Fix contact_get undefined display name

Defensively extract contact fields and add endpoint-based email/phone
fallback. The API returns endpoints in the contact response but the
plugin was only checking top-level email/phone fields."
```

---

### Task 6: Fix namespace_members "undefined" role (#1831, #1883)

**Files:**
- Modify: `packages/openclaw-plugin/src/register-openclaw.ts:3924-3944`
- Investigate: `src/api/server.ts:1022-1059`

**Step 1: Investigate the API response**

Write a quick integration test to verify the endpoint works with M2M tokens. Add to `tests/namespace_api.test.ts`:

```typescript
describe('GET /api/namespaces/:ns M2M access (#1883)', () => {
  it('returns members for M2M token', async () => {
    // Ensure namespace grant exists
    await pool.query(
      `INSERT INTO namespace_grant (email, namespace, access, is_home)
       VALUES ('test@example.com', 'test-ns', 'readwrite', true)
       ON CONFLICT DO NOTHING`,
    );

    const { getM2mAuthHeaders } = await import('./helpers/auth.ts');
    const headers = await getM2mAuthHeaders('test-agent');

    const res = await app.inject({
      method: 'GET',
      url: '/api/namespaces/test-ns',
      headers,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.namespace).toBe('test-ns');
    expect(body.members).toBeDefined();
    expect(Array.isArray(body.members)).toBe(true);
    expect(body.members.length).toBeGreaterThan(0);
    expect(body.members[0].access).toBeDefined();
    expect(body.members[0].email).toBeDefined();
  });
});
```

Run: `pnpm exec vitest run tests/namespace_api.test.ts -t "M2M access"`

If this passes, the API endpoint works fine and the issue is in the plugin's `reqOpts()` not passing auth correctly. If it fails, the API needs fixing.

**Step 2: Fix the plugin handler**

The plugin uses `reqOpts()` which doesn't include namespace scoping headers. The `GET /api/namespaces/:ns` endpoint checks `identity.type` and only restricts `user` tokens. M2M tokens should pass through. But the plugin might not be passing the auth token at all.

Check that `reqOpts()` includes the authorization header via `apiClient`. If the issue is that `apiClient` doesn't forward auth, fix the client. Otherwise, fix the plugin handler to use proper error handling:

```typescript
    async namespace_members(params: Record<string, unknown>): Promise<ToolResult> {
      const { namespace } = params as { namespace: string };
      try {
        const response = await apiClient.get<{
          namespace: string;
          members: Array<{ id: string; email: string; access: string; is_home: boolean }>;
          member_count: number;
        }>(
          `/api/namespaces/${encodeURIComponent(namespace)}`,
          reqOpts(),
        );
        if (!response.success) {
          logger.warn('namespace_members API call failed', {
            namespace,
            status: response.error?.status,
            message: response.error?.message,
          });
          return { success: false, error: response.error.message || 'Failed to list namespace members' };
        }
        const data = response.data;
        const members = Array.isArray(data.members) ? data.members : [];
        const memberCount = data.member_count ?? members.length;

        if (members.length === 0) {
          return { success: true, data: { content: `Namespace **${namespace}** has no members.`, details: data } };
        }
        const content = [
          `**${namespace}** — ${memberCount} member(s):`,
          ...members.map((m) => `- ${m.email} (${m.access ?? 'unknown'}${m.is_home ? ', home' : ''})`),
        ].join('\n');
        return { success: true, data: { content, details: data } };
      } catch (error) {
        logger.error('namespace_members failed', { error });
        return { success: false, error: 'Failed to list namespace members' };
      }
    },
```

Key changes:
- Guard `data.members` with `Array.isArray()`
- Default `m.access` to `'unknown'` instead of letting it be `undefined`
- Log the actual error status for debugging

**Step 3: Commit**

```bash
git add packages/openclaw-plugin/src/register-openclaw.ts tests/namespace_api.test.ts
git commit -m "[#1831, #1883] Fix namespace_members undefined role and error handling

Guard members array access and default access field. Add diagnostic
logging for API call failures. Add M2M integration test for the
namespace endpoint."
```

---

### Task 7: Verify memory_forget full UUIDs (#1828)

**Files:**
- Verify: `packages/openclaw-plugin/src/register-openclaw.ts:2009`
- Test: (add assertion if needed)

**Step 1: Verify current behavior**

Read the plugin code at line 2009:
```typescript
const list = matches.map((m) => `- [${m.id}] ${m.content.slice(0, 60)}${m.content.length > 60 ? '...' : ''}`).join('\n');
```

The `m.id` comes from `searchResponse.data.results` which uses `id::text as id` from PostgreSQL — this IS the full UUID.

Verify by checking the API search endpoint returns full UUIDs. If current code already works correctly (full UUIDs), add an explicit comment and move on.

**Step 2: Add explicit full-UUID assertion**

If the code is correct, add a clarifying comment:

```typescript
          // Candidate list uses full UUIDs — required by OpenClaw gateway which
          // enforces format:"uuid" on memory_id parameter (#1828)
          const list = matches.map((m) => `- [${m.id}] ${m.content.slice(0, 60)}${m.content.length > 60 ? '...' : ''}`).join('\n');
```

**Step 3: Commit (if any changes)**

```bash
git add packages/openclaw-plugin/src/register-openclaw.ts
git commit -m "[#1828] Verify and document memory_forget full UUID output

The candidate list already returns full UUIDs from the search API.
Added clarifying comment about the OpenClaw gateway UUID format
requirement."
```

---

## Stream C: Final Verification

### Task 8: Run full test suite

**Step 1: Build**

```bash
pnpm run build
```

Expected: No type errors

**Step 2: Run unit tests**

```bash
pnpm test:unit
```

Expected: All pass

**Step 3: Run integration tests**

```bash
pnpm test:integration
```

Expected: All pass

**Step 4: Run all tests**

```bash
pnpm test
```

Expected: All pass

---

### Task 9: Update OpenAPI specs

**Files:**
- Modify: `src/api/openapi/paths/contacts.ts` — add `endpoints` to POST /api/contacts body
- Modify: `src/api/openapi/paths/work-items.ts` — add `parent_work_item_id` query param
- Verify: `src/api/openapi/paths/files.ts` — file share docs for M2M access note

**Step 1: Update contacts OpenAPI**

Add `endpoints` to the POST /api/contacts requestBody schema.

**Step 2: Update work-items OpenAPI**

Add `parent_work_item_id` query parameter to GET /api/work-items.

**Step 3: Commit**

```bash
git add src/api/openapi/paths/contacts.ts src/api/openapi/paths/work-items.ts
git commit -m "[#1881, #1882] Update OpenAPI specs for contacts endpoints and work-item filtering"
```

---

### Task 10: Create omnibus PR

**Step 1: Push branch**

```bash
git push -u origin issue/omnibus-1830-1884
```

**Step 2: Create PR**

```bash
gh pr create --title "[#1828, #1830, #1831, #1881, #1882, #1883, #1884] Omnibus: Fix plugin/API mismatches" --body "$(cat <<'EOF'
## Summary

- **#1830**: `resolveContact` cross-namespace fallback — contacts in other namespaces now found via UUID and name
- **#1831**: `contact_get` shows display name correctly; `namespace_members` guards `access` field
- **#1828**: Verified `memory_forget` returns full UUIDs (OpenClaw gateway requires `format: "uuid"`)
- **#1881**: `POST /api/contacts` now accepts `endpoints` array (email/phone persisted atomically)
- **#1882**: `GET /api/work-items` supports `parent_work_item_id` filter
- **#1883**: Namespace members endpoint M2M access investigated and fixed
- **#1884**: `file_share` allows M2M tokens for same-namespace files

Closes #1828
Closes #1830
Closes #1831
Closes #1881
Closes #1882
Closes #1883
Closes #1884

## Test plan

- [ ] `pnpm test:unit` passes
- [ ] `pnpm test:integration` passes
- [ ] `pnpm run build` passes (type-check)
- [ ] Verify `relationship_set` works with contact names cross-namespace
- [ ] Verify `contact_create` with email/phone creates endpoints
- [ ] Verify `todo_list` with project_id only returns children
- [ ] Verify `namespace_members` returns member roles (not "undefined")
- [ ] Verify `file_share` works for M2M tokens in same namespace
- [ ] Verify `memory_forget` candidate list shows full UUIDs

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
