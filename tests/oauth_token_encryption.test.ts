/**
 * Integration tests for OAuth token encryption at rest.
 * Verifies that tokens are encrypted in the database and decrypted on read.
 * Issue #1056.
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { saveConnection, getConnection, listConnections } from '../src/api/oauth/service.ts';
import type { OAuthTokens } from '../src/api/oauth/types.ts';

const TEST_KEY_HEX = 'c'.repeat(64); // 32-byte key in hex

const MOCK_TOKENS: OAuthTokens = {
  access_token: 'ya29.test-access-token-value',
  refresh_token: '1//test-refresh-token-value',
  expires_at: new Date('2099-01-01T00:00:00Z'),
  token_type: 'Bearer',
  scopes: ['openid', 'email'],
};

describe('oauth token encryption integration', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('with encryption enabled', () => {
    beforeEach(() => {
      vi.stubEnv('OAUTH_TOKEN_ENCRYPTION_KEY', TEST_KEY_HEX);
    });

    it('saves encrypted tokens and returns plaintext to caller', async () => {
      const conn = await saveConnection(pool, 'user@test.com', 'google', MOCK_TOKENS);

      // Returned connection should have plaintext tokens
      expect(conn.access_token).toBe(MOCK_TOKENS.access_token);
      expect(conn.refresh_token).toBe(MOCK_TOKENS.refresh_token);

      // Tokens in the database should be encrypted (not plaintext)
      const raw = await pool.query(
        'SELECT access_token, refresh_token FROM oauth_connection WHERE id = $1',
        [conn.id],
      );
      const dbRow = raw.rows[0];
      expect(dbRow.access_token).not.toBe(MOCK_TOKENS.access_token);
      expect(dbRow.refresh_token).not.toBe(MOCK_TOKENS.refresh_token);
    });

    it('getConnection decrypts tokens from database', async () => {
      const saved = await saveConnection(pool, 'user@test.com', 'google', MOCK_TOKENS);

      const conn = await getConnection(pool, saved.id);
      expect(conn).not.toBeNull();
      expect(conn!.access_token).toBe(MOCK_TOKENS.access_token);
      expect(conn!.refresh_token).toBe(MOCK_TOKENS.refresh_token);
    });

    it('listConnections decrypts tokens from database', async () => {
      await saveConnection(pool, 'user@test.com', 'google', MOCK_TOKENS);

      const connections = await listConnections(pool, 'user@test.com');
      expect(connections).toHaveLength(1);
      expect(connections[0].access_token).toBe(MOCK_TOKENS.access_token);
      expect(connections[0].refresh_token).toBe(MOCK_TOKENS.refresh_token);
    });

    it('upsert re-encrypts tokens on update', async () => {
      const conn1 = await saveConnection(pool, 'user@test.com', 'google', MOCK_TOKENS);

      const updatedTokens: OAuthTokens = {
        ...MOCK_TOKENS,
        access_token: 'ya29.updated-access-token',
        refresh_token: '1//updated-refresh-token',
      };

      const conn2 = await saveConnection(pool, 'user@test.com', 'google', updatedTokens);

      // Should be the same row (upsert)
      expect(conn2.id).toBe(conn1.id);

      // Returned connection has updated plaintext
      expect(conn2.access_token).toBe(updatedTokens.access_token);
      expect(conn2.refresh_token).toBe(updatedTokens.refresh_token);

      // Database should have encrypted updated tokens
      const raw = await pool.query(
        'SELECT access_token, refresh_token FROM oauth_connection WHERE id = $1',
        [conn2.id],
      );
      expect(raw.rows[0].access_token).not.toBe(updatedTokens.access_token);
      expect(raw.rows[0].refresh_token).not.toBe(updatedTokens.refresh_token);

      // Reading back should return updated plaintext
      const readBack = await getConnection(pool, conn2.id);
      expect(readBack!.access_token).toBe(updatedTokens.access_token);
      expect(readBack!.refresh_token).toBe(updatedTokens.refresh_token);
    });
  });

  describe('without encryption (dev mode)', () => {
    beforeEach(() => {
      vi.stubEnv('OAUTH_TOKEN_ENCRYPTION_KEY', '');
    });

    it('saves and reads tokens as plaintext', async () => {
      const conn = await saveConnection(pool, 'user@test.com', 'google', MOCK_TOKENS);
      expect(conn.access_token).toBe(MOCK_TOKENS.access_token);

      // In the database, tokens should be stored as-is (plaintext passthrough)
      const raw = await pool.query(
        'SELECT access_token, refresh_token FROM oauth_connection WHERE id = $1',
        [conn.id],
      );
      expect(raw.rows[0].access_token).toBe(MOCK_TOKENS.access_token);
      expect(raw.rows[0].refresh_token).toBe(MOCK_TOKENS.refresh_token);

      // getConnection also returns plaintext
      const readBack = await getConnection(pool, conn.id);
      expect(readBack!.access_token).toBe(MOCK_TOKENS.access_token);
    });
  });
});
