/**
 * Unit tests for Symphony REST API routes.
 * Epic #2186, Issue #2204
 *
 * Tests route handler logic, auth enforcement, namespace scoping, pagination.
 * Uses Fastify inject() to test routes without HTTP transport.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { symphonyRoutesPlugin } from '../../src/api/symphony/routes.ts';

// ─── mock pool ────────────────────────────────────────────────
function createMockPool() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: vi.fn(),
    end: vi.fn(),
  };
}

// ─── fake namespace context decorator ─────────────────────────
function buildApp(pool: ReturnType<typeof createMockPool>, namespaceContext: unknown = null) {
  const app = Fastify({ logger: false });

  // Simulate auth middleware by decorating request
  app.decorateRequest('namespaceContext', null);
  app.addHook('onRequest', async (req) => {
    (req as Record<string, unknown>).namespaceContext = namespaceContext;
  });

  app.register(symphonyRoutesPlugin, { pool: pool as never });
  return app;
}

const VALID_NS_CTX = {
  storeNamespace: 'test-ns',
  queryNamespaces: ['test-ns'],
  isM2M: false,
  roles: { 'test-ns': 'readwrite' as const },
};

const READ_ONLY_NS_CTX = {
  storeNamespace: 'test-ns',
  queryNamespaces: ['test-ns'],
  isM2M: false,
  roles: { 'test-ns': 'read' as const },
};

const VALID_UUID = '00000000-0000-0000-0000-000000000001';
const VALID_UUID_2 = '00000000-0000-0000-0000-000000000002';

// ============================================================
// AUTH + NAMESPACE SCOPING
// ============================================================

describe('Symphony REST API — auth enforcement', () => {
  let pool: ReturnType<typeof createMockPool>;
  let app: FastifyInstance;

  beforeAll(async () => {
    pool = createMockPool();
    app = buildApp(pool, null); // null = no auth
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 403 for GET /symphony/config/:project_id without namespace', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/symphony/config/${VALID_UUID}`,
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 403 for PUT /symphony/config/:project_id without namespace', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/symphony/config/${VALID_UUID}`,
      payload: { config: {} },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 403 for GET /symphony/runs without namespace', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/symphony/runs',
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 403 for GET /symphony/dashboard/status without namespace', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/symphony/dashboard/status',
    });
    expect(res.statusCode).toBe(403);
  });
});

// ============================================================
// READ-ONLY ROLE ENFORCEMENT
// ============================================================

describe('Symphony REST API — read-only role enforcement', () => {
  let pool: ReturnType<typeof createMockPool>;
  let app: FastifyInstance;

  beforeAll(async () => {
    pool = createMockPool();
    app = buildApp(pool, READ_ONLY_NS_CTX);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows GET /symphony/runs for read-only users', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 });
    const res = await app.inject({
      method: 'GET',
      url: '/symphony/runs',
    });
    expect(res.statusCode).toBe(200);
  });

  it('denies PUT /symphony/config/:project_id for read-only users', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/symphony/config/${VALID_UUID}`,
      payload: { config: {} },
    });
    expect(res.statusCode).toBe(403);
  });

  it('denies POST /symphony/runs/:id/cancel for read-only users', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/symphony/runs/${VALID_UUID}/cancel`,
    });
    expect(res.statusCode).toBe(403);
  });
});

// ============================================================
// PAGINATION
// ============================================================

describe('Symphony REST API — pagination', () => {
  let pool: ReturnType<typeof createMockPool>;
  let app: FastifyInstance;

  beforeAll(async () => {
    pool = createMockPool();
    app = buildApp(pool, VALID_NS_CTX);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('applies default pagination to /symphony/runs', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 });

    const res = await app.inject({
      method: 'GET',
      url: '/symphony/runs',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
  });

  it('clamps limit to max 500', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 });

    const res = await app.inject({
      method: 'GET',
      url: '/symphony/runs?limit=1000&offset=10',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.limit).toBe(500);
    expect(body.offset).toBe(10);
  });

  it('rejects negative offset', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 });

    const res = await app.inject({
      method: 'GET',
      url: '/symphony/runs?offset=-5',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.offset).toBe(0); // normalized to 0
  });
});

// ============================================================
// CONFIG ENDPOINTS
// ============================================================

describe('Symphony REST API — config CRUD', () => {
  let pool: ReturnType<typeof createMockPool>;
  let app: FastifyInstance;

  beforeAll(async () => {
    pool = createMockPool();
    app = buildApp(pool, VALID_NS_CTX);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /symphony/config/:project_id returns config', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: VALID_UUID, project_id: VALID_UUID, config: { max_concurrent: 2 }, version: 1 }],
      rowCount: 1,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/symphony/config/${VALID_UUID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toBeDefined();
  });

  it('GET /symphony/config/:project_id returns 404 if not found', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await app.inject({
      method: 'GET',
      url: `/symphony/config/${VALID_UUID}`,
    });

    expect(res.statusCode).toBe(404);
  });

  it('GET /symphony/config/:project_id returns 400 for invalid UUID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/symphony/config/not-a-uuid',
    });

    expect(res.statusCode).toBe(400);
  });

  it('PUT /symphony/config/:project_id creates/updates config', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: VALID_UUID, project_id: VALID_UUID, config: { max_concurrent: 3 }, version: 2 }],
      rowCount: 1,
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/symphony/config/${VALID_UUID}`,
      payload: { config: { max_concurrent: 3 } },
    });

    expect(res.statusCode).toBe(200);
  });

  it('DELETE /symphony/config/:project_id deletes config', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: VALID_UUID }], rowCount: 1 });

    const res = await app.inject({
      method: 'DELETE',
      url: `/symphony/config/${VALID_UUID}`,
    });

    expect(res.statusCode).toBe(200);
  });
});

// ============================================================
// REPO ENDPOINTS
// ============================================================

describe('Symphony REST API — repo CRUD', () => {
  let pool: ReturnType<typeof createMockPool>;
  let app: FastifyInstance;

  beforeAll(async () => {
    pool = createMockPool();
    app = buildApp(pool, VALID_NS_CTX);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /symphony/projects/:id/repos returns repos list', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: VALID_UUID, org: 'test', repo: 'test-repo' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ total: '1' }], rowCount: 1 });

    const res = await app.inject({
      method: 'GET',
      url: `/symphony/projects/${VALID_UUID}/repos`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toHaveLength(1);
  });

  it('POST /symphony/projects/:id/repos creates a repo', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: VALID_UUID_2, project_id: VALID_UUID, org: 'myorg', repo: 'myrepo' }],
      rowCount: 1,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/symphony/projects/${VALID_UUID}/repos`,
      payload: { org: 'myorg', repo: 'myrepo', default_branch: 'main' },
    });

    expect(res.statusCode).toBe(201);
  });

  it('POST /symphony/projects/:id/repos requires org and repo', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/symphony/projects/${VALID_UUID}/repos`,
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });
});

// ============================================================
// HOST ENDPOINTS
// ============================================================

describe('Symphony REST API — host CRUD + actions', () => {
  let pool: ReturnType<typeof createMockPool>;
  let app: FastifyInstance;

  beforeAll(async () => {
    pool = createMockPool();
    app = buildApp(pool, VALID_NS_CTX);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /symphony/projects/:id/hosts returns hosts list', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 });

    const res = await app.inject({
      method: 'GET',
      url: `/symphony/projects/${VALID_UUID}/hosts`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toHaveLength(0);
  });

  it('POST /symphony/projects/:id/hosts/:host_id/drain marks host as drained', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: VALID_UUID_2 }],
      rowCount: 1,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/symphony/projects/${VALID_UUID}/hosts/${VALID_UUID_2}/drain`,
    });

    expect(res.statusCode).toBe(200);
  });

  it('POST /symphony/projects/:id/hosts/:host_id/activate marks host as active', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: VALID_UUID_2 }],
      rowCount: 1,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/symphony/projects/${VALID_UUID}/hosts/${VALID_UUID_2}/activate`,
    });

    expect(res.statusCode).toBe(200);
  });
});

// ============================================================
// TOOL ENDPOINTS
// ============================================================

describe('Symphony REST API — tool CRUD', () => {
  let pool: ReturnType<typeof createMockPool>;
  let app: FastifyInstance;

  beforeAll(async () => {
    pool = createMockPool();
    app = buildApp(pool, VALID_NS_CTX);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /symphony/tools returns tools list', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 });

    const res = await app.inject({
      method: 'GET',
      url: '/symphony/tools',
    });

    expect(res.statusCode).toBe(200);
  });

  it('POST /symphony/tools creates a tool', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: VALID_UUID, tool_name: 'claude-code', command: 'claude' }],
      rowCount: 1,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/symphony/tools',
      payload: { tool_name: 'claude-code', command: 'claude' },
    });

    expect(res.statusCode).toBe(201);
  });
});

// ============================================================
// RUN ENDPOINTS
// ============================================================

describe('Symphony REST API — run list/detail/actions', () => {
  let pool: ReturnType<typeof createMockPool>;
  let app: FastifyInstance;

  beforeAll(async () => {
    pool = createMockPool();
    app = buildApp(pool, VALID_NS_CTX);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /symphony/runs returns paginated list', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: VALID_UUID, status: 'running', stage: 'coding' }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ total: '1' }], rowCount: 1 });

    const res = await app.inject({
      method: 'GET',
      url: '/symphony/runs',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  it('GET /symphony/runs filters by status', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 });

    const res = await app.inject({
      method: 'GET',
      url: '/symphony/runs?status=running',
    });

    expect(res.statusCode).toBe(200);
    // Verify that one of the query calls includes a status filter
    const allCalls = pool.query.mock.calls;
    const hasStatusFilter = allCalls.some(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('status = $'),
    );
    expect(hasStatusFilter).toBe(true);
  });

  it('GET /symphony/runs/:id returns run detail', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: VALID_UUID,
        status: 'running',
        stage: 'coding',
        work_item_id: VALID_UUID_2,
      }],
      rowCount: 1,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/symphony/runs/${VALID_UUID}`,
    });

    expect(res.statusCode).toBe(200);
  });

  it('GET /symphony/runs/:id returns 404 for missing run', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await app.inject({
      method: 'GET',
      url: `/symphony/runs/${VALID_UUID}`,
    });

    expect(res.statusCode).toBe(404);
  });

  it('POST /symphony/runs/:id/cancel cancels a run', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: VALID_UUID, status: 'cancelled' }],
      rowCount: 1,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/symphony/runs/${VALID_UUID}/cancel`,
    });

    expect(res.statusCode).toBe(200);
  });

  it('POST /symphony/runs/:id/retry retries a run', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: VALID_UUID, status: 'retry_queued' }],
      rowCount: 1,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/symphony/runs/${VALID_UUID}/retry`,
    });

    expect(res.statusCode).toBe(200);
  });

  it('POST /symphony/runs/:id/approve approves a run', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: VALID_UUID, status: 'running' }],
      rowCount: 1,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/symphony/runs/${VALID_UUID}/approve`,
    });

    expect(res.statusCode).toBe(200);
  });

  it('POST /symphony/runs/:id/merge triggers merge', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: VALID_UUID, status: 'merge_pending' }],
      rowCount: 1,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/symphony/runs/${VALID_UUID}/merge`,
    });

    expect(res.statusCode).toBe(200);
  });

  it('GET /symphony/runs/:id/events returns events', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [
          { id: VALID_UUID, kind: 'state_change', payload: {}, emitted_at: new Date().toISOString() },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ total: '1' }], rowCount: 1 });

    const res = await app.inject({
      method: 'GET',
      url: `/symphony/runs/${VALID_UUID}/events`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toHaveLength(1);
  });

  it('GET /symphony/runs/:id/terminal returns terminal sessions', async () => {
    // First call: run existence check (must find the run)
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: VALID_UUID }], rowCount: 1 })
      // Second call: terminal sessions
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await app.inject({
      method: 'GET',
      url: `/symphony/runs/${VALID_UUID}/terminal`,
    });

    expect(res.statusCode).toBe(200);
  });
});

// ============================================================
// DASHBOARD ENDPOINTS
// ============================================================

describe('Symphony REST API — dashboard', () => {
  let pool: ReturnType<typeof createMockPool>;
  let app: FastifyInstance;

  beforeAll(async () => {
    pool = createMockPool();
    app = buildApp(pool, VALID_NS_CTX);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /symphony/dashboard/status returns status summary', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ status: 'running', count: '3' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ last_heartbeat_at: new Date().toISOString() }], rowCount: 1 });

    const res = await app.inject({
      method: 'GET',
      url: '/symphony/dashboard/status',
    });

    expect(res.statusCode).toBe(200);
  });

  it('GET /symphony/dashboard/queue returns queue entries', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 });

    const res = await app.inject({
      method: 'GET',
      url: '/symphony/dashboard/queue',
    });

    expect(res.statusCode).toBe(200);
  });

  it('GET /symphony/dashboard/health returns health info', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ active: '2' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ last_heartbeat_at: new Date().toISOString(), orchestrator_id: 'test' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await app.inject({
      method: 'GET',
      url: '/symphony/dashboard/health',
    });

    expect(res.statusCode).toBe(200);
  });
});

// ============================================================
// SYNC ENDPOINTS
// ============================================================

describe('Symphony REST API — sync', () => {
  let pool: ReturnType<typeof createMockPool>;
  let app: FastifyInstance;

  beforeAll(async () => {
    pool = createMockPool();
    app = buildApp(pool, VALID_NS_CTX);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /symphony/sync/:project_id triggers sync', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: VALID_UUID, project_id: VALID_UUID }],
      rowCount: 1,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/symphony/sync/${VALID_UUID}`,
    });

    expect(res.statusCode).toBe(202);
  });

  it('GET /symphony/sync/:project_id/status returns sync status', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ project_id: VALID_UUID, last_synced_at: new Date().toISOString() }],
      rowCount: 1,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/symphony/sync/${VALID_UUID}/status`,
    });

    expect(res.statusCode).toBe(200);
  });
});

// ============================================================
// CLEANUP ENDPOINTS
// ============================================================

describe('Symphony REST API — cleanup', () => {
  let pool: ReturnType<typeof createMockPool>;
  let app: FastifyInstance;

  beforeAll(async () => {
    pool = createMockPool();
    app = buildApp(pool, VALID_NS_CTX);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /symphony/cleanup returns pending items', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 });

    const res = await app.inject({
      method: 'GET',
      url: '/symphony/cleanup',
    });

    expect(res.statusCode).toBe(200);
  });

  it('POST /symphony/cleanup/:id/resolve resolves an item', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: VALID_UUID, status: 'completed' }],
      rowCount: 1,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/symphony/cleanup/${VALID_UUID}/resolve`,
    });

    expect(res.statusCode).toBe(200);
  });
});
