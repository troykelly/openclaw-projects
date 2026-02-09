import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { buildServer } from '../src/api/server.ts';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { embeddingService } from '../src/api/embeddings/service.ts';

describe('Memory Search API', () => {
  const app = buildServer();
  let pool: Pool;

  const hasApiKey = !!(process.env.VOYAGERAI_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY);

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
    embeddingService.clearCache();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  describe('GET /api/memories/search', () => {
    it('returns 400 when query is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/memories/search',
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'q (query) parameter is required' });
    });

    it('returns empty results for non-matching query', async () => {
      // Create a work item
      const workItem = await pool.query(
        `INSERT INTO work_item (title, description, kind)
         VALUES ('Test Project', 'Test description', 'project')
         RETURNING id::text as id`,
      );
      const workItemId = (workItem.rows[0] as { id: string }).id;

      // Create a memory
      await pool.query(
        `INSERT INTO memory (work_item_id, title, content, memory_type)
         VALUES ($1, 'Test Memory', 'Some content', 'note')`,
        [workItemId],
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/memories/search?q=completely_unrelated_xyz123',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results).toEqual([]);
      expect(body.search_type).toBeDefined();
    });

    it.skipIf(!hasApiKey)('performs semantic search with embeddings', async () => {
      // Create a work item
      const workItem = await pool.query(
        `INSERT INTO work_item (title, description, kind)
         VALUES ('Test Project', 'Test description', 'project')
         RETURNING id::text as id`,
      );
      const workItemId = (workItem.rows[0] as { id: string }).id;

      // Create memory via API (which generates embedding)
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/memory',
        payload: {
          title: 'Dark Mode Preference',
          content: 'User prefers dark mode for reduced eye strain',
          linkedItemId: workItemId,
          type: 'note',
        },
      });
      expect(createRes.statusCode).toBe(201);

      // Search for it
      const searchRes = await app.inject({
        method: 'GET',
        url: '/api/memories/search?q=theme+settings',
      });

      expect(searchRes.statusCode).toBe(200);
      const body = searchRes.json();
      expect(body.search_type).toBe('semantic');
      expect(body.results.length).toBeGreaterThan(0);
      expect(body.query_embedding_provider).toBeDefined();
    });
  });

  describe('POST /api/memory with embedding', () => {
    it.skipIf(!hasApiKey)('creates memory with embedding', async () => {
      // Create a work item
      const workItem = await pool.query(
        `INSERT INTO work_item (title, description, kind)
         VALUES ('Test Project', 'Test description', 'project')
         RETURNING id::text as id`,
      );
      const workItemId = (workItem.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'POST',
        url: '/api/memory',
        payload: {
          title: 'Test Memory',
          content: 'Test content for embedding',
          linkedItemId: workItemId,
          type: 'note',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.embedding_status).toBe('complete');
    });
  });

  describe('PUT /api/memory/:id with embedding regeneration', () => {
    it.skipIf(!hasApiKey)('regenerates embedding on update', async () => {
      // Create a work item
      const workItem = await pool.query(
        `INSERT INTO work_item (title, description, kind)
         VALUES ('Test Project', 'Test description', 'project')
         RETURNING id::text as id`,
      );
      const workItemId = (workItem.rows[0] as { id: string }).id;

      // Create memory
      const memory = await pool.query(
        `INSERT INTO memory (work_item_id, title, content, memory_type, embedding_status)
         VALUES ($1, 'Original Title', 'Original content', 'note', 'complete')
         RETURNING id::text as id`,
        [workItemId],
      );
      const memoryId = (memory.rows[0] as { id: string }).id;

      // Update via API
      const res = await app.inject({
        method: 'PUT',
        url: `/api/memory/${memoryId}`,
        payload: {
          title: 'Updated Title',
          content: 'Updated content about something new',
          type: 'note',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.embedding_status).toBe('complete');
      expect(body.title).toBe('Updated Title');
    });
  });

  describe('POST /api/admin/embeddings/backfill', () => {
    it('backfills embeddings for memories', async () => {
      // Create a work item
      const workItem = await pool.query(
        `INSERT INTO work_item (title, description, kind)
         VALUES ('Test Project', 'Test description', 'project')
         RETURNING id::text as id`,
      );
      const workItemId = (workItem.rows[0] as { id: string }).id;

      // Create memories without embeddings
      await pool.query(
        `INSERT INTO memory (work_item_id, title, content, memory_type, embedding_status)
         VALUES ($1, 'Memory 1', 'Content 1', 'note', 'pending'),
                ($1, 'Memory 2', 'Content 2', 'note', 'pending')`,
        [workItemId],
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/embeddings/backfill',
        payload: {
          batch_size: 10,
        },
      });

      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.status).toBe('completed');
      expect(body.processed).toBe(2);
    });
  });

  describe('GET /api/health with embedding status', () => {
    it('includes embedding health in response', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/health',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.components.embeddings).toBeDefined();
      expect(body.components.embeddings.status).toBeDefined();
      expect(body.components.embeddings.details).toBeDefined();
    });
  });

  describe('GET /api/admin/embeddings/status', () => {
    it('returns embedding configuration and stats', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/embeddings/status',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.configured).toBeDefined();
      expect(body.stats).toBeDefined();
      expect(body.stats.total_memories).toBeDefined();
      expect(body.stats.with_embedding).toBeDefined();
      expect(body.stats.pending).toBeDefined();
      expect(body.stats.failed).toBeDefined();
    });
  });
});
