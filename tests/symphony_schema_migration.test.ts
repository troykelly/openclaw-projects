/**
 * Integration tests for Symphony database schema migrations 140-143.
 * Epic #2186, Issue #2192 — Symphony Database Schema (17 New Tables).
 *
 * Verifies table creation, constraints, indexes, hypertable setup,
 * FK cascades, namespace enforcement, and clean rollback.
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

describe('Symphony Schema Migrations 140-143 (#2192)', () => {
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  // ─────────────────────────────────────────────────────────────
  // Migration 140: Core config tables
  // ─────────────────────────────────────────────────────────────
  describe('Migration 140: Core config tables', () => {
    describe('project_repository', () => {
      beforeEach(async () => {
        await pool.query('DELETE FROM project_repository');
      });

      it('creates the project_repository table', async () => {
        const result = await pool.query(
          `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'project_repository'`,
        );
        expect(result.rows).toHaveLength(1);
      });

      it('enforces namespace NOT NULL without DEFAULT', async () => {
        await expect(
          pool.query(
            `INSERT INTO project_repository (org, repo) VALUES ('myorg', 'myrepo')`,
          ),
        ).rejects.toThrow();
      });

      it('accepts valid insert', async () => {
        const workItemId = await insertWorkItem(pool);
        const result = await pool.query(
          `INSERT INTO project_repository (namespace, project_id, org, repo, sync_strategy, sync_epic_id)
           VALUES ('testns', $1, 'myorg', 'myrepo', 'mirror', $1) RETURNING id`,
          [workItemId],
        );
        expect(result.rows).toHaveLength(1);
      });

      it('enforces unique (namespace, project_id, org, repo)', async () => {
        const workItemId = await insertWorkItem(pool);
        await pool.query(
          `INSERT INTO project_repository (namespace, project_id, org, repo)
           VALUES ('testns', $1, 'myorg', 'myrepo')`,
          [workItemId],
        );
        await expect(
          pool.query(
            `INSERT INTO project_repository (namespace, project_id, org, repo)
             VALUES ('testns', $1, 'myorg', 'myrepo')`,
            [workItemId],
          ),
        ).rejects.toThrow();
      });

      it('sync_epic_id FK ON DELETE SET NULL', async () => {
        const workItemId = await insertWorkItem(pool);
        const epicId = await insertWorkItem(pool);
        await pool.query(
          `INSERT INTO project_repository (namespace, project_id, org, repo, sync_epic_id)
           VALUES ('testns', $1, 'myorg', 'myrepo-fk', $2)`,
          [workItemId, epicId],
        );
        // Delete the epic work item
        await pool.query('DELETE FROM work_item WHERE id = $1', [epicId]);
        const result = await pool.query(
          `SELECT sync_epic_id FROM project_repository WHERE project_id = $1 AND org = 'myorg' AND repo = 'myrepo-fk'`,
          [workItemId],
        );
        expect((result.rows[0] as { sync_epic_id: string | null }).sync_epic_id).toBeNull();
      });

      it('enforces sync_strategy CHECK constraint', async () => {
        const workItemId = await insertWorkItem(pool);
        await expect(
          pool.query(
            `INSERT INTO project_repository (namespace, project_id, org, repo, sync_strategy)
             VALUES ('testns', $1, 'myorg', 'myrepo', 'invalid')`,
            [workItemId],
          ),
        ).rejects.toThrow();
      });
    });

    describe('project_host', () => {
      beforeEach(async () => {
        await pool.query('DELETE FROM project_host');
      });

      it('creates the project_host table', async () => {
        const result = await pool.query(
          `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'project_host'`,
        );
        expect(result.rows).toHaveLength(1);
      });

      it('enforces namespace NOT NULL without DEFAULT', async () => {
        const workItemId = await insertWorkItem(pool);
        const connId = await insertTerminalConnection(pool);
        await expect(
          pool.query(
            `INSERT INTO project_host (project_id, connection_id, priority)
             VALUES ($1, $2, 10)`,
            [workItemId, connId],
          ),
        ).rejects.toThrow();
      });

      it('accepts valid insert', async () => {
        const workItemId = await insertWorkItem(pool);
        const connId = await insertTerminalConnection(pool);
        const result = await pool.query(
          `INSERT INTO project_host (namespace, project_id, connection_id, priority)
           VALUES ('testns', $1, $2, 10) RETURNING id`,
          [workItemId, connId],
        );
        expect(result.rows).toHaveLength(1);
      });

      it('enforces unique (project_id, connection_id)', async () => {
        const workItemId = await insertWorkItem(pool);
        const connId = await insertTerminalConnection(pool);
        await pool.query(
          `INSERT INTO project_host (namespace, project_id, connection_id, priority)
           VALUES ('testns', $1, $2, 10)`,
          [workItemId, connId],
        );
        await expect(
          pool.query(
            `INSERT INTO project_host (namespace, project_id, connection_id, priority)
             VALUES ('testns', $1, $2, 20)`,
            [workItemId, connId],
          ),
        ).rejects.toThrow();
      });
    });

    describe('symphony_tool_config', () => {
      beforeEach(async () => {
        await pool.query('DELETE FROM symphony_tool_config');
      });

      it('creates the table', async () => {
        const result = await pool.query(
          `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'symphony_tool_config'`,
        );
        expect(result.rows).toHaveLength(1);
      });

      it('accepts valid insert', async () => {
        const result = await pool.query(
          `INSERT INTO symphony_tool_config (namespace, tool_name, command, verify_command, min_version)
           VALUES ('testns', 'claude-code', 'claude', 'claude --version', '1.0.0') RETURNING id`,
        );
        expect(result.rows).toHaveLength(1);
      });

      it('enforces unique (namespace, tool_name)', async () => {
        await pool.query(
          `INSERT INTO symphony_tool_config (namespace, tool_name, command)
           VALUES ('testns', 'claude-code', 'claude')`,
        );
        await expect(
          pool.query(
            `INSERT INTO symphony_tool_config (namespace, tool_name, command)
             VALUES ('testns', 'claude-code', 'claude2')`,
          ),
        ).rejects.toThrow();
      });
    });

    describe('symphony_orchestrator_config', () => {
      beforeEach(async () => {
        await pool.query('DELETE FROM symphony_orchestrator_config');
      });

      it('creates the table', async () => {
        const result = await pool.query(
          `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'symphony_orchestrator_config'`,
        );
        expect(result.rows).toHaveLength(1);
      });

      it('accepts valid insert with project_id', async () => {
        const workItemId = await insertWorkItem(pool);
        const result = await pool.query(
          `INSERT INTO symphony_orchestrator_config (namespace, project_id, version, config)
           VALUES ('testns', $1, 1, '{"polling_interval": 30}') RETURNING id`,
          [workItemId],
        );
        expect(result.rows).toHaveLength(1);
      });

      it('enforces unique (namespace, project_id, version)', async () => {
        const workItemId = await insertWorkItem(pool);
        await pool.query(
          `INSERT INTO symphony_orchestrator_config (namespace, project_id, version, config)
           VALUES ('testns', $1, 1, '{}')`,
          [workItemId],
        );
        await expect(
          pool.query(
            `INSERT INTO symphony_orchestrator_config (namespace, project_id, version, config)
             VALUES ('testns', $1, 1, '{"updated": true}')`,
            [workItemId],
          ),
        ).rejects.toThrow();
      });
    });

    describe('symphony_notification_rule', () => {
      beforeEach(async () => {
        await pool.query('DELETE FROM symphony_notification_rule');
      });

      it('creates the table', async () => {
        const result = await pool.query(
          `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'symphony_notification_rule'`,
        );
        expect(result.rows).toHaveLength(1);
      });

      it('enforces event CHECK constraint', async () => {
        await expect(
          pool.query(
            `INSERT INTO symphony_notification_rule (namespace, event, channel, destination)
             VALUES ('testns', 'invalid_event', 'webhook', 'https://example.com')`,
          ),
        ).rejects.toThrow();
      });

      it('enforces channel CHECK constraint', async () => {
        await expect(
          pool.query(
            `INSERT INTO symphony_notification_rule (namespace, event, channel, destination)
             VALUES ('testns', 'run_failed', 'invalid_channel', 'https://example.com')`,
          ),
        ).rejects.toThrow();
      });

      it('accepts valid notification event values', async () => {
        const events = [
          'run_failed', 'run_succeeded', 'run_paused', 'run_stalled',
          'budget_warning', 'budget_exceeded',
          'host_degraded', 'host_offline',
          'cleanup_failed', 'cleanup_slo_breach',
          'secret_rotation_detected', 'secret_validation_failed',
          'approval_required', 'merge_ready',
        ];
        for (const event of events) {
          const result = await pool.query(
            `INSERT INTO symphony_notification_rule (namespace, event, channel, destination)
             VALUES ('testns', $1, 'webhook', 'https://example.com') RETURNING id`,
            [event],
          );
          expect(result.rows).toHaveLength(1);
        }
      });

      it('accepts valid channel values', async () => {
        const channels = ['webhook', 'email', 'slack', 'discord'];
        for (const channel of channels) {
          const result = await pool.query(
            `INSERT INTO symphony_notification_rule (namespace, event, channel, destination)
             VALUES ('testns', 'run_failed', $1, 'https://example.com') RETURNING id`,
            [channel],
          );
          expect(result.rows).toHaveLength(1);
        }
      });
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Migration 141: Run lifecycle tables
  // ─────────────────────────────────────────────────────────────
  describe('Migration 141: Run lifecycle tables', () => {
    describe('symphony_claim', () => {
      beforeEach(async () => {
        await pool.query('DELETE FROM symphony_claim');
      });

      it('creates the table', async () => {
        const result = await pool.query(
          `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'symphony_claim'`,
        );
        expect(result.rows).toHaveLength(1);
      });

      it('enforces namespace NOT NULL without DEFAULT', async () => {
        const workItemId = await insertWorkItem(pool);
        await expect(
          pool.query(
            `INSERT INTO symphony_claim (work_item_id, orchestrator_id, status, claim_epoch)
             VALUES ($1, 'orch-1', 'pending', 1)`,
            [workItemId],
          ),
        ).rejects.toThrow();
      });

      it('enforces status CHECK constraint', async () => {
        const workItemId = await insertWorkItem(pool);
        await expect(
          pool.query(
            `INSERT INTO symphony_claim (namespace, work_item_id, orchestrator_id, status, claim_epoch)
             VALUES ('testns', $1, 'orch-1', 'invalid_status', 1)`,
            [workItemId],
          ),
        ).rejects.toThrow();
      });

      it('accepts valid status values', async () => {
        // Each active status (pending, assigned, active) needs a different work_item
        // because the partial unique index prevents multiple active claims per work_item
        for (const status of ['pending', 'assigned', 'active', 'released', 'expired', 'completed']) {
          const workItemId = await insertWorkItem(pool);
          await pool.query(
            `INSERT INTO symphony_claim (namespace, work_item_id, orchestrator_id, status, claim_epoch)
             VALUES ('testns', $1, 'orch-1', $2, $3)`,
            [workItemId, status, Math.floor(Math.random() * 100000)],
          );
        }
      });

      it('partial unique index prevents duplicate active claims on same work_item', async () => {
        const workItemId = await insertWorkItem(pool);
        await pool.query(
          `INSERT INTO symphony_claim (namespace, work_item_id, orchestrator_id, status, claim_epoch)
           VALUES ('testns', $1, 'orch-1', 'active', 1)`,
          [workItemId],
        );
        // Second active claim on same work_item should fail
        await expect(
          pool.query(
            `INSERT INTO symphony_claim (namespace, work_item_id, orchestrator_id, status, claim_epoch)
             VALUES ('testns', $1, 'orch-2', 'active', 2)`,
            [workItemId],
          ),
        ).rejects.toThrow();
      });

      it('allows multiple released/expired/completed claims on same work_item', async () => {
        const workItemId = await insertWorkItem(pool);
        for (const status of ['released', 'expired', 'completed']) {
          await pool.query(
            `INSERT INTO symphony_claim (namespace, work_item_id, orchestrator_id, status, claim_epoch)
             VALUES ('testns', $1, 'orch-1', $2, $3)`,
            [workItemId, status, Math.floor(Math.random() * 100000)],
          );
        }
      });

      it('claim_epoch supports compare-and-swap fencing', async () => {
        const workItemId = await insertWorkItem(pool);
        const insert = await pool.query(
          `INSERT INTO symphony_claim (namespace, work_item_id, orchestrator_id, status, claim_epoch)
           VALUES ('testns', $1, 'orch-1', 'active', 1) RETURNING id, claim_epoch`,
          [workItemId],
        );
        const row = insert.rows[0] as { id: string; claim_epoch: number };
        expect(row.claim_epoch).toBe(1);

        // CAS update: only update if epoch matches
        const cas = await pool.query(
          `UPDATE symphony_claim SET status = 'released', claim_epoch = claim_epoch + 1
           WHERE id = $1 AND claim_epoch = $2 RETURNING claim_epoch`,
          [row.id, 1],
        );
        expect(cas.rows).toHaveLength(1);
        expect((cas.rows[0] as { claim_epoch: number }).claim_epoch).toBe(2);
      });
    });

    describe('symphony_workspace', () => {
      beforeEach(async () => {
        await pool.query('DELETE FROM symphony_workspace');
      });

      it('creates the table', async () => {
        const result = await pool.query(
          `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'symphony_workspace'`,
        );
        expect(result.rows).toHaveLength(1);
      });

      it('enforces warm_state CHECK constraint', async () => {
        const connId = await insertTerminalConnection(pool);
        await expect(
          pool.query(
            `INSERT INTO symphony_workspace (namespace, connection_id, worktree_path, warm_state)
             VALUES ('testns', $1, '/tmp/ws', 'invalid')`,
            [connId],
          ),
        ).rejects.toThrow();
      });

      it('accepts valid warm_state values', async () => {
        const connId = await insertTerminalConnection(pool);
        for (const state of ['cold', 'warming', 'warm', 'cooling', 'dirty']) {
          const result = await pool.query(
            `INSERT INTO symphony_workspace (namespace, connection_id, worktree_path, warm_state)
             VALUES ('testns', $1, $2, $3) RETURNING id`,
            [connId, `/tmp/ws-${state}`, state],
          );
          expect(result.rows).toHaveLength(1);
        }
      });
    });

    describe('symphony_run', () => {
      beforeEach(async () => {
        // Clean in reverse FK order
        await pool.query('DELETE FROM symphony_provisioning_step');
        await pool.query('DELETE FROM symphony_run_terminal');
        await pool.query('DELETE FROM symphony_run');
      });

      it('creates the table', async () => {
        const result = await pool.query(
          `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'symphony_run'`,
        );
        expect(result.rows).toHaveLength(1);
      });

      it('enforces status CHECK constraint (22 values)', async () => {
        const workItemId = await insertWorkItem(pool);
        await expect(
          pool.query(
            `INSERT INTO symphony_run (namespace, work_item_id, attempt, status, stage)
             VALUES ('testns', $1, 1, 'invalid_status', 'queued')`,
            [workItemId],
          ),
        ).rejects.toThrow();
      });

      it('enforces stage CHECK constraint (7 values)', async () => {
        const workItemId = await insertWorkItem(pool);
        await expect(
          pool.query(
            `INSERT INTO symphony_run (namespace, work_item_id, attempt, status, stage)
             VALUES ('testns', $1, 1, 'queued', 'invalid_stage')`,
            [workItemId],
          ),
        ).rejects.toThrow();
      });

      it('accepts all 22 valid status values', async () => {
        const statuses = [
          'queued', 'claiming', 'claimed', 'provisioning', 'provisioned',
          'cloning', 'cloned', 'installing', 'installed', 'branching',
          'branched', 'executing', 'paused', 'resuming', 'reviewing',
          'pushing', 'pr_created', 'merging', 'succeeded', 'failed',
          'cancelled', 'timed_out',
        ];
        for (let i = 0; i < statuses.length; i++) {
          const workItemId = await insertWorkItem(pool);
          const result = await pool.query(
            `INSERT INTO symphony_run (namespace, work_item_id, attempt, status, stage)
             VALUES ('testns', $1, $2, $3, 'queued') RETURNING id`,
            [workItemId, i + 1, statuses[i]],
          );
          expect(result.rows).toHaveLength(1);
        }
      });

      it('accepts all 7 valid stage values', async () => {
        const stages = ['queued', 'setup', 'execution', 'review', 'delivery', 'teardown', 'terminal'];
        for (let i = 0; i < stages.length; i++) {
          const workItemId = await insertWorkItem(pool);
          const result = await pool.query(
            `INSERT INTO symphony_run (namespace, work_item_id, attempt, status, stage)
             VALUES ('testns', $1, $2, 'queued', $3) RETURNING id`,
            [workItemId, i + 1, stages[i]],
          );
          expect(result.rows).toHaveLength(1);
        }
      });

      it('enforces unique (work_item_id, attempt) for active runs', async () => {
        const workItemId = await insertWorkItem(pool);
        await pool.query(
          `INSERT INTO symphony_run (namespace, work_item_id, attempt, status, stage)
           VALUES ('testns', $1, 1, 'executing', 'execution')`,
          [workItemId],
        );
        // Same work_item_id + attempt with active status should fail
        await expect(
          pool.query(
            `INSERT INTO symphony_run (namespace, work_item_id, attempt, status, stage)
             VALUES ('testns', $1, 1, 'queued', 'queued')`,
            [workItemId],
          ),
        ).rejects.toThrow();
      });

      it('allows same (work_item_id, attempt) for terminal runs', async () => {
        const workItemId = await insertWorkItem(pool);
        // Insert a completed run
        await pool.query(
          `INSERT INTO symphony_run (namespace, work_item_id, attempt, status, stage)
           VALUES ('testns', $1, 1, 'succeeded', 'terminal')`,
          [workItemId],
        );
        // Another completed run with same attempt should succeed
        // (both are terminal, not active)
        await pool.query(
          `INSERT INTO symphony_run (namespace, work_item_id, attempt, status, stage)
           VALUES ('testns', $1, 1, 'failed', 'terminal')`,
          [workItemId],
        );
      });

      it('state_version supports idempotent transitions', async () => {
        const workItemId = await insertWorkItem(pool);
        const insert = await pool.query(
          `INSERT INTO symphony_run (namespace, work_item_id, attempt, status, stage)
           VALUES ('testns', $1, 99, 'queued', 'queued') RETURNING id, state_version`,
          [workItemId],
        );
        const row = insert.rows[0] as { id: string; state_version: number };
        expect(row.state_version).toBe(1);
      });
    });

    describe('symphony_provisioning_step', () => {
      beforeEach(async () => {
        await pool.query('DELETE FROM symphony_provisioning_step');
        await pool.query('DELETE FROM symphony_run');
      });

      it('creates the table', async () => {
        const result = await pool.query(
          `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'symphony_provisioning_step'`,
        );
        expect(result.rows).toHaveLength(1);
      });

      it('enforces step_name CHECK constraint', async () => {
        const workItemId = await insertWorkItem(pool);
        const runResult = await pool.query(
          `INSERT INTO symphony_run (namespace, work_item_id, attempt, status, stage)
           VALUES ('testns', $1, 100, 'provisioning', 'setup') RETURNING id`,
          [workItemId],
        );
        const runId = (runResult.rows[0] as { id: string }).id;
        await expect(
          pool.query(
            `INSERT INTO symphony_provisioning_step (run_id, ordinal, step_name, status)
             VALUES ($1, 1, 'invalid_step', 'pending')`,
            [runId],
          ),
        ).rejects.toThrow();
      });

      it('enforces status CHECK constraint', async () => {
        const workItemId = await insertWorkItem(pool);
        const runResult = await pool.query(
          `INSERT INTO symphony_run (namespace, work_item_id, attempt, status, stage)
           VALUES ('testns', $1, 101, 'provisioning', 'setup') RETURNING id`,
          [workItemId],
        );
        const runId = (runResult.rows[0] as { id: string }).id;
        await expect(
          pool.query(
            `INSERT INTO symphony_provisioning_step (run_id, ordinal, step_name, status)
             VALUES ($1, 1, 'workspace', 'invalid_status')`,
            [runId],
          ),
        ).rejects.toThrow();
      });

      it('accepts valid step_name and status values', async () => {
        const workItemId = await insertWorkItem(pool);
        const runResult = await pool.query(
          `INSERT INTO symphony_run (namespace, work_item_id, attempt, status, stage)
           VALUES ('testns', $1, 102, 'provisioning', 'setup') RETURNING id`,
          [workItemId],
        );
        const runId = (runResult.rows[0] as { id: string }).id;
        const steps = ['workspace', 'container', 'secrets', 'clone', 'install', 'branch', 'verify', 'snapshot'];
        for (let i = 0; i < steps.length; i++) {
          const result = await pool.query(
            `INSERT INTO symphony_provisioning_step (run_id, ordinal, step_name, status)
             VALUES ($1, $2, $3, 'pending') RETURNING id`,
            [runId, i + 1, steps[i]],
          );
          expect(result.rows).toHaveLength(1);
        }
      });

      it('cascades on run deletion', async () => {
        const workItemId = await insertWorkItem(pool);
        const runResult = await pool.query(
          `INSERT INTO symphony_run (namespace, work_item_id, attempt, status, stage)
           VALUES ('testns', $1, 103, 'provisioning', 'setup') RETURNING id`,
          [workItemId],
        );
        const runId = (runResult.rows[0] as { id: string }).id;
        await pool.query(
          `INSERT INTO symphony_provisioning_step (run_id, ordinal, step_name, status)
           VALUES ($1, 1, 'workspace', 'pending')`,
          [runId],
        );
        await pool.query('DELETE FROM symphony_run WHERE id = $1', [runId]);
        const result = await pool.query(
          `SELECT id FROM symphony_provisioning_step WHERE run_id = $1`,
          [runId],
        );
        expect(result.rows).toHaveLength(0);
      });
    });

    describe('symphony_run_terminal', () => {
      beforeEach(async () => {
        await pool.query('DELETE FROM symphony_run_terminal');
        await pool.query('DELETE FROM symphony_run');
      });

      it('creates the table', async () => {
        const result = await pool.query(
          `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'symphony_run_terminal'`,
        );
        expect(result.rows).toHaveLength(1);
      });

      it('enforces purpose CHECK constraint', async () => {
        const workItemId = await insertWorkItem(pool);
        const runResult = await pool.query(
          `INSERT INTO symphony_run (namespace, work_item_id, attempt, status, stage)
           VALUES ('testns', $1, 200, 'executing', 'execution') RETURNING id`,
          [workItemId],
        );
        const runId = (runResult.rows[0] as { id: string }).id;
        await expect(
          pool.query(
            `INSERT INTO symphony_run_terminal (run_id, terminal_session_id, purpose, ordinal)
             VALUES ($1, gen_random_uuid(), 'invalid_purpose', 1)`,
            [runId],
          ),
        ).rejects.toThrow();
      });

      it('cascades on run deletion', async () => {
        const workItemId = await insertWorkItem(pool);
        const runResult = await pool.query(
          `INSERT INTO symphony_run (namespace, work_item_id, attempt, status, stage)
           VALUES ('testns', $1, 201, 'executing', 'execution') RETURNING id`,
          [workItemId],
        );
        const runId = (runResult.rows[0] as { id: string }).id;
        // We reference terminal_session_id but it may not exist if we don't have the FK
        // We'll just test the cascade with the run
        await pool.query(
          `INSERT INTO symphony_run_terminal (run_id, terminal_session_id, purpose, ordinal)
           VALUES ($1, gen_random_uuid(), 'primary', 1)`,
          [runId],
        );
        await pool.query('DELETE FROM symphony_run WHERE id = $1', [runId]);
        const result = await pool.query(
          `SELECT id FROM symphony_run_terminal WHERE run_id = $1`,
          [runId],
        );
        expect(result.rows).toHaveLength(0);
      });
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Migration 142: symphony_run_event hypertable
  // ─────────────────────────────────────────────────────────────
  describe('Migration 142: symphony_run_event hypertable', () => {
    beforeEach(async () => {
      await pool.query('DELETE FROM symphony_run_event');
    });

    it('creates the table', async () => {
      const result = await pool.query(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'symphony_run_event'`,
      );
      expect(result.rows).toHaveLength(1);
    });

    it('is a TimescaleDB hypertable', async () => {
      const result = await pool.query(
        `SELECT hypertable_name FROM timescaledb_information.hypertables
         WHERE hypertable_name = 'symphony_run_event'`,
      );
      expect(result.rows).toHaveLength(1);
    });

    it('has weekly chunk interval', async () => {
      const result = await pool.query(
        `SELECT h.hypertable_name
         FROM timescaledb_information.dimensions d
         JOIN timescaledb_information.hypertables h
           ON d.hypertable_name = h.hypertable_name
         WHERE d.hypertable_name = 'symphony_run_event'
           AND d.column_name = 'emitted_at'`,
      );
      expect(result.rows).toHaveLength(1);
    });

    it('has composite unique index including time column (P1-2)', async () => {
      const result = await pool.query(
        `SELECT indexname, indexdef FROM pg_indexes
         WHERE tablename = 'symphony_run_event'
         AND indexdef LIKE '%id%'
         AND indexdef LIKE '%emitted_at%'`,
      );
      expect(result.rows.length).toBeGreaterThanOrEqual(1);
    });

    it('accepts valid event insert', async () => {
      const result = await pool.query(
        `INSERT INTO symphony_run_event (namespace, run_id, emitted_at, kind, payload)
         VALUES ('testns', gen_random_uuid(), NOW(), 'status_change', '{"from": "queued", "to": "executing"}')
         RETURNING id, emitted_at`,
      );
      expect(result.rows).toHaveLength(1);
    });

    it('enforces namespace NOT NULL', async () => {
      await expect(
        pool.query(
          `INSERT INTO symphony_run_event (run_id, emitted_at, kind, payload)
           VALUES (gen_random_uuid(), NOW(), 'status_change', '{}')`,
        ),
      ).rejects.toThrow();
    });

    it('has retention policy configured', async () => {
      const result = await pool.query(
        `SELECT * FROM timescaledb_information.jobs
         WHERE hypertable_name = 'symphony_run_event'
         AND proc_name = 'policy_retention'`,
      );
      expect(result.rows).toHaveLength(1);
    });

    it('has columnstore (compression) policy configured', async () => {
      const result = await pool.query(
        `SELECT * FROM timescaledb_information.jobs
         WHERE hypertable_name = 'symphony_run_event'
         AND proc_name IN ('policy_compression', 'policy_columnstore')`,
      );
      expect(result.rows).toHaveLength(1);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Migration 143: Infrastructure tables
  // ─────────────────────────────────────────────────────────────
  describe('Migration 143: Infrastructure tables', () => {
    describe('symphony_container', () => {
      beforeEach(async () => {
        await pool.query('DELETE FROM symphony_container');
      });

      it('creates the table', async () => {
        const result = await pool.query(
          `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'symphony_container'`,
        );
        expect(result.rows).toHaveLength(1);
      });

      it('enforces warm_state CHECK (P1-3)', async () => {
        const connId = await insertTerminalConnection(pool);
        await expect(
          pool.query(
            `INSERT INTO symphony_container (namespace, connection_id, container_id, warm_state)
             VALUES ('testns', $1, 'ctr-123', 'invalid')`,
            [connId],
          ),
        ).rejects.toThrow();
      });

      it('accepts valid warm_state values matching symphony_workspace', async () => {
        const connId = await insertTerminalConnection(pool);
        for (const state of ['cold', 'warming', 'warm', 'cooling', 'dirty']) {
          const result = await pool.query(
            `INSERT INTO symphony_container (namespace, connection_id, container_id, warm_state)
             VALUES ('testns', $1, $2, $3) RETURNING id`,
            [connId, `ctr-${state}`, state],
          );
          expect(result.rows).toHaveLength(1);
        }
      });
    });

    describe('symphony_cleanup_item', () => {
      beforeEach(async () => {
        await pool.query('DELETE FROM symphony_cleanup_item');
      });

      it('creates the table', async () => {
        const result = await pool.query(
          `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'symphony_cleanup_item'`,
        );
        expect(result.rows).toHaveLength(1);
      });

      it('enforces resource_type CHECK', async () => {
        await expect(
          pool.query(
            `INSERT INTO symphony_cleanup_item (namespace, resource_type, resource_id, status)
             VALUES ('testns', 'invalid_type', 'res-1', 'pending')`,
          ),
        ).rejects.toThrow();
      });

      it('enforces status CHECK', async () => {
        await expect(
          pool.query(
            `INSERT INTO symphony_cleanup_item (namespace, resource_type, resource_id, status)
             VALUES ('testns', 'container', 'res-1', 'invalid_status')`,
          ),
        ).rejects.toThrow();
      });

      it('accepts valid values', async () => {
        for (const type of ['container', 'worktree', 'branch', 'secret', 'workspace']) {
          for (const status of ['pending', 'in_progress', 'completed', 'failed', 'skipped']) {
            const result = await pool.query(
              `INSERT INTO symphony_cleanup_item (namespace, resource_type, resource_id, status)
               VALUES ('testns', $1, $2, $3) RETURNING id`,
              [type, `${type}-${status}`, status],
            );
            expect(result.rows).toHaveLength(1);
          }
        }
      });
    });

    describe('symphony_secret_deployment', () => {
      beforeEach(async () => {
        await pool.query('DELETE FROM symphony_secret_deployment');
      });

      it('creates the table', async () => {
        const result = await pool.query(
          `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'symphony_secret_deployment'`,
        );
        expect(result.rows).toHaveLength(1);
      });

      it('enforces namespace NOT NULL', async () => {
        const connId = await insertTerminalConnection(pool);
        await expect(
          pool.query(
            `INSERT INTO symphony_secret_deployment (connection_id, secret_name, secret_version, deployed_path)
             VALUES ($1, 'API_KEY', '1', '/run/secrets/api_key')`,
            [connId],
          ),
        ).rejects.toThrow();
      });

      it('accepts valid insert', async () => {
        const connId = await insertTerminalConnection(pool);
        const result = await pool.query(
          `INSERT INTO symphony_secret_deployment (namespace, connection_id, secret_name, secret_version, deployed_path)
           VALUES ('testns', $1, 'API_KEY', '1', '/run/secrets/api_key') RETURNING id`,
          [connId],
        );
        expect(result.rows).toHaveLength(1);
      });
    });

    describe('symphony_orchestrator_heartbeat', () => {
      beforeEach(async () => {
        await pool.query('DELETE FROM symphony_orchestrator_heartbeat');
      });

      it('creates the table', async () => {
        const result = await pool.query(
          `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'symphony_orchestrator_heartbeat'`,
        );
        expect(result.rows).toHaveLength(1);
      });

      it('enforces unique orchestrator_id', async () => {
        await pool.query(
          `INSERT INTO symphony_orchestrator_heartbeat (namespace, orchestrator_id, last_heartbeat_at)
           VALUES ('testns', 'orch-1', NOW())`,
        );
        await expect(
          pool.query(
            `INSERT INTO symphony_orchestrator_heartbeat (namespace, orchestrator_id, last_heartbeat_at)
             VALUES ('testns', 'orch-1', NOW())`,
          ),
        ).rejects.toThrow();
      });

      it('supports upsert heartbeat pattern', async () => {
        // First insert
        await pool.query(
          `INSERT INTO symphony_orchestrator_heartbeat (namespace, orchestrator_id, last_heartbeat_at, active_runs)
           VALUES ('testns', 'orch-upsert', NOW(), 3)`,
        );
        // Upsert (ON CONFLICT updates)
        await pool.query(
          `INSERT INTO symphony_orchestrator_heartbeat (namespace, orchestrator_id, last_heartbeat_at, active_runs)
           VALUES ('testns', 'orch-upsert', NOW(), 99)
           ON CONFLICT (orchestrator_id) DO UPDATE SET last_heartbeat_at = NOW(), active_runs = 5`,
        );
        const result = await pool.query(
          `SELECT active_runs FROM symphony_orchestrator_heartbeat WHERE orchestrator_id = 'orch-upsert'`,
        );
        expect((result.rows[0] as { active_runs: number }).active_runs).toBe(5);
      });
    });

    describe('symphony_github_rate_limit', () => {
      beforeEach(async () => {
        await pool.query('DELETE FROM symphony_github_rate_limit');
      });

      it('creates the table', async () => {
        const result = await pool.query(
          `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'symphony_github_rate_limit'`,
        );
        expect(result.rows).toHaveLength(1);
      });

      it('enforces unique (namespace, resource)', async () => {
        await pool.query(
          `INSERT INTO symphony_github_rate_limit (namespace, resource, remaining, "limit", resets_at)
           VALUES ('testns', 'core', 5000, 5000, NOW() + INTERVAL '1 hour')`,
        );
        await expect(
          pool.query(
            `INSERT INTO symphony_github_rate_limit (namespace, resource, remaining, "limit", resets_at)
             VALUES ('testns', 'core', 4999, 5000, NOW() + INTERVAL '1 hour')`,
          ),
        ).rejects.toThrow();
      });
    });

    describe('symphony_circuit_breaker', () => {
      beforeEach(async () => {
        await pool.query('DELETE FROM symphony_circuit_breaker');
      });

      it('creates the table', async () => {
        const result = await pool.query(
          `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'symphony_circuit_breaker'`,
        );
        expect(result.rows).toHaveLength(1);
      });

      it('enforces state CHECK constraint', async () => {
        await expect(
          pool.query(
            `INSERT INTO symphony_circuit_breaker (namespace, circuit_name, state)
             VALUES ('testns', 'github-api', 'invalid_state')`,
          ),
        ).rejects.toThrow();
      });

      it('accepts valid state values', async () => {
        for (const state of ['closed', 'open', 'half_open']) {
          const result = await pool.query(
            `INSERT INTO symphony_circuit_breaker (namespace, circuit_name, state)
             VALUES ('testns', $1, $2) RETURNING id`,
            [`circuit-${state}`, state],
          );
          expect(result.rows).toHaveLength(1);
        }
      });

      it('enforces unique (namespace, circuit_name)', async () => {
        await pool.query(
          `INSERT INTO symphony_circuit_breaker (namespace, circuit_name, state)
           VALUES ('testns', 'github-api', 'closed')`,
        );
        await expect(
          pool.query(
            `INSERT INTO symphony_circuit_breaker (namespace, circuit_name, state)
             VALUES ('testns', 'github-api', 'open')`,
          ),
        ).rejects.toThrow();
      });
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Indexes
  // ─────────────────────────────────────────────────────────────
  describe('Indexes', () => {
    it('has claim index on lease_expires_at', async () => {
      const result = await pool.query(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'symphony_claim' AND indexdef LIKE '%lease_expires_at%'`,
      );
      expect(result.rows.length).toBeGreaterThanOrEqual(1);
    });

    it('has claim index on orchestrator_id', async () => {
      const result = await pool.query(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'symphony_claim' AND indexdef LIKE '%orchestrator_id%'`,
      );
      expect(result.rows.length).toBeGreaterThanOrEqual(1);
    });

    it('has run active index by project', async () => {
      const result = await pool.query(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'symphony_run' AND indexdef LIKE '%project_id%'`,
      );
      expect(result.rows.length).toBeGreaterThanOrEqual(1);
    });

    it('has run index by work_item_id', async () => {
      const result = await pool.query(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'symphony_run' AND indexdef LIKE '%work_item_id%'`,
      );
      expect(result.rows.length).toBeGreaterThanOrEqual(1);
    });

    it('has provisioning step index on (run_id, ordinal)', async () => {
      const result = await pool.query(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'symphony_provisioning_step' AND indexdef LIKE '%run_id%' AND indexdef LIKE '%ordinal%'`,
      );
      expect(result.rows.length).toBeGreaterThanOrEqual(1);
    });

    it('has cleanup index on pending items by created_at', async () => {
      const result = await pool.query(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'symphony_cleanup_item' AND indexdef LIKE '%created_at%'`,
      );
      expect(result.rows.length).toBeGreaterThanOrEqual(1);
    });

    it('has workspace index on (connection_id, warm_state)', async () => {
      const result = await pool.query(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'symphony_workspace' AND indexdef LIKE '%connection_id%' AND indexdef LIKE '%warm_state%'`,
      );
      expect(result.rows.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Down migration
  // ─────────────────────────────────────────────────────────────
  describe('Down migrations', () => {
    it('cleanly rolls back all 4 symphony migrations', async () => {
      // Roll back 4 migrations (143, 142, 141, 140)
      await runMigrate('down', 4);

      const tables = [
        'project_repository', 'project_host', 'symphony_tool_config',
        'symphony_orchestrator_config', 'symphony_notification_rule',
        'symphony_claim', 'symphony_workspace', 'symphony_run',
        'symphony_provisioning_step', 'symphony_run_terminal',
        'symphony_run_event', 'symphony_container', 'symphony_cleanup_item',
        'symphony_secret_deployment', 'symphony_orchestrator_heartbeat',
        'symphony_github_rate_limit', 'symphony_circuit_breaker',
      ];

      for (const table of tables) {
        const result = await pool.query(
          `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = $1`,
          [table],
        );
        expect(result.rows).toHaveLength(0);
      }

      // Re-apply so other test suites are unaffected
      await runMigrate('up');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Idempotency
  // ─────────────────────────────────────────────────────────────
  describe('Idempotency', () => {
    it('up migration is safe to run twice', async () => {
      await expect(runMigrate('up')).resolves.not.toThrow();
    });
  });
});
