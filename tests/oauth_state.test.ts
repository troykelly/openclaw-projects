/**
 * Tests for database-backed PKCE state storage (issue #1046).
 *
 * Exercises the oauth_state table and the service functions that
 * replaced the in-memory Map: getAuthorizationUrl (INSERT),
 * validateState (SELECT+DELETE), and cleanExpiredStates.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { runMigrate } from './helpers/migrate.ts';
import { validateState, cleanExpiredStates } from '../src/api/oauth/service.ts';
import { InvalidStateError } from '../src/api/oauth/types.ts';

describe('oauth_state database storage', () => {
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
  });

  // ---------- migration / table existence ----------

  it('oauth_state table exists after migration', async () => {
    const result = await pool.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'oauth_state'`,
    );
    expect(result.rows).toHaveLength(1);
  });

  it('oauth_state has an index on expires_at', async () => {
    const result = await pool.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'oauth_state' AND indexname = 'oauth_state_expires_at_idx'`,
    );
    expect(result.rows).toHaveLength(1);
  });

  // ---------- INSERT (via direct SQL, simulating getAuthorizationUrl) ----------

  it('inserts and retrieves a state row', async () => {
    await pool.query(
      `INSERT INTO oauth_state (state, provider, code_verifier, scopes, user_email, redirect_path)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ['test-state-1', 'google', 'verifier-abc', ['scope1', 'scope2'], 'user@example.com', '/settings'],
    );

    const result = await pool.query('SELECT * FROM oauth_state WHERE state = $1', ['test-state-1']);
    expect(result.rows).toHaveLength(1);

    const row = result.rows[0];
    expect(row.provider).toBe('google');
    expect(row.code_verifier).toBe('verifier-abc');
    expect(row.scopes).toEqual(['scope1', 'scope2']);
    expect(row.user_email).toBe('user@example.com');
    expect(row.redirect_path).toBe('/settings');
    expect(row.created_at).toBeInstanceOf(Date);
    expect(row.expires_at).toBeInstanceOf(Date);
    // expires_at should be ~10 minutes after created_at
    const diffMs = row.expires_at.getTime() - row.created_at.getTime();
    expect(diffMs).toBeGreaterThanOrEqual(9 * 60 * 1000);
    expect(diffMs).toBeLessThanOrEqual(11 * 60 * 1000);
  });

  it('allows null user_email and redirect_path', async () => {
    await pool.query(
      `INSERT INTO oauth_state (state, provider, code_verifier, scopes)
       VALUES ($1, $2, $3, $4)`,
      ['test-state-nullable', 'microsoft', 'verifier-xyz', []],
    );

    const result = await pool.query('SELECT user_email, redirect_path FROM oauth_state WHERE state = $1', [
      'test-state-nullable',
    ]);
    expect(result.rows[0].user_email).toBeNull();
    expect(result.rows[0].redirect_path).toBeNull();
  });

  it('rejects duplicate state keys', async () => {
    await pool.query(
      `INSERT INTO oauth_state (state, provider, code_verifier) VALUES ($1, $2, $3)`,
      ['dup-state', 'google', 'v1'],
    );

    await expect(
      pool.query(
        `INSERT INTO oauth_state (state, provider, code_verifier) VALUES ($1, $2, $3)`,
        ['dup-state', 'microsoft', 'v2'],
      ),
    ).rejects.toThrow(/duplicate key/i);
  });

  // ---------- validateState ----------

  it('validateState returns and deletes valid state', async () => {
    await pool.query(
      `INSERT INTO oauth_state (state, provider, code_verifier, scopes, user_email, redirect_path)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ['validate-me', 'microsoft', 'pkce-verifier', ['contacts', 'email'], 'alice@test.com', '/callback'],
    );

    const data = await validateState(pool, 'validate-me');

    expect(data.provider).toBe('microsoft');
    expect(data.code_verifier).toBe('pkce-verifier');
    expect(data.scopes).toEqual(['contacts', 'email']);
    expect(data.user_email).toBe('alice@test.com');
    expect(data.redirect_path).toBe('/callback');
    expect(data.created_at).toBeInstanceOf(Date);
    expect(data.expires_at).toBeInstanceOf(Date);

    // State should be deleted (single-use)
    const remaining = await pool.query('SELECT 1 FROM oauth_state WHERE state = $1', ['validate-me']);
    expect(remaining.rows).toHaveLength(0);
  });

  it('validateState throws InvalidStateError for unknown state', async () => {
    await expect(validateState(pool, 'does-not-exist')).rejects.toThrow(InvalidStateError);
  });

  it('validateState throws InvalidStateError for expired state', async () => {
    // Insert a state that already expired
    await pool.query(
      `INSERT INTO oauth_state (state, provider, code_verifier, expires_at)
       VALUES ($1, $2, $3, now() - interval '1 second')`,
      ['expired-state', 'google', 'verifier'],
    );

    await expect(validateState(pool, 'expired-state')).rejects.toThrow(InvalidStateError);
  });

  it('validateState is single-use (second call fails)', async () => {
    await pool.query(
      `INSERT INTO oauth_state (state, provider, code_verifier)
       VALUES ($1, $2, $3)`,
      ['single-use', 'google', 'v'],
    );

    await validateState(pool, 'single-use'); // first call succeeds
    await expect(validateState(pool, 'single-use')).rejects.toThrow(InvalidStateError);
  });

  // ---------- cleanExpiredStates ----------

  it('cleanExpiredStates removes only expired rows', async () => {
    // Insert one valid and one expired state
    await pool.query(
      `INSERT INTO oauth_state (state, provider, code_verifier)
       VALUES ($1, $2, $3)`,
      ['still-valid', 'google', 'v1'],
    );
    await pool.query(
      `INSERT INTO oauth_state (state, provider, code_verifier, expires_at)
       VALUES ($1, $2, $3, now() - interval '1 second')`,
      ['already-expired', 'microsoft', 'v2'],
    );

    const deleted = await cleanExpiredStates(pool);
    expect(deleted).toBe(1);

    const remaining = await pool.query('SELECT state FROM oauth_state');
    expect(remaining.rows).toHaveLength(1);
    expect(remaining.rows[0].state).toBe('still-valid');
  });

  it('cleanExpiredStates returns 0 when nothing to clean', async () => {
    const deleted = await cleanExpiredStates(pool);
    expect(deleted).toBe(0);
  });

  // ---------- down migration ----------

  it('down migration removes the table and index', async () => {
    // Apply down migrations until oauth_state (057) is rolled back.
    // Migrations after 057 must also be rolled back first.
    // Count how many need rolling back by checking what's applied after 057.
    const applied = await pool.query(
      `SELECT COUNT(*) as cnt FROM schema_migrations WHERE version >= 57`,
    );
    const stepsToRollBack = parseInt((applied.rows[0] as { cnt: string }).cnt, 10);
    await runMigrate('down', stepsToRollBack);

    const result = await pool.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'oauth_state'`,
    );
    expect(result.rows).toHaveLength(0);

    // Re-apply so other tests still work
    await runMigrate('up');
  });
});
