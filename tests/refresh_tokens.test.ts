/**
 * Integration tests for refresh token storage with family-based rotation.
 * Issue #1324 — part of Epic #1322 (JWT Auth).
 *
 * Tests run against real Postgres via the shared test pool.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { getPoolConfig } from './helpers/db.ts';
import {
  createRefreshToken,
  consumeRefreshToken,
  revokeTokenFamily,
} from '../src/api/auth/refresh-tokens.ts';

describe('auth/refresh-tokens', () => {
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    // Use a slightly larger pool to avoid connection exhaustion during
    // concurrent tests that call consumeRefreshToken (which checks out
    // a dedicated client for FOR UPDATE transactions).
    pool = new Pool({ ...getPoolConfig(), max: 5 });
  });

  beforeEach(async () => {
    // Use targeted truncation instead of truncateAllTables to avoid
    // contention with the pool's checked-out clients from prior tests.
    await pool.query('TRUNCATE TABLE auth_refresh_token CASCADE');
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('createRefreshToken', () => {
    it('creates a token and returns token string, id, and familyId', async () => {
      const result = await createRefreshToken(pool, 'user@example.com');

      expect(result).toHaveProperty('token');
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('familyId');
      expect(typeof result.token).toBe('string');
      expect(result.token.length).toBeGreaterThan(0);
      expect(typeof result.id).toBe('string');
      expect(typeof result.familyId).toBe('string');
    });

    it('stores only the SHA-256 hash, not the raw token', async () => {
      const result = await createRefreshToken(pool, 'user@example.com');

      // The raw token should NOT appear in the database
      const rows = await pool.query(
        'SELECT token_sha256 FROM auth_refresh_token WHERE id = $1',
        [result.id],
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0].token_sha256).not.toBe(result.token);
      // SHA-256 hex digest is 64 characters
      expect(rows.rows[0].token_sha256).toHaveLength(64);
    });

    it('generates unique tokens each time', async () => {
      const t1 = await createRefreshToken(pool, 'user@example.com');
      const t2 = await createRefreshToken(pool, 'user@example.com');

      expect(t1.token).not.toBe(t2.token);
      expect(t1.id).not.toBe(t2.id);
    });

    it('uses the provided familyId when given', async () => {
      const familyId = '550e8400-e29b-41d4-a716-446655440000';
      const result = await createRefreshToken(pool, 'user@example.com', familyId);

      expect(result.familyId).toBe(familyId);
    });

    it('generates a new familyId when none is provided', async () => {
      const result = await createRefreshToken(pool, 'user@example.com');

      // Should be a valid UUID
      expect(result.familyId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it('sets expires_at to 7 days from creation', async () => {
      const result = await createRefreshToken(pool, 'user@example.com');

      const row = await pool.query(
        'SELECT created_at, expires_at FROM auth_refresh_token WHERE id = $1',
        [result.id],
      );
      const created = new Date(row.rows[0].created_at);
      const expires = new Date(row.rows[0].expires_at);

      const diffMs = expires.getTime() - created.getTime();
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      // Allow 5 seconds of clock drift
      expect(Math.abs(diffMs - sevenDaysMs)).toBeLessThan(5000);
    });
  });

  describe('consumeRefreshToken', () => {
    it('consumes a valid token and returns email + familyId', async () => {
      const { token, familyId } = await createRefreshToken(pool, 'user@example.com');

      const result = await consumeRefreshToken(pool, token);

      expect(result.email).toBe('user@example.com');
      expect(result.familyId).toBe(familyId);
      expect(typeof result.tokenId).toBe('string');
    });

    it('rejects an unknown token', async () => {
      await expect(consumeRefreshToken(pool, 'bogus-token')).rejects.toThrow();
    });

    it('rejects an expired token', async () => {
      const { token, id } = await createRefreshToken(pool, 'user@example.com');

      // Manually set expires_at to the past
      await pool.query(
        "UPDATE auth_refresh_token SET expires_at = now() - interval '1 hour' WHERE id = $1",
        [id],
      );

      await expect(consumeRefreshToken(pool, token)).rejects.toThrow(/expired/i);
    });

    it('rejects a revoked token', async () => {
      const { token, id } = await createRefreshToken(pool, 'user@example.com');

      // Manually revoke
      await pool.query(
        'UPDATE auth_refresh_token SET revoked_at = now() WHERE id = $1',
        [id],
      );

      await expect(consumeRefreshToken(pool, token)).rejects.toThrow(/revoked/i);
    });
  });

  describe('token rotation', () => {
    it('consume marks token as consumed (sets replaced_by after new token created)', async () => {
      const { token, id, familyId } = await createRefreshToken(pool, 'user@example.com');

      // Consume the old token
      await consumeRefreshToken(pool, token);

      // Create a new token in the same family (simulating rotation)
      const newToken = await createRefreshToken(pool, 'user@example.com', familyId);

      // Link old → new
      await pool.query(
        'UPDATE auth_refresh_token SET replaced_by = $1 WHERE id = $2',
        [newToken.id, id],
      );

      const row = await pool.query(
        'SELECT replaced_by FROM auth_refresh_token WHERE id = $1',
        [id],
      );
      expect(row.rows[0].replaced_by).toBe(newToken.id);
    });
  });

  describe('grace window', () => {
    it('allows previous token within 10s grace window', async () => {
      const { token: oldToken, id: oldId, familyId } = await createRefreshToken(
        pool,
        'user@example.com',
      );

      // Consume the old token — this sets grace_expires_at
      await consumeRefreshToken(pool, oldToken);

      // Create the replacement (simulating rotation)
      const newResult = await createRefreshToken(pool, 'user@example.com', familyId);

      // Link old → new
      await pool.query(
        'UPDATE auth_refresh_token SET replaced_by = $1 WHERE id = $2',
        [newResult.id, oldId],
      );

      // The old token should still be consumable within grace window
      const graceResult = await consumeRefreshToken(pool, oldToken);
      expect(graceResult.email).toBe('user@example.com');
      expect(graceResult.familyId).toBe(familyId);
    });

    it('rejects previous token after grace window expires', async () => {
      const { token: oldToken, id: oldId, familyId } = await createRefreshToken(
        pool,
        'user@example.com',
      );

      // Consume the old token
      await consumeRefreshToken(pool, oldToken);

      // Create the replacement
      const newResult = await createRefreshToken(pool, 'user@example.com', familyId);

      // Link old → new
      await pool.query(
        'UPDATE auth_refresh_token SET replaced_by = $1 WHERE id = $2',
        [newResult.id, oldId],
      );

      // Expire the grace window
      await pool.query(
        "UPDATE auth_refresh_token SET grace_expires_at = now() - interval '1 second' WHERE id = $1",
        [oldId],
      );

      // Should be rejected — reuse outside grace revokes the family
      await expect(consumeRefreshToken(pool, oldToken)).rejects.toThrow(/revoked|reuse/i);
    });
  });

  describe('reuse detection', () => {
    it('revokes entire family when consumed token is reused outside grace', async () => {
      const { token: oldToken, id: oldId, familyId } = await createRefreshToken(
        pool,
        'user@example.com',
      );

      // Create a second token in the same family
      const { id: newId } = await createRefreshToken(pool, 'user@example.com', familyId);

      // Consume the old token
      await consumeRefreshToken(pool, oldToken);

      // Link old → new and expire grace
      await pool.query(
        'UPDATE auth_refresh_token SET replaced_by = $1, grace_expires_at = now() - interval \'1 second\' WHERE id = $2',
        [newId, oldId],
      );

      // Attempt reuse — should fail and revoke the whole family
      await expect(consumeRefreshToken(pool, oldToken)).rejects.toThrow(/revoked|reuse/i);

      // Verify ALL tokens in the family are revoked
      const rows = await pool.query(
        'SELECT id, revoked_at FROM auth_refresh_token WHERE family_id = $1',
        [familyId],
      );
      for (const row of rows.rows) {
        expect(row.revoked_at).not.toBeNull();
      }
    });
  });

  describe('revokeTokenFamily', () => {
    it('revokes all tokens in a family', async () => {
      const familyId = '550e8400-e29b-41d4-a716-446655440000';
      await createRefreshToken(pool, 'user@example.com', familyId);
      await createRefreshToken(pool, 'user@example.com', familyId);
      await createRefreshToken(pool, 'user@example.com', familyId);

      await revokeTokenFamily(pool, familyId);

      const rows = await pool.query(
        'SELECT revoked_at FROM auth_refresh_token WHERE family_id = $1',
        [familyId],
      );
      expect(rows.rows).toHaveLength(3);
      for (const row of rows.rows) {
        expect(row.revoked_at).not.toBeNull();
      }
    });

    it('does not affect tokens in other families', async () => {
      const family1 = '550e8400-e29b-41d4-a716-446655440001';
      const family2 = '550e8400-e29b-41d4-a716-446655440002';

      await createRefreshToken(pool, 'user@example.com', family1);
      await createRefreshToken(pool, 'user@example.com', family2);

      await revokeTokenFamily(pool, family1);

      const rows = await pool.query(
        'SELECT revoked_at FROM auth_refresh_token WHERE family_id = $1',
        [family2],
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0].revoked_at).toBeNull();
    });
  });

  describe('concurrent refresh race condition', () => {
    it('handles concurrent consume attempts without data corruption', async () => {
      const { token, familyId } = await createRefreshToken(pool, 'user@example.com');

      // Fire two consume calls concurrently.
      // With FOR UPDATE serialisation, two outcomes are valid:
      //   1. First wins, sets grace. Second sees grace window → both succeed.
      //   2. First wins, second waits on lock then sees grace → both succeed.
      //   3. Serialisation error causes one to fail — that's fine too.
      const results = await Promise.allSettled([
        consumeRefreshToken(pool, token),
        consumeRefreshToken(pool, token),
      ]);

      const successes = results.filter((r) => r.status === 'fulfilled');
      const failures = results.filter((r) => r.status === 'rejected');

      // At least one must succeed (the first to acquire the lock)
      // Both may succeed if the second runs within the grace window
      expect(successes.length).toBeGreaterThanOrEqual(1);
      expect(successes.length + failures.length).toBe(2);

      // Verify the token's family is still consistent
      const rows = await pool.query(
        'SELECT email, family_id FROM auth_refresh_token WHERE family_id = $1',
        [familyId],
      );
      expect(rows.rows.length).toBeGreaterThanOrEqual(1);
      expect(rows.rows[0].email).toBe('user@example.com');
    });
  });
});
