/**
 * Tests for HA REST API routes (routines, anomalies, observations).
 * Issue #1460, Epic #1440.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

import { haRoutesPlugin } from './ha-routes.ts';

// ---------- helpers ----------

function mockPool(queryFn: ReturnType<typeof vi.fn>): Pool {
  return { query: queryFn } as unknown as Pool;
}

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440001';
const OTHER_UUID = '660e8400-e29b-41d4-a716-446655440002';

function makeRoutineRow(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_UUID,
    namespace: 'default',
    key: 'bedtime:22:monday,tuesday',
    title: 'Evening Bedtime',
    description: 'Detected bedtime pattern',
    confidence: 0.8,
    observations_count: 5,
    first_seen: new Date('2026-02-10T22:00:00Z'),
    last_seen: new Date('2026-02-18T22:00:00Z'),
    time_window: { start_hour: 22, end_hour: 23, avg_duration_minutes: 15 },
    days: ['monday', 'tuesday'],
    sequence: [{ entity_id: 'light.bedroom', domain: 'light', to_state: 'off', offset_minutes: 0 }],
    status: 'tentative',
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function makeAnomalyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: OTHER_UUID,
    namespace: 'default',
    timestamp: new Date('2026-02-18T22:30:00Z'),
    routine_id: VALID_UUID,
    score: 7,
    reason: 'Unexpected activity',
    entities: ['switch.garage'],
    notified: true,
    resolved: false,
    context: {},
    created_at: new Date(),
    ...overrides,
  };
}

async function buildApp(queryFn: ReturnType<typeof vi.fn>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Decorate request with namespaceContext (simulates middleware)
  app.decorateRequest('namespaceContext', null);
  app.addHook('preHandler', async (req) => {
    req.namespaceContext = {
      storeNamespace: 'default',
      queryNamespaces: ['default'],
      isM2M: false,
      roles: { default: 'member' },
    };
  });

  await app.register(haRoutesPlugin, { pool: mockPool(queryFn) });
  await app.ready();
  return app;
}

/** Build an app with no namespace context (simulates unauthenticated/no-grants user). */
async function buildAppNoContext(queryFn: ReturnType<typeof vi.fn>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorateRequest('namespaceContext', null);
  // No preHandler → namespaceContext stays null
  await app.register(haRoutesPlugin, { pool: mockPool(queryFn) });
  await app.ready();
  return app;
}

/** Build an app with observer role (read-only, should be denied writes). */
async function buildAppObserver(queryFn: ReturnType<typeof vi.fn>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorateRequest('namespaceContext', null);
  app.addHook('preHandler', async (req) => {
    req.namespaceContext = {
      storeNamespace: 'default',
      queryNamespaces: ['default'],
      isM2M: false,
      roles: { default: 'observer' },
    };
  });
  await app.register(haRoutesPlugin, { pool: mockPool(queryFn) });
  await app.ready();
  return app;
}

// ---------- tests ----------

