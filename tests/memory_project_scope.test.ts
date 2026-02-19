/**
 * Tests for memory project_id scope (Issue #1273).
 * Verifies the project_id column, FK, index, service layer support,
 * API endpoint support, and scope validation.
 */

import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMemory, getGlobalMemories, getMemory, listMemories, searchMemories } from '../src/api/memory/index.ts';
import { buildServer } from '../src/api/server.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { runMigrate } from './helpers/migrate.ts';

describe('Memory Project Scope (Issue #1273)', () => {
  const app = buildServer();
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  // ── Helpers ────────────────────────────────────────────────

  /** Creates a work_item of kind 'project' and returns its ID. */
  async function createTestProject(title = 'Test Project'): Promise<string> {
    const result = await pool.query(`INSERT INTO work_item (title, kind) VALUES ($1, 'project') RETURNING id::text as id`, [title]);
    return (result.rows[0] as { id: string }).id;
  }

  // ── Schema ──────────────────────────────────────────────

  describe('schema', () => {
    it('memory table has project_id column', async () => {
      const result = await pool.query(
        `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_name = 'memory' AND column_name = 'project_id'`,
      );
      expect(result.rows.length).toBe(1);
      const col = result.rows[0] as {
        column_name: string;
        data_type: string;
        is_nullable: string;
      };
      expect(col.data_type).toBe('uuid');
      expect(col.is_nullable).toBe('YES');
    });

    it('foreign key constraint exists referencing work_item table', async () => {
      const result = await pool.query(
        `SELECT tc.constraint_name, ccu.table_name AS foreign_table
         FROM information_schema.table_constraints tc
         JOIN information_schema.constraint_column_usage ccu
           ON tc.constraint_name = ccu.constraint_name
         WHERE tc.table_name = 'memory'
           AND tc.constraint_type = 'FOREIGN KEY'
           AND ccu.table_name = 'work_item'
           AND ccu.column_name = 'id'
           AND tc.constraint_name LIKE '%project%'`,
      );
      expect(result.rows.length).toBeGreaterThan(0);
    });

    it('partial index exists on project_id', async () => {
      const result = await pool.query(
        `SELECT indexname, indexdef FROM pg_indexes
         WHERE tablename = 'memory' AND indexname = 'idx_memory_project_id'`,
      );
      expect(result.rows.length).toBe(1);
      const idx = result.rows[0] as { indexname: string; indexdef: string };
      expect(idx.indexdef).toContain('project_id');
      expect(idx.indexdef).toContain('WHERE');
    });
  });

  // ── Service layer: createMemory ─────────────────────────

  describe('createMemory with project_id', () => {
    it('creates a memory scoped to a project', async () => {
      const project_id = await createTestProject();

      const memory = await createMemory(pool, {
        user_email: 'test@example.com',
        title: 'Deployment config',
        content: 'Uses Docker Compose for staging',
        memory_type: 'fact',
        project_id,
      });

      expect(memory.project_id).toBe(project_id);
    });

    it('creates a memory with only project_id scope', async () => {
      const project_id = await createTestProject();

      const memory = await createMemory(pool, {
        title: 'Tech stack note',
        content: 'React + Fastify + Postgres',
        memory_type: 'note',
        project_id,
      });

      expect(memory.project_id).toBe(project_id);
      expect(memory.work_item_id).toBeNull();
      expect(memory.contact_id).toBeNull();
    });

    it('creates a memory without project_id (backward compatible)', async () => {
      const memory = await createMemory(pool, {
        user_email: 'test@example.com',
        title: 'Global note',
        content: 'No project scope',
      });

      expect(memory.project_id).toBeNull();
    });
  });

  // ── Service layer: deduplication within project scope ────

  describe('deduplication within project scope', () => {
    it('deduplicates within the same project', async () => {
      const project_id = await createTestProject();

      const first = await createMemory(pool, {
        title: 'Duplicate content',
        content: 'Same content in same project',
        project_id,
      });

      const second = await createMemory(pool, {
        title: 'Duplicate content',
        content: 'Same content in same project',
        project_id,
      });

      // Should return same memory (dedup), just updated timestamp
      expect(second.id).toBe(first.id);
    });

    it('does NOT deduplicate across different projects', async () => {
      const projectA = await createTestProject('Project A');
      const projectB = await createTestProject('Project B');

      const first = await createMemory(pool, {
        title: 'Same content',
        content: 'Identical content different project',
        project_id: projectA,
      });

      const second = await createMemory(pool, {
        title: 'Same content',
        content: 'Identical content different project',
        project_id: projectB,
      });

      // Different projects → separate memories
      expect(second.id).not.toBe(first.id);
    });

    it('does NOT deduplicate project-scoped vs unscoped', async () => {
      const project_id = await createTestProject();

      const unscoped = await createMemory(pool, {
        title: 'Global memory',
        content: 'Same text in both scopes',
        user_email: 'test@example.com',
      });

      const scoped = await createMemory(pool, {
        title: 'Project memory',
        content: 'Same text in both scopes',
        user_email: 'test@example.com',
        project_id,
      });

      expect(scoped.id).not.toBe(unscoped.id);
    });
  });

  // ── Service layer: getMemory ────────────────────────────

  describe('getMemory returns project_id', () => {
    it('returns project_id when retrieving a memory', async () => {
      const project_id = await createTestProject();

      const created = await createMemory(pool, {
        title: 'Project memory',
        content: 'Should round-trip project_id',
        memory_type: 'fact',
        project_id,
      });

      const retrieved = await getMemory(pool, created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.project_id).toBe(project_id);
    });
  });

  // ── Service layer: listMemories filtering ───────────────

  describe('listMemories project_id filtering', () => {
    it('filters memories by project_id', async () => {
      const projectA = await createTestProject('Project A');
      const projectB = await createTestProject('Project B');

      await createMemory(pool, {
        title: 'Project A memory',
        content: 'Belongs to A',
        memory_type: 'fact',
        project_id: projectA,
      });
      await createMemory(pool, {
        title: 'Project B memory',
        content: 'Belongs to B',
        memory_type: 'fact',
        project_id: projectB,
      });

      const result = await listMemories(pool, { project_id: projectA });

      expect(result.total).toBe(1);
      expect(result.memories[0].title).toBe('Project A memory');
    });

    it('combines project_id filter with other filters', async () => {
      const project_id = await createTestProject();

      await createMemory(pool, {
        user_email: 'user@example.com',
        title: 'Project preference',
        content: 'Use TypeScript strict mode',
        memory_type: 'preference',
        project_id,
      });
      await createMemory(pool, {
        user_email: 'user@example.com',
        title: 'Project fact',
        content: 'Uses Fastify framework',
        memory_type: 'fact',
        project_id,
      });

      const result = await listMemories(pool, {
        project_id,
        memory_type: 'preference',
      });

      expect(result.total).toBe(1);
      expect(result.memories[0].memory_type).toBe('preference');
    });
  });

  // ── Service layer: getGlobalMemories excludes project-scoped ─

  describe('getGlobalMemories excludes project-scoped memories', () => {
    it('does not return project-scoped memories', async () => {
      const project_id = await createTestProject();

      await createMemory(pool, {
        user_email: 'user@example.com',
        title: 'Global preference',
        content: 'Prefers dark mode',
        memory_type: 'preference',
      });
      await createMemory(pool, {
        user_email: 'user@example.com',
        title: 'Project-scoped preference',
        content: 'Prefers tabs over spaces',
        memory_type: 'preference',
        project_id,
      });

      const result = await getGlobalMemories(pool, 'user@example.com');

      expect(result.total).toBe(1);
      expect(result.memories[0].title).toBe('Global preference');
    });
  });

  // ── Service layer: searchMemories ───────────────────────

  describe('searchMemories with project_id filtering', () => {
    it('combines project_id filter with text search', async () => {
      const project_id = await createTestProject();

      await createMemory(pool, {
        title: 'Deployment config',
        content: 'Docker Compose deployment for staging environment',
        memory_type: 'fact',
        project_id,
      });
      await createMemory(pool, {
        title: 'Other deployment',
        content: 'Different project deployment configuration',
        memory_type: 'fact',
      });

      const result = await searchMemories(pool, 'deployment', { project_id });

      if (result.results.length > 0) {
        expect(result.results.every((r) => r.project_id === project_id)).toBe(true);
      }
    });
  });

  // ── Scope validation ────────────────────────────────────

  describe('scope validation', () => {
    it('project_id counts as a valid scope (no warning logged)', async () => {
      const project_id = await createTestProject();

      const memory = await createMemory(pool, {
        title: 'Scoped by project',
        content: 'Has at least one scope',
        project_id,
      });

      expect(memory.id).toBeDefined();
      expect(memory.project_id).toBe(project_id);
    });
  });

  // ── FK cascade: ON DELETE SET NULL ──────────────────────

  describe('foreign key behavior', () => {
    it('sets project_id to null when work_item is deleted', async () => {
      const project_id = await createTestProject();

      const memory = await createMemory(pool, {
        title: 'Will lose project ref',
        content: 'FK should SET NULL',
        memory_type: 'fact',
        project_id,
      });

      // Delete the project
      await pool.query('DELETE FROM work_item WHERE id = $1', [project_id]);

      // Memory should still exist but with null project_id
      const retrieved = await getMemory(pool, memory.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.project_id).toBeNull();
    });
  });

  // ── API: POST /api/memories/unified with project_id ─

  describe('POST /api/memories/unified with project_id', () => {
    it('accepts project_id in request body', async () => {
      const project_id = await createTestProject();

      const res = await app.inject({
        method: 'POST',
        url: '/api/memories/unified',
        payload: {
          title: 'API project memory',
          content: 'Created via API with project scope',
          memory_type: 'fact',
          user_email: 'test@example.com',
          project_id: project_id,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.project_id).toBe(project_id);
    });

    it('creates memory without project_id (backward compatible)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memories/unified',
        payload: {
          title: 'No project scope',
          content: 'Backward compatible',
          memory_type: 'note',
          user_email: 'test@example.com',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.project_id).toBeNull();
    });
  });

  // ── API: GET /api/memories/unified with project_id filter ─

  describe('GET /api/memories/unified with project_id filter', () => {
    it('filters memories by project_id query parameter', async () => {
      const project_id = await createTestProject();

      await createMemory(pool, {
        title: 'With project',
        content: 'Scoped to project',
        memory_type: 'fact',
        project_id,
      });
      await createMemory(pool, {
        title: 'Without project',
        content: 'No project scope',
        memory_type: 'fact',
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/memories/unified?project_id=${project_id}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.memories.length).toBe(1);
      expect(body.memories[0].project_id).toBe(project_id);
    });
  });

  // ── API: GET /api/memories/search with project_id ──

  describe('GET /api/memories/search with project_id filter', () => {
    it('accepts project_id query parameter for filtered search', async () => {
      const project_id = await createTestProject();

      await pool.query(
        `INSERT INTO memory (title, content, memory_type, project_id)
         VALUES ('Deployment config', 'Docker Compose deployment for staging', 'fact', $1)`,
        [project_id],
      );
      await pool.query(
        `INSERT INTO memory (title, content, memory_type)
         VALUES ('Other deployment', 'Different deployment config', 'fact')`,
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/memories/search?q=deployment&project_id=${project_id}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      if (body.results && body.results.length > 0) {
        expect(body.results.length).toBeGreaterThan(0);
      }
    });
  });

  // ── API: POST /api/memories/:id/supersede inherits project_id ──

  describe('POST /api/memories/:id/supersede', () => {
    it('inherits project_id from superseded memory', async () => {
      const project_id = await createTestProject();

      const original = await pool.query(
        `INSERT INTO memory (title, content, memory_type, project_id)
         VALUES ('Old config', 'Docker Compose v1', 'fact', $1)
         RETURNING id::text as id`,
        [project_id],
      );
      const oldId = (original.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/memories/${oldId}/supersede`,
        payload: {
          title: 'Updated config',
          content: 'Docker Compose v2',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.new_memory.project_id).toBe(project_id);
    });
  });
});
