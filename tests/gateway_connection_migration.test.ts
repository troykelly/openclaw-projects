/**
 * Integration tests for gateway_connection migration 134 (Epic #2153, Issue #2161).
 * Verifies table creation, constraints, indexes, triggers, pg_cron job,
 * idempotency, and clean rollback.
 */
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { runMigrate } from './helpers/migrate.ts';

describe('Gateway Connection Migration 134 (#2161)', () => {
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('Table structure', () => {
    it('creates the gateway_connection table', async () => {
      const result = await pool.query(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'gateway_connection'`,
      );
      expect(result.rows).toHaveLength(1);
    });

    it('has all expected columns with correct types', async () => {
      const result = await pool.query(
        `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_name = 'gateway_connection'
         ORDER BY ordinal_position`,
      );
      const columns = result.rows as Array<{
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }>;

      const colMap = new Map(columns.map((c) => [c.column_name, c]));

      expect(colMap.get('id')?.data_type).toBe('uuid');
      expect(colMap.get('id')?.is_nullable).toBe('NO');

      expect(colMap.get('instance_id')?.data_type).toBe('text');
      expect(colMap.get('instance_id')?.is_nullable).toBe('NO');

      expect(colMap.get('gateway_url')?.data_type).toBe('text');
      expect(colMap.get('gateway_url')?.is_nullable).toBe('NO');

      expect(colMap.get('status')?.data_type).toBe('text');
      expect(colMap.get('status')?.is_nullable).toBe('NO');

      expect(colMap.get('connected_at')?.data_type).toContain('timestamp');
      expect(colMap.get('connected_at')?.is_nullable).toBe('YES');

      expect(colMap.get('last_tick_at')?.data_type).toContain('timestamp');
      expect(colMap.get('last_tick_at')?.is_nullable).toBe('YES');

      expect(colMap.get('created_at')?.data_type).toContain('timestamp');
      expect(colMap.get('created_at')?.is_nullable).toBe('NO');

      expect(colMap.get('updated_at')?.data_type).toContain('timestamp');
      expect(colMap.get('updated_at')?.is_nullable).toBe('NO');
    });
  });

  describe('Indexes', () => {
    it('creates updated_at index', async () => {
      const result = await pool.query(
        `SELECT indexname FROM pg_indexes
         WHERE schemaname = 'public'
         AND tablename = 'gateway_connection'
         AND indexname = 'gateway_connection_updated_at_idx'`,
      );
      expect(result.rows).toHaveLength(1);
    });

    it('creates unique constraint index on instance_id', async () => {
      const result = await pool.query(
        `SELECT indexname FROM pg_indexes
         WHERE schemaname = 'public'
         AND tablename = 'gateway_connection'
         AND indexdef LIKE '%instance_id%'`,
      );
      expect(result.rows.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Constraints', () => {
    beforeEach(async () => {
      await pool.query('DELETE FROM gateway_connection');
    });

    it('enforces status CHECK constraint — rejects invalid status', async () => {
      await expect(
        pool.query(
          `INSERT INTO gateway_connection (instance_id, gateway_url, status)
           VALUES ('test-instance', 'gateway.example.com:443', 'invalid_status')`,
        ),
      ).rejects.toThrow();
    });

    it('accepts valid status values', async () => {
      for (const status of ['connecting', 'connected', 'disconnected']) {
        const result = await pool.query(
          `INSERT INTO gateway_connection (instance_id, gateway_url, status)
           VALUES ($1, 'gateway.example.com:443', $2)
           RETURNING id`,
          [`test-instance-${status}`, status],
        );
        expect(result.rows).toHaveLength(1);
      }
    });

    it('enforces unique instance_id', async () => {
      await pool.query(
        `INSERT INTO gateway_connection (instance_id, gateway_url, status)
         VALUES ('unique-test', 'gateway.example.com:443', 'connected')`,
      );
      await expect(
        pool.query(
          `INSERT INTO gateway_connection (instance_id, gateway_url, status)
           VALUES ('unique-test', 'gateway.example.com:443', 'connected')`,
        ),
      ).rejects.toThrow();
    });

    it('enforces NOT NULL on instance_id', async () => {
      await expect(
        pool.query(
          `INSERT INTO gateway_connection (instance_id, gateway_url, status)
           VALUES (NULL, 'gateway.example.com:443', 'connected')`,
        ),
      ).rejects.toThrow();
    });

    it('enforces NOT NULL on gateway_url', async () => {
      await expect(
        pool.query(
          `INSERT INTO gateway_connection (instance_id, gateway_url, status)
           VALUES ('test-null-url', NULL, 'connected')`,
        ),
      ).rejects.toThrow();
    });

    it('enforces NOT NULL on status', async () => {
      await expect(
        pool.query(
          `INSERT INTO gateway_connection (instance_id, gateway_url, status)
           VALUES ('test-null-status', 'gateway.example.com:443', NULL)`,
        ),
      ).rejects.toThrow();
    });
  });

  describe('Trigger: updated_at auto-update', () => {
    beforeEach(async () => {
      await pool.query('DELETE FROM gateway_connection');
    });

    it('auto-updates updated_at on row modification', async () => {
      const insert = await pool.query(
        `INSERT INTO gateway_connection (instance_id, gateway_url, status, connected_at)
         VALUES ('trigger-test', 'gateway.example.com:443', 'connected', NOW())
         RETURNING id, updated_at`,
      );
      const originalUpdated = (insert.rows[0] as { updated_at: Date }).updated_at;

      // Small delay to ensure timestamp difference
      await new Promise((r) => setTimeout(r, 50));

      const update = await pool.query(
        `UPDATE gateway_connection SET last_tick_at = NOW() WHERE instance_id = 'trigger-test'
         RETURNING updated_at`,
      );
      const newUpdated = (update.rows[0] as { updated_at: Date }).updated_at;

      expect(new Date(newUpdated).getTime()).toBeGreaterThan(
        new Date(originalUpdated).getTime(),
      );
    });

    it('updated_at updates even when not explicitly set in UPDATE', async () => {
      const insert = await pool.query(
        `INSERT INTO gateway_connection (instance_id, gateway_url, status)
         VALUES ('trigger-test-2', 'gateway.example.com:443', 'connecting')
         RETURNING updated_at`,
      );
      const originalUpdated = (insert.rows[0] as { updated_at: Date }).updated_at;

      await new Promise((r) => setTimeout(r, 50));

      const update = await pool.query(
        `UPDATE gateway_connection SET status = 'connected' WHERE instance_id = 'trigger-test-2'
         RETURNING updated_at`,
      );
      const newUpdated = (update.rows[0] as { updated_at: Date }).updated_at;

      expect(new Date(newUpdated).getTime()).toBeGreaterThan(
        new Date(originalUpdated).getTime(),
      );
    });
  });

  describe('pg_cron job', () => {
    it('registers gateway_connection_cleanup cron job', async () => {
      const result = await pool.query(
        `SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'gateway_connection_cleanup'`,
      );
      expect(result.rows).toHaveLength(1);
      const job = result.rows[0] as { jobname: string; schedule: string; command: string };
      expect(job.schedule).toBe('* * * * *');
      expect(job.command).toContain('DELETE FROM gateway_connection');
      expect(job.command).toContain("INTERVAL '5 minutes'");
    });
  });

  describe('Idempotency', () => {
    it('up migration is safe to run twice', async () => {
      // The migration was already applied in beforeAll. Running again should not error.
      await expect(runMigrate('up')).resolves.not.toThrow();
    });
  });

  describe('Service integration patterns', () => {
    beforeEach(async () => {
      await pool.query('DELETE FROM gateway_connection');
    });

    it('supports upsert pattern for connect', async () => {
      // First connect
      await pool.query(
        `INSERT INTO gateway_connection (instance_id, gateway_url, status, connected_at)
         VALUES ('svc-test', 'gateway.example.com:443', 'connected', NOW())
         ON CONFLICT (instance_id) DO UPDATE SET status='connected', connected_at=NOW(), gateway_url='gateway.example.com:443'`,
      );

      // Reconnect (upsert)
      await pool.query(
        `INSERT INTO gateway_connection (instance_id, gateway_url, status, connected_at)
         VALUES ('svc-test', 'gateway2.example.com:443', 'connected', NOW())
         ON CONFLICT (instance_id) DO UPDATE SET status='connected', connected_at=NOW(), gateway_url='gateway2.example.com:443'`,
      );

      const result = await pool.query(
        `SELECT gateway_url, status FROM gateway_connection WHERE instance_id = 'svc-test'`,
      );
      expect(result.rows).toHaveLength(1);
      expect((result.rows[0] as { gateway_url: string }).gateway_url).toBe('gateway2.example.com:443');
      expect((result.rows[0] as { status: string }).status).toBe('connected');
    });

    it('supports tick update pattern', async () => {
      await pool.query(
        `INSERT INTO gateway_connection (instance_id, gateway_url, status, connected_at)
         VALUES ('tick-test', 'gateway.example.com:443', 'connected', NOW())`,
      );

      const result = await pool.query(
        `UPDATE gateway_connection SET last_tick_at = NOW() WHERE instance_id = 'tick-test'
         RETURNING last_tick_at`,
      );
      expect(result.rows).toHaveLength(1);
      expect((result.rows[0] as { last_tick_at: Date }).last_tick_at).toBeTruthy();
    });

    it('supports disconnect update pattern', async () => {
      await pool.query(
        `INSERT INTO gateway_connection (instance_id, gateway_url, status, connected_at)
         VALUES ('disconnect-test', 'gateway.example.com:443', 'connected', NOW())`,
      );

      await pool.query(
        `UPDATE gateway_connection SET status = 'disconnected' WHERE instance_id = 'disconnect-test'`,
      );

      const result = await pool.query(
        `SELECT status FROM gateway_connection WHERE instance_id = 'disconnect-test'`,
      );
      expect((result.rows[0] as { status: string }).status).toBe('disconnected');
    });

    it('supports clean shutdown delete pattern', async () => {
      await pool.query(
        `INSERT INTO gateway_connection (instance_id, gateway_url, status, connected_at)
         VALUES ('shutdown-test', 'gateway.example.com:443', 'connected', NOW())`,
      );

      await pool.query(
        `DELETE FROM gateway_connection WHERE instance_id = 'shutdown-test'`,
      );

      const result = await pool.query(
        `SELECT id FROM gateway_connection WHERE instance_id = 'shutdown-test'`,
      );
      expect(result.rows).toHaveLength(0);
    });
  });

  describe('Down migration', () => {
    it('cleanly rolls back migration 134', async () => {
      // Roll back just migration 134
      await runMigrate('down', 1);

      // Verify table is gone
      const tableResult = await pool.query(
        `SELECT tablename FROM pg_tables
         WHERE schemaname = 'public' AND tablename = 'gateway_connection'`,
      );
      expect(tableResult.rows).toHaveLength(0);

      // Verify trigger function is gone
      const fnResult = await pool.query(
        `SELECT proname FROM pg_proc WHERE proname = 'set_gateway_connection_updated_at'`,
      );
      expect(fnResult.rows).toHaveLength(0);

      // Verify cron job is gone
      const cronResult = await pool.query(
        `SELECT jobname FROM cron.job WHERE jobname = 'gateway_connection_cleanup'`,
      );
      expect(cronResult.rows).toHaveLength(0);

      // Re-apply so other tests are unaffected
      await runMigrate('up');
    });
  });
});
