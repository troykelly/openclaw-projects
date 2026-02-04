import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { Pool } from 'pg';
import { existsSync } from 'fs';
import { runMigrate } from './helpers/migrate.ts';

/**
 * Tests for Issue #343 - Note Work Item References Schema
 * Validates migration 043_note_work_item_references
 */
describe('Note Work Item References Schema (Migration 043)', () => {
  let pool: Pool;
  let testNoteId: string;
  let testWorkItemId: string;

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

    // Create test note
    const note = await pool.query(`
      INSERT INTO note (user_email, title, content)
      VALUES ('test@example.com', 'Test Note for References', 'Content')
      RETURNING id
    `);
    testNoteId = note.rows[0].id;

    // Create test work item (work_item table uses title, work_item_kind, status)
    const workItem = await pool.query(`
      INSERT INTO work_item (title, work_item_kind, status)
      VALUES ('Test Project', 'project', 'open')
      RETURNING id
    `);
    testWorkItemId = workItem.rows[0].id;
  });

  afterAll(async () => {
    // Cleanup
    await pool.query('DELETE FROM note_work_item_reference WHERE note_id = $1', [testNoteId]);
    await pool.query('DELETE FROM note WHERE user_email = $1', ['test@example.com']);
    await pool.query('DELETE FROM work_item WHERE id = $1', [testWorkItemId]);
    await pool.end();
  });

  describe('note_work_item_reference table', () => {
    afterEach(async () => {
      await pool.query('DELETE FROM note_work_item_reference WHERE note_id = $1', [testNoteId]);
    });

    it('exists with all required columns', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'note_work_item_reference'
        ORDER BY ordinal_position
      `);

      const columns = result.rows.map((r) => r.column_name);
      expect(columns).toContain('id');
      expect(columns).toContain('note_id');
      expect(columns).toContain('work_item_id');
      expect(columns).toContain('reference_type');
      expect(columns).toContain('description');
      expect(columns).toContain('created_by_email');
      expect(columns).toContain('created_at');
    });

    it('enforces reference_type CHECK constraint', async () => {
      // Valid types should work
      for (const type of ['related', 'documented_by', 'spawned_from', 'meeting_notes']) {
        const result = await pool.query(`
          INSERT INTO note_work_item_reference (note_id, work_item_id, reference_type, created_by_email)
          VALUES ($1, $2, $3, 'test@example.com')
          RETURNING id
        `, [testNoteId, testWorkItemId, type]);
        expect(result.rows[0].id).toBeDefined();

        // Clean up for next iteration
        await pool.query('DELETE FROM note_work_item_reference WHERE note_id = $1', [testNoteId]);
      }

      // Invalid type should fail
      await expect(
        pool.query(`
          INSERT INTO note_work_item_reference (note_id, work_item_id, reference_type, created_by_email)
          VALUES ($1, $2, 'invalid_type', 'test@example.com')
        `, [testNoteId, testWorkItemId])
      ).rejects.toThrow();
    });

    it('enforces unique constraint on (note_id, work_item_id)', async () => {
      await pool.query(`
        INSERT INTO note_work_item_reference (note_id, work_item_id, reference_type, created_by_email)
        VALUES ($1, $2, 'related', 'test@example.com')
      `, [testNoteId, testWorkItemId]);

      // Duplicate should fail
      await expect(
        pool.query(`
          INSERT INTO note_work_item_reference (note_id, work_item_id, reference_type, created_by_email)
          VALUES ($1, $2, 'meeting_notes', 'test@example.com')
        `, [testNoteId, testWorkItemId])
      ).rejects.toThrow();
    });

    it('cascades delete when note is deleted', async () => {
      // Create temporary note
      const tempNote = await pool.query(`
        INSERT INTO note (user_email, title, content)
        VALUES ('test@example.com', 'Temp Note', 'Content')
        RETURNING id
      `);
      const tempNoteId = tempNote.rows[0].id;

      // Create reference
      await pool.query(`
        INSERT INTO note_work_item_reference (note_id, work_item_id, reference_type, created_by_email)
        VALUES ($1, $2, 'related', 'test@example.com')
      `, [tempNoteId, testWorkItemId]);

      // Delete note
      await pool.query('DELETE FROM note WHERE id = $1', [tempNoteId]);

      // Reference should be gone
      const refs = await pool.query('SELECT id FROM note_work_item_reference WHERE note_id = $1', [tempNoteId]);
      expect(refs.rows.length).toBe(0);
    });

    it('cascades delete when work item is deleted', async () => {
      // Create temporary work item
      const tempWorkItem = await pool.query(`
        INSERT INTO work_item (title, work_item_kind, status)
        VALUES ('Temp Work Item', 'issue', 'open')
        RETURNING id
      `);
      const tempWorkItemId = tempWorkItem.rows[0].id;

      // Create reference
      await pool.query(`
        INSERT INTO note_work_item_reference (note_id, work_item_id, reference_type, created_by_email)
        VALUES ($1, $2, 'related', 'test@example.com')
      `, [testNoteId, tempWorkItemId]);

      // Delete work item
      await pool.query('DELETE FROM work_item WHERE id = $1', [tempWorkItemId]);

      // Reference should be gone
      const refs = await pool.query('SELECT id FROM note_work_item_reference WHERE work_item_id = $1', [tempWorkItemId]);
      expect(refs.rows.length).toBe(0);
    });

    it('allows optional description', async () => {
      const withDesc = await pool.query(`
        INSERT INTO note_work_item_reference (note_id, work_item_id, reference_type, created_by_email, description)
        VALUES ($1, $2, 'documented_by', 'test@example.com', 'Technical design document')
        RETURNING description
      `, [testNoteId, testWorkItemId]);
      expect(withDesc.rows[0].description).toBe('Technical design document');

      await pool.query('DELETE FROM note_work_item_reference WHERE note_id = $1', [testNoteId]);

      const withoutDesc = await pool.query(`
        INSERT INTO note_work_item_reference (note_id, work_item_id, reference_type, created_by_email)
        VALUES ($1, $2, 'related', 'test@example.com')
        RETURNING description
      `, [testNoteId, testWorkItemId]);
      expect(withoutDesc.rows[0].description).toBeNull();
    });
  });

  describe('note_with_references view', () => {
    afterEach(async () => {
      await pool.query('DELETE FROM note_work_item_reference WHERE note_id = $1', [testNoteId]);
    });

    it('exists and returns note with empty references array when no refs', async () => {
      const result = await pool.query(`
        SELECT id, title, referenced_work_items
        FROM note_with_references
        WHERE id = $1
      `, [testNoteId]);

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].referenced_work_items).toEqual([]);
    });

    it('includes referenced work items as JSONB array', async () => {
      await pool.query(`
        INSERT INTO note_work_item_reference (note_id, work_item_id, reference_type, created_by_email)
        VALUES ($1, $2, 'documented_by', 'test@example.com')
      `, [testNoteId, testWorkItemId]);

      const result = await pool.query(`
        SELECT referenced_work_items
        FROM note_with_references
        WHERE id = $1
      `, [testNoteId]);

      const refs = result.rows[0].referenced_work_items;
      expect(refs.length).toBe(1);
      expect(refs[0].id).toBe(testWorkItemId);
      expect(refs[0].title).toBe('Test Project');
      expect(refs[0].kind).toBe('project');
      expect(refs[0].referenceType).toBe('documented_by');
    });

    it('excludes soft-deleted notes', async () => {
      // Soft delete the note
      await pool.query('UPDATE note SET deleted_at = NOW() WHERE id = $1', [testNoteId]);

      const result = await pool.query(`
        SELECT id FROM note_with_references WHERE id = $1
      `, [testNoteId]);

      expect(result.rows.length).toBe(0);

      // Restore
      await pool.query('UPDATE note SET deleted_at = NULL WHERE id = $1', [testNoteId]);
    });
  });

  describe('work_item_note_backlinks view', () => {
    afterEach(async () => {
      await pool.query('DELETE FROM note_work_item_reference WHERE note_id = $1', [testNoteId]);
    });

    it('exists and returns work item with empty notes array when no refs', async () => {
      const result = await pool.query(`
        SELECT work_item_id, work_item_title, referencing_notes, note_count
        FROM work_item_note_backlinks
        WHERE work_item_id = $1
      `, [testWorkItemId]);

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].referencing_notes).toEqual([]);
      expect(result.rows[0].note_count).toBe(0);
    });

    it('includes backlinks as JSONB array', async () => {
      await pool.query(`
        INSERT INTO note_work_item_reference (note_id, work_item_id, reference_type, created_by_email)
        VALUES ($1, $2, 'meeting_notes', 'test@example.com')
      `, [testNoteId, testWorkItemId]);

      const result = await pool.query(`
        SELECT referencing_notes, note_count
        FROM work_item_note_backlinks
        WHERE work_item_id = $1
      `, [testWorkItemId]);

      const notes = result.rows[0].referencing_notes;
      expect(notes.length).toBe(1);
      expect(notes[0].id).toBe(testNoteId);
      expect(notes[0].title).toBe('Test Note for References');
      expect(notes[0].referenceType).toBe('meeting_notes');
      expect(result.rows[0].note_count).toBe(1);
    });

    it('excludes soft-deleted work items', async () => {
      // Soft delete work item
      await pool.query('UPDATE work_item SET deleted_at = NOW() WHERE id = $1', [testWorkItemId]);

      const result = await pool.query(`
        SELECT work_item_id FROM work_item_note_backlinks WHERE work_item_id = $1
      `, [testWorkItemId]);

      expect(result.rows.length).toBe(0);

      // Restore
      await pool.query('UPDATE work_item SET deleted_at = NULL WHERE id = $1', [testWorkItemId]);
    });

    it('excludes backlinks from soft-deleted notes', async () => {
      // Create reference
      await pool.query(`
        INSERT INTO note_work_item_reference (note_id, work_item_id, reference_type, created_by_email)
        VALUES ($1, $2, 'related', 'test@example.com')
      `, [testNoteId, testWorkItemId]);

      // Soft delete note
      await pool.query('UPDATE note SET deleted_at = NOW() WHERE id = $1', [testNoteId]);

      const result = await pool.query(`
        SELECT note_count FROM work_item_note_backlinks WHERE work_item_id = $1
      `, [testWorkItemId]);

      expect(result.rows[0].note_count).toBe(0);

      // Restore
      await pool.query('UPDATE note SET deleted_at = NULL WHERE id = $1', [testNoteId]);
    });
  });

  describe('indexes', () => {
    it('has required indexes', async () => {
      const result = await pool.query(`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'note_work_item_reference'
        ORDER BY indexname
      `);

      const indexes = result.rows.map((r) => r.indexname);

      expect(indexes).toContain('idx_note_work_item_ref_note');
      expect(indexes).toContain('idx_note_work_item_ref_work_item');
      expect(indexes).toContain('idx_note_work_item_ref_type');
    });
  });
});
