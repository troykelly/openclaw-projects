/**
 * Note and Notebook Sharing API Tests
 * Part of Epic #337, Issue #348
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { buildServer } from '../src/api/server.ts';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';

describe('Sharing API (Epic #337, Issue #348)', () => {
  const app = buildServer();
  let pool: Pool;
  const ownerEmail = 'owner@example.com';
  const collaboratorEmail = 'collaborator@example.com';
  const otherEmail = 'other@example.com';

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
  });

  /**
   * Helper to create a note via API
   */
  async function createNote(
    userEmail: string,
    title: string,
    content: string,
    visibility: 'private' | 'shared' | 'public' = 'private'
  ): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/notes',
      payload: { user_email: userEmail, title, content, visibility },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id;
  }

  /**
   * Helper to create a notebook via API
   */
  async function createNotebook(
    userEmail: string,
    name: string
  ): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/notebooks',
      payload: { user_email: userEmail, name },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id;
  }

  // ============================================
  // Note Sharing with Users
  // ============================================

  describe('POST /api/notes/:id/share', () => {
    it('shares a note with another user', async () => {
      const noteId = await createNote(ownerEmail, 'Test Note', 'Content');

      const res = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/share`,
        payload: {
          user_email: ownerEmail,
          email: collaboratorEmail,
          permission: 'read',
        },
      });

      expect(res.statusCode).toBe(201);
      const share = res.json();
      expect(share.type).toBe('user');
      expect(share.noteId).toBe(noteId);
      expect(share.sharedWithEmail).toBe(collaboratorEmail);
      expect(share.permission).toBe('read');
    });

    it('supports read_write permission', async () => {
      const noteId = await createNote(ownerEmail, 'Test Note', 'Content');

      const res = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/share`,
        payload: {
          user_email: ownerEmail,
          email: collaboratorEmail,
          permission: 'read_write',
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().permission).toBe('read_write');
    });

    it('supports expiration date', async () => {
      const noteId = await createNote(ownerEmail, 'Test Note', 'Content');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const res = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/share`,
        payload: {
          user_email: ownerEmail,
          email: collaboratorEmail,
          expiresAt,
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().expiresAt).toBeDefined();
    });

    it('returns 404 for non-existent note', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/notes/00000000-0000-0000-0000-000000000000/share',
        payload: {
          user_email: ownerEmail,
          email: collaboratorEmail,
        },
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 403 for non-owner', async () => {
      const noteId = await createNote(ownerEmail, 'Test Note', 'Content');

      const res = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/share`,
        payload: {
          user_email: otherEmail,
          email: collaboratorEmail,
        },
      });

      expect(res.statusCode).toBe(403);
    });

    it('returns 409 when already shared', async () => {
      const noteId = await createNote(ownerEmail, 'Test Note', 'Content');

      // First share
      await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/share`,
        payload: {
          user_email: ownerEmail,
          email: collaboratorEmail,
        },
      });

      // Try to share again
      const res = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/share`,
        payload: {
          user_email: ownerEmail,
          email: collaboratorEmail,
        },
      });

      expect(res.statusCode).toBe(409);
    });

    it('requires user_email', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/notes/some-id/share',
        payload: { email: collaboratorEmail },
      });

      expect(res.statusCode).toBe(400);
    });

    it('requires target email', async () => {
      const noteId = await createNote(ownerEmail, 'Test Note', 'Content');

      const res = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/share`,
        payload: { user_email: ownerEmail },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ============================================
  // Note Share Links
  // ============================================

  describe('POST /api/notes/:id/share/link', () => {
    it('creates a share link', async () => {
      const noteId = await createNote(ownerEmail, 'Test Note', 'Content');

      const res = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/share/link`,
        payload: { user_email: ownerEmail },
      });

      expect(res.statusCode).toBe(201);
      const share = res.json();
      expect(share.type).toBe('link');
      expect(share.token).toBeDefined();
      expect(share.url).toContain(share.token);
      expect(share.permission).toBe('read');
    });

    it('supports single view mode', async () => {
      const noteId = await createNote(ownerEmail, 'Test Note', 'Content');

      const res = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/share/link`,
        payload: {
          user_email: ownerEmail,
          isSingleView: true,
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().isSingleView).toBe(true);
    });

    it('supports max views limit', async () => {
      const noteId = await createNote(ownerEmail, 'Test Note', 'Content');

      const res = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/share/link`,
        payload: {
          user_email: ownerEmail,
          maxViews: 5,
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().maxViews).toBe(5);
    });

    it('returns 403 for non-owner', async () => {
      const noteId = await createNote(ownerEmail, 'Test Note', 'Content');

      const res = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/share/link`,
        payload: { user_email: otherEmail },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  // ============================================
  // List and Manage Shares
  // ============================================

  describe('GET /api/notes/:id/shares', () => {
    it('lists all shares for a note', async () => {
      const noteId = await createNote(ownerEmail, 'Test Note', 'Content');

      // Create user share
      await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/share`,
        payload: { user_email: ownerEmail, email: collaboratorEmail },
      });

      // Create link share
      await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/share/link`,
        payload: { user_email: ownerEmail },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}/shares`,
        query: { user_email: ownerEmail },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.noteId).toBe(noteId);
      expect(body.shares.length).toBe(2);

      const types = body.shares.map((s: { type: string }) => s.type);
      expect(types).toContain('user');
      expect(types).toContain('link');
    });

    it('returns 403 for non-owner', async () => {
      const noteId = await createNote(ownerEmail, 'Test Note', 'Content');

      const res = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}/shares`,
        query: { user_email: otherEmail },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe('PUT /api/notes/:id/shares/:shareId', () => {
    it('updates share permission', async () => {
      const noteId = await createNote(ownerEmail, 'Test Note', 'Content');

      const shareRes = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/share`,
        payload: { user_email: ownerEmail, email: collaboratorEmail, permission: 'read' },
      });
      const shareId = shareRes.json().id;

      const res = await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}/shares/${shareId}`,
        payload: { user_email: ownerEmail, permission: 'read_write' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().permission).toBe('read_write');
    });

    it('returns 404 for non-existent share', async () => {
      const noteId = await createNote(ownerEmail, 'Test Note', 'Content');

      const res = await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}/shares/00000000-0000-0000-0000-000000000000`,
        payload: { user_email: ownerEmail, permission: 'read_write' },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/notes/:id/shares/:shareId', () => {
    it('revokes a share', async () => {
      const noteId = await createNote(ownerEmail, 'Test Note', 'Content');

      const shareRes = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/share`,
        payload: { user_email: ownerEmail, email: collaboratorEmail },
      });
      const shareId = shareRes.json().id;

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/notes/${noteId}/shares/${shareId}`,
        query: { user_email: ownerEmail },
      });

      expect(res.statusCode).toBe(204);

      // Verify share is gone
      const listRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}/shares`,
        query: { user_email: ownerEmail },
      });
      expect(listRes.json().shares.length).toBe(0);
    });

    it('returns 404 for non-existent share', async () => {
      const noteId = await createNote(ownerEmail, 'Test Note', 'Content');

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/notes/${noteId}/shares/00000000-0000-0000-0000-000000000000`,
        query: { user_email: ownerEmail },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ============================================
  // Access Shared Notes
  // ============================================

  describe('GET /api/shared/notes/:token', () => {
    it('accesses a note via share link', async () => {
      const noteId = await createNote(ownerEmail, 'Shared Note', 'Secret content');

      const linkRes = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/share/link`,
        payload: { user_email: ownerEmail },
      });
      const token = linkRes.json().token;

      const res = await app.inject({
        method: 'GET',
        url: `/api/shared/notes/${token}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.note.id).toBe(noteId);
      expect(body.note.title).toBe('Shared Note');
      expect(body.note.content).toBe('Secret content');
      expect(body.permission).toBe('read');
      expect(body.sharedBy).toBe(ownerEmail);
    });

    it('returns 404 for invalid token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/shared/notes/invalid-token-here',
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 410 for single-view link after first access', async () => {
      const noteId = await createNote(ownerEmail, 'One Time Note', 'Content');

      const linkRes = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/share/link`,
        payload: { user_email: ownerEmail, isSingleView: true },
      });
      const token = linkRes.json().token;

      // First access - should work
      const res1 = await app.inject({
        method: 'GET',
        url: `/api/shared/notes/${token}`,
      });
      expect(res1.statusCode).toBe(200);

      // Second access - should fail
      const res2 = await app.inject({
        method: 'GET',
        url: `/api/shared/notes/${token}`,
      });
      expect(res2.statusCode).toBe(410);
    });

    it('increments view count', async () => {
      const noteId = await createNote(ownerEmail, 'Note', 'Content');

      const linkRes = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/share/link`,
        payload: { user_email: ownerEmail },
      });
      const token = linkRes.json().token;

      // Access twice
      await app.inject({ method: 'GET', url: `/api/shared/notes/${token}` });
      await app.inject({ method: 'GET', url: `/api/shared/notes/${token}` });

      // Check view count
      const result = await pool.query(
        'SELECT view_count FROM note_share WHERE share_link_token = $1',
        [token]
      );
      expect(result.rows[0].view_count).toBe(2);
    });
  });

  // ============================================
  // Shared With Me
  // ============================================

  describe('GET /api/notes/shared-with-me', () => {
    it('lists notes shared with user', async () => {
      const noteId = await createNote(ownerEmail, 'Shared Note', 'Content');

      await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/share`,
        payload: { user_email: ownerEmail, email: collaboratorEmail },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/notes/shared-with-me',
        query: { user_email: collaboratorEmail },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.notes.length).toBe(1);
      expect(body.notes[0].id).toBe(noteId);
      expect(body.notes[0].title).toBe('Shared Note');
      expect(body.notes[0].sharedByEmail).toBe(ownerEmail);
    });

    it('returns empty list when nothing shared', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/notes/shared-with-me',
        query: { user_email: collaboratorEmail },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().notes.length).toBe(0);
    });

    it('excludes expired shares', async () => {
      const noteId = await createNote(ownerEmail, 'Shared Note', 'Content');

      // Share with past expiration
      const pastDate = new Date(Date.now() - 1000).toISOString();
      await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/share`,
        payload: { user_email: ownerEmail, email: collaboratorEmail, expiresAt: pastDate },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/notes/shared-with-me',
        query: { user_email: collaboratorEmail },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().notes.length).toBe(0);
    });
  });

  // ============================================
  // Notebook Sharing (parallel tests)
  // ============================================

  describe('Notebook Sharing', () => {
    describe('POST /api/notebooks/:id/share', () => {
      it('shares a notebook with another user', async () => {
        const notebookId = await createNotebook(ownerEmail, 'Test Notebook');

        const res = await app.inject({
          method: 'POST',
          url: `/api/notebooks/${notebookId}/share`,
          payload: {
            user_email: ownerEmail,
            email: collaboratorEmail,
            permission: 'read',
          },
        });

        expect(res.statusCode).toBe(201);
        const share = res.json();
        expect(share.type).toBe('user');
        expect(share.notebookId).toBe(notebookId);
        expect(share.sharedWithEmail).toBe(collaboratorEmail);
      });
    });

    describe('POST /api/notebooks/:id/share/link', () => {
      it('creates a share link for notebook', async () => {
        const notebookId = await createNotebook(ownerEmail, 'Test Notebook');

        const res = await app.inject({
          method: 'POST',
          url: `/api/notebooks/${notebookId}/share/link`,
          payload: { user_email: ownerEmail },
        });

        expect(res.statusCode).toBe(201);
        expect(res.json().token).toBeDefined();
        expect(res.json().url).toContain('notebooks');
      });
    });

    describe('GET /api/notebooks/:id/shares', () => {
      it('lists notebook shares', async () => {
        const notebookId = await createNotebook(ownerEmail, 'Test Notebook');

        await app.inject({
          method: 'POST',
          url: `/api/notebooks/${notebookId}/share`,
          payload: { user_email: ownerEmail, email: collaboratorEmail },
        });

        const res = await app.inject({
          method: 'GET',
          url: `/api/notebooks/${notebookId}/shares`,
          query: { user_email: ownerEmail },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json().shares.length).toBe(1);
      });
    });

    describe('GET /api/shared/notebooks/:token', () => {
      it('accesses a notebook via share link', async () => {
        const notebookId = await createNotebook(ownerEmail, 'Shared Notebook');

        const linkRes = await app.inject({
          method: 'POST',
          url: `/api/notebooks/${notebookId}/share/link`,
          payload: { user_email: ownerEmail },
        });
        const token = linkRes.json().token;

        const res = await app.inject({
          method: 'GET',
          url: `/api/shared/notebooks/${token}`,
        });

        expect(res.statusCode).toBe(200);
        expect(res.json().notebook.name).toBe('Shared Notebook');
        expect(res.json().sharedBy).toBe(ownerEmail);
      });
    });

    describe('GET /api/notebooks/shared-with-me', () => {
      it('lists notebooks shared with user', async () => {
        const notebookId = await createNotebook(ownerEmail, 'Shared Notebook');

        await app.inject({
          method: 'POST',
          url: `/api/notebooks/${notebookId}/share`,
          payload: { user_email: ownerEmail, email: collaboratorEmail },
        });

        const res = await app.inject({
          method: 'GET',
          url: '/api/notebooks/shared-with-me',
          query: { user_email: collaboratorEmail },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json().notebooks.length).toBe(1);
        expect(res.json().notebooks[0].name).toBe('Shared Notebook');
      });
    });
  });

  // ============================================
  // Integration: Sharing enables access
  // ============================================

  describe('Integration: Sharing enables note access', () => {
    it('shared user can read note', async () => {
      const noteId = await createNote(ownerEmail, 'Shared Note', 'Content', 'shared');

      // Before sharing, collaborator cannot access
      const beforeRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}`,
        query: { user_email: collaboratorEmail },
      });
      expect(beforeRes.statusCode).toBe(404);

      // Share with collaborator
      await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/share`,
        payload: { user_email: ownerEmail, email: collaboratorEmail },
      });

      // After sharing, collaborator can access
      const afterRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}`,
        query: { user_email: collaboratorEmail },
      });
      expect(afterRes.statusCode).toBe(200);
      expect(afterRes.json().title).toBe('Shared Note');
    });

    it('shared user with read_write can update note', async () => {
      const noteId = await createNote(ownerEmail, 'Shared Note', 'Original', 'shared');

      // Share with read_write
      await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/share`,
        payload: { user_email: ownerEmail, email: collaboratorEmail, permission: 'read_write' },
      });

      // Collaborator can update
      const res = await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}`,
        payload: {
          user_email: collaboratorEmail,
          content: 'Updated by collaborator',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().content).toBe('Updated by collaborator');
    });
  });
});
