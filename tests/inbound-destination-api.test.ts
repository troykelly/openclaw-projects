/**
 * Tests for inbound destination CRUD API (Epic #1497, Issue #1500).
 */
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.ts';
import { createTestPool, truncateAllTables, ensureTestNamespace } from './helpers/db.ts';
import { runMigrate } from './helpers/migrate.ts';

describe('Inbound Destination API (Issue #1500)', () => {
  const app = buildServer();
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
    await ensureTestNamespace(pool, 'test@example.com');
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  // Helper to create a destination directly in DB
  async function seedDestination(overrides: Record<string, unknown> = {}) {
    const defaults = {
      address: '+61400000001',
      channel_type: 'sms',
      display_name: '+61 400 000 001',
      namespace: 'default',
    };
    const data = { ...defaults, ...overrides };
    const result = await pool.query(
      `INSERT INTO inbound_destination (address, channel_type, display_name, namespace)
       VALUES ($1, $2, $3, $4)
       RETURNING id::text as id`,
      [data.address, data.channel_type, data.display_name, data.namespace],
    );
    return (result.rows[0] as { id: string }).id;
  }

  // ── GET /api/inbound-destinations ─────────────────────────

  describe('GET /api/inbound-destinations', () => {
    it('returns empty list when no destinations exist', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/inbound-destinations' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.total).toBe(0);
      expect(body.items).toHaveLength(0);
    });

    it('returns destinations with pagination info', async () => {
      await seedDestination({ address: '+61400000001' });
      await seedDestination({ address: '+61400000002' });

      const res = await app.inject({ method: 'GET', url: '/api/inbound-destinations?limit=1' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.total).toBe(2);
      expect(body.items).toHaveLength(1);
      expect(body.limit).toBe(1);
      expect(body.offset).toBe(0);
    });

    it('filters by channel_type', async () => {
      await seedDestination({ address: '+61400000001', channel_type: 'sms' });
      await seedDestination({ address: 'test@example.com', channel_type: 'email' });

      const res = await app.inject({
        method: 'GET',
        url: '/api/inbound-destinations?channel_type=email',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().total).toBe(1);
      expect(res.json().items[0].channel_type).toBe('email');
    });

    it('searches by address and display_name', async () => {
      await seedDestination({ address: '+61400000001', display_name: 'Office Phone' });
      await seedDestination({ address: '+61400000002', display_name: 'Personal' });

      const res = await app.inject({
        method: 'GET',
        url: '/api/inbound-destinations?search=office',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().total).toBe(1);
    });

    it('excludes inactive by default', async () => {
      const id = await seedDestination();
      await pool.query('UPDATE inbound_destination SET is_active = false WHERE id = $1', [id]);

      const res = await app.inject({ method: 'GET', url: '/api/inbound-destinations' });
      expect(res.json().total).toBe(0);
    });

    it('includes inactive when requested', async () => {
      const id = await seedDestination();
      await pool.query('UPDATE inbound_destination SET is_active = false WHERE id = $1', [id]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/inbound-destinations?include_inactive=true',
      });
      expect(res.json().total).toBe(1);
    });

    it('rejects non-numeric limit', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/inbound-destinations?limit=abc',
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects non-numeric offset', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/inbound-destinations?offset=xyz',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── GET /api/inbound-destinations/:id ─────────────────────

  describe('GET /api/inbound-destinations/:id', () => {
    it('returns a destination by ID', async () => {
      const id = await seedDestination();

      const res = await app.inject({ method: 'GET', url: `/api/inbound-destinations/${id}` });

      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(id);
      expect(res.json().address).toBe('+61400000001');
    });

    it('returns 404 for non-existent ID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/inbound-destinations/00000000-0000-0000-0000-000000000000',
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for malformed ID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/inbound-destinations/not-a-uuid',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── PUT /api/inbound-destinations/:id ─────────────────────

  describe('PUT /api/inbound-destinations/:id', () => {
    it('updates display_name', async () => {
      const id = await seedDestination();

      const res = await app.inject({
        method: 'PUT',
        url: `/api/inbound-destinations/${id}`,
        payload: { display_name: 'My Office Phone' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().display_name).toBe('My Office Phone');
    });

    it('sets routing overrides', async () => {
      const id = await seedDestination();

      const res = await app.inject({
        method: 'PUT',
        url: `/api/inbound-destinations/${id}`,
        payload: { agent_id: 'agent-xyz' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().agent_id).toBe('agent-xyz');
    });

    it('clears routing overrides with null', async () => {
      const id = await seedDestination();
      // Set first
      await app.inject({
        method: 'PUT',
        url: `/api/inbound-destinations/${id}`,
        payload: { agent_id: 'agent-xyz' },
      });
      // Clear
      const res = await app.inject({
        method: 'PUT',
        url: `/api/inbound-destinations/${id}`,
        payload: { agent_id: null },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().agent_id).toBeNull();
    });

    it('returns 404 for non-existent ID', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/inbound-destinations/00000000-0000-0000-0000-000000000000',
        payload: { display_name: 'x' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for empty update body', async () => {
      const id = await seedDestination();

      const res = await app.inject({
        method: 'PUT',
        url: `/api/inbound-destinations/${id}`,
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for malformed ID', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/inbound-destinations/not-a-uuid',
        payload: { display_name: 'x' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for invalid prompt_template_id format', async () => {
      const id = await seedDestination();
      const res = await app.inject({
        method: 'PUT',
        url: `/api/inbound-destinations/${id}`,
        payload: { prompt_template_id: 'not-a-uuid' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('prompt_template_id');
    });

    it('returns 400 for invalid context_id format', async () => {
      const id = await seedDestination();
      const res = await app.inject({
        method: 'PUT',
        url: `/api/inbound-destinations/${id}`,
        payload: { context_id: 'not-a-uuid' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('context_id');
    });
  });

  // ── DELETE /api/inbound-destinations/:id ──────────────────

  describe('DELETE /api/inbound-destinations/:id', () => {
    it('soft-deletes a destination', async () => {
      const id = await seedDestination();

      const res = await app.inject({ method: 'DELETE', url: `/api/inbound-destinations/${id}` });
      expect(res.statusCode).toBe(204);

      // Verify still exists but inactive
      const get = await app.inject({ method: 'GET', url: `/api/inbound-destinations/${id}` });
      expect(get.statusCode).toBe(200);
      expect(get.json().is_active).toBe(false);
    });

    it('returns 404 for non-existent ID', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/inbound-destinations/00000000-0000-0000-0000-000000000000',
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 for already-deleted destination', async () => {
      const id = await seedDestination();

      await app.inject({ method: 'DELETE', url: `/api/inbound-destinations/${id}` });
      const res = await app.inject({ method: 'DELETE', url: `/api/inbound-destinations/${id}` });
      expect(res.statusCode).toBe(404);
    });
  });
});
