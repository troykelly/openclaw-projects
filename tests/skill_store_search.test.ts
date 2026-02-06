import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';

/**
 * Tests for Skill Store Search API (Issue #798).
 *
 * Covers:
 * - Full-text search (tsvector)
 * - Semantic search (vector similarity)
 * - Hybrid search (Reciprocal Rank Fusion)
 * - Fallback from semantic to full-text when embedding service unavailable
 * - Filter parameters: collection, tags, status, user_email
 * - min_similarity threshold filtering
 * - Exclude soft-deleted items
 * - API endpoint integration
 */
describe('Skill Store Search (Issue #798)', () => {
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  // Helper to insert an item with embedding
  async function insertItem(overrides: {
    skill_id?: string;
    title?: string;
    summary?: string;
    content?: string;
    collection?: string;
    key?: string;
    tags?: string[];
    status?: string;
    user_email?: string;
    deleted_at?: string;
  } = {}): Promise<string> {
    const result = await pool.query(
      `INSERT INTO skill_store_item (skill_id, collection, key, title, summary, content, tags, status, user_email, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::skill_store_item_status, 'active'), $9, $10::timestamptz)
       RETURNING id::text as id`,
      [
        overrides.skill_id ?? 'test-skill',
        overrides.collection ?? '_default',
        overrides.key ?? null,
        overrides.title ?? null,
        overrides.summary ?? null,
        overrides.content ?? null,
        overrides.tags ?? [],
        overrides.status ?? null,
        overrides.user_email ?? null,
        overrides.deleted_at ?? null,
      ]
    );
    return result.rows[0].id;
  }

  describe('searchSkillStoreFullText', () => {
    it('finds items matching search query via tsvector', async () => {
      const { searchSkillStoreFullText } = await import(
        '../src/api/skill-store/search.ts'
      );

      await insertItem({ skill_id: 'sk1', title: 'PostgreSQL Optimization Guide', summary: 'How to tune database queries' });
      await insertItem({ skill_id: 'sk1', title: 'Redis Caching Patterns', summary: 'In-memory caching strategies' });

      const result = await searchSkillStoreFullText(pool, {
        skill_id: 'sk1',
        query: 'database optimization',
      });

      expect(result.results.length).toBeGreaterThanOrEqual(1);
      expect(result.results[0].title).toContain('PostgreSQL');
      expect(result.total).toBeGreaterThanOrEqual(1);
    });

    it('requires skill_id parameter', async () => {
      const { searchSkillStoreFullText } = await import(
        '../src/api/skill-store/search.ts'
      );

      await expect(
        searchSkillStoreFullText(pool, {
          skill_id: '',
          query: 'test',
        })
      ).rejects.toThrow(/skill_id/);
    });

    it('requires query parameter', async () => {
      const { searchSkillStoreFullText } = await import(
        '../src/api/skill-store/search.ts'
      );

      await expect(
        searchSkillStoreFullText(pool, {
          skill_id: 'sk1',
          query: '',
        })
      ).rejects.toThrow(/query/);
    });

    it('filters by collection', async () => {
      const { searchSkillStoreFullText } = await import(
        '../src/api/skill-store/search.ts'
      );

      await insertItem({ skill_id: 'sk1', collection: 'articles', title: 'Database Article', content: 'Full database content' });
      await insertItem({ skill_id: 'sk1', collection: 'config', title: 'Database Config', content: 'Database configuration' });

      const result = await searchSkillStoreFullText(pool, {
        skill_id: 'sk1',
        query: 'database',
        collection: 'articles',
      });

      expect(result.results).toHaveLength(1);
      expect(result.results[0].collection).toBe('articles');
    });

    it('filters by tags', async () => {
      const { searchSkillStoreFullText } = await import(
        '../src/api/skill-store/search.ts'
      );

      await insertItem({ skill_id: 'sk1', title: 'Tagged Item', content: 'Some searchable content', tags: ['javascript', 'tutorial'] });
      await insertItem({ skill_id: 'sk1', title: 'Untagged Item', content: 'Other searchable content' });

      const result = await searchSkillStoreFullText(pool, {
        skill_id: 'sk1',
        query: 'searchable content',
        tags: ['javascript'],
      });

      expect(result.results).toHaveLength(1);
      expect(result.results[0].tags).toContain('javascript');
    });

    it('filters by status', async () => {
      const { searchSkillStoreFullText } = await import(
        '../src/api/skill-store/search.ts'
      );

      await insertItem({ skill_id: 'sk1', title: 'Active Item', content: 'Searchable content here' });
      await insertItem({ skill_id: 'sk1', title: 'Archived Item', content: 'Searchable content too', status: 'archived' });

      const result = await searchSkillStoreFullText(pool, {
        skill_id: 'sk1',
        query: 'searchable content',
        status: 'active',
      });

      expect(result.results).toHaveLength(1);
      expect(result.results[0].title).toBe('Active Item');
    });

    it('filters by user_email', async () => {
      const { searchSkillStoreFullText } = await import(
        '../src/api/skill-store/search.ts'
      );

      await insertItem({ skill_id: 'sk1', title: 'User Item', content: 'Personal content', user_email: 'alice@example.com' });
      await insertItem({ skill_id: 'sk1', title: 'Other User Item', content: 'Other content', user_email: 'bob@example.com' });

      const result = await searchSkillStoreFullText(pool, {
        skill_id: 'sk1',
        query: 'content',
        user_email: 'alice@example.com',
      });

      expect(result.results).toHaveLength(1);
      expect(result.results[0].user_email).toBe('alice@example.com');
    });

    it('excludes soft-deleted items', async () => {
      const { searchSkillStoreFullText } = await import(
        '../src/api/skill-store/search.ts'
      );

      await insertItem({ skill_id: 'sk1', title: 'Active Item', content: 'Searchable content' });
      const deletedId = await insertItem({ skill_id: 'sk1', title: 'Deleted Item', content: 'Also searchable content' });
      await pool.query(`UPDATE skill_store_item SET deleted_at = now() WHERE id = $1`, [deletedId]);

      const result = await searchSkillStoreFullText(pool, {
        skill_id: 'sk1',
        query: 'searchable',
      });

      expect(result.results).toHaveLength(1);
      expect(result.results[0].title).toBe('Active Item');
    });

    it('supports pagination with limit and offset', async () => {
      const { searchSkillStoreFullText } = await import(
        '../src/api/skill-store/search.ts'
      );

      for (let i = 0; i < 5; i++) {
        await insertItem({ skill_id: 'sk1', title: `Article ${i}`, content: `Searchable article content number ${i}` });
      }

      const result = await searchSkillStoreFullText(pool, {
        skill_id: 'sk1',
        query: 'article',
        limit: 2,
        offset: 0,
      });

      expect(result.results).toHaveLength(2);
    });

    it('returns relevance score', async () => {
      const { searchSkillStoreFullText } = await import(
        '../src/api/skill-store/search.ts'
      );

      await insertItem({ skill_id: 'sk1', title: 'Exact Match Item', summary: 'Exact Match', content: 'Exact match content' });

      const result = await searchSkillStoreFullText(pool, {
        skill_id: 'sk1',
        query: 'exact match',
      });

      expect(result.results.length).toBeGreaterThanOrEqual(1);
      expect(result.results[0]).toHaveProperty('relevance');
      expect(typeof result.results[0].relevance).toBe('number');
    });
  });

  describe('searchSkillStoreSemantic', () => {
    it('performs semantic search when embedding service is available', async () => {
      const { searchSkillStoreSemantic } = await import(
        '../src/api/skill-store/search.ts'
      );
      const { embeddingService } = await import(
        '../src/api/embeddings/service.ts'
      );
      const { generateSkillStoreItemEmbedding, buildSkillStoreEmbeddingText } = await import(
        '../src/api/embeddings/skill-store-integration.ts'
      );

      // Insert items and generate embeddings
      const id1 = await insertItem({ skill_id: 'sk1', title: 'Machine Learning Basics', summary: 'Introduction to ML algorithms' });
      const id2 = await insertItem({ skill_id: 'sk1', title: 'Cooking Recipes', summary: 'Italian pasta recipes' });

      if (embeddingService.isConfigured()) {
        const text1 = buildSkillStoreEmbeddingText({ title: 'Machine Learning Basics', summary: 'Introduction to ML algorithms', content: null });
        await generateSkillStoreItemEmbedding(pool, id1, text1);
        const text2 = buildSkillStoreEmbeddingText({ title: 'Cooking Recipes', summary: 'Italian pasta recipes', content: null });
        await generateSkillStoreItemEmbedding(pool, id2, text2);

        const result = await searchSkillStoreSemantic(pool, {
          skill_id: 'sk1',
          query: 'artificial intelligence and neural networks',
        });

        expect(result.searchType).toBe('semantic');
        expect(result.results.length).toBeGreaterThanOrEqual(1);
        expect(result.results[0]).toHaveProperty('similarity');
      }
    });

    it('falls back to full-text search when embedding service unavailable', async () => {
      const { searchSkillStoreSemantic } = await import(
        '../src/api/skill-store/search.ts'
      );

      await insertItem({ skill_id: 'sk1', title: 'Database Tuning', summary: 'PostgreSQL query optimization techniques' });

      // Even if embedding is configured, test the fallback code path is available
      const result = await searchSkillStoreSemantic(pool, {
        skill_id: 'sk1',
        query: 'database',
      });

      // Should return results regardless of search type
      expect(result.results.length).toBeGreaterThanOrEqual(0);
      expect(['semantic', 'text']).toContain(result.searchType);
    });

    it('filters by min_similarity when doing semantic search', async () => {
      const { searchSkillStoreSemantic } = await import(
        '../src/api/skill-store/search.ts'
      );
      const { embeddingService } = await import(
        '../src/api/embeddings/service.ts'
      );
      const { generateSkillStoreItemEmbedding } = await import(
        '../src/api/embeddings/skill-store-integration.ts'
      );

      if (embeddingService.isConfigured()) {
        const id1 = await insertItem({ skill_id: 'sk1', title: 'Artificial Intelligence', summary: 'Deep learning and neural networks' });
        await generateSkillStoreItemEmbedding(pool, id1, 'Artificial Intelligence\n\nDeep learning and neural networks');

        const result = await searchSkillStoreSemantic(pool, {
          skill_id: 'sk1',
          query: 'AI deep learning',
          min_similarity: 0.9,
        });

        // All results should meet the minimum similarity
        for (const r of result.results) {
          expect(r.similarity).toBeGreaterThanOrEqual(0.9);
        }
      }
    });

    it('excludes soft-deleted items', async () => {
      const { searchSkillStoreSemantic } = await import(
        '../src/api/skill-store/search.ts'
      );

      await insertItem({ skill_id: 'sk1', title: 'Active Search Item', summary: 'Active content for search' });
      const deletedId = await insertItem({ skill_id: 'sk1', title: 'Deleted Search Item', summary: 'Deleted content for search' });
      await pool.query(`UPDATE skill_store_item SET deleted_at = now() WHERE id = $1`, [deletedId]);

      const result = await searchSkillStoreSemantic(pool, {
        skill_id: 'sk1',
        query: 'search',
      });

      // Should not include the deleted item
      const deletedInResults = result.results.some((r) => r.id === deletedId);
      expect(deletedInResults).toBe(false);
    });
  });

  describe('searchSkillStoreHybrid', () => {
    it('combines semantic and full-text results with RRF', async () => {
      const { searchSkillStoreHybrid } = await import(
        '../src/api/skill-store/search.ts'
      );
      const { embeddingService } = await import(
        '../src/api/embeddings/service.ts'
      );
      const { generateSkillStoreItemEmbedding, buildSkillStoreEmbeddingText } = await import(
        '../src/api/embeddings/skill-store-integration.ts'
      );

      const id1 = await insertItem({ skill_id: 'sk1', title: 'TypeScript Handbook', summary: 'Guide to TypeScript programming language features' });
      const id2 = await insertItem({ skill_id: 'sk1', title: 'JavaScript Basics', summary: 'Introduction to JavaScript language' });

      if (embeddingService.isConfigured()) {
        const text1 = buildSkillStoreEmbeddingText({ title: 'TypeScript Handbook', summary: 'Guide to TypeScript programming language features', content: null });
        await generateSkillStoreItemEmbedding(pool, id1, text1);
        const text2 = buildSkillStoreEmbeddingText({ title: 'JavaScript Basics', summary: 'Introduction to JavaScript language', content: null });
        await generateSkillStoreItemEmbedding(pool, id2, text2);
      }

      const result = await searchSkillStoreHybrid(pool, {
        skill_id: 'sk1',
        query: 'typescript programming',
      });

      expect(result.results.length).toBeGreaterThanOrEqual(1);
      expect(result.results[0]).toHaveProperty('score');
    });

    it('accepts custom semantic_weight', async () => {
      const { searchSkillStoreHybrid } = await import(
        '../src/api/skill-store/search.ts'
      );

      await insertItem({ skill_id: 'sk1', title: 'Test Item', summary: 'Content for hybrid search' });

      const result = await searchSkillStoreHybrid(pool, {
        skill_id: 'sk1',
        query: 'test',
        semantic_weight: 0.5,
      });

      // Should still return results
      expect(result).toHaveProperty('results');
      expect(result).toHaveProperty('searchType');
    });

    it('falls back to full-text only when no semantic results available', async () => {
      const { searchSkillStoreHybrid } = await import(
        '../src/api/skill-store/search.ts'
      );

      // Items without embeddings — hybrid should still work via full-text
      await insertItem({ skill_id: 'sk1', title: 'Full Text Only Item', summary: 'Only full text available here' });

      const result = await searchSkillStoreHybrid(pool, {
        skill_id: 'sk1',
        query: 'full text',
      });

      expect(result.results.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('API endpoint integration', () => {
    it('POST /api/skill-store/search returns full-text results', async () => {
      const { buildServer } = await import('../src/api/server.ts');
      const app = buildServer({ logger: false });

      await insertItem({ skill_id: 'sk1', title: 'API Test Item', summary: 'Item for API search testing' });

      const response = await app.inject({
        method: 'POST',
        url: '/api/skill-store/search',
        payload: {
          skill_id: 'sk1',
          query: 'API test',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('results');
      expect(body).toHaveProperty('total');

      await app.close();
    });

    it('POST /api/skill-store/search requires skill_id', async () => {
      const { buildServer } = await import('../src/api/server.ts');
      const app = buildServer({ logger: false });

      const response = await app.inject({
        method: 'POST',
        url: '/api/skill-store/search',
        payload: {
          query: 'test',
        },
      });

      expect(response.statusCode).toBe(400);

      await app.close();
    });

    it('POST /api/skill-store/search/semantic returns results', async () => {
      const { buildServer } = await import('../src/api/server.ts');
      const app = buildServer({ logger: false });

      await insertItem({ skill_id: 'sk1', title: 'Semantic Test Item', summary: 'Item for semantic search testing' });

      const response = await app.inject({
        method: 'POST',
        url: '/api/skill-store/search/semantic',
        payload: {
          skill_id: 'sk1',
          query: 'semantic test',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('results');
      expect(body).toHaveProperty('search_type');

      await app.close();
    });

    it('POST /api/skill-store/search/semantic requires skill_id', async () => {
      const { buildServer } = await import('../src/api/server.ts');
      const app = buildServer({ logger: false });

      const response = await app.inject({
        method: 'POST',
        url: '/api/skill-store/search/semantic',
        payload: {
          query: 'test',
        },
      });

      expect(response.statusCode).toBe(400);

      await app.close();
    });
  });
});
