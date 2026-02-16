/**
 * Tests for memory file attachments (Issue #1271).
 * Verifies the unified_memory_attachment junction table, API endpoints
 * for attaching/listing/removing files from memories.
 */

import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { runMigrate } from './helpers/migrate.ts';

describe('Memory File Attachments (Issue #1271)', () => {
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

  // ── Helpers ────────────────────────────────────────────────

  async function createTestMemory(title = 'Test Memory'): Promise<string> {
    const result = await pool.query(
      `INSERT INTO memory (title, content, memory_type)
       VALUES ($1, 'Test content', 'fact')
       RETURNING id::text as id`,
      [title],
    );
    return (result.rows[0] as { id: string }).id;
  }

  async function createTestFile(filename = 'test.pdf'): Promise<string> {
    const result = await pool.query(
      `INSERT INTO file_attachment (storage_key, original_filename, content_type, size_bytes)
       VALUES ($1, $2, 'application/pdf', 1024)
       RETURNING id::text as id`,
      [`2026/02/15/${crypto.randomUUID()}.pdf`, filename],
    );
    return (result.rows[0] as { id: string }).id;
  }

  // ── Schema ──────────────────────────────────────────────

  describe('schema', () => {
    it('unified_memory_attachment table exists', async () => {
      const result = await pool.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_name = 'unified_memory_attachment'`,
      );
      expect(result.rows.length).toBe(1);
    });

    it('has correct columns', async () => {
      const result = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'unified_memory_attachment'
         ORDER BY ordinal_position`,
      );
      const cols = result.rows.map((r: { column_name: string }) => r.column_name);
      expect(cols).toContain('memory_id');
      expect(cols).toContain('file_attachment_id');
      expect(cols).toContain('attached_at');
      expect(cols).toContain('attached_by');
    });

    it('has FK to memory table', async () => {
      const result = await pool.query(
        `SELECT ccu.table_name AS foreign_table
         FROM information_schema.table_constraints tc
         JOIN information_schema.constraint_column_usage ccu
           ON tc.constraint_name = ccu.constraint_name
         WHERE tc.table_name = 'unified_memory_attachment'
           AND tc.constraint_type = 'FOREIGN KEY'
           AND ccu.table_name = 'memory'`,
      );
      expect(result.rows.length).toBeGreaterThan(0);
    });

    it('has FK to file_attachment table', async () => {
      const result = await pool.query(
        `SELECT ccu.table_name AS foreign_table
         FROM information_schema.table_constraints tc
         JOIN information_schema.constraint_column_usage ccu
           ON tc.constraint_name = ccu.constraint_name
         WHERE tc.table_name = 'unified_memory_attachment'
           AND tc.constraint_type = 'FOREIGN KEY'
           AND ccu.table_name = 'file_attachment'`,
      );
      expect(result.rows.length).toBeGreaterThan(0);
    });
  });

  // ── API: POST /api/memories/:id/attachments ─────────────

  describe('POST /api/memories/:id/attachments', () => {
    it('attaches a file to a memory', async () => {
      const memoryId = await createTestMemory();
      const fileId = await createTestFile();

      const res = await app.inject({
        method: 'POST',
        url: `/api/memories/${memoryId}/attachments`,
        payload: { fileId },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.memoryId).toBe(memoryId);
      expect(body.fileId).toBe(fileId);
      expect(body.attached).toBe(true);
    });

    it('returns 400 when fileId is missing', async () => {
      const memoryId = await createTestMemory();

      const res = await app.inject({
        method: 'POST',
        url: `/api/memories/${memoryId}/attachments`,
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 404 when memory does not exist', async () => {
      const fileId = await createTestFile();

      const res = await app.inject({
        method: 'POST',
        url: '/api/memories/00000000-0000-0000-0000-000000000000/attachments',
        payload: { fileId },
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 404 when file does not exist', async () => {
      const memoryId = await createTestMemory();

      const res = await app.inject({
        method: 'POST',
        url: `/api/memories/${memoryId}/attachments`,
        payload: { fileId: '00000000-0000-0000-0000-000000000000' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('is idempotent (ON CONFLICT DO NOTHING)', async () => {
      const memoryId = await createTestMemory();
      const fileId = await createTestFile();

      await app.inject({
        method: 'POST',
        url: `/api/memories/${memoryId}/attachments`,
        payload: { fileId },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/memories/${memoryId}/attachments`,
        payload: { fileId },
      });

      expect(res.statusCode).toBe(201);
    });
  });

  // ── API: GET /api/memories/:id/attachments ──────────────

  describe('GET /api/memories/:id/attachments', () => {
    it('lists attachments for a memory', async () => {
      const memoryId = await createTestMemory();
      const fileId1 = await createTestFile('doc1.pdf');
      const fileId2 = await createTestFile('doc2.pdf');

      await app.inject({
        method: 'POST',
        url: `/api/memories/${memoryId}/attachments`,
        payload: { fileId: fileId1 },
      });
      await app.inject({
        method: 'POST',
        url: `/api/memories/${memoryId}/attachments`,
        payload: { fileId: fileId2 },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/memories/${memoryId}/attachments`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.attachments.length).toBe(2);
      expect(body.attachments[0].originalFilename).toBeDefined();
      expect(body.attachments[0].contentType).toBeDefined();
      expect(body.attachments[0].sizeBytes).toBeDefined();
    });

    it('returns empty array when no attachments', async () => {
      const memoryId = await createTestMemory();

      const res = await app.inject({
        method: 'GET',
        url: `/api/memories/${memoryId}/attachments`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.attachments).toEqual([]);
    });
  });

  // ── API: DELETE /api/memories/:memoryId/attachments/:fileId ─

  describe('DELETE /api/memories/:memoryId/attachments/:fileId', () => {
    it('removes an attachment from a memory', async () => {
      const memoryId = await createTestMemory();
      const fileId = await createTestFile();

      await app.inject({
        method: 'POST',
        url: `/api/memories/${memoryId}/attachments`,
        payload: { fileId },
      });

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/memories/${memoryId}/attachments/${fileId}`,
      });

      expect(res.statusCode).toBe(204);

      // Verify it's gone
      const listRes = await app.inject({
        method: 'GET',
        url: `/api/memories/${memoryId}/attachments`,
      });
      const body = listRes.json();
      expect(body.attachments.length).toBe(0);
    });

    it('returns 404 when attachment does not exist', async () => {
      const memoryId = await createTestMemory();

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/memories/${memoryId}/attachments/00000000-0000-0000-0000-000000000000`,
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── FK cascade: memory deletion removes attachments ─────

  describe('cascade behavior', () => {
    it('deletes attachments when memory is deleted', async () => {
      const memoryId = await createTestMemory();
      const fileId = await createTestFile();

      await pool.query(
        `INSERT INTO unified_memory_attachment (memory_id, file_attachment_id)
         VALUES ($1, $2)`,
        [memoryId, fileId],
      );

      // Delete the memory
      await pool.query('DELETE FROM memory WHERE id = $1', [memoryId]);

      // Attachment link should be gone
      const result = await pool.query('SELECT * FROM unified_memory_attachment WHERE memory_id = $1', [memoryId]);
      expect(result.rows.length).toBe(0);
    });

    it('deletes attachments when file is deleted', async () => {
      const memoryId = await createTestMemory();
      const fileId = await createTestFile();

      await pool.query(
        `INSERT INTO unified_memory_attachment (memory_id, file_attachment_id)
         VALUES ($1, $2)`,
        [memoryId, fileId],
      );

      // Delete the file
      await pool.query('DELETE FROM file_attachment WHERE id = $1', [fileId]);

      // Attachment link should be gone
      const result = await pool.query('SELECT * FROM unified_memory_attachment WHERE file_attachment_id = $1', [fileId]);
      expect(result.rows.length).toBe(0);
    });
  });
});
