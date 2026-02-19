import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { buildServer } from '../src/api/server.ts';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables, ensureTestNamespace } from './helpers/db.ts';

describe('Notes CRUD API (Epic #337, Issue #344)', () => {
  const app = buildServer();
  let pool: Pool;
  const testUserEmail = 'test@example.com';
  const otherUserEmail = 'other@example.com';

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
    await ensureTestNamespace(pool, testUserEmail);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  describe('POST /api/notes', () => {
    it('creates a basic note', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: testUserEmail,
          title: 'My First Note',
          content: 'This is the content of my note.',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.title).toBe('My First Note');
      expect(body.content).toBe('This is the content of my note.');
      expect(body.visibility).toBe('private');
      expect(body.is_pinned).toBe(false);
      expect(body.tags).toEqual([]);
      expect(body.embedding_status).toBe('pending');
    });

    it('creates a note with all optional fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: testUserEmail,
          title: 'Full Note',
          content: 'Content here',
          tags: ['work', 'important'],
          visibility: 'public',
          hide_from_agents: true,
          summary: 'A brief summary',
          is_pinned: true,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.tags).toEqual(['work', 'important']);
      expect(body.visibility).toBe('public');
      expect(body.hide_from_agents).toBe(true);
      expect(body.summary).toBe('A brief summary');
      expect(body.is_pinned).toBe(true);
    });

    it('creates a note in a notebook', async () => {
      // Create a notebook first
      const nbResult = await pool.query(`INSERT INTO notebook (namespace, name) VALUES ($1, 'Work Notebook') RETURNING id::text as id`, ['default']);
      const notebook_id = (nbResult.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: testUserEmail,
          title: 'Notebook Note',
          notebook_id: notebook_id,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.notebook_id).toBe(notebook_id);
    });

    it('returns 400 when user_email is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          title: 'No User',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('user_email is required');
    });

    it('returns 400 when title is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: testUserEmail,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('title is required');
    });

    it('returns 400 for invalid visibility', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: testUserEmail,
          title: 'Test',
          visibility: 'invalid',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('Invalid visibility');
    });

    it('returns 400 when notebook does not exist', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: testUserEmail,
          title: 'Test',
          notebook_id: '00000000-0000-0000-0000-000000000000',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('Notebook not found');
    });

    it("returns 403 when adding note to someone else's notebook", async () => {
      // Create a notebook owned by another user
      const nbResult = await pool.query(`INSERT INTO notebook (namespace, name) VALUES ($1, 'Other Notebook') RETURNING id::text as id`, ['other']);
      const notebook_id = (nbResult.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: testUserEmail,
          title: 'Test',
          notebook_id: notebook_id,
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toContain('do not own');
    });
  });

  describe('GET /api/notes', () => {
    beforeEach(async () => {
      // Create some test notes
      await pool.query(
        `INSERT INTO note (namespace, title, content, tags, visibility, is_pinned)
         VALUES
           ($1, 'Note 1', 'Content 1', ARRAY['work'], 'private', false),
           ($1, 'Note 2', 'Content 2', ARRAY['personal'], 'public', true),
           ($1, 'Note 3', 'Content 3', ARRAY['work', 'important'], 'private', false)`,
        ['default'],
      );
    });

    it('lists notes for a user', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/notes',
        query: { user_email: testUserEmail },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.notes).toHaveLength(3);
      expect(body.total).toBe(3);
    });

    it('returns 400 when user_email is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/notes',
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('user_email is required');
    });

    it('filters notes by visibility', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/notes',
        query: { user_email: testUserEmail, visibility: 'public' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.notes).toHaveLength(1);
      expect(body.notes[0].title).toBe('Note 2');
    });

    it('filters notes by tags', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/notes',
        query: { user_email: testUserEmail, tags: 'work' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.notes).toHaveLength(2);
    });

    it('filters notes by isPinned', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/notes',
        query: { user_email: testUserEmail, is_pinned: 'true' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.notes).toHaveLength(1);
      expect(body.notes[0].title).toBe('Note 2');
    });

    it('paginates results', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/notes',
        query: { user_email: testUserEmail, limit: '2', offset: '0' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.notes).toHaveLength(2);
      expect(body.total).toBe(3);
      expect(body.limit).toBe(2);
      expect(body.offset).toBe(0);
    });

    it('sorts notes by title ascending', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/notes',
        query: { user_email: testUserEmail, sort_by: 'title', sort_order: 'asc' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.notes[0].title).toBe('Note 1');
      expect(body.notes[2].title).toBe('Note 3');
    });

    it('can see public notes from other users', async () => {
      // Create a public note from another user
      await pool.query(`INSERT INTO note (namespace, title, visibility) VALUES ($1, 'Public Note', 'public')`, ['other']);

      const res = await app.inject({
        method: 'GET',
        url: '/api/notes',
        query: { user_email: testUserEmail, visibility: 'public' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Should see both our public note and the other user's public note
      expect(body.notes.length).toBeGreaterThanOrEqual(2);
    });

    it('filters notes by notebook', async () => {
      // Create a notebook and a note in it
      const nbResult = await pool.query(`INSERT INTO notebook (namespace, name) VALUES ($1, 'Test Notebook') RETURNING id::text as id`, ['default']);
      const notebook_id = (nbResult.rows[0] as { id: string }).id;

      await pool.query(`INSERT INTO note (namespace, title, notebook_id) VALUES ($1, 'Notebook Note', $2)`, ['default', notebook_id]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/notes',
        query: { user_email: testUserEmail, notebook_id: notebook_id },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.notes).toHaveLength(1);
      expect(body.notes[0].title).toBe('Notebook Note');
    });
  });

  describe('GET /api/notes/:id', () => {
    it('returns a note by ID', async () => {
      const noteResult = await pool.query(`INSERT INTO note (namespace, title, content) VALUES ($1, 'Test Note', 'Content') RETURNING id::text as id`, [
        'default',
      ]);
      const noteId = (noteResult.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}`,
        query: { user_email: testUserEmail },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(noteId);
      expect(body.title).toBe('Test Note');
    });

    it('returns 400 when user_email is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/notes/some-id',
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('user_email is required');
    });

    it('returns 404 for non-existent note', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/notes/00000000-0000-0000-0000-000000000000',
        query: { user_email: testUserEmail },
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 404 when user cannot access note', async () => {
      // Create a private note from another user
      const noteResult = await pool.query(`INSERT INTO note (namespace, title, visibility) VALUES ($1, 'Private', 'private') RETURNING id::text as id`, [
        'other',
      ]);
      const noteId = (noteResult.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}`,
        query: { user_email: testUserEmail },
      });

      expect(res.statusCode).toBe(404);
    });

    it('allows accessing public notes from other users', async () => {
      const noteResult = await pool.query(`INSERT INTO note (namespace, title, visibility) VALUES ($1, 'Public', 'public') RETURNING id::text as id`, [
        'other',
      ]);
      const noteId = (noteResult.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}`,
        query: { user_email: testUserEmail },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().visibility).toBe('public');
    });

    it('includes version count', async () => {
      const noteResult = await pool.query(`INSERT INTO note (namespace, title) VALUES ($1, 'Test') RETURNING id::text as id`, ['default']);
      const noteId = (noteResult.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}`,
        query: { user_email: testUserEmail },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().version_count).toBeDefined();
    });
  });

  describe('PUT /api/notes/:id', () => {
    let noteId: string;

    beforeEach(async () => {
      const result = await pool.query(
        `INSERT INTO note (namespace, title, content, tags)
         VALUES ($1, 'Original Title', 'Original Content', ARRAY['tag1'])
         RETURNING id::text as id`,
        ['default'],
      );
      noteId = (result.rows[0] as { id: string }).id;
    });

    it('updates note fields', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}`,
        payload: {
          user_email: testUserEmail,
          title: 'Updated Title',
          content: 'Updated Content',
          tags: ['tag2', 'tag3'],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.title).toBe('Updated Title');
      expect(body.content).toBe('Updated Content');
      expect(body.tags).toEqual(['tag2', 'tag3']);
    });

    it('returns 400 when user_email is missing', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}`,
        payload: { title: 'New Title' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 404 for non-existent note', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/notes/00000000-0000-0000-0000-000000000000',
        payload: { user_email: testUserEmail, title: 'New' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 403 when user cannot edit note', async () => {
      // Create a private note from another user
      const otherNoteResult = await pool.query(`INSERT INTO note (namespace, title, visibility) VALUES ($1, 'Private', 'private') RETURNING id::text as id`, [
        'other',
      ]);
      const otherNoteId = (otherNoteResult.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'PUT',
        url: `/api/notes/${otherNoteId}`,
        payload: { user_email: testUserEmail, title: 'Hacked' },
      });

      expect(res.statusCode).toBe(403);
    });

    it('allows partial updates', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}`,
        payload: {
          user_email: testUserEmail,
          is_pinned: true,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.is_pinned).toBe(true);
      expect(body.title).toBe('Original Title'); // Unchanged
    });

    it('returns 400 for invalid visibility', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}`,
        payload: {
          user_email: testUserEmail,
          visibility: 'invalid',
        },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('DELETE /api/notes/:id', () => {
    it('soft deletes a note', async () => {
      const noteResult = await pool.query(`INSERT INTO note (namespace, title) VALUES ($1, 'To Delete') RETURNING id::text as id`, ['default']);
      const noteId = (noteResult.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/notes/${noteId}`,
        query: { user_email: testUserEmail },
      });

      expect(res.statusCode).toBe(204);

      // Verify it's soft deleted
      const check = await pool.query('SELECT deleted_at FROM note WHERE id = $1', [noteId]);
      expect(check.rows[0].deleted_at).not.toBeNull();
    });

    it('returns 400 when user_email is missing', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/notes/some-id',
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 404 for non-existent note', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/notes/00000000-0000-0000-0000-000000000000',
        query: { user_email: testUserEmail },
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 403 when non-owner tries to delete', async () => {
      const noteResult = await pool.query(`INSERT INTO note (namespace, title) VALUES ($1, 'Other Note') RETURNING id::text as id`, ['other']);
      const noteId = (noteResult.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/notes/${noteId}`,
        query: { user_email: testUserEmail },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe('POST /api/notes/:id/restore', () => {
    it('restores a soft-deleted note', async () => {
      const noteResult = await pool.query(`INSERT INTO note (namespace, title, deleted_at) VALUES ($1, 'Deleted Note', NOW()) RETURNING id::text as id`, [
        'default',
      ]);
      const noteId = (noteResult.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/restore`,
        payload: { user_email: testUserEmail },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(noteId);
      expect(body.deleted_at).toBeNull();
    });

    it('returns 400 when user_email is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/notes/some-id/restore',
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 404 for non-existent note', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/notes/00000000-0000-0000-0000-000000000000/restore',
        payload: { user_email: testUserEmail },
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 403 when non-owner tries to restore', async () => {
      const noteResult = await pool.query(`INSERT INTO note (namespace, title, deleted_at) VALUES ($1, 'Other Deleted', NOW()) RETURNING id::text as id`, [
        'other',
      ]);
      const noteId = (noteResult.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/restore`,
        payload: { user_email: testUserEmail },
      });

      expect(res.statusCode).toBe(403);
    });

    it('returns 404 when note is not deleted', async () => {
      const noteResult = await pool.query(`INSERT INTO note (namespace, title) VALUES ($1, 'Not Deleted') RETURNING id::text as id`, ['default']);
      const noteId = (noteResult.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/restore`,
        payload: { user_email: testUserEmail },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('Note sharing access', () => {
    it('allows access to shared notes', async () => {
      // Create a private note and share it
      const noteResult = await pool.query(
        `INSERT INTO note (namespace, title, visibility)
         VALUES ($1, 'Shared Note', 'shared')
         RETURNING id::text as id`,
        ['other'],
      );
      const noteId = (noteResult.rows[0] as { id: string }).id;

      // Create a share (must include created_by_email)
      await pool.query(
        `INSERT INTO note_share (note_id, shared_with_email, permission, created_by_email)
         VALUES ($1, $2, 'read', $3)`,
        [noteId, testUserEmail, otherUserEmail],
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}`,
        query: { user_email: testUserEmail },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().title).toBe('Shared Note');
    });

    it('allows editing shared notes with write permission', async () => {
      // Create a private note and share with write access
      const noteResult = await pool.query(
        `INSERT INTO note (namespace, title, visibility)
         VALUES ($1, 'Editable Shared', 'shared')
         RETURNING id::text as id`,
        ['other'],
      );
      const noteId = (noteResult.rows[0] as { id: string }).id;

      await pool.query(
        `INSERT INTO note_share (note_id, shared_with_email, permission, created_by_email)
         VALUES ($1, $2, 'read_write', $3)`,
        [noteId, testUserEmail, otherUserEmail],
      );

      const res = await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}`,
        payload: {
          user_email: testUserEmail,
          title: 'Updated by Collaborator',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().title).toBe('Updated by Collaborator');
    });

    it('prevents editing shared notes with read-only permission', async () => {
      // Create a private note and share with read-only access
      const noteResult = await pool.query(
        `INSERT INTO note (namespace, title, visibility)
         VALUES ($1, 'Read Only Shared', 'shared')
         RETURNING id::text as id`,
        ['other'],
      );
      const noteId = (noteResult.rows[0] as { id: string }).id;

      await pool.query(
        `INSERT INTO note_share (note_id, shared_with_email, permission, created_by_email)
         VALUES ($1, $2, 'read', $3)`,
        [noteId, testUserEmail, otherUserEmail],
      );

      const res = await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}`,
        payload: {
          user_email: testUserEmail,
          title: 'Attempted Edit',
        },
      });

      expect(res.statusCode).toBe(403);
    });
  });
});
