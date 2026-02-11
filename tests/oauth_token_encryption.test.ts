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
  accessToken: 'ya29.test-access-token-value',
  refreshToken: '1//test-refresh-token-value',
  expiresAt: new Date('2099-01-01T00:00:00Z'),
  tokenType: 'Bearer',
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
      expect(conn.accessToken).toBe(MOCK_TOKENS.accessToken);
      expect(conn.refreshToken).toBe(MOCK_TOKENS.refreshToken);

      // Tokens in the database should be encrypted (not plaintext)
      const raw = await pool.query(
        'SELECT access_token, refresh_token FROM oauth_connection WHERE id = $1',
        [conn.id],
      );
      const dbRow = raw.rows[0];
      expect(dbRow.access_token).not.toBe(MOCK_TOKENS.accessToken);
      expect(dbRow.refresh_token).not.toBe(MOCK_TOKENS.refreshToken);
    });

    it('getConnection decrypts tokens from database', async () => {
      const saved = await saveConnection(pool, 'user@test.com', 'google', MOCK_TOKENS);

      const conn = await getConnection(pool, saved.id);
      expect(conn).not.toBeNull();
      expect(conn!.accessToken).toBe(MOCK_TOKENS.accessToken);
      expect(conn!.refreshToken).toBe(MOCK_TOKENS.refreshToken);
    });

    it('listConnections decrypts tokens from database', async () => {
      await saveConnection(pool, 'user@test.com', 'google', MOCK_TOKENS);

      const connections = await listConnections(pool, 'user@test.com');
      expect(connections).toHaveLength(1);
      expect(connections[0].accessToken).toBe(MOCK_TOKENS.accessToken);
      expect(connections[0].refreshToken).toBe(MOCK_TOKENS.refreshToken);
    });

    it('upsert re-encrypts tokens on update', async () => {
      const conn1 = await saveConnection(pool, 'user@test.com', 'google', MOCK_TOKENS);

      const updatedTokens: OAuthTokens = {
        ...MOCK_TOKENS,
        accessToken: 'ya29.updated-access-token',
        refreshToken: '1//updated-refresh-token',
      };

      const conn2 = await saveConnection(pool, 'user@test.com', 'google', updatedTokens);

      // Should be the same row (upsert)
      expect(conn2.id).toBe(conn1.id);

      // Returned connection has updated plaintext
      expect(conn2.accessToken).toBe(updatedTokens.accessToken);
      expect(conn2.refreshToken).toBe(updatedTokens.refreshToken);

      // Database should have encrypted updated tokens
      const raw = await pool.query(
        'SELECT access_token, refresh_token FROM oauth_connection WHERE id = $1',
        [conn2.id],
      );
      expect(raw.rows[0].access_token).not.toBe(updatedTokens.accessToken);
      expect(raw.rows[0].refresh_token).not.toBe(updatedTokens.refreshToken);

      // Reading back should return updated plaintext
      const readBack = await getConnection(pool, conn2.id);
      expect(readBack!.accessToken).toBe(updatedTokens.accessToken);
      expect(readBack!.refreshToken).toBe(updatedTokens.refreshToken);
    });
  });

  describe('without encryption (dev mode)', () => {
    beforeEach(() => {
      vi.stubEnv('OAUTH_TOKEN_ENCRYPTION_KEY', '');
    });

    it('saves and reads tokens as plaintext', async () => {
      const conn = await saveConnection(pool, 'user@test.com', 'google', MOCK_TOKENS);
      expect(conn.accessToken).toBe(MOCK_TOKENS.accessToken);

      // In the database, tokens should be stored as-is (plaintext passthrough)
      const raw = await pool.query(
        'SELECT access_token, refresh_token FROM oauth_connection WHERE id = $1',
        [conn.id],
      );
      expect(raw.rows[0].access_token).toBe(MOCK_TOKENS.accessToken);
      expect(raw.rows[0].refresh_token).toBe(MOCK_TOKENS.refreshToken);

      // getConnection also returns plaintext
      const readBack = await getConnection(pool, conn.id);
      expect(readBack!.accessToken).toBe(MOCK_TOKENS.accessToken);
    });
  });
});
