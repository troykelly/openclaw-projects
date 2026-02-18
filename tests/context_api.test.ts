/**
 * Tests for the context retrieval API endpoint.
 * Part of Epic #235 - Issue #251.
 */

import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

describe('Context Retrieval API', () => {
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

  describe('POST /api/v1/context', () => {
    describe('input validation', () => {
      it('should require prompt field', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/context',
          payload: {},
        });

        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.payload);
        expect(body.error).toContain('prompt');
      });

      it('should reject empty prompt', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/context',
          payload: { prompt: '' },
        });

        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.payload);
        expect(body.error).toContain('prompt');
      });

      it('should reject prompt exceeding max length', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/context',
          payload: { prompt: 'a'.repeat(2001) },
        });

        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.payload);
        expect(body.error).toContain('2000');
      });

      it('should reject invalid max_memories value', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/context',
          payload: { prompt: 'test', max_memories: 100 },
        });

        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.payload);
        expect(body.error).toContain('max_memories');
      });

      it('should reject invalid max_context_length value', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/context',
          payload: { prompt: 'test', max_context_length: 50 },
        });

        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.payload);
        expect(body.error).toContain('max_context_length');
      });
    });

    describe('successful requests', () => {
      it('should return context structure with valid prompt', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/context',
          payload: { prompt: 'What are my preferences?' },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.payload);

        // Should have expected structure
        expect(body).toHaveProperty('context');
        expect(body).toHaveProperty('sources');
        expect(body).toHaveProperty('metadata');

        // Sources should be arrays
        expect(body.sources).toHaveProperty('memories');
        expect(Array.isArray(body.sources.memories)).toBe(true);

        // Metadata should have query time
        expect(body.metadata).toHaveProperty('query_time_ms');
        expect(typeof body.metadata.query_time_ms).toBe('number');
      });

      it('should return null context when nothing relevant found', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/context',
          payload: { prompt: 'completely irrelevant query xyz123abc' },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.payload);

        // Context can be null
        expect(body).toHaveProperty('context');
        // Metadata should still be present
        expect(body.metadata.memory_count).toBe(0);
      });

      it('should respect max_memories parameter', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/context',
          payload: { prompt: 'test', max_memories: 3 },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.payload);
        expect(body.sources.memories.length).toBeLessThanOrEqual(3);
      });

      it('should respect max_context_length parameter', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/context',
          payload: { prompt: 'test', max_context_length: 500 },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.payload);

        if (body.context) {
          expect(body.context.length).toBeLessThanOrEqual(500);
        }
      });

      it('should include projects when include_projects is true', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/context',
          payload: { prompt: 'test', include_projects: true },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.payload);
        expect(body.sources).toHaveProperty('projects');
        expect(Array.isArray(body.sources.projects)).toBe(true);
      });

      it('should include todos when include_todos is true', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/context',
          payload: { prompt: 'test', include_todos: true },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.payload);
        expect(body.sources).toHaveProperty('todos');
        expect(Array.isArray(body.sources.todos)).toBe(true);
      });
    });

    describe('user scoping', () => {
      it('should accept user_id in request body', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/context',
          payload: { prompt: 'test', user_id: 'test-user-123' },
        });

        expect(response.statusCode).toBe(200);
      });
    });

    describe('metadata', () => {
      it('should include search type in metadata', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/context',
          payload: { prompt: 'test' },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.payload);
        expect(body.metadata).toHaveProperty('search_type');
        expect(['semantic', 'text']).toContain(body.metadata.search_type);
      });

      it('should include truncated flag in metadata', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/context',
          payload: { prompt: 'test' },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.payload);
        expect(body.metadata).toHaveProperty('truncated');
        expect(typeof body.metadata.truncated).toBe('boolean');
      });
    });

    describe('performance', () => {
      it('should respond within acceptable time', async () => {
        const start = Date.now();

        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/context',
          payload: { prompt: 'test' },
        });

        const elapsed = Date.now() - start;

        expect(response.statusCode).toBe(200);
        // Should respond within 2 seconds (generous for test environment)
        expect(elapsed).toBeLessThan(2000);
      });
    });
  });
});
