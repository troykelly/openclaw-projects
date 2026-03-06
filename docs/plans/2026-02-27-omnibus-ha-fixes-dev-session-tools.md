# Omnibus: HA Integration Fixes + Dev Session Plugin Tools — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all 18 Home Assistant geolocation bugs found during deep review and add dev session plugin tools (#1896).

**Architecture:** Agent team with 4 teammates working in parallel on isolated worktrees. Each teammate handles a severity tier of fixes. All work merges into a single omnibus branch for one PR that closes #1895 and #1896.

**Tech Stack:** TypeScript, PostgreSQL, Fastify, Vitest, Zod, WebSocket (ws), React

---

## Team Structure

| Teammate | Branch | Scope |
|----------|--------|-------|
| **ha-critical** | `omnibus/ha-critical` | C1-C4 |
| **ha-high** | `omnibus/ha-high` | H1-H4 |
| **ha-medium-low** | `omnibus/ha-medium-low` | M1-M6, L1-L2 |
| **dev-session-tools** | `omnibus/dev-session-tools` | F1 (#1896) |

All branches from `main`. Lead merges into `omnibus/1895-1896-ha-fixes-dev-session-tools`.

---

## Teammate: ha-critical (C1-C4)

### Task 1: Fix auto-inject wrong column name (C1)

**Files:**
- Modify: `src/api/geolocation/auto-inject.ts:42`
- Test: `src/api/geolocation/auto-inject.test.ts`

**Step 1: Read the existing test file**

Read `src/api/geolocation/auto-inject.test.ts` to understand the test setup.

**Step 2: Update the existing test to assert correct column**

The test should verify the SQL query uses the column `email` (not `user_email`). Add or update the test that checks the query string:

```typescript
it('queries user_setting by email column', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ geo_auto_inject: true }] });
  const { getCurrentLocation } = await import('./service.ts');
  (getCurrentLocation as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    lat: -33.8688, lng: 151.2093, address: 'Test', place_label: 'Test',
  });

  const req = makeReq({ body: { content: 'Test' } });
  const hook = geoAutoInjectHook(createPool);
  await hook(req, noopReply);

  // Assert the first query uses "email" column, not "user_email"
  expect(mockQuery).toHaveBeenCalledWith(
    expect.stringContaining('WHERE email = $1'),
    ['user@example.com'],
  );
});
```

**Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run src/api/geolocation/auto-inject.test.ts`
Expected: FAIL — current code queries `WHERE user_email = $1`

**Step 4: Fix the column name**

In `src/api/geolocation/auto-inject.ts:42`, change:
```typescript
// BEFORE
`SELECT geo_auto_inject FROM user_setting WHERE user_email = $1`
// AFTER
`SELECT geo_auto_inject FROM user_setting WHERE email = $1`
```

**Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run src/api/geolocation/auto-inject.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/api/geolocation/auto-inject.ts src/api/geolocation/auto-inject.test.ts
git commit -m "[#1895] Fix auto-inject: use correct 'email' column name in user_setting query"
```

---

### Task 2: Fix auto-inject error handling (M3)

**Files:**
- Modify: `src/api/geolocation/auto-inject.ts:38-62`
- Test: `src/api/geolocation/auto-inject.test.ts`

**Step 1: Write test for error resilience**

```typescript
it('returns silently when DB query throws', async () => {
  mockQuery.mockRejectedValueOnce(new Error('connection refused'));

  const req = makeReq({ body: { content: 'Test' } });
  const hook = geoAutoInjectHook(createPool);

  // Should NOT throw
  await hook(req, noopReply);

  const body = req.body as Record<string, unknown>;
  expect(body.lat).toBeUndefined();
  expect(body.lng).toBeUndefined();
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/api/geolocation/auto-inject.test.ts`
Expected: FAIL — error propagates unhandled

**Step 3: Wrap the pool queries in try-catch**

In `auto-inject.ts`, wrap the pool logic inside the existing try block with an inner catch that returns silently:

```typescript
const pool = createPool();
try {
  // Check user's geo_auto_inject setting
  let settingResult;
  try {
    settingResult = await pool.query(
      `SELECT geo_auto_inject FROM user_setting WHERE email = $1`,
      [email],
    );
  } catch {
    // DB error during auto-inject — skip injection silently
    return;
  }
  const autoInject = settingResult.rows[0]?.geo_auto_inject;
  if (!autoInject) return;

  // Get current location
  let location;
  try {
    const { getCurrentLocation } = await import('./service.ts');
    location = await getCurrentLocation(pool, email);
  } catch {
    return;
  }
  if (!location) return;

  // Inject location into body
  body.lat = location.lat;
  body.lng = location.lng;
  if (location.address) body.address = location.address;
  if (location.place_label) body.place_label = location.place_label;

  req.headers['x-geo-source'] = 'auto';
} finally {
  await pool.end();
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/api/geolocation/auto-inject.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/api/geolocation/auto-inject.ts src/api/geolocation/auto-inject.test.ts
git commit -m "[#1895] Add error handling to geo auto-inject hook"
```

---

### Task 3: Fix FOR UPDATE on COUNT(*) (C2)

**Files:**
- Modify: `src/api/server.ts:19463` and `src/api/server.ts:19821`
- Test: `tests/unit/geolocation/provider-creation.test.ts` (create new)

**Step 1: Write failing test for provider creation**

Create `tests/unit/geolocation/provider-creation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('provider creation SQL', () => {
  it('count query does not use FOR UPDATE', async () => {
    // This test validates the SQL pattern used in provider creation.
    // FOR UPDATE is incompatible with aggregate functions in PostgreSQL.
    const serverContent = await import('fs').then(fs =>
      fs.promises.readFile('src/api/server.ts', 'utf8')
    );

    // Find all COUNT(*) queries on geo_provider
    const countQueries = serverContent.match(/SELECT COUNT\(\*\).*geo_provider.*FOR UPDATE/g);
    expect(countQueries).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/geolocation/provider-creation.test.ts`
Expected: FAIL — matches exist

**Step 3: Remove FOR UPDATE from both count queries**

At line 19463:
```typescript
// BEFORE
'SELECT COUNT(*)::int AS cnt FROM geo_provider WHERE owner_email = $1 AND deleted_at IS NULL FOR UPDATE'
// AFTER
'SELECT COUNT(*)::int AS cnt FROM geo_provider WHERE owner_email = $1 AND deleted_at IS NULL'
```

At line 19821 (same change):
```typescript
// BEFORE
'SELECT COUNT(*)::int AS cnt FROM geo_provider WHERE owner_email = $1 AND deleted_at IS NULL FOR UPDATE'
// AFTER
'SELECT COUNT(*)::int AS cnt FROM geo_provider WHERE owner_email = $1 AND deleted_at IS NULL'
```

The transaction + advisory lock in the INSERT path already prevents real race conditions.

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/geolocation/provider-creation.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/api/server.ts tests/unit/geolocation/provider-creation.test.ts
git commit -m "[#1895] Remove FOR UPDATE from provider count queries (incompatible with aggregates)"
```

---

### Task 4: Fix cross-user location leak (C4)

**Files:**
- Modify: `src/api/geolocation/service.ts:407-420`
- Test: `tests/unit/geolocation/current-location.test.ts` (create new)

**Step 1: Write test verifying user email filter**

```typescript
import { describe, it, expect } from 'vitest';

describe('getCurrentLocation SQL', () => {
  it('filters geo_location by user_email to prevent cross-user leaks', async () => {
    const serviceContent = await import('fs').then(fs =>
      fs.promises.readFile('src/api/geolocation/service.ts', 'utf8')
    );

    // Find the getCurrentLocation function's query
    const fnMatch = serviceContent.match(
      /async function getCurrentLocation[\s\S]*?`([\s\S]*?)`/
    );
    expect(fnMatch).not.toBeNull();
    const query = fnMatch![1];

    // Must filter gl.user_email to prevent shared provider cross-user leak
    expect(query).toContain('gl.user_email');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/geolocation/current-location.test.ts`
Expected: FAIL — current query doesn't reference `gl.user_email`

**Step 3: Add user_email filter to getCurrentLocation**

In `service.ts:407-420`, change the query:

```typescript
export async function getCurrentLocation(pool: Queryable, user_email: string): Promise<GeoLocation | null> {
  const result = await pool.query(
    `SELECT gl.* FROM geo_location gl
     JOIN geo_provider_user gpu ON gl.provider_id = gpu.provider_id
     JOIN geo_provider gp ON gl.provider_id = gp.id
     WHERE gpu.user_email = $1
       AND gl.user_email = $1
       AND gpu.is_active = true
       AND gp.deleted_at IS NULL
       AND gl.time > now() - (gp.max_age_seconds || ' seconds')::interval
     ORDER BY gpu.priority ASC, gl.accuracy_m ASC NULLS LAST, gl.time DESC
     LIMIT 1`,
    [user_email],
  );
  return result.rows.length > 0 ? rowToLocation(result.rows[0]) : null;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/geolocation/current-location.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/api/geolocation/service.ts tests/unit/geolocation/current-location.test.ts
git commit -m "[#1895] Fix cross-user location leak: filter gl.user_email in getCurrentLocation"
```

---

### Task 5: Wire ingestion pipeline in HA connector (C3)

**Files:**
- Modify: `src/ha-connector/run.ts:62-69`
- Modify: `src/api/geolocation/processors/geo-ingestor-processor.ts`
- Modify: `src/ha-connector/lifecycle.ts:209-231` (namespace to include providerId)
- Test: `tests/unit/ha-connector/ingestion-wiring.test.ts` (create new)

**Step 1: Understand the data flow**

The current flow:
1. `lifecycle.ts:connectProvider()` creates a `Connection` with `onUpdate` callback
2. `onUpdate` converts `LocationUpdate` → `HaStateChange` and dispatches through router
3. Router dispatches to `GeoIngestorProcessor.onStateChange(change, namespace)`
4. `GeoIngestorProcessor` converts back to `LocationUpdate` and calls `this.updateHandler(update)`
5. `updateHandler` in `run.ts:64-68` just logs

The fix: `GeoIngestorProcessor` needs access to the DB pool and the providerId.

**Step 2: Modify GeoIngestorProcessor to accept pool and call ingestLocationUpdate**

Redesign `GeoIngestorProcessor` to accept a pool and extract providerId from the namespace:

```typescript
// In geo-ingestor-processor.ts
import type { Pool } from 'pg';
import { ingestLocationUpdate } from '../ingestion.ts';

export class GeoIngestorProcessor implements HaEventProcessor {
  private readonly pool: Pool;
  private readonly onUpdateLog?: LocationUpdateHandler;

  constructor(pool: Pool, onUpdateLog?: LocationUpdateHandler) {
    this.pool = pool;
    this.onUpdateLog = onUpdateLog;
  }

  // ... getConfig() unchanged ...

  async onStateChange(change: HaStateChange, namespace: string): Promise<void> {
    const update = stateChangeToLocationUpdate(change);
    if (!update) return;

    // namespace format: "providerId:ownerEmail" (set by lifecycle.ts)
    const sepIdx = namespace.indexOf(':');
    if (sepIdx === -1) {
      this.onUpdateLog?.(update);
      return;
    }
    const providerId = namespace.slice(0, sepIdx);

    try {
      await ingestLocationUpdate(this.pool, providerId, update);
    } catch (err) {
      console.error('[GeoIngestor] Ingestion failed:', (err as Error).message);
    }

    this.onUpdateLog?.(update);
  }
}
```

**Step 3: Update lifecycle.ts to use `providerId:ownerEmail` as namespace**

In `lifecycle.ts:230`, change:
```typescript
// BEFORE
void this.router.dispatch(stateChange, row.owner_email);
// AFTER
void this.router.dispatch(stateChange, `${row.id}:${row.owner_email}`);
```

**Step 4: Update run.ts to pass pool to GeoIngestorProcessor**

In `run.ts:64-69`, change:
```typescript
// BEFORE
const geoProcessor = new GeoIngestorProcessor((update) => {
  console.debug('[HA-Connector] Location update:', update.entity_id, update.lat, update.lng);
});
// AFTER
const geoProcessor = new GeoIngestorProcessor(pool, (update) => {
  console.debug('[HA-Connector] Location update:', update.entity_id, update.lat, update.lng);
});
```

**Step 5: Write test for the wiring**

Create `tests/unit/ha-connector/ingestion-wiring.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the ingestion module
vi.mock('@/api/geolocation/ingestion', () => ({
  ingestLocationUpdate: vi.fn().mockResolvedValue({ inserted: true }),
}));

describe('GeoIngestorProcessor ingestion wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls ingestLocationUpdate with correct providerId from namespace', async () => {
    const { GeoIngestorProcessor } = await import(
      '@/api/geolocation/processors/geo-ingestor-processor'
    );
    const { ingestLocationUpdate } = await import('@/api/geolocation/ingestion');

    const mockPool = {} as any;
    const processor = new GeoIngestorProcessor(mockPool);

    await processor.onStateChange(
      {
        entity_id: 'device_tracker.phone',
        domain: 'device_tracker',
        old_state: null,
        new_state: 'home',
        old_attributes: {},
        new_attributes: { latitude: -33.86, longitude: 151.20 },
        last_changed: new Date().toISOString(),
        last_updated: new Date().toISOString(),
        context: { id: '', parent_id: null, user_id: null },
      },
      'provider-uuid-123:user@example.com',
    );

    expect(ingestLocationUpdate).toHaveBeenCalledWith(
      mockPool,
      'provider-uuid-123',
      expect.objectContaining({
        entity_id: 'device_tracker.phone',
        lat: -33.86,
        lng: 151.20,
      }),
    );
  });

  it('skips ingestion when namespace has no separator', async () => {
    const { GeoIngestorProcessor } = await import(
      '@/api/geolocation/processors/geo-ingestor-processor'
    );
    const { ingestLocationUpdate } = await import('@/api/geolocation/ingestion');

    const logHandler = vi.fn();
    const processor = new GeoIngestorProcessor({} as any, logHandler);

    await processor.onStateChange(
      {
        entity_id: 'device_tracker.phone',
        domain: 'device_tracker',
        old_state: null,
        new_state: 'home',
        old_attributes: {},
        new_attributes: { latitude: -33.86, longitude: 151.20 },
        last_changed: new Date().toISOString(),
        last_updated: new Date().toISOString(),
        context: { id: '', parent_id: null, user_id: null },
      },
      'default',
    );

    expect(ingestLocationUpdate).not.toHaveBeenCalled();
    expect(logHandler).toHaveBeenCalled();
  });
});
```

**Step 6: Run tests**

Run: `pnpm exec vitest run tests/unit/ha-connector/ingestion-wiring.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add src/api/geolocation/processors/geo-ingestor-processor.ts src/ha-connector/run.ts src/ha-connector/lifecycle.ts tests/unit/ha-connector/ingestion-wiring.test.ts
git commit -m "[#1895] Wire ingestion pipeline: GeoIngestorProcessor now persists location updates to DB"
```

**Step 8: Run full test suite**

Run: `pnpm test:unit`
Expected: All tests pass

**Step 9: Run typecheck**

Run: `pnpm run build`
Expected: No type errors

---

## Teammate: ha-high (H1-H4)

### Task 6: Fix WebSocket reconnect after initial close (H1)

**Files:**
- Modify: `src/api/geolocation/providers/home-assistant.ts:457-462`
- Test: `tests/unit/geolocation/ha-reconnect.test.ts` (create new)

**Step 1: Write test for reconnection behavior**

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('HA WebSocket reconnect', () => {
  it('initial close handler should always schedule reconnect', async () => {
    const haContent = await import('fs').then(fs =>
      fs.promises.readFile('src/api/geolocation/providers/home-assistant.ts', 'utf8')
    );

    // The close handler for the initial WS connection should NOT check ctx.attempt > 0
    // because after successful auth, attempt is reset to 0, preventing reconnection.
    // Look for the initial ws.on('close') handler
    const closeHandlerMatch = haContent.match(
      /ws\.on\('close',\s*\(\)\s*=>\s*\{[^}]*ctx\.attempt\s*>\s*0/
    );
    expect(closeHandlerMatch).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/geolocation/ha-reconnect.test.ts`
Expected: FAIL

**Step 3: Fix the close handler**

In `home-assistant.ts:457-462`, change:
```typescript
// BEFORE
ws.on('close', () => {
  ctx.connected = false;
  ctx.ws = null;
  if (!ctx.disconnecting && ctx.attempt > 0) {
    scheduleReconnect();
  }
});
// AFTER
ws.on('close', () => {
  ctx.connected = false;
  ctx.ws = null;
  if (!ctx.disconnecting) {
    scheduleReconnect();
  }
});
```

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/geolocation/ha-reconnect.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/api/geolocation/providers/home-assistant.ts tests/unit/geolocation/ha-reconnect.test.ts
git commit -m "[#1895] Fix HA WebSocket: always reconnect on close unless intentional disconnect"
```

---

### Task 7: Fix OAuth refresh clientId mismatch (H4)

**Files:**
- Modify: `src/api/geolocation/providers/home-assistant.ts:570-578`
- Test: `tests/unit/geolocation/ha-oauth-refresh.test.ts` (create new)

**Step 1: Write test for clientId consistency**

```typescript
import { describe, it, expect } from 'vitest';

describe('HA OAuth refresh', () => {
  it('uses PUBLIC_BASE_URL for clientId, not HA origin', async () => {
    const haContent = await import('fs').then(fs =>
      fs.promises.readFile('src/api/geolocation/providers/home-assistant.ts', 'utf8')
    );

    // The refreshCb should use PUBLIC_BASE_URL for clientId
    // not `new URL(baseUrl).origin` which is the HA instance origin
    const refreshSection = haContent.match(/refreshCb[\s\S]*?refreshAccessToken[\s\S]*?}/);
    expect(refreshSection).not.toBeNull();

    // Should reference PUBLIC_BASE_URL or process.env
    expect(refreshSection![0]).toContain('PUBLIC_BASE_URL');
    // Should NOT use HA baseUrl origin as clientId
    expect(refreshSection![0]).not.toMatch(/new URL\(baseUrl\)\.origin/);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/geolocation/ha-oauth-refresh.test.ts`
Expected: FAIL

**Step 3: Fix the clientId in refresh callback**

In `home-assistant.ts:570-578`, change:
```typescript
// BEFORE
const refreshCb = creds.isOAuth && creds.refreshToken
  ? async (): Promise<string> => {
      const { refreshAccessToken } = await import('../../oauth/home-assistant.ts');
      const baseUrl = (config.url as string).replace(/\/+$/, '');
      const clientId = new URL(baseUrl).origin;
      const tokens = await refreshAccessToken(baseUrl, creds.refreshToken!, clientId);
      return tokens.access_token;
    }
  : undefined;
// AFTER
const refreshCb = creds.isOAuth && creds.refreshToken
  ? async (): Promise<string> => {
      const { refreshAccessToken } = await import('../../oauth/home-assistant.ts');
      const baseUrl = (config.url as string).replace(/\/+$/, '');
      const rawPublicBase = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
      const clientId = rawPublicBase.replace(/\/+$/, '');
      const tokens = await refreshAccessToken(baseUrl, creds.refreshToken!, clientId);
      return tokens.access_token;
    }
  : undefined;
```

**Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/geolocation/ha-oauth-refresh.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/api/geolocation/providers/home-assistant.ts tests/unit/geolocation/ha-oauth-refresh.test.ts
git commit -m "[#1895] Fix HA OAuth refresh: use PUBLIC_BASE_URL for clientId consistency"
```

---

### Task 8: Fix lifecycle reconcile to detect config changes (H2)

**Files:**
- Modify: `src/ha-connector/lifecycle.ts:112-130`
- Test: `tests/unit/ha-connector/reconcile.test.ts` (create new)

**Step 1: Add a fingerprint function to detect changes**

Add to `lifecycle.ts`:
```typescript
import { createHash } from 'crypto';

function providerFingerprint(row: ProviderRow): string {
  const data = JSON.stringify({
    config: row.config,
    credentials: row.credentials?.toString('utf8') ?? '',
    status: row.status,
  });
  return createHash('sha256').update(data).digest('hex');
}
```

**Step 2: Store fingerprint in ManagedProvider**

```typescript
interface ManagedProvider {
  row: ProviderRow;
  connection: Connection | null;
  error?: string;
  fingerprint: string;
}
```

**Step 3: Update addProvider to store fingerprint**

In `addProvider`:
```typescript
const mp: ManagedProvider = { row, connection: null, fingerprint: providerFingerprint(row) };
```

**Step 4: Update reconcile to detect changes**

```typescript
async reconcile(): Promise<void> {
  const rows = await this.fetchProviders();
  const currentIds = new Set(rows.map((r) => r.id));
  const managedIds = new Set(this.managed.keys());

  // Remove providers no longer in DB
  for (const id of managedIds) {
    if (!currentIds.has(id)) {
      await this.removeProvider(id);
    }
  }

  // Add new providers OR reconnect changed ones
  for (const row of rows) {
    if (!managedIds.has(row.id)) {
      await this.addProvider(row);
    } else {
      // Check for config/credential changes
      const existing = this.managed.get(row.id)!;
      const newFingerprint = providerFingerprint(row);
      if (existing.fingerprint !== newFingerprint) {
        console.log(`[Lifecycle] Config changed for ${row.id} (${row.label}), reconnecting`);
        await this.removeProvider(row.id);
        await this.addProvider(row);
      }
    }
  }
}
```

**Step 5: Write test**

Create `tests/unit/ha-connector/reconcile.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import type { HaEventRouter } from '@/api/geolocation/ha-event-router';
import { ProviderLifecycleManager } from '@/ha-connector/lifecycle';

describe('ProviderLifecycleManager.reconcile', () => {
  it('reconnects provider when config changes', async () => {
    // Test that reconcile detects config changes via fingerprint
    // and calls removeProvider + addProvider
    const mockPool = {
      query: vi.fn(),
    } as unknown as Pool;

    const mockRouter = {
      dispatch: vi.fn(),
      notifyConnect: vi.fn(),
      notifyDisconnect: vi.fn(),
      shutdown: vi.fn(),
      register: vi.fn(),
    } as unknown as HaEventRouter;

    const lifecycle = new ProviderLifecycleManager(mockPool, mockRouter);

    // First call returns initial config
    (mockPool.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [{ id: 'p1', provider_type: 'home_assistant', label: 'HA', config: { url: 'https://old.ha' }, credentials: null, status: 'active', owner_email: 'user@test.com' }] });

    // Mock connectProvider to avoid real WS
    const connectSpy = vi.spyOn(lifecycle as any, 'connectProvider')
      .mockResolvedValue({ disconnect: vi.fn(), addEntities: vi.fn(), removeEntities: vi.fn(), isConnected: () => true });
    const updateStatusSpy = vi.spyOn(lifecycle as any, 'updateStatus').mockResolvedValue(undefined);

    await lifecycle.start();
    expect(connectSpy).toHaveBeenCalledTimes(1);

    // Reconcile with changed config
    (mockPool.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [{ id: 'p1', provider_type: 'home_assistant', label: 'HA', config: { url: 'https://new.ha' }, credentials: null, status: 'active', owner_email: 'user@test.com' }] });

    await lifecycle.reconcile();
    // Should have reconnected (removed + added = 2 more connect calls)
    expect(connectSpy).toHaveBeenCalledTimes(2);
  });
});
```

**Step 6: Run test**

Run: `pnpm exec vitest run tests/unit/ha-connector/reconcile.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add src/ha-connector/lifecycle.ts tests/unit/ha-connector/reconcile.test.ts
git commit -m "[#1895] Fix lifecycle reconcile: detect config/credential changes and reconnect"
```

---

### Task 9: Wire service call routing (H3)

**Files:**
- Modify: `src/worker/listener.ts` (add channel/payload to callback)
- Modify: `src/ha-connector/run.ts:85-103` (wire ServiceCallHandler)
- Test: `tests/unit/ha-connector/service-call-routing.test.ts` (create new)

**Step 1: Expand NotifyListener callback to include channel and payload**

In `src/worker/listener.ts`, change the callback type:

```typescript
interface NotifyListenerOptions {
  connectionConfig: ClientConfig;
  channels: string[];
  onNotification: (channel: string, payload: string) => void;  // CHANGED: add channel+payload
  onReconnect?: () => void;
}
```

Update the `notification` handler (line 92-94):
```typescript
client.on('notification', (msg) => {
  this.debouncedNotify(msg.channel, msg.payload ?? '');
});
```

Update debounce to carry the last channel/payload:
```typescript
private lastChannel = '';
private lastPayload = '';

private debouncedNotify(channel: string, payload: string): void {
  this.lastChannel = channel;
  this.lastPayload = payload;
  if (this.debounceTimer) {
    clearTimeout(this.debounceTimer);
  }
  this.debounceTimer = setTimeout(() => {
    this.debounceTimer = null;
    this.onNotification(this.lastChannel, this.lastPayload);
  }, 100);
}
```

**Step 2: Update run.ts to route by channel**

```typescript
import { ServiceCallHandler } from './service-calls.ts';

// After lifecycle creation:
const serviceCallHandler = new ServiceCallHandler(lifecycle);

const listener = new NotifyListener({
  connectionConfig: {},
  channels: NOTIFY_CHANNELS,
  onNotification: (channel: string, payload: string) => {
    if (shuttingDown) return;

    if (channel === 'ha_service_call' && payload) {
      void serviceCallHandler.handleNotification(payload).catch((err) => {
        console.error('[HA-Connector] Service call error:', (err as Error).message);
      });
    } else {
      void lifecycle.reconcile();
    }
  },
  onReconnect: () => {
    listenerConnected = true;
    if (!shuttingDown) {
      void lifecycle.reconcile();
    }
  },
});
```

**Step 3: Write test**

Create `tests/unit/ha-connector/service-call-routing.test.ts` verifying channel-based routing.

**Step 4: Run tests, commit**

```bash
git add src/worker/listener.ts src/ha-connector/run.ts tests/unit/ha-connector/service-call-routing.test.ts
git commit -m "[#1895] Wire service call routing: route ha_service_call NOTIFY to ServiceCallHandler"
```

**Step 5: Run full test suite**

Run: `pnpm test:unit`
Expected: PASS (may need to update other NotifyListener callers)

**Step 6: Check for other NotifyListener usages**

Search for all `new NotifyListener` and `onNotification` usages — update their callback signatures if needed. The worker's listener also uses this class.

---

## Teammate: ha-medium-low (M1-M6, L1-L2)

### Task 10: Fix swallowed batch errors (M1) and silent WS errors (M2)

**Files:**
- Modify: `src/api/geolocation/ha-event-router.ts:195`
- Modify: `src/api/geolocation/providers/home-assistant.ts:355`

**Step 1: Add logging to batch error catch**

In `ha-event-router.ts:195`:
```typescript
// BEFORE
} catch {
  // Error isolation — batch flush failure is logged but does not propagate
}
// AFTER
} catch (err) {
  console.error(`[HaEventRouter] Batch flush failed for ${processorId}:`, (err as Error).message);
}
```

**Step 2: Add logging to WS error handler**

In `home-assistant.ts:355`:
```typescript
// BEFORE
ws.on('error', () => {
  ctx.connected = false;
});
// AFTER
ws.on('error', (err: Error) => {
  ctx.connected = false;
  console.error('[HA-WS] Reconnect socket error:', err.message);
});
```

**Step 3: Commit**

```bash
git add src/api/geolocation/ha-event-router.ts src/api/geolocation/providers/home-assistant.ts
git commit -m "[#1895] Add error logging to HA batch flush and WebSocket error handlers"
```

---

### Task 11: Remove FOR UPDATE from canDeleteProvider (M4)

**Files:**
- Modify: `src/api/geolocation/service.ts:296`

**Step 1: Remove FOR UPDATE**

```typescript
// BEFORE
`SELECT owner_email, is_shared FROM geo_provider WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`
// AFTER
`SELECT owner_email, is_shared FROM geo_provider WHERE id = $1 AND deleted_at IS NULL`
```

**Step 2: Commit**

```bash
git add src/api/geolocation/service.ts
git commit -m "[#1895] Remove unnecessary FOR UPDATE from read-only canDeleteProvider query"
```

---

### Task 12: Change HA OAuth authorize to POST (M5)

**Files:**
- Modify: `src/api/server.ts` (change route from GET to POST)
- Modify: `src/api/openapi/paths/geolocation-providers.ts` (update OpenAPI spec)
- Modify: `src/ui/components/settings/use-geolocation.ts:295-308` (change apiClient.get to post)

**Step 1: Change server route from GET to POST**

Find the route registration (around line 19795) and change `server.get` to `server.post`. Move query params to body params.

**Step 2: Update frontend hook**

In `use-geolocation.ts:295-308`:
```typescript
// BEFORE
const res = await apiClient.get<{ url: string; provider_id: string }>(
  `/api/geolocation/providers/ha/authorize?instance_url=${encodeURIComponent(instanceUrl)}&label=${encodeURIComponent(label)}`,
);
// AFTER
const res = await apiClient.post<{ url: string; provider_id: string }>(
  '/api/geolocation/providers/ha/authorize',
  { instance_url: instanceUrl, label },
);
```

**Step 3: Commit**

```bash
git add src/api/server.ts src/api/openapi/paths/geolocation-providers.ts src/ui/components/settings/use-geolocation.ts
git commit -m "[#1895] Change HA OAuth authorize from GET to POST (CSRF mitigation)"
```

---

### Task 13: Add Nominatim timeout (M6)

**Files:**
- Modify: `src/api/geolocation/workers.ts:37-45`

**Step 1: Add AbortSignal timeout**

```typescript
// BEFORE
const response = await fetch(
  `https://nominatim.openstreetmap.org/reverse?...`,
  { headers: {...} }
);
// AFTER
const response = await fetch(
  `https://nominatim.openstreetmap.org/reverse?...`,
  {
    headers: {...},
    signal: AbortSignal.timeout(10_000), // 10s timeout
  }
);
```

**Step 2: Commit**

```bash
git add src/api/geolocation/workers.ts
git commit -m "[#1895] Add 10s timeout to Nominatim geocode API calls"
```

---

### Task 14: Type rowToProvider and add worker locking (L1, L2)

**Files:**
- Modify: `src/api/geolocation/service.ts:68-87` (type the row parameter)
- Modify: `src/api/geolocation/workers.ts:22,83` (add FOR UPDATE SKIP LOCKED)

**Step 1: Type rowToProvider**

```typescript
// BEFORE
/* eslint-disable @typescript-eslint/no-explicit-any */
export function rowToProvider(row: any): GeoProvider {
// AFTER
interface GeoProviderRow {
  id: string;
  owner_email: string;
  provider_type: string;
  auth_type: string;
  label: string;
  config: Record<string, unknown>;
  status: string;
  status_message: string | null;
  is_shared: boolean;
  poll_interval_seconds: number;
  max_age_seconds: number;
  last_seen_at: Date | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export function rowToProvider(row: GeoProviderRow): GeoProvider {
```

**Step 2: Add FOR UPDATE SKIP LOCKED to worker queries**

In the geocode worker query (around line 22):
```typescript
// Add FOR UPDATE SKIP LOCKED to prevent concurrent worker races
`SELECT ... FROM geo_location WHERE ... FOR UPDATE SKIP LOCKED LIMIT $1`
```

Same for embedding worker query (around line 83).

**Step 3: Commit**

```bash
git add src/api/geolocation/service.ts src/api/geolocation/workers.ts
git commit -m "[#1895] Type rowToProvider, add FOR UPDATE SKIP LOCKED to geo workers"
```

**Step 4: Run full test suite and typecheck**

Run: `pnpm test:unit && pnpm run build`
Expected: All pass

---

## Teammate: dev-session-tools (F1 — #1896)

### Task 15: Create dev session tool file with Zod schemas

**Files:**
- Create: `packages/openclaw-plugin/src/tools/dev-sessions.ts`

**Step 1: Create the tool file following the terminal-sessions pattern**

```typescript
/**
 * Dev Session plugin tools.
 * Exposes the dev-sessions REST API as OpenClaw agent tools.
 * Issue #1896.
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { PluginConfig } from '../config.js';
import { sanitizeErrorMessage } from '../utils/sanitize.js';

// ─── Shared Types ───

export interface DevSessionToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  user_id: string;
}

interface DevSessionResponse {
  id: string;
  session_name: string;
  node: string;
  status: string;
  task_summary?: string;
  branch?: string;
  container?: string;
  repo_org?: string;
  repo_name?: string;
  context_pct?: number;
  linked_issues?: string[];
  linked_prs?: string[];
  created_at: string;
  updated_at?: string;
}

// ─── Failure type (shared) ───

interface DevSessionFailure {
  success: false;
  error: string;
}

// ─── dev_session_create ───

export const DevSessionCreateParamsSchema = z.object({
  session_name: z.string().min(1).max(200),
  node: z.string().min(1).max(100),
  container: z.string().max(200).optional(),
  container_user: z.string().max(100).optional(),
  repo_org: z.string().max(100).optional(),
  repo_name: z.string().max(200).optional(),
  branch: z.string().max(200).optional(),
  task_summary: z.string().max(2000).optional(),
  task_prompt: z.string().max(10000).optional(),
  project_id: z.string().uuid().optional(),
});
export type DevSessionCreateParams = z.infer<typeof DevSessionCreateParamsSchema>;

export interface DevSessionCreateSuccess {
  success: true;
  data: { content: string; details: DevSessionResponse };
}
export type DevSessionCreateResult = DevSessionCreateSuccess | DevSessionFailure;

export interface DevSessionCreateTool {
  name: string;
  description: string;
  parameters: typeof DevSessionCreateParamsSchema;
  execute: (params: DevSessionCreateParams) => Promise<DevSessionCreateResult>;
}

export function createDevSessionCreateTool(options: DevSessionToolOptions): DevSessionCreateTool {
  const { client, logger, user_id } = options;
  return {
    name: 'dev_session_create',
    description: 'Create a new dev session to track an agent coding session. Records the node, container, repo, branch, and task being worked on.',
    parameters: DevSessionCreateParamsSchema,
    async execute(params: DevSessionCreateParams): Promise<DevSessionCreateResult> {
      const parseResult = DevSessionCreateParamsSchema.safeParse(params);
      if (!parseResult.success) {
        return { success: false, error: parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ') };
      }
      try {
        const response = await client.post<DevSessionResponse>('/api/dev-sessions', parseResult.data, { user_id });
        if (!response.success) {
          return { success: false, error: response.error.message || 'Failed to create dev session' };
        }
        return {
          success: true,
          data: {
            content: `Created dev session "${response.data.session_name}" (${response.data.id}) on ${response.data.node}`,
            details: response.data,
          },
        };
      } catch (err) {
        logger.error('dev_session_create failed', err);
        return { success: false, error: sanitizeErrorMessage(err) };
      }
    },
  };
}

// ─── dev_session_list ───

export const DevSessionListParamsSchema = z.object({
  status: z.enum(['active', 'completed', 'abandoned']).optional(),
  node: z.string().max(100).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
export type DevSessionListParams = z.infer<typeof DevSessionListParamsSchema>;

export interface DevSessionListSuccess {
  success: true;
  data: { content: string; details: DevSessionResponse[] };
}
export type DevSessionListResult = DevSessionListSuccess | DevSessionFailure;

export interface DevSessionListTool {
  name: string;
  description: string;
  parameters: typeof DevSessionListParamsSchema;
  execute: (params: DevSessionListParams) => Promise<DevSessionListResult>;
}

export function createDevSessionListTool(options: DevSessionToolOptions): DevSessionListTool {
  const { client, logger, user_id } = options;
  return {
    name: 'dev_session_list',
    description: 'List dev sessions, optionally filtered by status or node.',
    parameters: DevSessionListParamsSchema,
    async execute(params: DevSessionListParams): Promise<DevSessionListResult> {
      try {
        const queryParts: string[] = [];
        if (params.status) queryParts.push(`status=${encodeURIComponent(params.status)}`);
        if (params.node) queryParts.push(`node=${encodeURIComponent(params.node)}`);
        if (params.limit) queryParts.push(`limit=${params.limit}`);
        const qs = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';

        const response = await client.get<DevSessionResponse[]>(`/api/dev-sessions${qs}`, { user_id });
        if (!response.success) {
          return { success: false, error: response.error.message || 'Failed to list dev sessions' };
        }
        const sessions = Array.isArray(response.data) ? response.data : [];
        return {
          success: true,
          data: {
            content: `Found ${sessions.length} dev session(s)`,
            details: sessions,
          },
        };
      } catch (err) {
        logger.error('dev_session_list failed', err);
        return { success: false, error: sanitizeErrorMessage(err) };
      }
    },
  };
}

// ─── dev_session_get ───

export const DevSessionGetParamsSchema = z.object({
  id: z.string().uuid('Session ID must be a valid UUID'),
});
export type DevSessionGetParams = z.infer<typeof DevSessionGetParamsSchema>;

export interface DevSessionGetSuccess {
  success: true;
  data: { content: string; details: DevSessionResponse };
}
export type DevSessionGetResult = DevSessionGetSuccess | DevSessionFailure;

export interface DevSessionGetTool {
  name: string;
  description: string;
  parameters: typeof DevSessionGetParamsSchema;
  execute: (params: DevSessionGetParams) => Promise<DevSessionGetResult>;
}

export function createDevSessionGetTool(options: DevSessionToolOptions): DevSessionGetTool {
  const { client, logger, user_id } = options;
  return {
    name: 'dev_session_get',
    description: 'Get details of a specific dev session by ID.',
    parameters: DevSessionGetParamsSchema,
    async execute(params: DevSessionGetParams): Promise<DevSessionGetResult> {
      const parseResult = DevSessionGetParamsSchema.safeParse(params);
      if (!parseResult.success) {
        return { success: false, error: parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ') };
      }
      try {
        const response = await client.get<DevSessionResponse>(`/api/dev-sessions/${params.id}`, { user_id });
        if (!response.success) {
          return { success: false, error: response.error.message || 'Failed to get dev session' };
        }
        return {
          success: true,
          data: {
            content: `Session "${response.data.session_name}" (${response.data.status}) on ${response.data.node}`,
            details: response.data,
          },
        };
      } catch (err) {
        logger.error('dev_session_get failed', err);
        return { success: false, error: sanitizeErrorMessage(err) };
      }
    },
  };
}

// ─── dev_session_update ───

export const DevSessionUpdateParamsSchema = z.object({
  id: z.string().uuid('Session ID must be a valid UUID'),
  status: z.enum(['active', 'completed', 'abandoned']).optional(),
  task_summary: z.string().max(2000).optional(),
  task_prompt: z.string().max(10000).optional(),
  branch: z.string().max(200).optional(),
  context_pct: z.number().min(0).max(100).optional(),
  last_capture: z.string().max(50000).optional(),
  linked_issues: z.array(z.string().max(200)).optional(),
  linked_prs: z.array(z.string().max(200)).optional(),
});
export type DevSessionUpdateParams = z.infer<typeof DevSessionUpdateParamsSchema>;

export interface DevSessionUpdateSuccess {
  success: true;
  data: { content: string; details: DevSessionResponse };
}
export type DevSessionUpdateResult = DevSessionUpdateSuccess | DevSessionFailure;

export interface DevSessionUpdateTool {
  name: string;
  description: string;
  parameters: typeof DevSessionUpdateParamsSchema;
  execute: (params: DevSessionUpdateParams) => Promise<DevSessionUpdateResult>;
}

export function createDevSessionUpdateTool(options: DevSessionToolOptions): DevSessionUpdateTool {
  const { client, logger, user_id } = options;
  return {
    name: 'dev_session_update',
    description: 'Update an active dev session: progress, context percentage, linked issues/PRs, capture data.',
    parameters: DevSessionUpdateParamsSchema,
    async execute(params: DevSessionUpdateParams): Promise<DevSessionUpdateResult> {
      const parseResult = DevSessionUpdateParamsSchema.safeParse(params);
      if (!parseResult.success) {
        return { success: false, error: parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ') };
      }
      try {
        const { id, ...body } = parseResult.data;
        const response = await client.patch<DevSessionResponse>(`/api/dev-sessions/${id}`, body, { user_id });
        if (!response.success) {
          return { success: false, error: response.error.message || 'Failed to update dev session' };
        }
        return {
          success: true,
          data: {
            content: `Updated dev session "${response.data.session_name}" (${response.data.status})`,
            details: response.data,
          },
        };
      } catch (err) {
        logger.error('dev_session_update failed', err);
        return { success: false, error: sanitizeErrorMessage(err) };
      }
    },
  };
}

// ─── dev_session_complete ───

export const DevSessionCompleteParamsSchema = z.object({
  id: z.string().uuid('Session ID must be a valid UUID'),
  completion_summary: z.string().max(5000).optional(),
});
export type DevSessionCompleteParams = z.infer<typeof DevSessionCompleteParamsSchema>;

export interface DevSessionCompleteSuccess {
  success: true;
  data: { content: string; details: DevSessionResponse };
}
export type DevSessionCompleteResult = DevSessionCompleteSuccess | DevSessionFailure;

export interface DevSessionCompleteTool {
  name: string;
  description: string;
  parameters: typeof DevSessionCompleteParamsSchema;
  execute: (params: DevSessionCompleteParams) => Promise<DevSessionCompleteResult>;
}

export function createDevSessionCompleteTool(options: DevSessionToolOptions): DevSessionCompleteTool {
  const { client, logger, user_id } = options;
  return {
    name: 'dev_session_complete',
    description: 'Mark a dev session as complete with an optional summary of work done.',
    parameters: DevSessionCompleteParamsSchema,
    async execute(params: DevSessionCompleteParams): Promise<DevSessionCompleteResult> {
      const parseResult = DevSessionCompleteParamsSchema.safeParse(params);
      if (!parseResult.success) {
        return { success: false, error: parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ') };
      }
      try {
        const body = params.completion_summary ? { completion_summary: params.completion_summary } : {};
        const response = await client.post<DevSessionResponse>(`/api/dev-sessions/${params.id}/complete`, body, { user_id });
        if (!response.success) {
          return { success: false, error: response.error.message || 'Failed to complete dev session' };
        }
        return {
          success: true,
          data: {
            content: `Completed dev session "${response.data.session_name}"`,
            details: response.data,
          },
        };
      } catch (err) {
        logger.error('dev_session_complete failed', err);
        return { success: false, error: sanitizeErrorMessage(err) };
      }
    },
  };
}
```

**Step 2: Commit**

```bash
git add packages/openclaw-plugin/src/tools/dev-sessions.ts
git commit -m "[#1896] Add dev session plugin tools: create, list, get, update, complete"
```

---

### Task 16: Export from barrel and register tools

**Files:**
- Modify: `packages/openclaw-plugin/src/tools/index.ts`
- Modify: `packages/openclaw-plugin/src/register-openclaw.ts`

**Step 1: Add exports to index.ts**

Add to the end of `packages/openclaw-plugin/src/tools/index.ts`:

```typescript
// Dev session tools (Issue #1896)
export {
  createDevSessionCreateTool,
  createDevSessionListTool,
  createDevSessionGetTool,
  createDevSessionUpdateTool,
  createDevSessionCompleteTool,
  DevSessionCreateParamsSchema,
  DevSessionListParamsSchema,
  DevSessionGetParamsSchema,
  DevSessionUpdateParamsSchema,
  DevSessionCompleteParamsSchema,
  type DevSessionCreateParams,
  type DevSessionListParams,
  type DevSessionGetParams,
  type DevSessionUpdateParams,
  type DevSessionCompleteParams,
  type DevSessionCreateTool,
  type DevSessionListTool,
  type DevSessionGetTool,
  type DevSessionUpdateTool,
  type DevSessionCompleteTool,
  type DevSessionCreateResult,
  type DevSessionListResult,
  type DevSessionGetResult,
  type DevSessionUpdateResult,
  type DevSessionCompleteResult,
  type DevSessionToolOptions,
} from './dev-sessions.js';
```

**Step 2: Register in register-openclaw.ts**

Find the terminal tools registration block (around lines 4738-4784) and add a similar block for dev session tools immediately after:

```typescript
// Dev session tools (Issue #1896)
const devSessionToolFactories = [
  createDevSessionCreateTool,
  createDevSessionListTool,
  createDevSessionGetTool,
  createDevSessionUpdateTool,
  createDevSessionCompleteTool,
] as const;

for (const factory of devSessionToolFactories) {
  const tool = (factory as (opts: typeof termToolOpts) => { name: string; description: string; parameters: unknown; execute: (params: any) => Promise<any> })(termToolOpts);
  tools.push({
    name: tool.name,
    description: tool.description,
    parameters: zodToJsonSchema(tool.parameters as import('zod').ZodTypeAny),
    execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
      const result = await tool.execute(params);
      return toAgentToolResult(result);
    },
  });
}
```

**Step 3: Commit**

```bash
git add packages/openclaw-plugin/src/tools/index.ts packages/openclaw-plugin/src/register-openclaw.ts
git commit -m "[#1896] Register dev session tools in plugin barrel and OpenClaw registration"
```

---

### Task 17: Write tests for dev session tools

**Files:**
- Create: `tests/unit/tools/dev-sessions.test.ts`

**Step 1: Write tests for all 5 tools**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createDevSessionCreateTool,
  createDevSessionListTool,
  createDevSessionGetTool,
  createDevSessionUpdateTool,
  createDevSessionCompleteTool,
} from '@/../../packages/openclaw-plugin/src/tools/dev-sessions';

const mockClient = {
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
};

const mockLogger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
const baseOpts = { client: mockClient as any, logger: mockLogger as any, config: {} as any, user_id: 'agent-1' };

describe('dev_session_create', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates session and returns formatted result', async () => {
    mockClient.post.mockResolvedValueOnce({
      success: true,
      data: { id: 'uuid-1', session_name: 'fix-bug', node: 'MST001', status: 'active' },
    });

    const tool = createDevSessionCreateTool(baseOpts);
    const result = await tool.execute({ session_name: 'fix-bug', node: 'MST001' });

    expect(result.success).toBe(true);
    expect(result.success && result.data.content).toContain('fix-bug');
    expect(mockClient.post).toHaveBeenCalledWith('/api/dev-sessions', expect.any(Object), { user_id: 'agent-1' });
  });

  it('returns validation error for missing node', async () => {
    const tool = createDevSessionCreateTool(baseOpts);
    const result = await tool.execute({ session_name: 'test' } as any);
    expect(result.success).toBe(false);
  });
});

describe('dev_session_list', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists sessions with filters', async () => {
    mockClient.get.mockResolvedValueOnce({
      success: true,
      data: [{ id: 'uuid-1', session_name: 'test', node: 'MST001', status: 'active' }],
    });

    const tool = createDevSessionListTool(baseOpts);
    const result = await tool.execute({ status: 'active', node: 'MST001' });

    expect(result.success).toBe(true);
    expect(mockClient.get).toHaveBeenCalledWith(
      expect.stringContaining('status=active'),
      { user_id: 'agent-1' },
    );
  });
});

describe('dev_session_get', () => {
  beforeEach(() => vi.clearAllMocks());

  it('gets session by ID', async () => {
    const uuid = '00000000-0000-0000-0000-000000000001';
    mockClient.get.mockResolvedValueOnce({
      success: true,
      data: { id: uuid, session_name: 'test', node: 'MST001', status: 'active' },
    });

    const tool = createDevSessionGetTool(baseOpts);
    const result = await tool.execute({ id: uuid });

    expect(result.success).toBe(true);
    expect(mockClient.get).toHaveBeenCalledWith(`/api/dev-sessions/${uuid}`, { user_id: 'agent-1' });
  });
});

describe('dev_session_update', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates session fields', async () => {
    const uuid = '00000000-0000-0000-0000-000000000001';
    mockClient.patch.mockResolvedValueOnce({
      success: true,
      data: { id: uuid, session_name: 'test', node: 'MST001', status: 'active', context_pct: 75 },
    });

    const tool = createDevSessionUpdateTool(baseOpts);
    const result = await tool.execute({ id: uuid, context_pct: 75, linked_issues: ['#100'] });

    expect(result.success).toBe(true);
    expect(mockClient.patch).toHaveBeenCalledWith(
      `/api/dev-sessions/${uuid}`,
      { context_pct: 75, linked_issues: ['#100'] },
      { user_id: 'agent-1' },
    );
  });
});

describe('dev_session_complete', () => {
  beforeEach(() => vi.clearAllMocks());

  it('completes session with summary', async () => {
    const uuid = '00000000-0000-0000-0000-000000000001';
    mockClient.post.mockResolvedValueOnce({
      success: true,
      data: { id: uuid, session_name: 'test', node: 'MST001', status: 'completed' },
    });

    const tool = createDevSessionCompleteTool(baseOpts);
    const result = await tool.execute({ id: uuid, completion_summary: 'Fixed the bug' });

    expect(result.success).toBe(true);
    expect(mockClient.post).toHaveBeenCalledWith(
      `/api/dev-sessions/${uuid}/complete`,
      { completion_summary: 'Fixed the bug' },
      { user_id: 'agent-1' },
    );
  });
});
```

**Step 2: Run tests**

Run: `pnpm exec vitest run tests/unit/tools/dev-sessions.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/unit/tools/dev-sessions.test.ts
git commit -m "[#1896] Add unit tests for all 5 dev session plugin tools"
```

---

## Lead: Integration (Phase 2-4)

### Task 18: Merge all branches into omnibus

**Step 1:** Create omnibus branch from main
```bash
git checkout main && git pull
git checkout -b omnibus/1895-1896-ha-fixes-dev-session-tools
```

**Step 2:** Merge each teammate's branch
```bash
git merge omnibus/ha-critical --no-ff
git merge omnibus/ha-high --no-ff
git merge omnibus/ha-medium-low --no-ff
git merge omnibus/dev-session-tools --no-ff
```

**Step 3:** Resolve any conflicts (expected: minimal, files don't overlap much)

### Task 19: Full test suite and typecheck

```bash
pnpm install --frozen-lockfile
pnpm run build
pnpm test:unit
pnpm test:integration  # if DB available
```

Fix any failures.

### Task 20: Create omnibus PR

```bash
gh pr create \
  --title "[#1895, #1896] Omnibus: Fix all HA integration bugs + Dev session plugin tools" \
  --body "$(cat <<'EOF'
## Summary
- Fixes 18 Home Assistant geolocation integration bugs found during deep review (Claude Code + Codex CLI)
- Adds dev session plugin tools for agent self-reporting (#1896)

### Critical fixes
- **C1**: Auto-inject uses wrong column name (`user_email` → `email`) — all geo injection was broken
- **C2**: `FOR UPDATE` with `COUNT(*)` — PostgreSQL error on provider creation
- **C3**: Location data never persisted — `GeoIngestorProcessor` callback only logged, never called `ingestLocationUpdate()`
- **C4**: Cross-user location leak on shared providers — missing `gl.user_email` filter

### High-priority fixes
- **H1**: WebSocket never reconnects after initial successful connection closes
- **H2**: Lifecycle `reconcile()` ignores config/credential changes for existing providers
- **H3**: `ha_service_call` NOTIFY channel not routed to ServiceCallHandler
- **H4**: OAuth token refresh uses wrong `clientId` (HA origin instead of PUBLIC_BASE_URL)

### Medium/Low fixes
- M1-M4: Error logging, error handling, unnecessary FOR UPDATE removal
- M5: HA OAuth authorize changed from GET to POST (CSRF mitigation)
- M6: Nominatim API timeout added
- L1-L2: Type safety, worker race prevention

### Feature
- **F1**: Dev session plugin tools: `dev_session_create`, `dev_session_list`, `dev_session_get`, `dev_session_update`, `dev_session_complete`

Closes #1895
Closes #1896

## Test plan
- [ ] Unit tests pass (`pnpm test:unit`)
- [ ] Integration tests pass (`pnpm test:integration`)
- [ ] Typecheck passes (`pnpm run build`)
- [ ] Provider creation works (no FOR UPDATE error)
- [ ] Auto-inject queries correct column
- [ ] HA WebSocket reconnects after disconnect
- [ ] Location updates persist to geo_location table
- [ ] Shared provider only returns requesting user's location

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
