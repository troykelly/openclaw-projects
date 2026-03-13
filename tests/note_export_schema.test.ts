import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { createTestPool, ensureTestNamespace } from './helpers/db.ts';
import { runMigrate } from './helpers/migrate.ts';

/**
 * Tests for Issue #2476 — note_export schema (Migration 166)
 * Validates table structure, enum types, constraints, triggers, and access control.
 */
describe('note_export Schema (Migration 166)', () => {
  let pool: Pool;
  const TEST_USER = 'export-test@example.com';
  const TEST_USER_B = 'export-other@example.com';
  const TEST_NAMESPACE = 'default';

  beforeAll(async () => {
    pool = createTestPool();
    await runMigrate('up');
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Clean up test data
    await pool.query(`DELETE FROM note_export WHERE namespace = $1`, [TEST_NAMESPACE]);
    await ensureTestNamespace(pool, TEST_USER, TEST_NAMESPACE);
    await ensureTestNamespace(pool, TEST_USER_B, TEST_NAMESPACE);
  });

  describe('table structure', () => {
    it('note_export table exists with all required columns', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'note_export'
        ORDER BY ordinal_position
      `);

      const columns = result.rows.map((r: Record<string, string>) => r.column_name);
      expect(columns).toContain('id');
      expect(columns).toContain('namespace');
      expect(columns).toContain('requested_by');
      expect(columns).toContain('source_type');
      expect(columns).toContain('source_id');
      expect(columns).toContain('format');
      expect(columns).toContain('options');
      expect(columns).toContain('status');
      expect(columns).toContain('error_message');
      expect(columns).toContain('storage_key');
      expect(columns).toContain('original_filename');
      expect(columns).toContain('size_bytes');
      expect(columns).toContain('attempt_count');
      expect(columns).toContain('started_at');
      expect(columns).toContain('expires_at');
      expect(columns).toContain('created_at');
      expect(columns).toContain('updated_at');
    });
  });

  describe('enum types', () => {
    it('export_format enum accepts valid values', async () => {
      const noteId = (await pool.query(`SELECT new_uuid() AS id`)).rows[0].id;

      for (const format of ['pdf', 'docx', 'odf']) {
        const result = await pool.query(
          `INSERT INTO note_export (namespace, requested_by, source_type, source_id, format)
           VALUES ($1, $2, 'note', $3, $4)
           RETURNING id`,
          [TEST_NAMESPACE, TEST_USER, noteId, format],
        );
        expect(result.rowCount).toBe(1);
      }
    });

    it('export_format enum rejects invalid values', async () => {
      const noteId = (await pool.query(`SELECT new_uuid() AS id`)).rows[0].id;

      await expect(
        pool.query(
          `INSERT INTO note_export (namespace, requested_by, source_type, source_id, format)
           VALUES ($1, $2, 'note', $3, 'xlsx')`,
          [TEST_NAMESPACE, TEST_USER, noteId],
        ),
      ).rejects.toThrow();
    });

    it('export_status enum accepts all valid values', async () => {
      const noteId = (await pool.query(`SELECT new_uuid() AS id`)).rows[0].id;

      // Insert a row and transition through all valid statuses
      const result = await pool.query(
        `INSERT INTO note_export (namespace, requested_by, source_type, source_id, format)
         VALUES ($1, $2, 'note', $3, 'pdf')
         RETURNING id`,
        [TEST_NAMESPACE, TEST_USER, noteId],
      );
      const exportId = result.rows[0].id;

      // Test all status transitions
      for (const status of ['generating', 'failed', 'expired', 'pending']) {
        await pool.query(`UPDATE note_export SET status = $1 WHERE id = $2`, [status, exportId]);
        const check = await pool.query(`SELECT status FROM note_export WHERE id = $1`, [exportId]);
        expect(check.rows[0].status).toBe(status);
      }
    });

    it('export_source_type enum accepts note and notebook', async () => {
      const noteId = (await pool.query(`SELECT new_uuid() AS id`)).rows[0].id;

      for (const sourceType of ['note', 'notebook']) {
        const result = await pool.query(
          `INSERT INTO note_export (namespace, requested_by, source_type, source_id, format)
           VALUES ($1, $2, $3, $4, 'pdf')
           RETURNING id`,
          [TEST_NAMESPACE, TEST_USER, sourceType, noteId],
        );
        expect(result.rowCount).toBe(1);
      }
    });
  });

  describe('constraints', () => {
    it('ready status requires storage_key (CHECK constraint)', async () => {
      const noteId = (await pool.query(`SELECT new_uuid() AS id`)).rows[0].id;

      const result = await pool.query(
        `INSERT INTO note_export (namespace, requested_by, source_type, source_id, format)
         VALUES ($1, $2, 'note', $3, 'pdf')
         RETURNING id`,
        [TEST_NAMESPACE, TEST_USER, noteId],
      );
      const exportId = result.rows[0].id;

      // Setting status to 'ready' without storage_key should fail
      await expect(
        pool.query(`UPDATE note_export SET status = 'ready' WHERE id = $1`, [exportId]),
      ).rejects.toThrow();
    });

    it('ready status with storage_key succeeds', async () => {
      const noteId = (await pool.query(`SELECT new_uuid() AS id`)).rows[0].id;

      const result = await pool.query(
        `INSERT INTO note_export (namespace, requested_by, source_type, source_id, format)
         VALUES ($1, $2, 'note', $3, 'pdf')
         RETURNING id`,
        [TEST_NAMESPACE, TEST_USER, noteId],
      );
      const exportId = result.rows[0].id;

      // Setting status to 'ready' with storage_key should succeed
      await pool.query(
        `UPDATE note_export SET status = 'ready', storage_key = 'exports/test/key.pdf' WHERE id = $1`,
        [exportId],
      );

      const check = await pool.query(`SELECT status, storage_key FROM note_export WHERE id = $1`, [exportId]);
      expect(check.rows[0].status).toBe('ready');
      expect(check.rows[0].storage_key).toBe('exports/test/key.pdf');
    });

    it('defaults: status is pending, attempt_count is 0, options is empty object', async () => {
      const noteId = (await pool.query(`SELECT new_uuid() AS id`)).rows[0].id;

      const result = await pool.query(
        `INSERT INTO note_export (namespace, requested_by, source_type, source_id, format)
         VALUES ($1, $2, 'note', $3, 'pdf')
         RETURNING status, attempt_count, options`,
        [TEST_NAMESPACE, TEST_USER, noteId],
      );

      expect(result.rows[0].status).toBe('pending');
      expect(result.rows[0].attempt_count).toBe(0);
      expect(result.rows[0].options).toEqual({});
    });
  });

  describe('updated_at trigger', () => {
    it('fires on UPDATE and changes the column value', async () => {
      const noteId = (await pool.query(`SELECT new_uuid() AS id`)).rows[0].id;

      const created = await pool.query(
        `INSERT INTO note_export (namespace, requested_by, source_type, source_id, format)
         VALUES ($1, $2, 'note', $3, 'pdf')
         RETURNING id, updated_at`,
        [TEST_NAMESPACE, TEST_USER, noteId],
      );
      const exportId = created.rows[0].id;
      const originalUpdatedAt = created.rows[0].updated_at;

      // Small delay so timestamp changes
      await new Promise((r) => setTimeout(r, 50));

      await pool.query(
        `UPDATE note_export SET status = 'generating', started_at = NOW() WHERE id = $1`,
        [exportId],
      );

      const updated = await pool.query(`SELECT updated_at FROM note_export WHERE id = $1`, [exportId]);
      expect(updated.rows[0].updated_at.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
    });
  });

  describe('expiry behaviour', () => {
    it('expires_at defaults to ~24h from now', async () => {
      const noteId = (await pool.query(`SELECT new_uuid() AS id`)).rows[0].id;

      const result = await pool.query(
        `INSERT INTO note_export (namespace, requested_by, source_type, source_id, format)
         VALUES ($1, $2, 'note', $3, 'pdf')
         RETURNING expires_at, created_at`,
        [TEST_NAMESPACE, TEST_USER, noteId],
      );

      const expiresAt = result.rows[0].expires_at.getTime();
      const createdAt = result.rows[0].created_at.getTime();
      const diffHours = (expiresAt - createdAt) / (1000 * 60 * 60);

      // Should be approximately 24 hours (allow some margin)
      expect(diffHours).toBeGreaterThan(23.9);
      expect(diffHours).toBeLessThan(24.1);
    });

    it('setting expires_at to past and running cleanup sets status to expired', async () => {
      const noteId = (await pool.query(`SELECT new_uuid() AS id`)).rows[0].id;

      const result = await pool.query(
        `INSERT INTO note_export (namespace, requested_by, source_type, source_id, format, storage_key, status)
         VALUES ($1, $2, 'note', $3, 'pdf', 'exports/test/key.pdf', 'ready')
         RETURNING id`,
        [TEST_NAMESPACE, TEST_USER, noteId],
      );
      const exportId = result.rows[0].id;

      // Set expires_at to the past
      await pool.query(
        `UPDATE note_export SET expires_at = NOW() - INTERVAL '1 hour' WHERE id = $1`,
        [exportId],
      );

      // Run the cleanup logic (same SQL as the pg_cron job)
      await pool.query(
        `UPDATE note_export SET status = 'expired' WHERE expires_at < NOW() AND status NOT IN ('failed', 'expired')`,
      );

      const check = await pool.query(`SELECT status FROM note_export WHERE id = $1`, [exportId]);
      expect(check.rows[0].status).toBe('expired');
    });

    it('cleanup does not touch failed exports', async () => {
      const noteId = (await pool.query(`SELECT new_uuid() AS id`)).rows[0].id;

      const result = await pool.query(
        `INSERT INTO note_export (namespace, requested_by, source_type, source_id, format, status, error_message)
         VALUES ($1, $2, 'note', $3, 'pdf', 'failed', 'test error')
         RETURNING id`,
        [TEST_NAMESPACE, TEST_USER, noteId],
      );
      const exportId = result.rows[0].id;

      // Set expires_at to the past
      await pool.query(
        `UPDATE note_export SET expires_at = NOW() - INTERVAL '1 hour' WHERE id = $1`,
        [exportId],
      );

      // Run cleanup
      await pool.query(
        `UPDATE note_export SET status = 'expired' WHERE expires_at < NOW() AND status NOT IN ('failed', 'expired')`,
      );

      const check = await pool.query(`SELECT status FROM note_export WHERE id = $1`, [exportId]);
      expect(check.rows[0].status).toBe('failed');
    });
  });

  describe('migration reversibility', () => {
    it('down migration removes all objects cleanly', async () => {
      // Run down for migration 166
      await runMigrate('down', 1);

      // Table should not exist
      const tableCheck = await pool.query(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'note_export'`,
      );
      expect(tableCheck.rowCount).toBe(0);

      // Types should not exist
      const typeCheck = await pool.query(
        `SELECT typname FROM pg_type WHERE typname IN ('export_format', 'export_status', 'export_source_type')`,
      );
      expect(typeCheck.rowCount).toBe(0);

      // Re-apply so other tests in the suite still work
      await runMigrate('up');
    });
  });

  describe('indexes', () => {
    it('required indexes exist', async () => {
      const result = await pool.query(`
        SELECT indexname FROM pg_indexes WHERE tablename = 'note_export'
      `);

      const indexes = result.rows.map((r: Record<string, string>) => r.indexname);
      expect(indexes).toContain('idx_note_export_namespace_status');
      expect(indexes).toContain('idx_note_export_requested_by_created');
      expect(indexes).toContain('idx_note_export_source');
    });
  });

  describe('namespace-based access control', () => {
    it('user A exports are distinguishable from user B exports in same namespace', async () => {
      const noteId = (await pool.query(`SELECT new_uuid() AS id`)).rows[0].id;

      // User A creates an export
      await pool.query(
        `INSERT INTO note_export (namespace, requested_by, source_type, source_id, format)
         VALUES ($1, $2, 'note', $3, 'pdf')`,
        [TEST_NAMESPACE, TEST_USER, noteId],
      );

      // User B creates an export
      await pool.query(
        `INSERT INTO note_export (namespace, requested_by, source_type, source_id, format)
         VALUES ($1, $2, 'note', $3, 'docx')`,
        [TEST_NAMESPACE, TEST_USER_B, noteId],
      );

      // Query scoped to user A
      const userAExports = await pool.query(
        `SELECT * FROM note_export WHERE namespace = $1 AND requested_by = $2`,
        [TEST_NAMESPACE, TEST_USER],
      );
      expect(userAExports.rowCount).toBe(1);
      expect(userAExports.rows[0].format).toBe('pdf');

      // Query scoped to user B
      const userBExports = await pool.query(
        `SELECT * FROM note_export WHERE namespace = $1 AND requested_by = $2`,
        [TEST_NAMESPACE, TEST_USER_B],
      );
      expect(userBExports.rowCount).toBe(1);
      expect(userBExports.rows[0].format).toBe('docx');
    });
  });
});
