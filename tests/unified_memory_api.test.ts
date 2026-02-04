import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { buildServer } from '../src/api/server.ts';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';

describe('Unified Memory API (Issue #209)', () => {
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

  describe('POST /api/memories/unified', () => {
    it('creates a global memory with user email only', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memories/unified',
        payload: {
          title: 'User preference',
          content: 'User prefers dark mode',
          memory_type: 'preference',
          user_email: 'test@example.com',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.userEmail).toBe('test@example.com');
      expect(body.workItemId).toBeNull();
      expect(body.contactId).toBeNull();
      expect(body.memoryType).toBe('preference');
    });

    it('creates memory with work item scope', async () => {
      // Create a work item first
      const wiResult = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, status)
         VALUES ('Test Project', 'project', 'open')
         RETURNING id::text as id`
      );
      const workItemId = (wiResult.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'POST',
        url: '/api/memories/unified',
        payload: {
          title: 'Tech decision',
          content: 'Chose PostgreSQL for ACID compliance',
          memory_type: 'decision',
          user_email: 'test@example.com',
          work_item_id: workItemId,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.workItemId).toBe(workItemId);
    });

    it('creates memory with contact scope', async () => {
      // Create a contact first
      const contactResult = await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('John Doe')
         RETURNING id::text as id`
      );
      const contactId = (contactResult.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'POST',
        url: '/api/memories/unified',
        payload: {
          title: 'Contact preference',
          content: 'John prefers email',
          memory_type: 'fact',
          user_email: 'test@example.com',
          contact_id: contactId,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.contactId).toBe(contactId);
    });

    it('creates memory with agent attribution', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memories/unified',
        payload: {
          title: 'Agent note',
          content: 'User mentioned liking pizza',
          memory_type: 'fact',
          created_by_agent: 'openclaw-pi',
          source_url: 'https://example.com/conv/123',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.createdByAgent).toBe('openclaw-pi');
      expect(body.sourceUrl).toBe('https://example.com/conv/123');
    });

    it('creates memory with importance and confidence', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memories/unified',
        payload: {
          title: 'Important fact',
          content: 'User is allergic to peanuts',
          memory_type: 'fact',
          importance: 10,
          confidence: 0.95,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.importance).toBe(10);
      expect(body.confidence).toBe(0.95);
    });

    it('returns 400 for invalid memory type', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memories/unified',
        payload: {
          title: 'Test',
          content: 'Test',
          memory_type: 'invalid',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('Invalid memory_type');
    });

    it('returns 400 when title is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memories/unified',
        payload: {
          content: 'Test',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('title');
    });
  });

  describe('GET /api/memories/unified', () => {
    it('lists all memories', async () => {
      await pool.query(
        `INSERT INTO memory (title, content, memory_type, user_email)
         VALUES ('Memory 1', 'Content 1', 'note', 'user1@example.com'),
                ('Memory 2', 'Content 2', 'fact', 'user2@example.com')`
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/memories/unified',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.memories.length).toBe(2);
      expect(body.total).toBe(2);
    });

    it('filters by user email', async () => {
      await pool.query(
        `INSERT INTO memory (title, content, memory_type, user_email)
         VALUES ('Memory 1', 'Content 1', 'note', 'user1@example.com'),
                ('Memory 2', 'Content 2', 'note', 'user2@example.com')`
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/memories/unified?user_email=user1@example.com',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.memories.length).toBe(1);
      expect(body.memories[0].userEmail).toBe('user1@example.com');
    });

    it('filters by memory type', async () => {
      await pool.query(
        `INSERT INTO memory (title, content, memory_type)
         VALUES ('Pref', 'Content 1', 'preference'),
                ('Fact', 'Content 2', 'fact')`
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/memories/unified?memory_type=preference',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.memories.length).toBe(1);
      expect(body.memories[0].memoryType).toBe('preference');
    });
  });

  describe('GET /api/memories/global', () => {
    it('returns only global memories for a user', async () => {
      // Create a work item
      const wiResult = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, status)
         VALUES ('Test', 'project', 'open')
         RETURNING id::text as id`
      );
      const workItemId = (wiResult.rows[0] as { id: string }).id;

      // Create global and work item scoped memories
      await pool.query(
        `INSERT INTO memory (title, content, memory_type, user_email)
         VALUES ('Global', 'Content', 'preference', 'test@example.com')`
      );
      await pool.query(
        `INSERT INTO memory (title, content, memory_type, user_email, work_item_id)
         VALUES ('Scoped', 'Content', 'note', 'test@example.com', $1)`,
        [workItemId]
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/memories/global?user_email=test@example.com',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.memories.length).toBe(1);
      expect(body.memories[0].title).toBe('Global');
    });

    it('returns 400 when user_email is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/memories/global',
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('user_email');
    });
  });

  describe('POST /api/memories/:id/supersede', () => {
    it('supersedes a memory with a new one', async () => {
      // Create original memory
      const result = await pool.query(
        `INSERT INTO memory (title, content, memory_type, user_email, importance)
         VALUES ('Old fact', 'Outdated info', 'fact', 'test@example.com', 5)
         RETURNING id::text as id`
      );
      const oldId = (result.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/memories/${oldId}/supersede`,
        payload: {
          title: 'New fact',
          content: 'Updated information',
          importance: 8,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.newMemory.title).toBe('New fact');
      expect(body.newMemory.importance).toBe(8);
      expect(body.supersededId).toBe(oldId);

      // Verify old memory is marked superseded
      const oldMemory = await pool.query(
        `SELECT superseded_by::text FROM memory WHERE id = $1`,
        [oldId]
      );
      expect(oldMemory.rows[0].superseded_by).toBe(body.newMemory.id);
    });

    it('returns 404 for non-existent memory', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memories/00000000-0000-0000-0000-000000000000/supersede',
        payload: {
          title: 'New',
          content: 'Content',
        },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/memories/cleanup-expired', () => {
    it('deletes expired memories', async () => {
      // Create active and expired memories
      await pool.query(
        `INSERT INTO memory (title, content, memory_type)
         VALUES ('Active', 'Content', 'note')`
      );
      await pool.query(
        `INSERT INTO memory (title, content, memory_type, expires_at)
         VALUES ('Expired', 'Content', 'note', NOW() - INTERVAL '1 hour')`
      );

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/memories/cleanup-expired',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.deleted).toBe(1);

      // Verify only active remains
      const remaining = await pool.query('SELECT COUNT(*) as count FROM memory');
      expect(parseInt((remaining.rows[0] as { count: string }).count, 10)).toBe(1);
    });
  });
});
