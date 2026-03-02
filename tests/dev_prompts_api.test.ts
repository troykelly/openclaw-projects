/**
 * Integration tests for dev prompts REST API (Epic #2011, Issue #2014, #2017).
 * Tests CRUD, namespace scoping, system prompt guards, reset, and render.
 */
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.ts';
import { createTestPool, truncateAllTables, ensureTestNamespace } from './helpers/db.ts';
import { runMigrate } from './helpers/migrate.ts';

describe('Dev Prompts API (#2014)', () => {
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

  // Helper: seed system prompts by re-running the INSERT from migration
  async function seedSystemPrompts(): Promise<void> {
    const { readFileSync } = await import('fs');
    const { resolve, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const migrationPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../migrations/132_dev_prompts.up.sql',
    );
    const sql = readFileSync(migrationPath, 'utf-8');
    const insertMatch = sql.match(/INSERT INTO dev_prompt[\s\S]+?ON CONFLICT[\s\S]+?DO NOTHING;/);
    if (!insertMatch) throw new Error('Could not find INSERT statement in migration');
    await pool.query(insertMatch[0]);
  }

  // Helper: create a user prompt via API
  async function createUserPrompt(overrides: Record<string, unknown> = {}) {
    return app.inject({
      method: 'POST',
      url: '/dev-prompts',
      payload: {
        prompt_key: 'test_prompt',
        title: 'Test Prompt',
        body: 'Hello {{ namespace }}',
        ...overrides,
      },
    });
  }

  // ── POST /dev-prompts ──────────────────────────────────────

  describe('POST /dev-prompts', () => {
    it('creates a user prompt with required fields', async () => {
      const res = await createUserPrompt();
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.prompt_key).toBe('test_prompt');
      expect(body.title).toBe('Test Prompt');
      expect(body.body).toBe('Hello {{ namespace }}');
      expect(body.is_system).toBe(false);
      expect(body.category).toBe('custom');
      expect(body.is_active).toBe(true);
    });

    it('creates with explicit category', async () => {
      const res = await createUserPrompt({ category: 'creation' });
      expect(res.statusCode).toBe(201);
      expect(res.json().category).toBe('creation');
    });

    it('rejects missing prompt_key', async () => {
      const res = await createUserPrompt({ prompt_key: undefined });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('prompt_key');
    });

    it('rejects invalid prompt_key format', async () => {
      const res = await createUserPrompt({ prompt_key: 'Invalid-Key' });
      expect(res.statusCode).toBe(400);
    });

    it('rejects missing title', async () => {
      const res = await createUserPrompt({ title: undefined });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('title');
    });

    it('rejects empty title', async () => {
      const res = await createUserPrompt({ title: '   ' });
      expect(res.statusCode).toBe(400);
    });

    it('rejects missing body', async () => {
      const res = await createUserPrompt({ body: undefined });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('body');
    });

    it('rejects invalid category', async () => {
      const res = await createUserPrompt({ category: 'invalid' });
      expect(res.statusCode).toBe(400);
    });

    it('returns 409 for duplicate prompt_key in same namespace', async () => {
      await createUserPrompt();
      const res = await createUserPrompt();
      expect(res.statusCode).toBe(409);
    });
  });

  // ── GET /dev-prompts ───────────────────────────────────────

  describe('GET /dev-prompts', () => {
    it('returns empty list when no prompts exist', async () => {
      const res = await app.inject({ method: 'GET', url: '/dev-prompts' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.total).toBe(0);
      expect(body.items).toHaveLength(0);
    });

    it('returns prompts with pagination', async () => {
      await createUserPrompt({ prompt_key: 'a_first' });
      await createUserPrompt({ prompt_key: 'b_second' });

      const res = await app.inject({ method: 'GET', url: '/dev-prompts?limit=1' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.total).toBe(2);
      expect(body.items).toHaveLength(1);
    });

    it('filters by category', async () => {
      await createUserPrompt({ prompt_key: 'creation_one', category: 'creation' });
      await createUserPrompt({ prompt_key: 'shipping_one', category: 'shipping' });

      const res = await app.inject({ method: 'GET', url: '/dev-prompts?category=creation' });
      expect(res.statusCode).toBe(200);
      expect(res.json().total).toBe(1);
      expect(res.json().items[0].category).toBe('creation');
    });

    it('filters by is_system', async () => {
      await seedSystemPrompts();
      await createUserPrompt();

      const res = await app.inject({ method: 'GET', url: '/dev-prompts?is_system=true' });
      expect(res.statusCode).toBe(200);
      expect(res.json().items.every((p: { is_system: boolean }) => p.is_system)).toBe(true);
    });

    it('searches by title and prompt_key', async () => {
      await createUserPrompt({ prompt_key: 'my_feature', title: 'Feature' });
      await createUserPrompt({ prompt_key: 'my_bug', title: 'Bug Report' });

      const res = await app.inject({ method: 'GET', url: '/dev-prompts?search=feature' });
      expect(res.statusCode).toBe(200);
      expect(res.json().total).toBe(1);
    });

    it('rejects invalid category filter', async () => {
      const res = await app.inject({ method: 'GET', url: '/dev-prompts?category=nope' });
      expect(res.statusCode).toBe(400);
    });

    it('rejects non-numeric limit', async () => {
      const res = await app.inject({ method: 'GET', url: '/dev-prompts?limit=abc' });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── GET /dev-prompts/:id ───────────────────────────────────

  describe('GET /dev-prompts/:id', () => {
    it('returns a prompt by ID', async () => {
      const created = await createUserPrompt();
      const id = created.json().id;

      const res = await app.inject({ method: 'GET', url: `/dev-prompts/${id}` });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(id);
    });

    it('returns 404 for non-existent ID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/dev-prompts/00000000-0000-0000-0000-000000000000',
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for malformed ID', async () => {
      const res = await app.inject({ method: 'GET', url: '/dev-prompts/not-a-uuid' });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── GET /dev-prompts/by-key/:key ───────────────────────────

  describe('GET /dev-prompts/by-key/:key', () => {
    it('returns a user prompt by key', async () => {
      await createUserPrompt();

      const res = await app.inject({ method: 'GET', url: '/dev-prompts/by-key/test_prompt' });
      expect(res.statusCode).toBe(200);
      expect(res.json().prompt_key).toBe('test_prompt');
    });

    it('returns system prompt from default namespace by key', async () => {
      await seedSystemPrompts();

      const res = await app.inject({ method: 'GET', url: '/dev-prompts/by-key/all_open' });
      expect(res.statusCode).toBe(200);
      expect(res.json().prompt_key).toBe('all_open');
      expect(res.json().is_system).toBe(true);
    });

    it('returns 404 for non-existent key', async () => {
      const res = await app.inject({ method: 'GET', url: '/dev-prompts/by-key/nonexistent' });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── PATCH /dev-prompts/:id ─────────────────────────────────

  describe('PATCH /dev-prompts/:id', () => {
    it('updates user prompt title', async () => {
      const created = await createUserPrompt();
      const id = created.json().id;

      const res = await app.inject({
        method: 'PATCH',
        url: `/dev-prompts/${id}`,
        payload: { title: 'Updated Title' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().title).toBe('Updated Title');
    });

    it('updates user prompt body', async () => {
      const created = await createUserPrompt();
      const id = created.json().id;

      const res = await app.inject({
        method: 'PATCH',
        url: `/dev-prompts/${id}`,
        payload: { body: 'New body content' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().body).toBe('New body content');
    });

    it('updates user prompt category', async () => {
      const created = await createUserPrompt();
      const id = created.json().id;

      const res = await app.inject({
        method: 'PATCH',
        url: `/dev-prompts/${id}`,
        payload: { category: 'shipping' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().category).toBe('shipping');
    });

    it('restricts system prompt updates to body and is_active', async () => {
      await seedSystemPrompts();
      const list = await app.inject({ method: 'GET', url: '/dev-prompts?is_system=true&limit=1' });
      const systemPrompt = list.json().items[0];

      // Trying to update title on a system prompt should be silently ignored
      const res = await app.inject({
        method: 'PATCH',
        url: `/dev-prompts/${systemPrompt.id}`,
        payload: { body: 'Updated system body', title: 'New Title' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().body).toBe('Updated system body');
      // Title should remain unchanged (system prompt guard)
      expect(res.json().title).toBe(systemPrompt.title);
    });

    it('rejects empty update body', async () => {
      const created = await createUserPrompt();
      const id = created.json().id;

      const res = await app.inject({
        method: 'PATCH',
        url: `/dev-prompts/${id}`,
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects invalid category', async () => {
      const created = await createUserPrompt();
      const id = created.json().id;

      const res = await app.inject({
        method: 'PATCH',
        url: `/dev-prompts/${id}`,
        payload: { category: 'invalid' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 404 for non-existent ID', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/dev-prompts/00000000-0000-0000-0000-000000000000',
        payload: { body: 'x' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── DELETE /dev-prompts/:id ────────────────────────────────

  describe('DELETE /dev-prompts/:id', () => {
    it('soft-deletes a user prompt', async () => {
      const created = await createUserPrompt();
      const id = created.json().id;

      const res = await app.inject({ method: 'DELETE', url: `/dev-prompts/${id}` });
      expect(res.statusCode).toBe(204);

      // Verify it no longer appears in list
      const list = await app.inject({ method: 'GET', url: '/dev-prompts' });
      expect(list.json().total).toBe(0);
    });

    it('prevents deleting system prompts', async () => {
      await seedSystemPrompts();
      const list = await app.inject({ method: 'GET', url: '/dev-prompts?is_system=true&limit=1' });
      const systemPrompt = list.json().items[0];

      const res = await app.inject({ method: 'DELETE', url: `/dev-prompts/${systemPrompt.id}` });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('System');
    });

    it('returns 404 for non-existent ID', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/dev-prompts/00000000-0000-0000-0000-000000000000',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── POST /dev-prompts/:id/reset ────────────────────────────

  describe('POST /dev-prompts/:id/reset', () => {
    it('resets system prompt body to default_body', async () => {
      await seedSystemPrompts();
      const list = await app.inject({ method: 'GET', url: '/dev-prompts?is_system=true&limit=1' });
      const systemPrompt = list.json().items[0];

      // Edit the body first
      await app.inject({
        method: 'PATCH',
        url: `/dev-prompts/${systemPrompt.id}`,
        payload: { body: 'User edited body' },
      });

      // Reset
      const res = await app.inject({
        method: 'POST',
        url: `/dev-prompts/${systemPrompt.id}/reset`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().body).toBe(res.json().default_body);
    });

    it('returns 400 for user prompt (not a system prompt)', async () => {
      const created = await createUserPrompt();
      const id = created.json().id;

      const res = await app.inject({
        method: 'POST',
        url: `/dev-prompts/${id}/reset`,
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for non-existent ID', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/dev-prompts/00000000-0000-0000-0000-000000000000/reset',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── POST /dev-prompts/:id/render ───────────────────────────

  describe('POST /dev-prompts/:id/render', () => {
    it('renders a prompt with built-in variables', async () => {
      const created = await createUserPrompt({
        body: '# Hello {{ namespace }}\n\nDate: {{ date }}',
      });
      const id = created.json().id;

      const res = await app.inject({
        method: 'POST',
        url: `/dev-prompts/${id}/render`,
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.rendered).toContain('# Hello default');
      expect(body.rendered).toMatch(/Date: \d{4}-\d{2}-\d{2}/);
      expect(body.variables_used).toContain('namespace');
      expect(body.variables_used).toContain('date');
      expect(body.available_variables).toBeDefined();
      expect(Array.isArray(body.available_variables)).toBe(true);
    });

    it('renders with user-supplied variable overrides', async () => {
      const created = await createUserPrompt({
        body: 'Repo: {{ repo_full }}',
      });
      const id = created.json().id;

      const res = await app.inject({
        method: 'POST',
        url: `/dev-prompts/${id}/render`,
        payload: {
          variables: { repo_org: 'troykelly', repo_name: 'openclaw-projects' },
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().rendered).toBe('Repo: troykelly/openclaw-projects');
    });

    it('renders with custom user variables', async () => {
      const created = await createUserPrompt({
        body: 'Custom: {{ my_var }}',
      });
      const id = created.json().id;

      const res = await app.inject({
        method: 'POST',
        url: `/dev-prompts/${id}/render`,
        payload: { variables: { my_var: 'hello' } },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().rendered).toBe('Custom: hello');
    });

    it('returns 404 for non-existent ID', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/dev-prompts/00000000-0000-0000-0000-000000000000/render',
        payload: {},
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for invalid template syntax', async () => {
      // Insert a prompt with bad Handlebars directly
      const insert = await pool.query(
        `INSERT INTO dev_prompt (namespace, prompt_key, title, body, default_body)
         VALUES ('default', 'bad_template', 'Bad', '{{ unclosed', '')
         RETURNING id::text as id`,
      );
      const id = (insert.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'POST',
        url: `/dev-prompts/${id}/render`,
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('Template error');
    });
  });

  // ── Namespace scoping ──────────────────────────────────────

  describe('Namespace scoping', () => {
    it('system prompts in default namespace are visible to all users', async () => {
      await seedSystemPrompts();

      const res = await app.inject({ method: 'GET', url: '/dev-prompts' });
      expect(res.statusCode).toBe(200);
      // System prompts should be visible
      const systemItems = res.json().items.filter((p: { is_system: boolean }) => p.is_system);
      expect(systemItems.length).toBe(9);
    });
  });
});
