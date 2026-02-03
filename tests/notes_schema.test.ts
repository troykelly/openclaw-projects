import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { existsSync } from 'fs';
import { runMigrate, migrationCount } from './helpers/migrate.js';

/**
 * Tests for Issue #340 - Notes and Notebooks Database Schema
 * Validates migration 040_notes_notebooks_schema
 */
describe('Notes and Notebooks Schema (Migration 040)', () => {
  let pool: Pool;

  beforeAll(async () => {
    const defaultHost = existsSync('/.dockerenv') ? 'postgres' : 'localhost';
    const host = process.env.PGHOST || defaultHost;

    pool = new Pool({
      host,
      port: parseInt(process.env.PGPORT || '5432', 10),
      user: process.env.PGUSER || 'openclaw',
      password: process.env.PGPASSWORD || 'openclaw',
      database: process.env.PGDATABASE || 'openclaw',
    });

    // Ensure migrations are applied
    await runMigrate('up');
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('notebook table', () => {
    it('exists with all required columns', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = 'notebook'
        ORDER BY ordinal_position
      `);

      const columns = result.rows.map((r) => r.column_name);
      expect(columns).toContain('id');
      expect(columns).toContain('user_email');
      expect(columns).toContain('name');
      expect(columns).toContain('description');
      expect(columns).toContain('icon');
      expect(columns).toContain('color');
      expect(columns).toContain('parent_notebook_id');
      expect(columns).toContain('sort_order');
      expect(columns).toContain('is_archived');
      expect(columns).toContain('deleted_at');
      expect(columns).toContain('created_at');
      expect(columns).toContain('updated_at');
    });

    it('supports hierarchical structure via parent_notebook_id', async () => {
      // Create parent notebook
      const parent = await pool.query(`
        INSERT INTO notebook (user_email, name)
        VALUES ('test@example.com', 'Parent Notebook')
        RETURNING id
      `);
      const parentId = parent.rows[0].id;

      // Create child notebook
      const child = await pool.query(`
        INSERT INTO notebook (user_email, name, parent_notebook_id)
        VALUES ('test@example.com', 'Child Notebook', $1)
        RETURNING id, parent_notebook_id
      `, [parentId]);

      expect(child.rows[0].parent_notebook_id).toBe(parentId);

      // Cleanup
      await pool.query('DELETE FROM notebook WHERE user_email = $1', ['test@example.com']);
    });

    it('auto-updates updated_at timestamp on modification', async () => {
      // Create notebook
      const created = await pool.query(`
        INSERT INTO notebook (user_email, name)
        VALUES ('test@example.com', 'Test Notebook')
        RETURNING id, created_at, updated_at
      `);
      const id = created.rows[0].id;
      const originalUpdatedAt = created.rows[0].updated_at;

      // Wait a moment then update
      await new Promise((resolve) => setTimeout(resolve, 10));
      await pool.query(`
        UPDATE notebook SET name = 'Updated Name' WHERE id = $1
      `, [id]);

      // Check updated_at changed
      const updated = await pool.query('SELECT updated_at FROM notebook WHERE id = $1', [id]);
      expect(updated.rows[0].updated_at.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());

      // Cleanup
      await pool.query('DELETE FROM notebook WHERE id = $1', [id]);
    });
  });

  describe('note table', () => {
    let notebookId: string;

    beforeAll(async () => {
      // Create a test notebook for note tests
      const result = await pool.query(`
        INSERT INTO notebook (user_email, name)
        VALUES ('test@example.com', 'Test Notebook for Notes')
        RETURNING id
      `);
      notebookId = result.rows[0].id;
    });

    afterAll(async () => {
      // Cleanup test data
      await pool.query('DELETE FROM note WHERE user_email = $1', ['test@example.com']);
      await pool.query('DELETE FROM notebook WHERE user_email = $1', ['test@example.com']);
    });

    it('exists with all required columns', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'note'
        ORDER BY ordinal_position
      `);

      const columns = result.rows.map((r) => r.column_name);
      expect(columns).toContain('id');
      expect(columns).toContain('notebook_id');
      expect(columns).toContain('user_email');
      expect(columns).toContain('title');
      expect(columns).toContain('content');
      expect(columns).toContain('summary');
      expect(columns).toContain('tags');
      expect(columns).toContain('is_pinned');
      expect(columns).toContain('sort_order');
      expect(columns).toContain('visibility');
      expect(columns).toContain('hide_from_agents');
      expect(columns).toContain('embedding');
      expect(columns).toContain('embedding_model');
      expect(columns).toContain('embedding_provider');
      expect(columns).toContain('embedding_status');
      expect(columns).toContain('search_vector');
      expect(columns).toContain('deleted_at');
      expect(columns).toContain('created_at');
      expect(columns).toContain('updated_at');
    });

    it('enforces visibility CHECK constraint', async () => {
      // Valid values should work
      const valid = await pool.query(`
        INSERT INTO note (user_email, title, visibility)
        VALUES ('test@example.com', 'Private Note', 'private')
        RETURNING id
      `);
      expect(valid.rows[0].id).toBeDefined();

      // Invalid value should fail
      await expect(
        pool.query(`
          INSERT INTO note (user_email, title, visibility)
          VALUES ('test@example.com', 'Bad Note', 'invalid_visibility')
        `)
      ).rejects.toThrow();
    });

    it('enforces embedding_status CHECK constraint', async () => {
      // Valid status should work
      const valid = await pool.query(`
        INSERT INTO note (user_email, title, embedding_status)
        VALUES ('test@example.com', 'Pending Note', 'pending')
        RETURNING id
      `);
      expect(valid.rows[0].id).toBeDefined();

      // Invalid status should fail
      await expect(
        pool.query(`
          INSERT INTO note (user_email, title, embedding_status)
          VALUES ('test@example.com', 'Bad Note', 'invalid_status')
        `)
      ).rejects.toThrow();
    });

    it('auto-updates search_vector on insert and update', async () => {
      const created = await pool.query(`
        INSERT INTO note (user_email, title, content, summary)
        VALUES ('test@example.com', 'Search Test', 'This is the content', 'Brief summary')
        RETURNING id, search_vector
      `);
      const id = created.rows[0].id;

      // search_vector should be populated
      expect(created.rows[0].search_vector).not.toBeNull();

      // Verify it's searchable
      const search = await pool.query(`
        SELECT id FROM note
        WHERE search_vector @@ to_tsquery('english', 'Search')
        AND id = $1
      `, [id]);
      expect(search.rows.length).toBe(1);
    });

    it('auto-updates updated_at timestamp on modification', async () => {
      const created = await pool.query(`
        INSERT INTO note (user_email, title, content)
        VALUES ('test@example.com', 'Update Test', 'Initial content')
        RETURNING id, updated_at
      `);
      const id = created.rows[0].id;
      const originalUpdatedAt = created.rows[0].updated_at;

      await new Promise((resolve) => setTimeout(resolve, 10));
      await pool.query('UPDATE note SET title = $1 WHERE id = $2', ['New Title', id]);

      const updated = await pool.query('SELECT updated_at FROM note WHERE id = $1', [id]);
      expect(updated.rows[0].updated_at.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
    });

    it('resets embedding to pending when content changes', async () => {
      // Create note with complete embedding
      const created = await pool.query(`
        INSERT INTO note (user_email, title, content, embedding_status)
        VALUES ('test@example.com', 'Embedding Test', 'Initial content', 'complete')
        RETURNING id
      `);
      const id = created.rows[0].id;

      // Update content
      await pool.query('UPDATE note SET content = $1 WHERE id = $2', ['Changed content', id]);

      // Check embedding_status is reset to pending
      const updated = await pool.query('SELECT embedding_status, embedding FROM note WHERE id = $1', [id]);
      expect(updated.rows[0].embedding_status).toBe('pending');
      expect(updated.rows[0].embedding).toBeNull();
    });

    it('can associate note with notebook', async () => {
      const created = await pool.query(`
        INSERT INTO note (user_email, title, notebook_id)
        VALUES ('test@example.com', 'Notebook Note', $1)
        RETURNING id, notebook_id
      `, [notebookId]);

      expect(created.rows[0].notebook_id).toBe(notebookId);
    });

    it('supports tags array', async () => {
      const created = await pool.query(`
        INSERT INTO note (user_email, title, tags)
        VALUES ('test@example.com', 'Tagged Note', ARRAY['work', 'important', 'meeting'])
        RETURNING id, tags
      `);

      expect(created.rows[0].tags).toEqual(['work', 'important', 'meeting']);

      // Test GIN index with containment query
      const search = await pool.query(`
        SELECT id FROM note WHERE tags @> ARRAY['work', 'meeting']
      `);
      expect(search.rows.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('active views', () => {
    let noteId: string;
    let notebookId: string;

    beforeAll(async () => {
      // Create test data
      const notebook = await pool.query(`
        INSERT INTO notebook (user_email, name)
        VALUES ('test@example.com', 'View Test Notebook')
        RETURNING id
      `);
      notebookId = notebook.rows[0].id;

      const note = await pool.query(`
        INSERT INTO note (user_email, title)
        VALUES ('test@example.com', 'View Test Note')
        RETURNING id
      `);
      noteId = note.rows[0].id;
    });

    afterAll(async () => {
      await pool.query('DELETE FROM note WHERE user_email = $1', ['test@example.com']);
      await pool.query('DELETE FROM notebook WHERE user_email = $1', ['test@example.com']);
    });

    it('note_active excludes soft-deleted notes', async () => {
      // Soft delete the note
      await pool.query('UPDATE note SET deleted_at = NOW() WHERE id = $1', [noteId]);

      // note_active should not contain it
      const active = await pool.query('SELECT id FROM note_active WHERE id = $1', [noteId]);
      expect(active.rows.length).toBe(0);

      // note_trash should contain it
      const trash = await pool.query('SELECT id FROM note_trash WHERE id = $1', [noteId]);
      expect(trash.rows.length).toBe(1);

      // Restore
      await pool.query('UPDATE note SET deleted_at = NULL WHERE id = $1', [noteId]);
    });

    it('notebook_active excludes soft-deleted notebooks', async () => {
      // Soft delete
      await pool.query('UPDATE notebook SET deleted_at = NOW() WHERE id = $1', [notebookId]);

      // notebook_active should not contain it
      const active = await pool.query('SELECT id FROM notebook_active WHERE id = $1', [notebookId]);
      expect(active.rows.length).toBe(0);

      // notebook_trash should contain it
      const trash = await pool.query('SELECT id FROM notebook_trash WHERE id = $1', [notebookId]);
      expect(trash.rows.length).toBe(1);

      // Restore
      await pool.query('UPDATE notebook SET deleted_at = NULL WHERE id = $1', [notebookId]);
    });
  });

  describe('indexes', () => {
    it('has required indexes', async () => {
      const result = await pool.query(`
        SELECT indexname FROM pg_indexes
        WHERE tablename IN ('note', 'notebook')
        ORDER BY indexname
      `);

      const indexes = result.rows.map((r) => r.indexname);

      // Notebook indexes
      expect(indexes).toContain('idx_notebook_user_email');
      expect(indexes).toContain('idx_notebook_parent');
      expect(indexes).toContain('idx_notebook_user_not_deleted');

      // Note indexes
      expect(indexes).toContain('idx_note_notebook_id');
      expect(indexes).toContain('idx_note_user_email');
      expect(indexes).toContain('idx_note_visibility');
      expect(indexes).toContain('idx_note_user_not_deleted');
      expect(indexes).toContain('idx_note_created_at');
      expect(indexes).toContain('idx_note_updated_at');
      expect(indexes).toContain('idx_note_pinned');
      expect(indexes).toContain('idx_note_tags');
      expect(indexes).toContain('idx_note_search_vector');
      expect(indexes).toContain('idx_note_embedding');
      expect(indexes).toContain('idx_note_embedding_pending');
    });
  });
});
