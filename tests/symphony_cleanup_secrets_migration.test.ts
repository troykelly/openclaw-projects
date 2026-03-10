/**
 * Integration tests for Symphony Cleanup & Secret Lifecycle migration 151.
 * Issues #2213 (Cleanup Queue), #2214 (Secret Lifecycle), Epic #2186.
 *
 * Verifies column additions, constraints, indexes, and clean rollback.
 */
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPool } from './helpers/db.ts';
import { runMigrate } from './helpers/migrate.ts';

/** Helper: insert a minimal work_item and return its id */
async function insertWorkItem(pool: Pool, namespace: string = 'testns'): Promise<string> {
  const res = await pool.query(
    `INSERT INTO work_item (title, namespace, status)
     VALUES ('test-item', $1, 'open') RETURNING id`,
    [namespace],
  );
  return (res.rows[0] as { id: string }).id;
}

/** Helper: insert a minimal terminal_connection and return its id */
async function insertTerminalConnection(pool: Pool, namespace: string = 'testns'): Promise<string> {
  const res = await pool.query(
    `INSERT INTO terminal_connection (namespace, name, host, port, username)
     VALUES ($1, 'test-conn', 'localhost', 22, 'testuser') RETURNING id`,
    [namespace],
  );
  return (res.rows[0] as { id: string }).id;
}

/** Helper: insert a symphony_run and return its id */
async function insertRun(
  pool: Pool,
  workItemId: string,
  namespace: string = 'testns',
): Promise<string> {
  const res = await pool.query(
    `INSERT INTO symphony_run (namespace, work_item_id, status, stage)
     VALUES ($1, $2, 'unclaimed', 'reading_issue') RETURNING id`,
    [namespace, workItemId],
  );
  return (res.rows[0] as { id: string }).id;
}

