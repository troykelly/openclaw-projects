/**
 * Tests for type validation in note presence API endpoints.
 * Part of Issue #697.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { buildServer } from '../src/api/server.ts';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';

describe('Note Presence API - Type Validation (Issue #697)', () => {
  const app = buildServer();
  let pool: Pool;
  const testUserEmail = 'test@example.com';
  let noteId: string;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);

    // Create a test note
    const noteResult = await pool.query(
      `INSERT INTO note (user_email, title, content)
       VALUES ($1, 'Test Note', 'Test content')
       RETURNING id::text as id`,
      [testUserEmail],
    );
    noteId = (noteResult.rows[0] as { id: string }).id;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  describe('POST /api/notes/:id/presence - Type Validation', () => {
    it('returns 400 when user_email is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/presence`,
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('user_email');
    });

    it('returns 400 when user_email is not a string', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/presence`,
        payload: { user_email: 123 },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('string');
    });

    it('returns 400 when cursorPosition has wrong structure', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/presence`,
        payload: {
          user_email: testUserEmail,
          cursor_position: 'invalid',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('cursorPosition');
    });

    it('returns 400 when cursorPosition line is not a number', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/presence`,
        payload: {
          user_email: testUserEmail,
          cursor_position: { line: 'not-a-number', column: 5 },
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('cursorPosition');
    });

    it('returns 400 when cursorPosition line is not an integer', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/presence`,
        payload: {
          user_email: testUserEmail,
          cursor_position: { line: 1.5, column: 5 },
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('integer');
    });

    it('returns 400 when cursorPosition has negative values', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/presence`,
        payload: {
          user_email: testUserEmail,
          cursor_position: { line: -1, column: 5 },
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('non-negative');
    });

    it('accepts valid payload with cursorPosition', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/presence`,
        payload: {
          user_email: testUserEmail,
          cursor_position: { line: 10, column: 5 },
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().collaborators).toBeDefined();
    });

    it('accepts valid payload without cursorPosition', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/presence`,
        payload: {
          user_email: testUserEmail,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().collaborators).toBeDefined();
    });
  });

  describe('DELETE /api/notes/:id/presence - Type Validation', () => {
    it('returns 400 when X-User-Email header is missing', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/notes/${noteId}/presence`,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('X-User-Email');
    });

    it('returns 400 when X-User-Email header is empty', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/notes/${noteId}/presence`,
        headers: { 'x-user-email': '' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('X-User-Email');
    });

    it('accepts valid X-User-Email header', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/notes/${noteId}/presence`,
        headers: { 'x-user-email': testUserEmail },
      });

      expect(res.statusCode).toBe(204);
    });
  });

  describe('GET /api/notes/:id/presence - Type Validation', () => {
    it('returns 400 when X-User-Email header is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}/presence`,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('X-User-Email');
    });

    it('returns 400 when X-User-Email header is empty', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}/presence`,
        headers: { 'x-user-email': '' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('X-User-Email');
    });

    it('accepts valid X-User-Email header', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}/presence`,
        headers: { 'x-user-email': testUserEmail },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().collaborators).toBeDefined();
    });
  });

  describe('PUT /api/notes/:id/presence/cursor - Type Validation', () => {
    it('returns 400 when user_email is missing', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}/presence/cursor`,
        payload: {
          cursor_position: { line: 1, column: 1 },
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('user_email');
    });

    it('returns 400 when user_email is not a string', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}/presence/cursor`,
        payload: {
          user_email: 12345,
          cursor_position: { line: 1, column: 1 },
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('string');
    });

    it('returns 400 when cursorPosition is missing', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}/presence/cursor`,
        payload: {
          user_email: testUserEmail,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('cursorPosition');
    });

    it('returns 400 when cursorPosition is not an object', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}/presence/cursor`,
        payload: {
          user_email: testUserEmail,
          cursor_position: 'invalid',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('cursorPosition');
    });

    it('returns 400 when cursorPosition is null', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}/presence/cursor`,
        payload: {
          user_email: testUserEmail,
          cursor_position: null,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('cursorPosition');
    });

    it('returns 400 when cursorPosition.line is not a number', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}/presence/cursor`,
        payload: {
          user_email: testUserEmail,
          cursor_position: { line: 'invalid', column: 1 },
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('cursorPosition');
    });

    it('returns 400 when cursorPosition.column is not a number', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}/presence/cursor`,
        payload: {
          user_email: testUserEmail,
          cursor_position: { line: 1, column: 'invalid' },
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('cursorPosition');
    });

    it('returns 400 when cursorPosition has non-integer values', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}/presence/cursor`,
        payload: {
          user_email: testUserEmail,
          cursor_position: { line: 1.5, column: 2.5 },
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('integer');
    });

    it('returns 400 when cursorPosition has negative values', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}/presence/cursor`,
        payload: {
          user_email: testUserEmail,
          cursor_position: { line: -1, column: 5 },
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('non-negative');
    });

    it('returns 400 when cursorPosition exceeds maximum bounds', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}/presence/cursor`,
        payload: {
          user_email: testUserEmail,
          cursor_position: { line: 2000000, column: 5 },
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('exceed');
    });

    it('accepts valid cursor position', async () => {
      // First join presence
      await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/presence`,
        payload: { user_email: testUserEmail },
      });

      const res = await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}/presence/cursor`,
        payload: {
          user_email: testUserEmail,
          cursor_position: { line: 10, column: 20 },
        },
      });

      expect(res.statusCode).toBe(204);
    });
  });
});
