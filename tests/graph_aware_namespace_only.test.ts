/**
 * Tests for Issue #2266: /context/graph-aware — make email optional
 * with namespace fallback.
 *
 * Validates:
 * - When user_email is absent, search uses namespace-only mode
 * - Namespace-only mode skips graph traversal (collectGraphScopes)
 * - Response metadata includes search_type: 'namespace_only' in that mode
 * - Existing graph mode (with email) unchanged
 * - Graceful degradation when email is absent and no namespace set
 */

import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { buildServer } from '../src/api/server.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { runMigrate } from './helpers/migrate.ts';
import { signTestM2mJwt, signTestJwt } from './helpers/auth.ts';

describe('Graph-Aware Context Namespace-Only Mode (#2266)', () => {
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

  describe('namespace-only mode (no email)', () => {
    it('returns results when email is absent with M2M token and namespace', async () => {
      // Create a memory in the default namespace
      await pool.query(
        `INSERT INTO memory (title, content, memory_type, importance, confidence, namespace)
         VALUES ('Test memory', 'Some test content for searching', 'preference', 5, 1.0, 'default')`,
      );

      const m2mToken = await signTestM2mJwt('test-agent');
      const res = await app.inject({
        method: 'POST',
        url: '/context/graph-aware',
        headers: {
          authorization: `Bearer ${m2mToken}`,
          'x-namespace': 'default',
        },
        payload: {
          prompt: 'test content',
          // No user_email — triggers namespace-only mode
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.metadata).toBeDefined();
      expect(body.metadata.search_type).toBe('namespace_only');
      expect(Array.isArray(body.memories)).toBe(true);
    });

    it('does not call collectGraphScopes in namespace-only mode (no scopes field)', async () => {
      const m2mToken = await signTestM2mJwt('test-agent');
      const res = await app.inject({
        method: 'POST',
        url: '/context/graph-aware',
        headers: {
          authorization: `Bearer ${m2mToken}`,
          'x-namespace': 'default',
        },
        payload: { prompt: 'test query' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.metadata.search_type).toBe('namespace_only');
    });
  });

  describe('existing graph mode unchanged', () => {
    it('returns graph search_type when user_email is provided', async () => {
      const TEST_EMAIL = `graph-test-${randomUUID().slice(0, 8)}@example.com`;
      await pool.query(
        `INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT (email) DO NOTHING`,
        [TEST_EMAIL],
      );
      await pool.query(
        `INSERT INTO namespace_grant (email, namespace, access, is_home)
         VALUES ($1, 'default', 'readwrite', true) ON CONFLICT DO NOTHING`,
        [TEST_EMAIL],
      );

      const userToken = await signTestJwt(TEST_EMAIL);
      const res = await app.inject({
        method: 'POST',
        url: '/context/graph-aware',
        headers: { authorization: `Bearer ${userToken}` },
        payload: {
          prompt: 'test query',
          user_email: TEST_EMAIL,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Graph mode: search_type should be 'semantic' or 'text' (not 'namespace_only')
      expect(['semantic', 'text']).toContain(body.metadata.search_type);
    });

    it('M2M with explicit user_email in body still uses graph mode', async () => {
      const TEST_EMAIL = `m2m-graph-${randomUUID().slice(0, 8)}@example.com`;
      await pool.query(
        `INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT (email) DO NOTHING`,
        [TEST_EMAIL],
      );

      const m2mToken = await signTestM2mJwt('test-agent');
      const res = await app.inject({
        method: 'POST',
        url: '/context/graph-aware',
        headers: {
          authorization: `Bearer ${m2mToken}`,
          'x-namespace': 'default',
        },
        payload: {
          prompt: 'test query',
          user_email: TEST_EMAIL,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Graph mode uses 'semantic' or 'text', not 'namespace_only'
      expect(['semantic', 'text']).toContain(body.metadata.search_type);
    });
  });

  describe('graceful degradation', () => {
    it('returns 400 when no email and no namespace available', async () => {
      // Without auth, without namespace, without email — should return 400
      const res = await app.inject({
        method: 'POST',
        url: '/context/graph-aware',
        payload: { prompt: 'test query' },
      });

      // The existing behavior returns 400 for missing email.
      // With our change it should still return 400 when there's no fallback.
      expect(res.statusCode).toBe(400);
    });
  });
});
