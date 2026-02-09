/**
 * Tests for UUID validation in note presence API endpoints.
 * Part of Issue #701.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { buildServer } from '../src/api/server.ts';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';

describe('Note Presence API - UUID Validation (Issue #701)', () => {
  const app = buildServer();
  let pool: Pool;
  const testUserEmail = 'test@example.com';
  const validUUID = '00000000-0000-0000-0000-000000000000';
  const invalidUUIDs = [
    'not-a-uuid',
    '123',
    '',
    'ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ',
    '00000000-0000-0000-0000-00000000000g', // Invalid hex char
    '00000000-0000-0000-0000-0000000000000', // Too long
    '00000000-0000-0000-0000-00000000000', // Too short
    'sql-injection-attempt',
    "'; DROP TABLE notes; --",
    '../../../etc/passwd',
  ];

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

  describe('POST /api/notes/:id/presence - UUID Validation', () => {
    for (const invalidId of invalidUUIDs) {
      it(`returns 400 for invalid UUID: "${invalidId.slice(0, 30)}..."`, async () => {
        const res = await app.inject({
          method: 'POST',
          url: `/api/notes/${encodeURIComponent(invalidId)}/presence`,
          payload: { userEmail: testUserEmail },
        });

        expect(res.statusCode).toBe(400);
        expect(res.json().error).toContain('Invalid note ID format');
      });
    }

    it('accepts valid UUID format', async () => {
      // Create a note first
      const noteResult = await pool.query(
        `INSERT INTO note (user_email, title, content)
         VALUES ($1, 'Test Note', 'Test content')
         RETURNING id::text as id`,
        [testUserEmail],
      );
      const noteId = (noteResult.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/presence`,
        payload: { userEmail: testUserEmail },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  describe('DELETE /api/notes/:id/presence - UUID Validation', () => {
    for (const invalidId of invalidUUIDs) {
      it(`returns 400 for invalid UUID: "${invalidId.slice(0, 30)}..."`, async () => {
        const res = await app.inject({
          method: 'DELETE',
          url: `/api/notes/${encodeURIComponent(invalidId)}/presence`,
          headers: { 'x-user-email': testUserEmail },
        });

        expect(res.statusCode).toBe(400);
        expect(res.json().error).toContain('Invalid note ID format');
      });
    }

    it('accepts valid UUID format', async () => {
      // Create a note first
      const noteResult = await pool.query(
        `INSERT INTO note (user_email, title, content)
         VALUES ($1, 'Test Note', 'Test content')
         RETURNING id::text as id`,
        [testUserEmail],
      );
      const noteId = (noteResult.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/notes/${noteId}/presence`,
        headers: { 'x-user-email': testUserEmail },
      });

      expect(res.statusCode).toBe(204);
    });
  });

  describe('GET /api/notes/:id/presence - UUID Validation', () => {
    for (const invalidId of invalidUUIDs) {
      it(`returns 400 for invalid UUID: "${invalidId.slice(0, 30)}..."`, async () => {
        const res = await app.inject({
          method: 'GET',
          url: `/api/notes/${encodeURIComponent(invalidId)}/presence`,
          headers: { 'x-user-email': testUserEmail },
        });

        expect(res.statusCode).toBe(400);
        expect(res.json().error).toContain('Invalid note ID format');
      });
    }

    it('accepts valid UUID format', async () => {
      // Create a note first
      const noteResult = await pool.query(
        `INSERT INTO note (user_email, title, content)
         VALUES ($1, 'Test Note', 'Test content')
         RETURNING id::text as id`,
        [testUserEmail],
      );
      const noteId = (noteResult.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}/presence`,
        headers: { 'x-user-email': testUserEmail },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  describe('PUT /api/notes/:id/presence/cursor - UUID Validation', () => {
    for (const invalidId of invalidUUIDs) {
      it(`returns 400 for invalid UUID: "${invalidId.slice(0, 30)}..."`, async () => {
        const res = await app.inject({
          method: 'PUT',
          url: `/api/notes/${encodeURIComponent(invalidId)}/presence/cursor`,
          payload: {
            userEmail: testUserEmail,
            cursorPosition: { line: 1, column: 1 },
          },
        });

        expect(res.statusCode).toBe(400);
        expect(res.json().error).toContain('Invalid note ID format');
      });
    }

    it('accepts valid UUID format', async () => {
      // Create a note first
      const noteResult = await pool.query(
        `INSERT INTO note (user_email, title, content)
         VALUES ($1, 'Test Note', 'Test content')
         RETURNING id::text as id`,
        [testUserEmail],
      );
      const noteId = (noteResult.rows[0] as { id: string }).id;

      // Join presence first
      await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/presence`,
        payload: { userEmail: testUserEmail },
      });

      const res = await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}/presence/cursor`,
        payload: {
          userEmail: testUserEmail,
          cursorPosition: { line: 1, column: 1 },
        },
      });

      expect(res.statusCode).toBe(204);
    });
  });
});
