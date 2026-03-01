/**
 * Tests for channel default CRUD API (Epic #1497, Issue #1501).
 */
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.ts';
import { createTestPool, truncateAllTables, ensureTestNamespace } from './helpers/db.ts';
import { runMigrate } from './helpers/migrate.ts';

describe('Channel Default API (Issue #1501)', () => {
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

  // ── GET /channel-defaults ─────────────────────────────

  describe('GET /channel-defaults', () => {
    it('returns empty list when no defaults exist', async () => {
      const res = await app.inject({ method: 'GET', url: '/channel-defaults' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(0);
    });

    it('returns all channel defaults', async () => {
      // Seed directly
      await pool.query(
        `INSERT INTO channel_default (namespace, channel_type, agent_id) VALUES ($1, $2, $3)`,
        ['default', 'sms', 'agent-sms'],
      );
      await pool.query(
        `INSERT INTO channel_default (namespace, channel_type, agent_id) VALUES ($1, $2, $3)`,
        ['default', 'email', 'agent-email'],
      );

      const res = await app.inject({ method: 'GET', url: '/channel-defaults' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(2);
    });
  });

  // ── GET /channel-defaults/:channelType ────────────────

  describe('GET /channel-defaults/:channelType', () => {
    it('returns default for channel type', async () => {
      await pool.query(
        `INSERT INTO channel_default (namespace, channel_type, agent_id) VALUES ($1, $2, $3)`,
        ['default', 'sms', 'agent-sms'],
      );

      const res = await app.inject({ method: 'GET', url: '/channel-defaults/sms' });

      expect(res.statusCode).toBe(200);
      expect(res.json().channel_type).toBe('sms');
      expect(res.json().agent_id).toBe('agent-sms');
    });

    it('returns 404 when no default exists', async () => {
      const res = await app.inject({ method: 'GET', url: '/channel-defaults/sms' });
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for invalid channel type', async () => {
      const res = await app.inject({ method: 'GET', url: '/channel-defaults/whatsapp' });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── PUT /channel-defaults/:channelType ────────────────

  describe('PUT /channel-defaults/:channelType', () => {
    it('creates a channel default', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/channel-defaults/sms',
        payload: { agent_id: 'agent-sms-1' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().channel_type).toBe('sms');
      expect(res.json().agent_id).toBe('agent-sms-1');
    });

    it('updates existing channel default (upsert)', async () => {
      await app.inject({
        method: 'PUT',
        url: '/channel-defaults/sms',
        payload: { agent_id: 'agent-1' },
      });

      const res = await app.inject({
        method: 'PUT',
        url: '/channel-defaults/sms',
        payload: { agent_id: 'agent-2' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().agent_id).toBe('agent-2');
    });

    it('sets prompt_template_id and context_id', async () => {
      // Create a prompt template first
      const ptRes = await app.inject({
        method: 'POST',
        url: '/prompt-templates',
        payload: { label: 'Test', content: 'test content', channel_type: 'sms' },
      });
      const ptId = ptRes.json().id;

      const res = await app.inject({
        method: 'PUT',
        url: '/channel-defaults/sms',
        payload: { agent_id: 'agent-1', prompt_template_id: ptId },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().prompt_template_id).toBe(ptId);
    });

    it('rejects missing agent_id', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/channel-defaults/sms',
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('agent_id');
    });

    it('rejects invalid channel type', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/channel-defaults/whatsapp',
        payload: { agent_id: 'agent-1' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('channel_type');
    });

    it('rejects invalid prompt_template_id format', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/channel-defaults/sms',
        payload: { agent_id: 'agent-1', prompt_template_id: 'not-a-uuid' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('prompt_template_id');
    });

    it('rejects invalid context_id format', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/channel-defaults/sms',
        payload: { agent_id: 'agent-1', context_id: 'not-a-uuid' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('context_id');
    });

    it('rejects whitespace-only agent_id', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/channel-defaults/sms',
        payload: { agent_id: '   ' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('agent_id');
    });

    it('returns 400 for nonexistent prompt_template_id FK', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/channel-defaults/sms',
        payload: { agent_id: 'agent-1', prompt_template_id: '00000000-0000-0000-0000-000000000000' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('does not exist');
    });
  });
});
