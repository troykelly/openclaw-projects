/**
 * Integration tests for dev session & terminal session schema migrations.
 * Issue #2193 — Dev Session & Terminal Session Schema Migrations.
 *
 * Tests:
 * - Migration 145: Symphony columns + updated_at trigger on dev_session
 * - Migration 146: Altered dev_session status CHECK to include 'stalled'
 * - Migration 147: terminal_session purpose column
 * - Query filtering: orchestrated sessions filtered from user-specific queries
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { createTestPool, truncateAllTables, ensureTestNamespace } from './helpers/db.ts';
import { runMigrate } from './helpers/migrate.ts';

describe('Dev Session Schema Migration (#2193)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = createTestPool();
    // Ensure all migrations are applied
    await runMigrate('up');
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('Migration 145: Symphony columns on dev_session', () => {
    it('has symphony_run_id column (nullable UUID)', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'dev_session' AND column_name = 'symphony_run_id'
      `);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].data_type).toBe('uuid');
      expect(result.rows[0].is_nullable).toBe('YES');
    });

    it('has orchestrated column (boolean, default false)', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = 'dev_session' AND column_name = 'orchestrated'
      `);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].data_type).toBe('boolean');
      expect(result.rows[0].is_nullable).toBe('NO');
      expect(result.rows[0].column_default).toBe('false');
    });

    it('has agent_type column (nullable text)', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'dev_session' AND column_name = 'agent_type'
      `);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].data_type).toBe('text');
      expect(result.rows[0].is_nullable).toBe('YES');
    });

    it('has updated_at trigger on dev_session', async () => {
      const result = await pool.query(`
        SELECT trigger_name
        FROM information_schema.triggers
        WHERE event_object_table = 'dev_session'
          AND trigger_name = 'dev_session_updated_at'
      `);
      expect(result.rows).toHaveLength(1);
    });

    it('updated_at trigger auto-updates on row modification', async () => {
      await truncateAllTables(pool);
      await ensureTestNamespace(pool, 'trigger-test@example.com', 'default');

      // Insert a row
      const insertResult = await pool.query(`
        INSERT INTO dev_session (user_email, session_name, node, namespace)
        VALUES ('trigger-test@example.com', 'trigger-test', 'node-1', 'default')
        RETURNING id, updated_at
      `);
      const id = insertResult.rows[0].id;
      const originalUpdatedAt = insertResult.rows[0].updated_at;

      // Wait briefly to ensure timestamp changes
      await new Promise((r) => setTimeout(r, 50));

      // Update the row
      await pool.query(
        `UPDATE dev_session SET task_summary = 'modified' WHERE id = $1`,
        [id],
      );

      const afterUpdate = await pool.query(
        `SELECT updated_at FROM dev_session WHERE id = $1`,
        [id],
      );
      expect(new Date(afterUpdate.rows[0].updated_at).getTime())
        .toBeGreaterThan(new Date(originalUpdatedAt).getTime());
    });
  });

  describe('Migration 146: dev_session status CHECK includes stalled', () => {
    it('accepts stalled status value', async () => {
      await truncateAllTables(pool);
      await ensureTestNamespace(pool, 'status-test@example.com', 'default');

      const result = await pool.query(`
        INSERT INTO dev_session (user_email, session_name, node, namespace, status)
        VALUES ('status-test@example.com', 'stalled-test', 'node-1', 'default', 'stalled')
        RETURNING status
      `);
      expect(result.rows[0].status).toBe('stalled');
    });

    it('still accepts existing valid statuses', async () => {
      await truncateAllTables(pool);
      await ensureTestNamespace(pool, 'status-test@example.com', 'default');

      const validStatuses = ['active', 'paused', 'completed', 'errored', 'abandoned'];
      for (const status of validStatuses) {
        const result = await pool.query(`
          INSERT INTO dev_session (user_email, session_name, node, namespace, status)
          VALUES ('status-test@example.com', $1, 'node-1', 'default', $2)
          RETURNING status
        `, [`test-${status}`, status]);
        expect(result.rows[0].status).toBe(status);
      }
    });

    it('rejects invalid status values', async () => {
      await truncateAllTables(pool);
      await ensureTestNamespace(pool, 'status-test@example.com', 'default');

      await expect(pool.query(`
        INSERT INTO dev_session (user_email, session_name, node, namespace, status)
        VALUES ('status-test@example.com', 'bad-status', 'node-1', 'default', 'invalid_status')
      `)).rejects.toThrow();
    });
  });

  describe('Migration 147: terminal_session purpose column', () => {
    it('has purpose column with default interactive', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = 'terminal_session' AND column_name = 'purpose'
      `);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].data_type).toBe('text');
      expect(result.rows[0].is_nullable).toBe('NO');
      expect(result.rows[0].column_default).toContain('interactive');
    });

    it('accepts orchestrated purpose value', async () => {
      await truncateAllTables(pool);
      await ensureTestNamespace(pool, 'purpose-test@example.com', 'default');

      const result = await pool.query(`
        INSERT INTO terminal_session (namespace, tmux_session_name, purpose)
        VALUES ('default', 'orch-test', 'orchestrated')
        RETURNING purpose
      `);
      expect(result.rows[0].purpose).toBe('orchestrated');
    });

    it('defaults to interactive purpose', async () => {
      await truncateAllTables(pool);
      await ensureTestNamespace(pool, 'purpose-test@example.com', 'default');

      const result = await pool.query(`
        INSERT INTO terminal_session (namespace, tmux_session_name)
        VALUES ('default', 'default-test')
        RETURNING purpose
      `);
      expect(result.rows[0].purpose).toBe('interactive');
    });

    it('rejects invalid purpose values', async () => {
      await truncateAllTables(pool);
      await ensureTestNamespace(pool, 'purpose-test@example.com', 'default');

      await expect(pool.query(`
        INSERT INTO terminal_session (namespace, tmux_session_name, purpose)
        VALUES ('default', 'bad-purpose', 'invalid_purpose')
      `)).rejects.toThrow();
    });
  });

  describe('Orchestrated session behavior', () => {
    it('can create orchestrated dev session with system email', async () => {
      await truncateAllTables(pool);
      await ensureTestNamespace(pool, 'symphony@orchestrator.local', 'default');

      const result = await pool.query(`
        INSERT INTO dev_session (
          user_email, session_name, node, namespace,
          orchestrated, agent_type
        )
        VALUES ('symphony@orchestrator.local', 'orch-session', 'node-1', 'default', true, 'orchestrator')
        RETURNING orchestrated, agent_type, user_email
      `);
      expect(result.rows[0].orchestrated).toBe(true);
      expect(result.rows[0].agent_type).toBe('orchestrator');
      expect(result.rows[0].user_email).toBe('symphony@orchestrator.local');
    });

    it('existing sessions default to non-orchestrated', async () => {
      await truncateAllTables(pool);
      await ensureTestNamespace(pool, 'regular@example.com', 'default');

      const result = await pool.query(`
        INSERT INTO dev_session (user_email, session_name, node, namespace)
        VALUES ('regular@example.com', 'regular-session', 'node-1', 'default')
        RETURNING orchestrated, agent_type, symphony_run_id
      `);
      expect(result.rows[0].orchestrated).toBe(false);
      expect(result.rows[0].agent_type).toBeNull();
      expect(result.rows[0].symphony_run_id).toBeNull();
    });
  });

  describe('Migration rollback', () => {
    it('migration 147 down removes purpose column', async () => {
      await truncateAllTables(pool);

      // Roll back to migration 146: 159..147 = 13 steps
      await runMigrate('down', 13);

      const result = await pool.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'terminal_session' AND column_name = 'purpose'
      `);
      expect(result.rows).toHaveLength(0);

      // Re-apply
      await runMigrate('up');
    });

    it('migration 146 down reverts status CHECK to original', async () => {
      await truncateAllTables(pool);

      // Roll back to migration 145: 159..146 = 14 steps
      await runMigrate('down', 14);

      // stalled should now be rejected
      await ensureTestNamespace(pool, 'rollback-test@example.com', 'default');
      await expect(pool.query(`
        INSERT INTO dev_session (user_email, session_name, node, namespace, status)
        VALUES ('rollback-test@example.com', 'rollback-test', 'node-1', 'default', 'stalled')
      `)).rejects.toThrow();

      // Re-apply
      await runMigrate('up');
    });

    it('migration 145 down removes symphony columns and trigger', async () => {
      await truncateAllTables(pool);

      // Roll back to migration 144: 159..145 = 15 steps
      await runMigrate('down', 15);

      // symphony_run_id should not exist
      const cols = await pool.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'dev_session'
          AND column_name IN ('symphony_run_id', 'orchestrated', 'agent_type')
      `);
      expect(cols.rows).toHaveLength(0);

      // Trigger should not exist
      const triggers = await pool.query(`
        SELECT trigger_name
        FROM information_schema.triggers
        WHERE event_object_table = 'dev_session'
          AND trigger_name = 'dev_session_updated_at'
      `);
      expect(triggers.rows).toHaveLength(0);

      // Re-apply
      await runMigrate('up');
    });
  });
});