describe('Migration 151: Symphony Cleanup & Secret Lifecycle (#2213, #2214)', () => {
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  // ─── symphony_secret_deployment enhancements ───────────────
  describe('symphony_secret_deployment new columns', () => {
    let connId: string;
    let runId: string;

    beforeEach(async () => {
      await pool.query('DELETE FROM symphony_secret_deployment');
      await pool.query('DELETE FROM symphony_run');
      await pool.query('DELETE FROM symphony_workspace');
      await pool.query('DELETE FROM symphony_container');
      const workItemId = await insertWorkItem(pool);
      connId = await insertTerminalConnection(pool);
      runId = await insertRun(pool, workItemId);
    });

    it('has run_id column with FK to symphony_run', async () => {
      const res = await pool.query(
        `INSERT INTO symphony_secret_deployment
         (namespace, connection_id, secret_name, secret_version, deployed_path, run_id)
         VALUES ('testns', $1, '.env', 'v1', '/home/user/.env', $2) RETURNING id, run_id`,
        [connId, runId],
      );
      expect(res.rows).toHaveLength(1);
      expect((res.rows[0] as { run_id: string }).run_id).toBe(runId);
    });

    it('has last_used_at column', async () => {
      const res = await pool.query(
        `INSERT INTO symphony_secret_deployment
         (namespace, connection_id, secret_name, secret_version, deployed_path, last_used_at)
         VALUES ('testns', $1, '.env', 'v1', '/home/user/.env', NOW()) RETURNING last_used_at`,
        [connId],
      );
      expect(res.rows).toHaveLength(1);
      expect((res.rows[0] as { last_used_at: Date }).last_used_at).toBeInstanceOf(Date);
    });

    it('has staleness column with CHECK constraint', async () => {
      // Valid value
      const res = await pool.query(
        `INSERT INTO symphony_secret_deployment
         (namespace, connection_id, secret_name, secret_version, deployed_path, staleness)
         VALUES ('testns', $1, '.env', 'v1', '/home/user/.env', 'stale') RETURNING staleness`,
        [connId],
      );
      expect((res.rows[0] as { staleness: string }).staleness).toBe('stale');

      // Invalid value
      await expect(
        pool.query(
          `INSERT INTO symphony_secret_deployment
           (namespace, connection_id, secret_name, secret_version, deployed_path, staleness)
           VALUES ('testns', $1, '.env2', 'v1', '/home/user/.env2', 'invalid')`,
          [connId],
        ),
      ).rejects.toThrow();
    });

    it('defaults staleness to current', async () => {
      const res = await pool.query(
        `INSERT INTO symphony_secret_deployment
         (namespace, connection_id, secret_name, secret_version, deployed_path)
         VALUES ('testns', $1, '.env', 'v1', '/home/user/.env') RETURNING staleness`,
        [connId],
      );
      expect((res.rows[0] as { staleness: string }).staleness).toBe('current');
    });

    it('has validation_status column with CHECK constraint', async () => {
      const res = await pool.query(
        `INSERT INTO symphony_secret_deployment
         (namespace, connection_id, secret_name, secret_version, deployed_path, validation_status)
         VALUES ('testns', $1, '.env', 'v1', '/home/user/.env', 'valid') RETURNING validation_status`,
        [connId],
      );
      expect((res.rows[0] as { validation_status: string }).validation_status).toBe('valid');

      await expect(
        pool.query(
          `INSERT INTO symphony_secret_deployment
           (namespace, connection_id, secret_name, secret_version, deployed_path, validation_status)
           VALUES ('testns', $1, '.env2', 'v1', '/home/user/.env2', 'bad_status')`,
          [connId],
        ),
      ).rejects.toThrow();
    });

    it('has expected_vars array column', async () => {
      const res = await pool.query(
        `INSERT INTO symphony_secret_deployment
         (namespace, connection_id, secret_name, secret_version, deployed_path, expected_vars)
         VALUES ('testns', $1, '.env', 'v1', '/home/user/.env', $2) RETURNING expected_vars`,
        [connId, ['DATABASE_URL', 'API_KEY']],
      );
      expect((res.rows[0] as { expected_vars: string[] }).expected_vars).toEqual(['DATABASE_URL', 'API_KEY']);
    });

    it('run_id FK ON DELETE SET NULL', async () => {
      await pool.query(
        `INSERT INTO symphony_secret_deployment
         (namespace, connection_id, secret_name, secret_version, deployed_path, run_id)
         VALUES ('testns', $1, '.env', 'v1', '/home/user/.env', $2)`,
        [connId, runId],
      );
      // Delete the run
      await pool.query('DELETE FROM symphony_run WHERE id = $1', [runId]);
      const res = await pool.query(
        `SELECT run_id FROM symphony_secret_deployment WHERE connection_id = $1`,
        [connId],
      );
      expect((res.rows[0] as { run_id: string | null }).run_id).toBeNull();
    });
  });

  // ─── symphony_container enhancements ───────────────────────
  describe('symphony_container new columns', () => {
    let connId: string;
    let runId: string;

    beforeEach(async () => {
      await pool.query('DELETE FROM symphony_container');
      await pool.query('DELETE FROM symphony_run');
      const workItemId = await insertWorkItem(pool);
      connId = await insertTerminalConnection(pool);
      runId = await insertRun(pool, workItemId);
    });

    it('has run_id column with FK to symphony_run', async () => {
      const res = await pool.query(
        `INSERT INTO symphony_container
         (namespace, connection_id, container_id, run_id)
         VALUES ('testns', $1, 'abc123def', $2) RETURNING run_id`,
        [connId, runId],
      );
      expect((res.rows[0] as { run_id: string }).run_id).toBe(runId);
    });

    it('has container_name column', async () => {
      const res = await pool.query(
        `INSERT INTO symphony_container
         (namespace, connection_id, container_id, container_name)
         VALUES ('testns', $1, 'abc123def', 'symphony-test') RETURNING container_name`,
        [connId],
      );
      expect((res.rows[0] as { container_name: string }).container_name).toBe('symphony-test');
    });
  });

  // ─── symphony_workspace enhancements ───────────────────────
  describe('symphony_workspace new columns', () => {
    let connId: string;
    let runId: string;

    beforeEach(async () => {
      await pool.query('DELETE FROM symphony_workspace');
      await pool.query('DELETE FROM symphony_run');
      const workItemId = await insertWorkItem(pool);
      connId = await insertTerminalConnection(pool);
      runId = await insertRun(pool, workItemId);
    });

    it('has run_id column with FK to symphony_run', async () => {
      const res = await pool.query(
        `INSERT INTO symphony_workspace
         (namespace, connection_id, worktree_path, run_id)
         VALUES ('testns', $1, '/tmp/worktree-test', $2) RETURNING run_id`,
        [connId, runId],
      );
      expect((res.rows[0] as { run_id: string }).run_id).toBe(runId);
    });

    it('has cleanup_scheduled_at column', async () => {
      const res = await pool.query(
        `INSERT INTO symphony_workspace
         (namespace, connection_id, worktree_path, cleanup_scheduled_at)
         VALUES ('testns', $1, '/tmp/worktree-test', NOW() + INTERVAL '24 hours')
         RETURNING cleanup_scheduled_at`,
        [connId],
      );
      expect((res.rows[0] as { cleanup_scheduled_at: Date }).cleanup_scheduled_at).toBeInstanceOf(Date);
    });
  });

  // ─── symphony_cleanup_item enhancements ────────────────────
  describe('symphony_cleanup_item new columns', () => {
    beforeEach(async () => {
      await pool.query('DELETE FROM symphony_cleanup_item');
    });

    it('has resolved_reason column with CHECK constraint', async () => {
      const res = await pool.query(
        `INSERT INTO symphony_cleanup_item
         (namespace, resource_type, resource_id, status, resolved_reason)
         VALUES ('testns', 'container', 'abc123', 'completed', 'reclaimed')
         RETURNING resolved_reason`,
      );
      expect((res.rows[0] as { resolved_reason: string }).resolved_reason).toBe('reclaimed');
    });

    it('rejects invalid resolved_reason', async () => {
      await expect(
        pool.query(
          `INSERT INTO symphony_cleanup_item
           (namespace, resource_type, resource_id, status, resolved_reason)
           VALUES ('testns', 'container', 'abc123', 'completed', 'invalid_reason')`,
        ),
      ).rejects.toThrow();
    });

    it('allows null resolved_reason', async () => {
      const res = await pool.query(
        `INSERT INTO symphony_cleanup_item
         (namespace, resource_type, resource_id, status)
         VALUES ('testns', 'container', 'abc123', 'pending')
         RETURNING resolved_reason`,
      );
      expect((res.rows[0] as { resolved_reason: string | null }).resolved_reason).toBeNull();
    });
  });

  // ─── Indexes ───────────────────────────────────────────────
  describe('New indexes', () => {
    it('has cleanup eligible index on symphony_secret_deployment', async () => {
      const res = await pool.query(
        `SELECT indexname FROM pg_indexes
         WHERE tablename = 'symphony_secret_deployment'
         AND indexname = 'idx_symphony_secret_cleanup_eligible'`,
      );
      expect(res.rows).toHaveLength(1);
    });

    it('has staleness index on symphony_secret_deployment', async () => {
      const res = await pool.query(
        `SELECT indexname FROM pg_indexes
         WHERE tablename = 'symphony_secret_deployment'
         AND indexname = 'idx_symphony_secret_staleness'`,
      );
      expect(res.rows).toHaveLength(1);
    });

    it('has run index on symphony_container', async () => {
      const res = await pool.query(
        `SELECT indexname FROM pg_indexes
         WHERE tablename = 'symphony_container'
         AND indexname = 'idx_symphony_container_run'`,
      );
      expect(res.rows).toHaveLength(1);
    });

    it('has cleanup index on symphony_workspace', async () => {
      const res = await pool.query(
        `SELECT indexname FROM pg_indexes
         WHERE tablename = 'symphony_workspace'
         AND indexname = 'idx_symphony_workspace_cleanup'`,
      );
      expect(res.rows).toHaveLength(1);
    });
  });

  // ─── Rollback ──────────────────────────────────────────────
  describe('Rollback', () => {
    it('removes all added columns and indexes', async () => {
      // Run down migrations (159..151 = 9 steps)
      await runMigrate('down', 9);

      // Check columns removed
      const secretCols = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'symphony_secret_deployment'
         AND column_name IN ('run_id', 'last_used_at', 'staleness', 'expected_vars', 'validation_status')`,
      );
      expect(secretCols.rows).toHaveLength(0);

      const containerCols = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'symphony_container'
         AND column_name IN ('run_id', 'container_name')`,
      );
      expect(containerCols.rows).toHaveLength(0);

      const workspaceCols = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'symphony_workspace'
         AND column_name IN ('cleanup_scheduled_at')
         AND table_schema = 'public'`,
      );
      expect(workspaceCols.rows).toHaveLength(0);

      const cleanupCols = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'symphony_cleanup_item'
         AND column_name = 'resolved_reason'`,
      );
      expect(cleanupCols.rows).toHaveLength(0);

      // Re-run up for other tests
      await runMigrate('up');
    });
  });
});
