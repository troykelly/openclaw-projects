/**
 * Tests for prompt template CRUD API (Epic #1497, Issue #1499).
 */
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.ts';
import { createTestPool, truncateAllTables, ensureTestNamespace } from './helpers/db.ts';
import { runMigrate } from './helpers/migrate.ts';

describe('Prompt Template API (Issue #1499)', () => {
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

  // Helper to create a template via API
  async function createTemplate(overrides: Record<string, unknown> = {}) {
    return app.inject({
      method: 'POST',
      url: '/api/prompt-templates',
      payload: {
        label: 'Test Template',
        content: 'You are a helpful triage agent.',
        channel_type: 'sms',
        ...overrides,
      },
    });
  }

  // ── POST /api/prompt-templates ────────────────────────────

  describe('POST /api/prompt-templates', () => {
    it('creates a template with required fields', async () => {
      const res = await createTemplate();

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.label).toBe('Test Template');
      expect(body.content).toBe('You are a helpful triage agent.');
      expect(body.channel_type).toBe('sms');
      expect(body.is_default).toBe(false);
      expect(body.is_active).toBe(true);
    });

    it('creates a default template', async () => {
      const res = await createTemplate({ is_default: true });

      expect(res.statusCode).toBe(201);
      expect(res.json().is_default).toBe(true);
    });

    it('rejects missing label', async () => {
      const res = await createTemplate({ label: undefined });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('label');
    });

    it('rejects empty label', async () => {
      const res = await createTemplate({ label: '   ' });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('label');
    });

    it('rejects missing content', async () => {
      const res = await createTemplate({ content: undefined });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('content');
    });

    it('rejects invalid channel_type', async () => {
      const res = await createTemplate({ channel_type: 'whatsapp' });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('channel_type');
    });

    it('rejects missing channel_type', async () => {
      const res = await createTemplate({ channel_type: undefined });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('channel_type');
    });

    it('unsets existing default when creating new default', async () => {
      const first = await createTemplate({ label: 'First', is_default: true });
      expect(first.statusCode).toBe(201);
      const firstId = first.json().id;

      await createTemplate({ label: 'Second', is_default: true });

      const getFirst = await app.inject({ method: 'GET', url: `/api/prompt-templates/${firstId}` });
      expect(getFirst.json().is_default).toBe(false);
    });
  });

  // ── GET /api/prompt-templates ─────────────────────────────

  describe('GET /api/prompt-templates', () => {
    it('returns empty list when no templates exist', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/prompt-templates' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.total).toBe(0);
      expect(body.items).toHaveLength(0);
    });

    it('returns templates with pagination info', async () => {
      await createTemplate({ label: 'A' });
      await createTemplate({ label: 'B' });

      const res = await app.inject({ method: 'GET', url: '/api/prompt-templates?limit=1' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.total).toBe(2);
      expect(body.items).toHaveLength(1);
      expect(body.limit).toBe(1);
      expect(body.offset).toBe(0);
    });

    it('filters by channel_type', async () => {
      await createTemplate({ label: 'SMS', channel_type: 'sms' });
      await createTemplate({ label: 'Email', channel_type: 'email' });

      const res = await app.inject({
        method: 'GET',
        url: '/api/prompt-templates?channel_type=sms',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().total).toBe(1);
      expect(res.json().items[0].channel_type).toBe('sms');
    });

    it('searches by label and content', async () => {
      await createTemplate({ label: 'Triage SMS', content: 'generic' });
      await createTemplate({ label: 'Other', content: 'triage logic' });
      await createTemplate({ label: 'Unrelated', content: 'nothing' });

      const res = await app.inject({
        method: 'GET',
        url: '/api/prompt-templates?search=triage',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().total).toBe(2);
    });

    it('excludes inactive by default', async () => {
      const created = await createTemplate();
      const id = created.json().id;
      await app.inject({ method: 'DELETE', url: `/api/prompt-templates/${id}` });

      const res = await app.inject({ method: 'GET', url: '/api/prompt-templates' });
      expect(res.json().total).toBe(0);
    });

    it('includes inactive when requested', async () => {
      const created = await createTemplate();
      const id = created.json().id;
      await app.inject({ method: 'DELETE', url: `/api/prompt-templates/${id}` });

      const res = await app.inject({
        method: 'GET',
        url: '/api/prompt-templates?include_inactive=true',
      });
      expect(res.json().total).toBe(1);
    });

    it('rejects non-numeric limit', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/prompt-templates?limit=abc',
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('limit');
    });

    it('rejects non-numeric offset', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/prompt-templates?offset=xyz',
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('offset');
    });

    it('rejects negative offset', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/prompt-templates?offset=-1',
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects zero limit', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/prompt-templates?limit=0',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── GET /api/prompt-templates/:id ─────────────────────────

  describe('GET /api/prompt-templates/:id', () => {
    it('returns a template by ID', async () => {
      const created = await createTemplate();
      const id = created.json().id;

      const res = await app.inject({ method: 'GET', url: `/api/prompt-templates/${id}` });

      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(id);
      expect(res.json().label).toBe('Test Template');
    });

    it('returns 404 for non-existent ID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/prompt-templates/00000000-0000-0000-0000-000000000000',
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── PUT /api/prompt-templates/:id ─────────────────────────

  describe('PUT /api/prompt-templates/:id', () => {
    it('updates label', async () => {
      const created = await createTemplate();
      const id = created.json().id;

      const res = await app.inject({
        method: 'PUT',
        url: `/api/prompt-templates/${id}`,
        payload: { label: 'Updated Label' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().label).toBe('Updated Label');
      expect(res.json().content).toBe('You are a helpful triage agent.');
    });

    it('updates content', async () => {
      const created = await createTemplate();
      const id = created.json().id;

      const res = await app.inject({
        method: 'PUT',
        url: `/api/prompt-templates/${id}`,
        payload: { content: 'New content' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().content).toBe('New content');
    });

    it('rejects invalid channel_type', async () => {
      const created = await createTemplate();
      const id = created.json().id;

      const res = await app.inject({
        method: 'PUT',
        url: `/api/prompt-templates/${id}`,
        payload: { channel_type: 'invalid' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 404 for non-existent ID', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/prompt-templates/00000000-0000-0000-0000-000000000000',
        payload: { label: 'x' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for empty update body', async () => {
      const created = await createTemplate();
      const id = created.json().id;

      const res = await app.inject({
        method: 'PUT',
        url: `/api/prompt-templates/${id}`,
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('field');
    });
  });

  // ── DELETE /api/prompt-templates/:id ──────────────────────

  describe('DELETE /api/prompt-templates/:id', () => {
    it('soft-deletes a template', async () => {
      const created = await createTemplate();
      const id = created.json().id;

      const res = await app.inject({ method: 'DELETE', url: `/api/prompt-templates/${id}` });
      expect(res.statusCode).toBe(204);

      // Verify still exists but inactive
      const get = await app.inject({
        method: 'GET',
        url: `/api/prompt-templates/${id}`,
      });
      expect(get.statusCode).toBe(200);
      expect(get.json().is_active).toBe(false);
    });

    it('returns 404 for non-existent ID', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/prompt-templates/00000000-0000-0000-0000-000000000000',
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 for already-deleted template', async () => {
      const created = await createTemplate();
      const id = created.json().id;

      await app.inject({ method: 'DELETE', url: `/api/prompt-templates/${id}` });
      const res = await app.inject({ method: 'DELETE', url: `/api/prompt-templates/${id}` });
      expect(res.statusCode).toBe(404);
    });
  });
});
