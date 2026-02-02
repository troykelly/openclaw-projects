/**
 * Tests for bulk operations API endpoints.
 * Part of Issue #218.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Pool } from 'pg';
import { buildServer } from '../src/api/server.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';

describe('Bulk API Endpoints', () => {
  const originalEnv = process.env;
  let pool: Pool;
  let app: ReturnType<typeof buildServer>;

  beforeEach(async () => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.CLAWDBOT_AUTH_DISABLED = 'true';

    pool = createTestPool();
    await truncateAllTables(pool);
    app = buildServer({ logger: false });
  });

  afterEach(async () => {
    process.env = originalEnv;
    await pool.end();
  });

  describe('POST /api/work-items/bulk', () => {
    it('creates multiple work items', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/work-items/bulk',
        payload: {
          items: [
            { title: 'Task 1', work_item_kind: 'issue' },
            { title: 'Task 2', work_item_kind: 'issue' },
            { title: 'Task 3', work_item_kind: 'epic' },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.created).toBe(3);
      expect(body.failed).toBe(0);
      expect(body.results).toHaveLength(3);
      expect(body.results.every((r: any) => r.status === 'created')).toBe(true);

      // Verify items in database
      const dbResult = await pool.query(
        "SELECT COUNT(*) FROM work_item WHERE title LIKE 'Task %'"
      );
      expect(parseInt(dbResult.rows[0].count, 10)).toBe(3);
    });

    it('returns 400 for empty items array', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/work-items/bulk',
        payload: { items: [] },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('items array is required');
    });

    it('returns 413 when exceeding limit', async () => {
      const items = Array.from({ length: 101 }, (_, i) => ({ title: `Item ${i}` }));

      const response = await app.inject({
        method: 'POST',
        url: '/api/work-items/bulk',
        payload: { items },
      });

      expect(response.statusCode).toBe(413);
      expect(response.json().limit).toBe(100);
    });

    it('handles partial failures with validation errors', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/work-items/bulk',
        payload: {
          items: [
            { title: 'Valid Task 1' },
            { title: '' }, // Invalid - empty title
            { title: 'Valid Task 2' },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.created).toBe(2);
      expect(body.failed).toBe(1);
      expect(body.results[1].status).toBe('failed');
      expect(body.results[1].error).toContain('title is required');
    });

    it('creates items with parent_work_item_id', async () => {
      // Create a parent first
      const parentResult = await pool.query(
        "INSERT INTO work_item (title, work_item_kind) VALUES ('Parent Epic', 'epic') RETURNING id::text as id"
      );
      const parentId = parentResult.rows[0].id;

      const response = await app.inject({
        method: 'POST',
        url: '/api/work-items/bulk',
        payload: {
          items: [
            { title: 'Child 1', parent_work_item_id: parentId },
            { title: 'Child 2', parent_work_item_id: parentId },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().created).toBe(2);

      // Verify parent relationship
      const childResult = await pool.query(
        'SELECT COUNT(*) FROM work_item WHERE parent_work_item_id = $1',
        [parentId]
      );
      expect(parseInt(childResult.rows[0].count, 10)).toBe(2);
    });
  });

  describe('DELETE /api/work-items/bulk', () => {
    it('deletes multiple work items', async () => {
      // Create items to delete
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const result = await pool.query(
          "INSERT INTO work_item (title, work_item_kind) VALUES ($1, 'issue') RETURNING id::text as id",
          [`Delete Test ${i}`]
        );
        ids.push(result.rows[0].id);
      }

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/work-items/bulk',
        payload: { ids },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.deleted).toBe(3);

      // Verify deleted
      const dbResult = await pool.query(
        "SELECT COUNT(*) FROM work_item WHERE title LIKE 'Delete Test %'"
      );
      expect(parseInt(dbResult.rows[0].count, 10)).toBe(0);
    });

    it('returns 400 for invalid UUIDs', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/work-items/bulk',
        payload: { ids: ['not-a-uuid', 'also-invalid'] },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('invalid UUID');
    });

    it('returns 413 when exceeding limit', async () => {
      const ids = Array.from({ length: 101 }, () => '00000000-0000-0000-0000-000000000000');

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/work-items/bulk',
        payload: { ids },
      });

      expect(response.statusCode).toBe(413);
    });
  });

  describe('PATCH /api/work-items/bulk', () => {
    let testIds: string[];

    beforeEach(async () => {
      testIds = [];
      for (let i = 0; i < 3; i++) {
        const result = await pool.query(
          "INSERT INTO work_item (title, work_item_kind, status) VALUES ($1, 'issue', 'backlog') RETURNING id::text as id",
          [`Patch Test ${i}`]
        );
        testIds.push(result.rows[0].id);
      }
    });

    it('updates status for multiple items', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/work-items/bulk',
        payload: {
          ids: testIds,
          action: 'status',
          value: 'in_progress',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);
      expect(response.json().affected).toBe(3);

      // Verify updates
      const dbResult = await pool.query(
        "SELECT COUNT(*) FROM work_item WHERE id = ANY($1::uuid[]) AND status = 'in_progress'",
        [testIds]
      );
      expect(parseInt(dbResult.rows[0].count, 10)).toBe(3);
    });

    it('updates priority for multiple items', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/work-items/bulk',
        payload: {
          ids: testIds,
          action: 'priority',
          value: 'P0',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);
    });

    it('returns 413 when exceeding limit', async () => {
      const ids = Array.from({ length: 101 }, () => '00000000-0000-0000-0000-000000000000');

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/work-items/bulk',
        payload: {
          ids,
          action: 'status',
          value: 'closed',
        },
      });

      expect(response.statusCode).toBe(413);
    });
  });

  describe('POST /api/contacts/bulk', () => {
    it('creates multiple contacts', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/contacts/bulk',
        payload: {
          contacts: [
            { displayName: 'Contact 1' },
            { displayName: 'Contact 2', notes: 'Some notes' },
            { displayName: 'Contact 3' },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.created).toBe(3);
      expect(body.results).toHaveLength(3);

      // Verify contacts in database
      const dbResult = await pool.query(
        "SELECT COUNT(*) FROM contact WHERE display_name LIKE 'Contact %'"
      );
      expect(parseInt(dbResult.rows[0].count, 10)).toBe(3);
    });

    it('creates contacts with endpoints', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/contacts/bulk',
        payload: {
          contacts: [
            {
              displayName: 'Contact With Email',
              endpoints: [
                { endpoint_type: 'email', endpoint_value: 'test@example.com' },
              ],
            },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().created).toBe(1);

      // Verify endpoint was created
      const epResult = await pool.query(
        "SELECT COUNT(*) FROM contact_endpoint WHERE endpoint_value = 'test@example.com'"
      );
      expect(parseInt(epResult.rows[0].count, 10)).toBe(1);
    });

    it('handles validation errors for empty displayName', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/contacts/bulk',
        payload: {
          contacts: [
            { displayName: 'Valid Contact' },
            { displayName: '' }, // Invalid
            { displayName: '   ' }, // Also invalid (whitespace only)
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.created).toBe(1);
      expect(body.failed).toBe(2);
    });

    it('returns 413 when exceeding limit', async () => {
      const contacts = Array.from({ length: 101 }, (_, i) => ({ displayName: `Contact ${i}` }));

      const response = await app.inject({
        method: 'POST',
        url: '/api/contacts/bulk',
        payload: { contacts },
      });

      expect(response.statusCode).toBe(413);
    });
  });

  describe('POST /api/memories/bulk', () => {
    it('creates multiple memories', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/memories/bulk',
        payload: {
          memories: [
            { title: 'Memory 1', content: 'Content 1', memory_type: 'note' },
            { title: 'Memory 2', content: 'Content 2', memory_type: 'fact' },
            { title: 'Memory 3', content: 'Content 3' }, // Default type
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.created).toBe(3);

      // Verify memories in database
      const dbResult = await pool.query(
        "SELECT COUNT(*) FROM memory WHERE title LIKE 'Memory %'"
      );
      expect(parseInt(dbResult.rows[0].count, 10)).toBe(3);
    });

    it('handles validation errors', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/memories/bulk',
        payload: {
          memories: [
            { title: 'Valid Memory', content: 'Valid Content' },
            { title: '', content: 'No title' }, // Invalid
            { title: 'No content' }, // Invalid - missing content
            { title: 'Invalid type', content: 'Content', memory_type: 'invalid_type' },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.created).toBe(1);
      expect(body.failed).toBe(3);
    });

    it('returns 413 when exceeding limit', async () => {
      const memories = Array.from({ length: 101 }, (_, i) => ({
        title: `Memory ${i}`,
        content: `Content ${i}`,
      }));

      const response = await app.inject({
        method: 'POST',
        url: '/api/memories/bulk',
        payload: { memories },
      });

      expect(response.statusCode).toBe(413);
    });
  });

  describe('PATCH /api/memories/bulk', () => {
    let memoryIds: string[];

    beforeEach(async () => {
      memoryIds = [];
      for (let i = 0; i < 3; i++) {
        const result = await pool.query(
          `INSERT INTO memory (title, content, memory_type)
           VALUES ($1, $2, 'note')
           RETURNING id::text as id`,
          [`Update Memory ${i}`, `Content ${i}`]
        );
        memoryIds.push(result.rows[0].id);
      }
    });

    it('updates multiple memories', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/memories/bulk',
        payload: {
          updates: [
            { id: memoryIds[0], title: 'Updated Title 0' },
            { id: memoryIds[1], importance: 8 },
            { id: memoryIds[2], content: 'Updated Content', confidence: 0.9 },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.updated).toBe(3);

      // Verify updates
      const result = await pool.query(
        'SELECT title, importance, content, confidence FROM memory WHERE id = ANY($1::uuid[]) ORDER BY title',
        [memoryIds]
      );
      expect(result.rows[0].title).toBe('Updated Title 0');
      expect(result.rows[1].importance).toBe(8);
      expect(result.rows[2].confidence).toBe(0.9);
    });

    it('handles partial failures for non-existent IDs', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/memories/bulk',
        payload: {
          updates: [
            { id: memoryIds[0], title: 'Updated' },
            { id: '00000000-0000-0000-0000-000000000000', title: 'Non-existent' },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.updated).toBe(1);
      expect(body.failed).toBe(1);
      expect(body.results[1].error).toContain('not found');
    });

    it('returns error for updates with no fields', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/memories/bulk',
        payload: {
          updates: [{ id: memoryIds[0] }], // No fields to update
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.results[0].error).toContain('no fields to update');
    });

    it('returns 413 when exceeding limit', async () => {
      const updates = Array.from({ length: 101 }, () => ({
        id: '00000000-0000-0000-0000-000000000000',
        title: 'Updated',
      }));

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/memories/bulk',
        payload: { updates },
      });

      expect(response.statusCode).toBe(413);
    });
  });
});
