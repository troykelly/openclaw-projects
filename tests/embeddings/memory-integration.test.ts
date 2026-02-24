import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { generateMemoryEmbedding, searchMemoriesSemantic, backfillMemoryEmbeddings } from '../../src/api/embeddings/memory-integration.ts';
import { embeddingService } from '../../src/api/embeddings/service.ts';
import { runMigrate } from '../helpers/migrate.ts';
import { createTestPool, truncateAllTables } from '../helpers/db.ts';

describe('Memory Embedding Integration', () => {
  let pool: Pool;

  const hasApiKey = !!(process.env.VOYAGERAI_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY);

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
    embeddingService.clearCache();
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('generateMemoryEmbedding', () => {
    it.skipIf(!hasApiKey)('generates embedding for memory content', async () => {
      // Create a work item first
      const workItem = await pool.query(
        `INSERT INTO work_item (title, description, kind)
         VALUES ('Test Project', 'Test description', 'project')
         RETURNING id::text as id`,
      );
      const work_item_id = (workItem.rows[0] as { id: string }).id;

      // Create a memory
      const memory = await pool.query(
        `INSERT INTO memory (work_item_id, title, content, memory_type)
         VALUES ($1, 'User Preference', 'User prefers dark mode', 'note')
         RETURNING id::text as id`,
        [work_item_id],
      );
      const memory_id = (memory.rows[0] as { id: string }).id;

      // Generate embedding
      const status = await generateMemoryEmbedding(pool, memory_id, 'User Preference\n\nUser prefers dark mode');

      expect(status).toBe('complete');

      // Verify embedding was stored
      const result = await pool.query(
        `SELECT embedding_status, embedding_provider, embedding_model, embedding
         FROM memory WHERE id = $1`,
        [memory_id],
      );

      expect(result.rows[0]).toMatchObject({
        embedding_status: 'complete',
      });
      expect((result.rows[0] as { embedding_provider: string }).embedding_provider).toBeDefined();
      expect((result.rows[0] as { embedding_model: string }).embedding_model).toBeDefined();
      expect((result.rows[0] as { embedding: string }).embedding).not.toBeNull();
    });

    it('returns pending when no provider configured', async () => {
      // Temporarily clear API keys
      const oldVoyage = process.env.VOYAGERAI_API_KEY;
      const oldOpenai = process.env.OPENAI_API_KEY;
      const oldGemini = process.env.GEMINI_API_KEY;
      delete process.env.VOYAGERAI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GEMINI_API_KEY;
      embeddingService.clearCache();

      try {
        // Create a work item first
        const workItem = await pool.query(
          `INSERT INTO work_item (title, description, kind)
           VALUES ('Test Project', 'Test description', 'project')
           RETURNING id::text as id`,
        );
        const work_item_id = (workItem.rows[0] as { id: string }).id;

        // Create a memory
        const memory = await pool.query(
          `INSERT INTO memory (work_item_id, title, content, memory_type)
           VALUES ($1, 'Test Memory', 'Test content', 'note')
           RETURNING id::text as id`,
          [work_item_id],
        );
        const memory_id = (memory.rows[0] as { id: string }).id;

        // Try to generate embedding (should return pending)
        const status = await generateMemoryEmbedding(pool, memory_id, 'Test Memory\n\nTest content');

        expect(status).toBe('pending');

        // Verify status was updated
        const result = await pool.query(`SELECT embedding_status FROM memory WHERE id = $1`, [memory_id]);
        expect((result.rows[0] as { embedding_status: string }).embedding_status).toBe('pending');
      } finally {
        // Restore API keys
        if (oldVoyage) process.env.VOYAGERAI_API_KEY = oldVoyage;
        if (oldOpenai) process.env.OPENAI_API_KEY = oldOpenai;
        if (oldGemini) process.env.GEMINI_API_KEY = oldGemini;
        embeddingService.clearCache();
      }
    });
  });

  describe('searchMemoriesSemantic', () => {
    it.skipIf(!hasApiKey)('finds semantically similar memories', async () => {
      // Create a work item
      const workItem = await pool.query(
        `INSERT INTO work_item (title, description, kind)
         VALUES ('Test Project', 'Test description', 'project')
         RETURNING id::text as id`,
      );
      const work_item_id = (workItem.rows[0] as { id: string }).id;

      // Create memories with embeddings
      const memories = [
        { title: 'Dark Mode Preference', content: 'User prefers dark mode for reduced eye strain' },
        { title: 'Notification Settings', content: 'User wants minimal notifications, only critical alerts' },
        { title: 'Programming Language', content: 'User prefers TypeScript for type safety' },
      ];

      for (const mem of memories) {
        const result = await pool.query(
          `INSERT INTO memory (work_item_id, title, content, memory_type)
           VALUES ($1, $2, $3, 'note')
           RETURNING id::text as id`,
          [work_item_id, mem.title, mem.content],
        );
        const memory_id = (result.rows[0] as { id: string }).id;
        await generateMemoryEmbedding(pool, memory_id, `${mem.title}\n\n${mem.content}`);
      }

      // Search for theme-related memories
      const searchResult = await searchMemoriesSemantic(pool, 'user interface theme settings');

      expect(searchResult.search_type).toBe('semantic');
      expect(searchResult.results.length).toBeGreaterThan(0);

      // Dark mode should appear in results (order is non-deterministic)
      const titles = searchResult.results.map((r: { title: string }) => r.title);
      expect(titles.some((t: string) => t.includes('Dark Mode'))).toBe(true);
    });

    it('falls back to text search when embedding fails', async () => {
      // Temporarily clear API keys
      const oldVoyage = process.env.VOYAGERAI_API_KEY;
      const oldOpenai = process.env.OPENAI_API_KEY;
      const oldGemini = process.env.GEMINI_API_KEY;
      delete process.env.VOYAGERAI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GEMINI_API_KEY;
      embeddingService.clearCache();

      try {
        // Create a work item
        const workItem = await pool.query(
          `INSERT INTO work_item (title, description, kind)
           VALUES ('Test Project', 'Test description', 'project')
           RETURNING id::text as id`,
        );
        const work_item_id = (workItem.rows[0] as { id: string }).id;

        // Create a memory (no embedding)
        await pool.query(
          `INSERT INTO memory (work_item_id, title, content, memory_type)
           VALUES ($1, 'Test Memory with Keyword', 'Contains the keyword searchterm', 'note')`,
          [work_item_id],
        );

        // Search (should fall back to text)
        const searchResult = await searchMemoriesSemantic(pool, 'searchterm');

        expect(searchResult.search_type).toBe('text');
        expect(searchResult.results.length).toBe(1);
        expect(searchResult.results[0].title).toContain('Keyword');
      } finally {
        // Restore API keys
        if (oldVoyage) process.env.VOYAGERAI_API_KEY = oldVoyage;
        if (oldOpenai) process.env.OPENAI_API_KEY = oldOpenai;
        if (oldGemini) process.env.GEMINI_API_KEY = oldGemini;
        embeddingService.clearCache();
      }
    });
  });

  describe('backfillMemoryEmbeddings', () => {
    it.skipIf(!hasApiKey)('backfills embeddings for memories without them', async () => {
      // Create a work item
      const workItem = await pool.query(
        `INSERT INTO work_item (title, description, kind)
         VALUES ('Test Project', 'Test description', 'project')
         RETURNING id::text as id`,
      );
      const work_item_id = (workItem.rows[0] as { id: string }).id;

      // Create memories without embeddings
      await pool.query(
        `INSERT INTO memory (work_item_id, title, content, memory_type, embedding_status)
         VALUES ($1, 'Memory 1', 'Content 1', 'note', 'pending'),
                ($1, 'Memory 2', 'Content 2', 'note', 'pending')`,
        [work_item_id],
      );

      // Run backfill
      const result = await backfillMemoryEmbeddings(pool, { batch_size: 10 });

      expect(result.processed).toBe(2);
      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(0);

      // Verify embeddings were created
      const memories = await pool.query(`SELECT embedding_status FROM memory WHERE work_item_id = $1`, [work_item_id]);
      for (const row of memories.rows as Array<{ embedding_status: string }>) {
        expect(row.embedding_status).toBe('complete');
      }
    });
  });
});
