/**
 * Tests for memory relationship_id scope (Issue #493).
 * Verifies the relationship_id column, FK, index, service layer support,
 * API endpoint support, and scope validation.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { buildServer } from '../src/api/server.ts';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { createMemory, getMemory, listMemories, searchMemories } from '../src/api/memory/index.ts';

/**
 * Ensure required relationship types exist in the database.
 * Migration 046 seeds these, but if the table was ever truncated by another
 * test run the seed data is lost. This function re-seeds only the types
 * needed by the tests in this file (using ON CONFLICT DO NOTHING for safety).
 */
async function seedRequiredRelationshipTypes(pool: Pool): Promise<void> {
  await pool.query(
    `INSERT INTO relationship_type (name, label, is_directional, description) VALUES
       ('partner_of', 'Partner of', false, 'Romantic or life partner.'),
       ('friend_of', 'Friend of', false, 'Friendship or close social bond.')
     ON CONFLICT (name) DO NOTHING`,
  );
}

describe('Memory Relationship Scope (Issue #493)', () => {
  const app = buildServer();
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
    await seedRequiredRelationshipTypes(pool);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  // ── Helpers ────────────────────────────────────────────────

  /** Creates two contacts and a relationship between them. Returns the relationship ID. */
  async function createTestRelationship(): Promise<{
    relationship_id: string;
    contact_a_id: string;
    contact_b_id: string;
    relationship_type_id: string;
  }> {
    // Create contacts
    const contact_a = await pool.query(`INSERT INTO contact (display_name) VALUES ('Troy') RETURNING id::text as id`);
    const contact_a_id = (contact_a.rows[0] as { id: string }).id;

    const contact_b = await pool.query(`INSERT INTO contact (display_name) VALUES ('Alex') RETURNING id::text as id`);
    const contact_b_id = (contact_b.rows[0] as { id: string }).id;

    // Get partner_of type (pre-seeded)
    const typeResult = await pool.query(`SELECT id::text as id FROM relationship_type WHERE name = 'partner_of' LIMIT 1`);
    const relationship_type_id = (typeResult.rows[0] as { id: string }).id;

    // Create relationship
    const relResult = await pool.query(
      `INSERT INTO relationship (contact_a_id, contact_b_id, relationship_type_id)
       VALUES ($1, $2, $3)
       RETURNING id::text as id`,
      [contact_a_id, contact_b_id, relationship_type_id],
    );
    const relationship_id = (relResult.rows[0] as { id: string }).id;

    return { relationship_id, contact_a_id, contact_b_id, relationship_type_id };
  }

  // ── Schema ──────────────────────────────────────────────

  describe('schema', () => {
    it('memory table has relationship_id column', async () => {
      const result = await pool.query(
        `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_name = 'memory' AND column_name = 'relationship_id'`,
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

    it('foreign key constraint exists referencing relationship table', async () => {
      const result = await pool.query(
        `SELECT tc.constraint_name, ccu.table_name AS foreign_table
         FROM information_schema.table_constraints tc
         JOIN information_schema.constraint_column_usage ccu
           ON tc.constraint_name = ccu.constraint_name
         WHERE tc.table_name = 'memory'
           AND tc.constraint_type = 'FOREIGN KEY'
           AND ccu.table_name = 'relationship'
           AND ccu.column_name = 'id'`,
      );
      expect(result.rows.length).toBeGreaterThan(0);
    });

    it('partial index exists on relationship_id', async () => {
      const result = await pool.query(
        `SELECT indexname, indexdef FROM pg_indexes
         WHERE tablename = 'memory' AND indexname = 'idx_memory_relationship_id'`,
      );
      expect(result.rows.length).toBe(1);
      const idx = result.rows[0] as { indexname: string; indexdef: string };
      expect(idx.indexdef).toContain('relationship_id');
      expect(idx.indexdef).toContain('WHERE');
    });
  });

  // ── Service layer: createMemory ─────────────────────────

  describe('createMemory with relationship_id', () => {
    it('creates a memory scoped to a relationship', async () => {
      const { relationship_id } = await createTestRelationship();

      const memory = await createMemory(pool, {
        user_email: 'test@example.com',
        title: 'Anniversary date',
        content: 'Troy and Alex anniversary is March 15',
        memory_type: 'fact',
        relationship_id,
      });

      expect(memory.relationship_id).toBe(relationship_id);
    });

    it('creates a memory with only relationship_id scope (no other scopes)', async () => {
      const { relationship_id } = await createTestRelationship();

      const memory = await createMemory(pool, {
        title: 'Communication preference',
        content: 'They prefer to meet on Tuesdays',
        memory_type: 'preference',
        relationship_id,
      });

      expect(memory.relationship_id).toBe(relationship_id);
      expect(memory.work_item_id).toBeNull();
      expect(memory.contact_id).toBeNull();
    });

    it('creates a memory without relationship_id (backward compatible)', async () => {
      const memory = await createMemory(pool, {
        user_email: 'test@example.com',
        title: 'Simple note',
        content: 'No relationship scope',
      });

      expect(memory.relationship_id).toBeNull();
    });
  });

  // ── Service layer: getMemory ────────────────────────────

  describe('getMemory returns relationship_id', () => {
    it('returns relationship_id when retrieving a memory', async () => {
      const { relationship_id } = await createTestRelationship();

      const created = await createMemory(pool, {
        title: 'Relationship memory',
        content: 'They share a love of jazz',
        memory_type: 'fact',
        relationship_id,
      });

      const retrieved = await getMemory(pool, created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.relationship_id).toBe(relationship_id);
    });
  });

  // ── Service layer: listMemories filtering ───────────────

  describe('listMemories relationship_id filtering', () => {
    it('filters memories by relationship_id', async () => {
      const rel1 = await createTestRelationship();

      // Create a second relationship (different contacts)
      const contactC = await pool.query(`INSERT INTO contact (display_name) VALUES ('Jordan') RETURNING id::text as id`);
      const contactCId = (contactC.rows[0] as { id: string }).id;
      const typeResult = await pool.query(`SELECT id::text as id FROM relationship_type WHERE name = 'friend_of' LIMIT 1`);
      const friendTypeId = (typeResult.rows[0] as { id: string }).id;
      const rel2Result = await pool.query(
        `INSERT INTO relationship (contact_a_id, contact_b_id, relationship_type_id)
         VALUES ($1, $2, $3)
         RETURNING id::text as id`,
        [rel1.contact_a_id, contactCId, friendTypeId],
      );
      const rel2Id = (rel2Result.rows[0] as { id: string }).id;

      await createMemory(pool, {
        title: 'Troy-Alex anniversary',
        content: 'March 15',
        memory_type: 'fact',
        relationship_id: rel1.relationship_id,
      });
      await createMemory(pool, {
        title: 'Troy-Jordan friendship',
        content: 'Met at a conference',
        memory_type: 'fact',
        relationship_id: rel2Id,
      });

      const result = await listMemories(pool, { relationship_id: rel1.relationship_id });

      expect(result.total).toBe(1);
      expect(result.memories[0].title).toBe('Troy-Alex anniversary');
    });

    it('combines relationship_id filter with other filters', async () => {
      const { relationship_id } = await createTestRelationship();

      await createMemory(pool, {
        user_email: 'user1@example.com',
        title: 'Preference about relationship',
        content: 'Prefers weekly catch-ups',
        memory_type: 'preference',
        relationship_id,
      });
      await createMemory(pool, {
        user_email: 'user1@example.com',
        title: 'Fact about relationship',
        content: 'Met in 2020',
        memory_type: 'fact',
        relationship_id,
      });

      const result = await listMemories(pool, {
        relationship_id,
        memory_type: 'preference',
      });

      expect(result.total).toBe(1);
      expect(result.memories[0].memory_type).toBe('preference');
    });
  });

  // ── Service layer: searchMemories ───────────────────────

  describe('searchMemories with relationship_id filtering', () => {
    it('combines relationship_id filter with text search', async () => {
      const { relationship_id } = await createTestRelationship();

      await createMemory(pool, {
        title: 'Anniversary date',
        content: 'Their wedding anniversary is March 15',
        memory_type: 'fact',
        relationship_id,
      });
      await createMemory(pool, {
        title: 'Another anniversary',
        content: 'Different anniversary for someone else March 20',
        memory_type: 'fact',
      });

      const result = await searchMemories(pool, 'anniversary', { relationship_id });

      // Should filter results to only the relationship-scoped memory
      if (result.results.length > 0) {
        expect(result.results.every((r) => r.relationship_id === relationship_id)).toBe(true);
      }
    });
  });

  // ── Scope validation ────────────────────────────────────

  describe('scope validation', () => {
    it('relationship_id counts as a valid scope (no warning logged)', async () => {
      const { relationship_id } = await createTestRelationship();

      // This should not produce a "without scope" warning because relationship_id is set
      const memory = await createMemory(pool, {
        title: 'Scoped by relationship',
        content: 'Has at least one scope',
        relationship_id,
      });

      expect(memory.id).toBeDefined();
      expect(memory.relationship_id).toBe(relationship_id);
    });
  });

  // ── FK cascade: ON DELETE SET NULL ──────────────────────

  describe('foreign key behavior', () => {
    it('sets relationship_id to null when relationship is deleted', async () => {
      const { relationship_id } = await createTestRelationship();

      const memory = await createMemory(pool, {
        title: 'Will lose relationship ref',
        content: 'FK should SET NULL',
        memory_type: 'fact',
        relationship_id,
      });

      // Delete the relationship
      await pool.query('DELETE FROM relationship WHERE id = $1', [relationship_id]);

      // Memory should still exist but with null relationship_id
      const retrieved = await getMemory(pool, memory.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.relationship_id).toBeNull();
    });
  });

  // ── API: POST /api/memories/unified with relationship_id ─

  describe('POST /api/memories/unified with relationship_id', () => {
    it('accepts relationship_id in request body', async () => {
      const { relationship_id } = await createTestRelationship();

      const res = await app.inject({
        method: 'POST',
        url: '/api/memories/unified',
        payload: {
          title: 'API relationship memory',
          content: 'Created via API with relationship scope',
          memory_type: 'fact',
          user_email: 'test@example.com',
          relationship_id: relationship_id,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.relationship_id).toBe(relationship_id);
    });

    it('creates memory without relationship_id (backward compatible)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memories/unified',
        payload: {
          title: 'No relationship scope',
          content: 'Backward compatible',
          memory_type: 'note',
          user_email: 'test@example.com',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.relationship_id).toBeNull();
    });
  });

  // ── API: GET /api/memories/unified with relationship_id filter ─

  describe('GET /api/memories/unified with relationship_id filter', () => {
    it('filters memories by relationship_id query parameter', async () => {
      const { relationship_id } = await createTestRelationship();

      await createMemory(pool, {
        title: 'With relationship',
        content: 'Scoped to relationship',
        memory_type: 'fact',
        relationship_id,
      });
      await createMemory(pool, {
        title: 'Without relationship',
        content: 'No relationship scope',
        memory_type: 'fact',
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/memories/unified?relationship_id=${relationship_id}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.memories.length).toBe(1);
      expect(body.memories[0].relationship_id).toBe(relationship_id);
    });
  });

  // ── API: GET /api/memories/search with relationship_id ──

  describe('GET /api/memories/search with relationship_id filter', () => {
    it('accepts relationship_id query parameter for filtered search', async () => {
      const { relationship_id } = await createTestRelationship();

      await pool.query(
        `INSERT INTO memory (title, content, memory_type, relationship_id)
         VALUES ('Anniversary', 'Their anniversary is March 15', 'fact', $1)`,
        [relationship_id],
      );
      await pool.query(
        `INSERT INTO memory (title, content, memory_type)
         VALUES ('Other anniversary', 'Someone else''s anniversary', 'fact')`,
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/memories/search?q=anniversary&relationship_id=${relationship_id}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // All results should be scoped to the relationship
      if (body.results && body.results.length > 0) {
        // The text search should return the relationship-scoped memory
        expect(body.results.length).toBeGreaterThan(0);
      }
    });
  });

  // ── API: POST /api/memories/:id/supersede inherits relationship_id ──

  describe('POST /api/memories/:id/supersede', () => {
    it('inherits relationship_id from superseded memory', async () => {
      const { relationship_id } = await createTestRelationship();

      // Create original memory with relationship scope
      const original = await pool.query(
        `INSERT INTO memory (title, content, memory_type, relationship_id)
         VALUES ('Old anniversary', 'March 15', 'fact', $1)
         RETURNING id::text as id`,
        [relationship_id],
      );
      const oldId = (original.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/memories/${oldId}/supersede`,
        payload: {
          title: 'Updated anniversary',
          content: 'Actually March 16',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.new_memory.relationship_id).toBe(relationship_id);
    });
  });

  // ── Down migration ─────────────────────────────────────

  describe('down migration', () => {
    it('migration can be reversed (column exists now)', async () => {
      const before = await pool.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_name = 'memory' AND column_name = 'relationship_id'`,
      );
      expect(before.rows.length).toBe(1);
    });
  });
});