describe('haRoutesPlugin', () => {
  let queryFn: ReturnType<typeof vi.fn>;
  let app: FastifyInstance;

  beforeEach(async () => {
    queryFn = vi.fn();
    app = await buildApp(queryFn);
  });

  // ── Routines ──────────────────────────────────────────────────

  describe('GET /api/ha/routines', () => {
    it('returns paginated routines', async () => {
      const row = makeRoutineRow();
      queryFn
        .mockResolvedValueOnce({ rows: [row], rowCount: 1 }) // data
        .mockResolvedValueOnce({ rows: [{ total: '1' }], rowCount: 1 }); // count

      const res = await app.inject({ method: 'GET', url: '/api/ha/routines' });
      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.payload);
      expect(body.data).toHaveLength(1);
      expect(body.total).toBe(1);
      expect(body.limit).toBe(50);
      expect(body.offset).toBe(0);
    });

    it('filters by status', async () => {
      queryFn
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 });

      const res = await app.inject({
        method: 'GET',
        url: '/api/ha/routines?status=confirmed',
      });
      expect(res.statusCode).toBe(200);

      // Verify query includes status filter
      const sql = queryFn.mock.calls[0][0] as string;
      expect(sql).toContain('status = $');
    });

    it('rejects invalid status', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/ha/routines?status=invalid',
      });
      expect(res.statusCode).toBe(400);
    });

    it('filters by min_confidence', async () => {
      queryFn
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 });

      const res = await app.inject({
        method: 'GET',
        url: '/api/ha/routines?min_confidence=0.5',
      });
      expect(res.statusCode).toBe(200);

      const sql = queryFn.mock.calls[0][0] as string;
      expect(sql).toContain('confidence >= $');
    });

    it('rejects invalid min_confidence', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/ha/routines?min_confidence=2.0',
      });
      expect(res.statusCode).toBe(400);
    });

    it('respects limit and offset', async () => {
      queryFn
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 });

      const res = await app.inject({
        method: 'GET',
        url: '/api/ha/routines?limit=10&offset=20',
      });

      const body = JSON.parse(res.payload);
      expect(body.limit).toBe(10);
      expect(body.offset).toBe(20);
    });

    it('clamps limit to max 500', async () => {
      queryFn
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 });

      const res = await app.inject({
        method: 'GET',
        url: '/api/ha/routines?limit=9999',
      });

      const body = JSON.parse(res.payload);
      expect(body.limit).toBe(500);
    });
  });

  describe('GET /api/ha/routines/:id', () => {
    it('returns routine by ID', async () => {
      const row = makeRoutineRow();
      queryFn.mockResolvedValueOnce({ rows: [row], rowCount: 1 });

      const res = await app.inject({
        method: 'GET',
        url: `/api/ha/routines/${VALID_UUID}`,
      });
      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.payload);
      expect(body.data.id).toBe(VALID_UUID);
    });

    it('returns 404 for unknown routine', async () => {
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const res = await app.inject({
        method: 'GET',
        url: `/api/ha/routines/${OTHER_UUID}`,
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for invalid UUID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/ha/routines/not-a-uuid',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('PATCH /api/ha/routines/:id', () => {
    it('updates routine title', async () => {
      const row = makeRoutineRow({ title: 'Updated Title' });
      queryFn.mockResolvedValueOnce({ rows: [row], rowCount: 1 });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/ha/routines/${VALID_UUID}`,
        payload: { title: 'Updated Title' },
      });
      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.payload);
      expect(body.data.title).toBe('Updated Title');
    });

    it('returns 400 with empty body', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/ha/routines/${VALID_UUID}`,
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 with empty title', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/ha/routines/${VALID_UUID}`,
        payload: { title: '  ' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 404 for non-existent routine', async () => {
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/ha/routines/${OTHER_UUID}`,
        payload: { title: 'Test' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/ha/routines/:id', () => {
    it('soft deletes by setting status to archived', async () => {
      queryFn.mockResolvedValueOnce({ rows: [{ id: VALID_UUID }], rowCount: 1 });

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/ha/routines/${VALID_UUID}`,
      });
      expect(res.statusCode).toBe(204);

      const sql = queryFn.mock.calls[0][0] as string;
      expect(sql).toContain("status = 'archived'");
    });

    it('returns 404 for non-existent routine', async () => {
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/ha/routines/${OTHER_UUID}`,
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /api/ha/routines/:id/confirm', () => {
    it('confirms a routine', async () => {
      const row = makeRoutineRow({ status: 'confirmed' });
      queryFn.mockResolvedValueOnce({ rows: [row], rowCount: 1 });

      const res = await app.inject({
        method: 'POST',
        url: `/api/ha/routines/${VALID_UUID}/confirm`,
      });
      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.payload);
      expect(body.data.status).toBe('confirmed');
    });

    it('returns 404 for archived routine', async () => {
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const res = await app.inject({
        method: 'POST',
        url: `/api/ha/routines/${VALID_UUID}/confirm`,
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /api/ha/routines/:id/reject', () => {
    it('rejects a routine', async () => {
      const row = makeRoutineRow({ status: 'rejected' });
      queryFn.mockResolvedValueOnce({ rows: [row], rowCount: 1 });

      const res = await app.inject({
        method: 'POST',
        url: `/api/ha/routines/${VALID_UUID}/reject`,
      });
      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.payload);
      expect(body.data.status).toBe('rejected');
    });
  });

  describe('GET /api/ha/routines/:id/observations', () => {
    it('returns observations for a routine', async () => {
      const routine = makeRoutineRow();
      queryFn
        .mockResolvedValueOnce({ rows: [routine], rowCount: 1 }) // routine lookup
        .mockResolvedValueOnce({ rows: [{ entity_id: 'light.bedroom', timestamp: new Date() }], rowCount: 1 }) // observations
        .mockResolvedValueOnce({ rows: [{ total: '1' }], rowCount: 1 }); // count

      const res = await app.inject({
        method: 'GET',
        url: `/api/ha/routines/${VALID_UUID}/observations`,
      });
      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.payload);
      expect(body.data).toHaveLength(1);
    });

    it('returns 404 for non-existent routine', async () => {
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const res = await app.inject({
        method: 'GET',
        url: `/api/ha/routines/${OTHER_UUID}/observations`,
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Anomalies ─────────────────────────────────────────────────

  describe('GET /api/ha/anomalies', () => {
    it('returns paginated anomalies', async () => {
      const row = makeAnomalyRow();
      queryFn
        .mockResolvedValueOnce({ rows: [row], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ total: '1' }], rowCount: 1 });

      const res = await app.inject({ method: 'GET', url: '/api/ha/anomalies' });
      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.payload);
      expect(body.data).toHaveLength(1);
      expect(body.total).toBe(1);
    });

    it('filters by resolved', async () => {
      queryFn
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 });

      const res = await app.inject({
        method: 'GET',
        url: '/api/ha/anomalies?resolved=false',
      });
      expect(res.statusCode).toBe(200);

      const sql = queryFn.mock.calls[0][0] as string;
      expect(sql).toContain('resolved = $');
    });

    it('filters by min_score', async () => {
      queryFn
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 });

      const res = await app.inject({
        method: 'GET',
        url: '/api/ha/anomalies?min_score=5',
      });
      expect(res.statusCode).toBe(200);

      const sql = queryFn.mock.calls[0][0] as string;
      expect(sql).toContain('score >= $');
    });

    it('rejects invalid min_score', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/ha/anomalies?min_score=15',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('PATCH /api/ha/anomalies/:id', () => {
    it('resolves an anomaly', async () => {
      const row = makeAnomalyRow({ resolved: true });
      queryFn.mockResolvedValueOnce({ rows: [row], rowCount: 1 });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/ha/anomalies/${OTHER_UUID}`,
        payload: { resolved: true },
      });
      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.payload);
      expect(body.data.resolved).toBe(true);
    });

    it('adds notes to anomaly', async () => {
      const row = makeAnomalyRow({ context: { notes: 'Fixed it' } });
      queryFn.mockResolvedValueOnce({ rows: [row], rowCount: 1 });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/ha/anomalies/${OTHER_UUID}`,
        payload: { notes: 'Fixed it' },
      });
      expect(res.statusCode).toBe(200);
    });

    it('returns 400 with empty body', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/ha/anomalies/${OTHER_UUID}`,
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for invalid resolved type', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/ha/anomalies/${OTHER_UUID}`,
        payload: { resolved: 'yes' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 404 for non-existent anomaly', async () => {
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/ha/anomalies/${VALID_UUID}`,
        payload: { resolved: true },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Observations ──────────────────────────────────────────────

  describe('GET /api/ha/observations', () => {
    it('returns paginated observations', async () => {
      const row = { entity_id: 'light.bedroom', domain: 'light', timestamp: new Date(), score: 5 };
      queryFn
        .mockResolvedValueOnce({ rows: [row], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ total: '1' }], rowCount: 1 });

      const res = await app.inject({ method: 'GET', url: '/api/ha/observations' });
      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.payload);
      expect(body.data).toHaveLength(1);
      expect(body.total).toBe(1);
    });

    it('filters by entity_id', async () => {
      queryFn
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 });

      const res = await app.inject({
        method: 'GET',
        url: '/api/ha/observations?entity_id=light.bedroom',
      });
      expect(res.statusCode).toBe(200);

      const sql = queryFn.mock.calls[0][0] as string;
      expect(sql).toContain('entity_id = $');
    });

    it('filters by domain', async () => {
      queryFn
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 });

      const res = await app.inject({
        method: 'GET',
        url: '/api/ha/observations?domain=light',
      });
      expect(res.statusCode).toBe(200);

      const sql = queryFn.mock.calls[0][0] as string;
      expect(sql).toContain('domain = $');
    });

    it('filters by time range', async () => {
      queryFn
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 });

      const res = await app.inject({
        method: 'GET',
        url: '/api/ha/observations?from=2026-02-01&to=2026-02-28',
      });
      expect(res.statusCode).toBe(200);

      const sql = queryFn.mock.calls[0][0] as string;
      expect(sql).toContain('timestamp >= $');
      expect(sql).toContain('timestamp <= $');
    });

    it('rejects invalid from date', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/ha/observations?from=not-a-date',
      });
      expect(res.statusCode).toBe(400);
    });

    it('filters by scene_label', async () => {
      queryFn
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 });

      const res = await app.inject({
        method: 'GET',
        url: '/api/ha/observations?scene_label=bedtime',
      });
      expect(res.statusCode).toBe(200);

      const sql = queryFn.mock.calls[0][0] as string;
      expect(sql).toContain('scene_label = $');
    });

    it('filters by min_score', async () => {
      queryFn
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 });

      const res = await app.inject({
        method: 'GET',
        url: '/api/ha/observations?min_score=5',
      });
      expect(res.statusCode).toBe(200);

      const sql = queryFn.mock.calls[0][0] as string;
      expect(sql).toContain('score >= $');
    });
  });

  // ── Namespace auth denial ──────────────────────────────────

  describe('namespace auth denial (no namespace context)', () => {
    it('returns 403 on GET /api/ha/routines without namespace context', async () => {
      const noCtxApp = await buildAppNoContext(queryFn);
      const res = await noCtxApp.inject({ method: 'GET', url: '/api/ha/routines' });
      expect(res.statusCode).toBe(403);
    });

    it('returns 403 on PATCH /api/ha/routines/:id without namespace context', async () => {
      const noCtxApp = await buildAppNoContext(queryFn);
      const res = await noCtxApp.inject({
        method: 'PATCH',
        url: `/api/ha/routines/${VALID_UUID}`,
        payload: { title: 'Test' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 403 on DELETE /api/ha/routines/:id without namespace context', async () => {
      const noCtxApp = await buildAppNoContext(queryFn);
      const res = await noCtxApp.inject({
        method: 'DELETE',
        url: `/api/ha/routines/${VALID_UUID}`,
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 403 on GET /api/ha/anomalies without namespace context', async () => {
      const noCtxApp = await buildAppNoContext(queryFn);
      const res = await noCtxApp.inject({ method: 'GET', url: '/api/ha/anomalies' });
      expect(res.statusCode).toBe(403);
    });

    it('returns 403 on GET /api/ha/observations without namespace context', async () => {
      const noCtxApp = await buildAppNoContext(queryFn);
      const res = await noCtxApp.inject({ method: 'GET', url: '/api/ha/observations' });
      expect(res.statusCode).toBe(403);
    });
  });

  // ── Role enforcement ───────────────────────────────────────

  describe('role enforcement (observer cannot write)', () => {
    it('returns 403 on PATCH /api/ha/routines/:id for observer', async () => {
      const obsApp = await buildAppObserver(queryFn);
      const res = await obsApp.inject({
        method: 'PATCH',
        url: `/api/ha/routines/${VALID_UUID}`,
        payload: { title: 'Test' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 403 on DELETE /api/ha/routines/:id for observer', async () => {
      const obsApp = await buildAppObserver(queryFn);
      const res = await obsApp.inject({
        method: 'DELETE',
        url: `/api/ha/routines/${VALID_UUID}`,
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 403 on POST /api/ha/routines/:id/confirm for observer', async () => {
      const obsApp = await buildAppObserver(queryFn);
      const res = await obsApp.inject({
        method: 'POST',
        url: `/api/ha/routines/${VALID_UUID}/confirm`,
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 403 on POST /api/ha/routines/:id/reject for observer', async () => {
      const obsApp = await buildAppObserver(queryFn);
      const res = await obsApp.inject({
        method: 'POST',
        url: `/api/ha/routines/${VALID_UUID}/reject`,
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 403 on PATCH /api/ha/anomalies/:id for observer', async () => {
      const obsApp = await buildAppObserver(queryFn);
      const res = await obsApp.inject({
        method: 'PATCH',
        url: `/api/ha/anomalies/${OTHER_UUID}`,
        payload: { resolved: true },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // ── Boolean resolved query validation ──────────────────────

  describe('GET /api/ha/anomalies resolved param validation', () => {
    it('rejects invalid resolved value', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/ha/anomalies?resolved=yes',
      });
      expect(res.statusCode).toBe(400);
    });

    it('accepts resolved=true', async () => {
      queryFn
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 });

      const res = await app.inject({
        method: 'GET',
        url: '/api/ha/anomalies?resolved=true',
      });
      expect(res.statusCode).toBe(200);
    });

    it('accepts resolved=false', async () => {
      queryFn
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 });

      const res = await app.inject({
        method: 'GET',
        url: '/api/ha/anomalies?resolved=false',
      });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── Routine observation namespace isolation ────────────────

  describe('GET /api/ha/routines/:id/observations namespace isolation', () => {
    it('uses the routine namespace for observation queries, not user queryNamespaces', async () => {
      const routine = makeRoutineRow({ namespace: 'tenant-a' });
      queryFn
        .mockResolvedValueOnce({ rows: [routine], rowCount: 1 }) // routine lookup
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // observations
        .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 }); // count

      const res = await app.inject({
        method: 'GET',
        url: `/api/ha/routines/${VALID_UUID}/observations`,
      });
      expect(res.statusCode).toBe(200);

      // The observation queries should use the routine's namespace ('tenant-a') with $1, not ANY($1)
      const obsSql = queryFn.mock.calls[1][0] as string;
      expect(obsSql).toContain('namespace = $1');
      // Namespace filter should NOT use ANY (single namespace, not array)
      expect(obsSql).not.toContain('namespace = ANY');
      const obsParams = queryFn.mock.calls[1][1] as unknown[];
      expect(obsParams[0]).toBe('tenant-a');
    });
  });
});
