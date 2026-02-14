/**
 * Test for Issue #1145: Memory search should include score and embedding_provider
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import type { Pool } from 'pg';
import { buildServer } from '../src/api/server.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { runMigrate } from './helpers/migrate.ts';

describe('Issue #1145 - Memory Search Scores', () => {
  const originalEnv = process.env;
  let pool: Pool;
  let app: ReturnType<typeof buildServer>;

  beforeAll(async () => {
    await runMigrate('up');
  });

  beforeEach(async () => {
    process.env = { ...originalEnv };
    process.env.OPENCLAW_PROJECTS_AUTH_DISABLED = 'true';
    // Configure embeddings (Voyage AI or mock)
    process.env.EMBEDDING_PROVIDER = 'voyage';
    process.env.VOYAGE_API_KEY = 'test-key';

    pool = createTestPool();
    await truncateAllTables(pool);
    app = buildServer({ logger: false });
  });

  afterEach(async () => {
    process.env = originalEnv;
    await pool.end();
    await app.close();
  });

  it('should include score and embedding_provider in search results', async () => {
    // Create a memory using the unified endpoint
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/memories/unified',
      payload: {
        title: 'Test Memory',
        content: 'This is a test memory about programming',
        type: 'fact',
      },
    });

    expect(createResponse.statusCode).toBe(201);

    // Search for the memory
    const searchResponse = await app.inject({
      method: 'GET',
      url: '/api/memories/search?q=programming',
    });

    expect(searchResponse.statusCode).toBe(200);

    const body = searchResponse.json() as {
      results: Array<{ id: string; title: string; score: number | null }>;
      search_type: string;
      embedding_provider: string | null;
    };

    // Should have search results
    expect(body.results).toBeDefined();
    expect(Array.isArray(body.results)).toBe(true);

    // Should have embedding_provider field (may be null if embeddings not configured)
    expect('embedding_provider' in body).toBe(true);

    // If results exist, each should have a score field
    if (body.results.length > 0) {
      for (const result of body.results) {
        expect('score' in result).toBe(true);

        // If semantic search was used, score should be a number
        if (body.search_type === 'semantic') {
          expect(typeof result.score).toBe('number');
          expect(result.score).toBeGreaterThanOrEqual(0);
          expect(result.score).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('should include score even for text-based search fallback', async () => {
    // Create a memory without waiting for embeddings
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/memories/unified',
      payload: {
        title: 'Test Memory',
        content: 'This is a test memory',
        type: 'fact',
      },
    });

    expect(createResponse.statusCode).toBe(201);

    // Search immediately (before embeddings are generated)
    const searchResponse = await app.inject({
      method: 'GET',
      url: '/api/memories/search?q=test',
    });

    expect(searchResponse.statusCode).toBe(200);

    const body = searchResponse.json() as {
      results: Array<{ id: string; title: string; score: number | null }>;
      search_type: string;
      embedding_provider: string | null;
    };

    // Even text search should have score field (may be 0.5 or null)
    if (body.results.length > 0) {
      for (const result of body.results) {
        expect('score' in result).toBe(true);
      }
    }
  });
});
