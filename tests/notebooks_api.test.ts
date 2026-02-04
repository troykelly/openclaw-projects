import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { buildServer } from '../src/api/server.ts';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';

describe('Notebooks CRUD API (Epic #337, Issue #345)', () => {
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
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  describe('POST /api/notebooks', () => {
    it('creates a basic notebook', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/notebooks',
        payload: {
          user_email: testUserEmail,
          name: 'My Notebook',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.name).toBe('My Notebook');
      expect(body.userEmail).toBe(testUserEmail);
      expect(body.isArchived).toBe(false);
      expect(body.parentNotebookId).toBeNull();
      expect(body.noteCount).toBe(0);
    });

    it('creates a notebook with all optional fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/notebooks',
        payload: {
          user_email: testUserEmail,
          name: 'Full Notebook',
          description: 'A detailed description',
          icon: '📓',
          color: '#3b82f6',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.description).toBe('A detailed description');
      expect(body.icon).toBe('📓');
      expect(body.color).toBe('#3b82f6');
    });

    it('creates a child notebook', async () => {
      // Create parent first
      const parentRes = await app.inject({
        method: 'POST',
        url: '/api/notebooks',
        payload: {
          user_email: testUserEmail,
          name: 'Parent',
        },
      });
      const parentId = parentRes.json().id;

      const res = await app.inject({
        method: 'POST',
        url: '/api/notebooks',
        payload: {
          user_email: testUserEmail,
          name: 'Child',
          parent_notebook_id: parentId,
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().parentNotebookId).toBe(parentId);
    });

    it('returns 400 when user_email is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/notebooks',
        payload: { name: 'Test' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('user_email is required');
    });

    it('returns 400 when name is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/notebooks',
        payload: { user_email: testUserEmail },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('name is required');
    });

    it('returns 400 when parent notebook does not exist', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/notebooks',
        payload: {
          user_email: testUserEmail,
          name: 'Test',
          parent_notebook_id: '00000000-0000-0000-0000-000000000000',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('Parent notebook not found');
    });

    it('returns 403 when adding notebook under another user\'s notebook', async () => {
      // Create notebook owned by another user
      const otherResult = await pool.query(
        `INSERT INTO notebook (user_email, name) VALUES ($1, 'Other') RETURNING id::text as id`,
        [otherUserEmail]
      );
      const otherId = (otherResult.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'POST',
        url: '/api/notebooks',
        payload: {
          user_email: testUserEmail,
          name: 'Test',
          parent_notebook_id: otherId,
        },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe('GET /api/notebooks', () => {
    beforeEach(async () => {
      // Create test notebooks
      await pool.query(
        `INSERT INTO notebook (user_email, name, is_archived)
         VALUES
           ($1, 'Notebook 1', false),
           ($1, 'Notebook 2', false),
           ($1, 'Archived', true)`,
        [testUserEmail]
      );
    });

    it('lists notebooks for a user', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/notebooks',
        query: { user_email: testUserEmail },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.notebooks).toHaveLength(2); // Excludes archived by default
      expect(body.total).toBe(2);
    });

    it('returns 400 when user_email is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/notebooks',
      });

      expect(res.statusCode).toBe(400);
    });

    it('includes archived notebooks when requested', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/notebooks',
        query: { user_email: testUserEmail, include_archived: 'true' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().notebooks).toHaveLength(3);
    });

    it('filters by parent_id=null for root notebooks', async () => {
      // Create a child notebook
      const parentResult = await pool.query(
        `SELECT id::text FROM notebook WHERE name = 'Notebook 1'`
      );
      const parentId = (parentResult.rows[0] as { id: string }).id;

      await pool.query(
        `INSERT INTO notebook (user_email, name, parent_notebook_id) VALUES ($1, 'Child', $2)`,
        [testUserEmail, parentId]
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/notebooks',
        query: { user_email: testUserEmail, parent_id: 'null' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.notebooks.every((n: { parentNotebookId: string | null }) => n.parentNotebookId === null)).toBe(true);
    });

    it('includes note counts', async () => {
      // Get first notebook ID
      const nbResult = await pool.query(
        `SELECT id::text FROM notebook WHERE name = 'Notebook 1'`
      );
      const nbId = (nbResult.rows[0] as { id: string }).id;

      // Add notes to it
      await pool.query(
        `INSERT INTO note (user_email, notebook_id, title) VALUES ($1, $2, 'Note 1'), ($1, $2, 'Note 2')`,
        [testUserEmail, nbId]
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/notebooks',
        query: { user_email: testUserEmail },
      });

      expect(res.statusCode).toBe(200);
      const notebooks = res.json().notebooks;
      const nb1 = notebooks.find((n: { name: string }) => n.name === 'Notebook 1');
      expect(nb1.noteCount).toBe(2);
    });
  });

  describe('GET /api/notebooks/tree', () => {
    beforeEach(async () => {
      // Create hierarchical notebooks
      const rootResult = await pool.query(
        `INSERT INTO notebook (user_email, name) VALUES ($1, 'Root') RETURNING id::text as id`,
        [testUserEmail]
      );
      const rootId = (rootResult.rows[0] as { id: string }).id;

      await pool.query(
        `INSERT INTO notebook (user_email, name, parent_notebook_id)
         VALUES ($1, 'Child 1', $2), ($1, 'Child 2', $2)`,
        [testUserEmail, rootId]
      );
    });

    it('returns notebooks as tree structure', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/notebooks/tree',
        query: { user_email: testUserEmail },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.notebooks).toHaveLength(1);
      expect(body.notebooks[0].name).toBe('Root');
      expect(body.notebooks[0].children).toHaveLength(2);
    });

    it('returns 400 when user_email is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/notebooks/tree',
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/notebooks/:id', () => {
    it('returns a notebook by ID', async () => {
      const nbResult = await pool.query(
        `INSERT INTO notebook (user_email, name) VALUES ($1, 'Test') RETURNING id::text as id`,
        [testUserEmail]
      );
      const nbId = (nbResult.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'GET',
        url: `/api/notebooks/${nbId}`,
        query: { user_email: testUserEmail },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe('Test');
    });

    it('returns 400 when user_email is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/notebooks/some-id',
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 404 for non-existent notebook', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/notebooks/00000000-0000-0000-0000-000000000000',
        query: { user_email: testUserEmail },
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 404 for another user\'s notebook', async () => {
      const nbResult = await pool.query(
        `INSERT INTO notebook (user_email, name) VALUES ($1, 'Other') RETURNING id::text as id`,
        [otherUserEmail]
      );
      const nbId = (nbResult.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'GET',
        url: `/api/notebooks/${nbId}`,
        query: { user_email: testUserEmail },
      });

      expect(res.statusCode).toBe(404);
    });

    it('includes notes when requested', async () => {
      const nbResult = await pool.query(
        `INSERT INTO notebook (user_email, name) VALUES ($1, 'Test') RETURNING id::text as id`,
        [testUserEmail]
      );
      const nbId = (nbResult.rows[0] as { id: string }).id;

      await pool.query(
        `INSERT INTO note (user_email, notebook_id, title) VALUES ($1, $2, 'Note 1')`,
        [testUserEmail, nbId]
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/notebooks/${nbId}`,
        query: { user_email: testUserEmail, include_notes: 'true' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().notes).toHaveLength(1);
    });

    it('includes children when requested', async () => {
      const parentResult = await pool.query(
        `INSERT INTO notebook (user_email, name) VALUES ($1, 'Parent') RETURNING id::text as id`,
        [testUserEmail]
      );
      const parentId = (parentResult.rows[0] as { id: string }).id;

      await pool.query(
        `INSERT INTO notebook (user_email, name, parent_notebook_id) VALUES ($1, 'Child', $2)`,
        [testUserEmail, parentId]
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/notebooks/${parentId}`,
        query: { user_email: testUserEmail, include_children: 'true' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().children).toHaveLength(1);
    });
  });

  describe('PUT /api/notebooks/:id', () => {
    let notebookId: string;

    beforeEach(async () => {
      const result = await pool.query(
        `INSERT INTO notebook (user_email, name) VALUES ($1, 'Original') RETURNING id::text as id`,
        [testUserEmail]
      );
      notebookId = (result.rows[0] as { id: string }).id;
    });

    it('updates notebook fields', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/notebooks/${notebookId}`,
        payload: {
          user_email: testUserEmail,
          name: 'Updated',
          description: 'New description',
          icon: '📁',
          color: '#ff0000',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.name).toBe('Updated');
      expect(body.description).toBe('New description');
      expect(body.icon).toBe('📁');
      expect(body.color).toBe('#ff0000');
    });

    it('returns 400 when user_email is missing', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/notebooks/${notebookId}`,
        payload: { name: 'New' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 404 for non-existent notebook', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/notebooks/00000000-0000-0000-0000-000000000000',
        payload: { user_email: testUserEmail, name: 'New' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 403 for another user\'s notebook', async () => {
      const otherResult = await pool.query(
        `INSERT INTO notebook (user_email, name) VALUES ($1, 'Other') RETURNING id::text as id`,
        [otherUserEmail]
      );
      const otherId = (otherResult.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'PUT',
        url: `/api/notebooks/${otherId}`,
        payload: { user_email: testUserEmail, name: 'Hacked' },
      });

      expect(res.statusCode).toBe(403);
    });

    it('prevents circular parent reference', async () => {
      // Create child notebook
      const childResult = await pool.query(
        `INSERT INTO notebook (user_email, name, parent_notebook_id) VALUES ($1, 'Child', $2) RETURNING id::text as id`,
        [testUserEmail, notebookId]
      );
      const childId = (childResult.rows[0] as { id: string }).id;

      // Try to set parent's parent to child
      const res = await app.inject({
        method: 'PUT',
        url: `/api/notebooks/${notebookId}`,
        payload: {
          user_email: testUserEmail,
          parent_notebook_id: childId,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('circular');
    });

    it('allows moving notebook to another parent', async () => {
      const newParentResult = await pool.query(
        `INSERT INTO notebook (user_email, name) VALUES ($1, 'New Parent') RETURNING id::text as id`,
        [testUserEmail]
      );
      const newParentId = (newParentResult.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'PUT',
        url: `/api/notebooks/${notebookId}`,
        payload: {
          user_email: testUserEmail,
          parent_notebook_id: newParentId,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().parentNotebookId).toBe(newParentId);
    });
  });

  describe('POST /api/notebooks/:id/archive', () => {
    it('archives a notebook', async () => {
      const nbResult = await pool.query(
        `INSERT INTO notebook (user_email, name) VALUES ($1, 'Test') RETURNING id::text as id`,
        [testUserEmail]
      );
      const nbId = (nbResult.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/notebooks/${nbId}/archive`,
        payload: { user_email: testUserEmail },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().isArchived).toBe(true);
    });

    it('returns 400 when user_email is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/notebooks/some-id/archive',
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 403 for another user\'s notebook', async () => {
      const nbResult = await pool.query(
        `INSERT INTO notebook (user_email, name) VALUES ($1, 'Other') RETURNING id::text as id`,
        [otherUserEmail]
      );
      const nbId = (nbResult.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/notebooks/${nbId}/archive`,
        payload: { user_email: testUserEmail },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe('POST /api/notebooks/:id/unarchive', () => {
    it('unarchives a notebook', async () => {
      const nbResult = await pool.query(
        `INSERT INTO notebook (user_email, name, is_archived) VALUES ($1, 'Test', true) RETURNING id::text as id`,
        [testUserEmail]
      );
      const nbId = (nbResult.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/notebooks/${nbId}/unarchive`,
        payload: { user_email: testUserEmail },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().isArchived).toBe(false);
    });
  });

  describe('DELETE /api/notebooks/:id', () => {
    it('soft deletes a notebook and moves notes to root', async () => {
      const nbResult = await pool.query(
        `INSERT INTO notebook (user_email, name) VALUES ($1, 'Test') RETURNING id::text as id`,
        [testUserEmail]
      );
      const nbId = (nbResult.rows[0] as { id: string }).id;

      // Add a note to the notebook
      await pool.query(
        `INSERT INTO note (user_email, notebook_id, title) VALUES ($1, $2, 'Note')`,
        [testUserEmail, nbId]
      );

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/notebooks/${nbId}`,
        query: { user_email: testUserEmail },
      });

      expect(res.statusCode).toBe(204);

      // Verify notebook is deleted
      const nbCheck = await pool.query(
        'SELECT deleted_at FROM notebook WHERE id = $1',
        [nbId]
      );
      expect(nbCheck.rows[0].deleted_at).not.toBeNull();

      // Verify note is moved to root
      const noteCheck = await pool.query(
        'SELECT notebook_id FROM note WHERE user_email = $1',
        [testUserEmail]
      );
      expect(noteCheck.rows[0].notebook_id).toBeNull();
    });

    it('deletes notes when delete_notes=true', async () => {
      const nbResult = await pool.query(
        `INSERT INTO notebook (user_email, name) VALUES ($1, 'Test') RETURNING id::text as id`,
        [testUserEmail]
      );
      const nbId = (nbResult.rows[0] as { id: string }).id;

      await pool.query(
        `INSERT INTO note (user_email, notebook_id, title) VALUES ($1, $2, 'Note')`,
        [testUserEmail, nbId]
      );

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/notebooks/${nbId}`,
        query: { user_email: testUserEmail, delete_notes: 'true' },
      });

      expect(res.statusCode).toBe(204);

      // Verify note is deleted
      const noteCheck = await pool.query(
        'SELECT deleted_at FROM note WHERE user_email = $1',
        [testUserEmail]
      );
      expect(noteCheck.rows[0].deleted_at).not.toBeNull();
    });

    it('returns 400 when user_email is missing', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/notebooks/some-id',
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 404 for non-existent notebook', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/notebooks/00000000-0000-0000-0000-000000000000',
        query: { user_email: testUserEmail },
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 403 for another user\'s notebook', async () => {
      const nbResult = await pool.query(
        `INSERT INTO notebook (user_email, name) VALUES ($1, 'Other') RETURNING id::text as id`,
        [otherUserEmail]
      );
      const nbId = (nbResult.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/notebooks/${nbId}`,
        query: { user_email: testUserEmail },
      });

      expect(res.statusCode).toBe(403);
    });

    it('moves child notebooks to parent when deleted', async () => {
      // Create parent -> child structure
      const parentResult = await pool.query(
        `INSERT INTO notebook (user_email, name) VALUES ($1, 'Parent') RETURNING id::text as id`,
        [testUserEmail]
      );
      const parentId = (parentResult.rows[0] as { id: string }).id;

      const childResult = await pool.query(
        `INSERT INTO notebook (user_email, name, parent_notebook_id) VALUES ($1, 'Child', $2) RETURNING id::text as id`,
        [testUserEmail, parentId]
      );
      const childId = (childResult.rows[0] as { id: string }).id;

      await pool.query(
        `INSERT INTO notebook (user_email, name, parent_notebook_id) VALUES ($1, 'Grandchild', $2)`,
        [testUserEmail, childId]
      );

      // Delete the child
      await app.inject({
        method: 'DELETE',
        url: `/api/notebooks/${childId}`,
        query: { user_email: testUserEmail },
      });

      // Verify grandchild is now under parent
      const gcCheck = await pool.query(
        `SELECT parent_notebook_id FROM notebook WHERE name = 'Grandchild'`
      );
      expect(gcCheck.rows[0].parent_notebook_id).toBe(parentId);
    });
  });

  describe('POST /api/notebooks/:id/notes', () => {
    let notebookId: string;
    let noteId: string;

    beforeEach(async () => {
      const nbResult = await pool.query(
        `INSERT INTO notebook (user_email, name) VALUES ($1, 'Target') RETURNING id::text as id`,
        [testUserEmail]
      );
      notebookId = (nbResult.rows[0] as { id: string }).id;

      const noteResult = await pool.query(
        `INSERT INTO note (user_email, title, content) VALUES ($1, 'Note', 'Content') RETURNING id::text as id`,
        [testUserEmail]
      );
      noteId = (noteResult.rows[0] as { id: string }).id;
    });

    it('moves notes to notebook', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/notebooks/${notebookId}/notes`,
        payload: {
          user_email: testUserEmail,
          note_ids: [noteId],
          action: 'move',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().moved).toContain(noteId);
      expect(res.json().failed).toHaveLength(0);

      // Verify note is in notebook
      const check = await pool.query(
        'SELECT notebook_id FROM note WHERE id = $1',
        [noteId]
      );
      expect(check.rows[0].notebook_id).toBe(notebookId);
    });

    it('copies notes to notebook', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/notebooks/${notebookId}/notes`,
        payload: {
          user_email: testUserEmail,
          note_ids: [noteId],
          action: 'copy',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().moved).toHaveLength(1);
      expect(res.json().moved[0]).not.toBe(noteId); // New ID

      // Verify original note unchanged
      const check = await pool.query(
        'SELECT notebook_id FROM note WHERE id = $1',
        [noteId]
      );
      expect(check.rows[0].notebook_id).toBeNull();
    });

    it('returns 400 when user_email is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/notebooks/${notebookId}/notes`,
        payload: { note_ids: [noteId], action: 'move' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when note_ids is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/notebooks/${notebookId}/notes`,
        payload: { user_email: testUserEmail, action: 'move' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for invalid action', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/notebooks/${notebookId}/notes`,
        payload: {
          user_email: testUserEmail,
          note_ids: [noteId],
          action: 'invalid',
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 403 for another user\'s notebook', async () => {
      const otherNbResult = await pool.query(
        `INSERT INTO notebook (user_email, name) VALUES ($1, 'Other') RETURNING id::text as id`,
        [otherUserEmail]
      );
      const otherNbId = (otherNbResult.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/notebooks/${otherNbId}/notes`,
        payload: {
          user_email: testUserEmail,
          note_ids: [noteId],
          action: 'move',
        },
      });

      expect(res.statusCode).toBe(403);
    });

    it('fails for notes user does not own', async () => {
      const otherNoteResult = await pool.query(
        `INSERT INTO note (user_email, title) VALUES ($1, 'Other') RETURNING id::text as id`,
        [otherUserEmail]
      );
      const otherNoteId = (otherNoteResult.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/notebooks/${notebookId}/notes`,
        payload: {
          user_email: testUserEmail,
          note_ids: [otherNoteId],
          action: 'move',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().failed).toContain(otherNoteId);
    });
  });
});
