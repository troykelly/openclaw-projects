import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { Pool } from 'pg';
import { createTestPool } from './helpers/db.ts';
import { runMigrate } from './helpers/migrate.ts';

/**
 * Tests for Issue #342 - Note Versions Table for History Tracking
 * Validates migration 042_note_versions_schema
 */
describe('Note Versions Schema (Migration 042)', () => {
  let pool: Pool;
  let testNoteId: string;

  beforeAll(async () => {
    pool = createTestPool();

    // Ensure migrations are applied
    await runMigrate('up');

    // Create test note
    const note = await pool.query(`
      INSERT INTO note (user_email, title, content)
      VALUES ('test@example.com', 'Test Note for Versions', 'Initial content')
      RETURNING id
    `);
    testNoteId = note.rows[0].id;
  });

  afterAll(async () => {
    // Cleanup test data
    await pool.query('DELETE FROM note_version WHERE note_id = $1', [testNoteId]);
    await pool.query('DELETE FROM note WHERE user_email = $1', ['test@example.com']);
    await pool.end();
  });

  describe('note_version table', () => {
    afterEach(async () => {
      // Clean up versions after each test (except ones created by trigger)
      await pool.query('DELETE FROM note_version WHERE note_id = $1', [testNoteId]);
    });

    it('exists with all required columns', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'note_version'
        ORDER BY ordinal_position
      `);

      const columns = result.rows.map((r) => r.column_name);
      expect(columns).toContain('id');
      expect(columns).toContain('note_id');
      expect(columns).toContain('version_number');
      expect(columns).toContain('title');
      expect(columns).toContain('content');
      expect(columns).toContain('summary');
      expect(columns).toContain('changed_by_email');
      expect(columns).toContain('change_type');
      expect(columns).toContain('change_summary');
      expect(columns).toContain('diff_from_previous');
      expect(columns).toContain('created_at');
    });

    it('enforces change_type CHECK constraint', async () => {
      // Valid types should work
      const valid = await pool.query(
        `
        INSERT INTO note_version (note_id, version_number, title, content, changed_by_email, change_type)
        VALUES ($1, 100, 'Test', 'Content', 'user@example.com', 'edit')
        RETURNING id
      `,
        [testNoteId],
      );
      expect(valid.rows[0].id).toBeDefined();

      // Invalid type should fail
      await expect(
        pool.query(
          `
          INSERT INTO note_version (note_id, version_number, title, content, changed_by_email, change_type)
          VALUES ($1, 101, 'Test', 'Content', 'user@example.com', 'invalid_type')
        `,
          [testNoteId],
        ),
      ).rejects.toThrow();
    });

    it('enforces unique constraint on (note_id, version_number)', async () => {
      await pool.query(
        `
        INSERT INTO note_version (note_id, version_number, title, content, changed_by_email, change_type)
        VALUES ($1, 200, 'Test', 'Content', 'user@example.com', 'edit')
      `,
        [testNoteId],
      );

      // Duplicate version number should fail
      await expect(
        pool.query(
          `
          INSERT INTO note_version (note_id, version_number, title, content, changed_by_email, change_type)
          VALUES ($1, 200, 'Test2', 'Content2', 'user@example.com', 'edit')
        `,
          [testNoteId],
        ),
      ).rejects.toThrow();
    });

    it('cascades delete when note is deleted', async () => {
      // Create a temporary note
      const tempNote = await pool.query(`
        INSERT INTO note (user_email, title, content)
        VALUES ('test@example.com', 'Temp Note for Cascade', 'Content')
        RETURNING id
      `);
      const tempNoteId = tempNote.rows[0].id;

      // Create a version
      await pool.query(
        `
        INSERT INTO note_version (note_id, version_number, title, content, changed_by_email, change_type)
        VALUES ($1, 1, 'Temp', 'Content', 'user@example.com', 'create')
      `,
        [tempNoteId],
      );

      // Delete the note
      await pool.query('DELETE FROM note WHERE id = $1', [tempNoteId]);

      // Version should be gone
      const versions = await pool.query('SELECT id FROM note_version WHERE note_id = $1', [tempNoteId]);
      expect(versions.rows.length).toBe(0);
    });

    it('stores diff_from_previous as JSONB', async () => {
      const diff = { ops: [{ op: 'replace', path: '/content', value: 'new content' }] };
      const result = await pool.query(
        `
        INSERT INTO note_version (note_id, version_number, title, content, changed_by_email, change_type, diff_from_previous)
        VALUES ($1, 300, 'Test', 'Content', 'user@example.com', 'edit', $2)
        RETURNING diff_from_previous
      `,
        [testNoteId, JSON.stringify(diff)],
      );

      expect(result.rows[0].diff_from_previous).toEqual(diff);
    });
  });

  describe('auto-versioning trigger', () => {
    let versionTestNoteId: string;

    beforeEach(async () => {
      // Create a fresh note for trigger tests
      const note = await pool.query(`
        INSERT INTO note (user_email, title, content)
        VALUES ('trigger-test@example.com', 'Trigger Test Note', 'Original content')
        RETURNING id
      `);
      versionTestNoteId = note.rows[0].id;
    });

    afterEach(async () => {
      await pool.query('DELETE FROM note_version WHERE note_id = $1', [versionTestNoteId]);
      await pool.query('DELETE FROM note WHERE id = $1', [versionTestNoteId]);
    });

    it('creates version when content changes', async () => {
      // Update content
      await pool.query(
        `
        UPDATE note SET content = 'Updated content' WHERE id = $1
      `,
        [versionTestNoteId],
      );

      // Should have created a version with the OLD content
      const versions = await pool.query(
        `
        SELECT title, content, change_type FROM note_version
        WHERE note_id = $1 ORDER BY version_number
      `,
        [versionTestNoteId],
      );

      expect(versions.rows.length).toBe(1);
      expect(versions.rows[0].content).toBe('Original content');
      expect(versions.rows[0].change_type).toBe('edit');
    });

    it('creates version when title changes', async () => {
      await pool.query(
        `
        UPDATE note SET title = 'Updated Title' WHERE id = $1
      `,
        [versionTestNoteId],
      );

      const versions = await pool.query(
        `
        SELECT title FROM note_version WHERE note_id = $1
      `,
        [versionTestNoteId],
      );

      expect(versions.rows.length).toBe(1);
      expect(versions.rows[0].title).toBe('Trigger Test Note');
    });

    it('does NOT create version when other fields change', async () => {
      // Update only tags (not content or title)
      await pool.query(
        `
        UPDATE note SET tags = ARRAY['test'] WHERE id = $1
      `,
        [versionTestNoteId],
      );

      const versions = await pool.query(
        `
        SELECT id FROM note_version WHERE note_id = $1
      `,
        [versionTestNoteId],
      );

      expect(versions.rows.length).toBe(0);
    });

    it('increments version number correctly', async () => {
      // Make multiple content changes
      await pool.query('UPDATE note SET content = $1 WHERE id = $2', ['Change 1', versionTestNoteId]);
      await pool.query('UPDATE note SET content = $1 WHERE id = $2', ['Change 2', versionTestNoteId]);
      await pool.query('UPDATE note SET content = $1 WHERE id = $2', ['Change 3', versionTestNoteId]);

      const versions = await pool.query(
        `
        SELECT version_number, content FROM note_version
        WHERE note_id = $1 ORDER BY version_number
      `,
        [versionTestNoteId],
      );

      expect(versions.rows.length).toBe(3);
      expect(versions.rows[0].version_number).toBe(1);
      expect(versions.rows[1].version_number).toBe(2);
      expect(versions.rows[2].version_number).toBe(3);
    });

    it('uses session setting for changed_by_email when available', async () => {
      // Set session variable and update in same transaction
      // (set_config with 'true' is local to the transaction)
      // Using separate connection to maintain transaction state
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.current_user_email', 'session-user@example.com', true)`);
        await client.query('UPDATE note SET content = $1 WHERE id = $2', ['Updated by session user', versionTestNoteId]);
        await client.query('COMMIT');
      } finally {
        client.release();
      }

      const versions = await pool.query(
        `
        SELECT changed_by_email FROM note_version WHERE note_id = $1
      `,
        [versionTestNoteId],
      );

      expect(versions.rows[0].changed_by_email).toBe('session-user@example.com');
    });

    it('defaults to system when no session user', async () => {
      // Reset session variable
      await pool.query(`SELECT set_config('app.current_user_email', '', true)`);

      await pool.query(
        `
        UPDATE note SET content = 'Updated without session user' WHERE id = $1
      `,
        [versionTestNoteId],
      );

      const versions = await pool.query(
        `
        SELECT changed_by_email FROM note_version WHERE note_id = $1
      `,
        [versionTestNoteId],
      );

      expect(versions.rows[0].changed_by_email).toBe('system');
    });
  });

  describe('indexes', () => {
    it('has required indexes', async () => {
      const result = await pool.query(`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'note_version'
        ORDER BY indexname
      `);

      const indexes = result.rows.map((r) => r.indexname);

      expect(indexes).toContain('idx_note_version_note_id');
      expect(indexes).toContain('idx_note_version_created_at');
      // Unique constraint creates an index automatically
      expect(indexes.some((i) => i.includes('note_id') && i.includes('version_number'))).toBe(true);
    });
  });

  describe('get_note_version() function', () => {
    let funcTestNoteId: string;

    beforeAll(async () => {
      // Create note with versions
      const note = await pool.query(`
        INSERT INTO note (user_email, title, content)
        VALUES ('func-test@example.com', 'Function Test', 'v1 content')
        RETURNING id
      `);
      funcTestNoteId = note.rows[0].id;

      await pool.query('UPDATE note SET content = $1 WHERE id = $2', ['v2 content', funcTestNoteId]);
      await pool.query('UPDATE note SET content = $1 WHERE id = $2', ['v3 content', funcTestNoteId]);
    });

    afterAll(async () => {
      await pool.query('DELETE FROM note_version WHERE note_id = $1', [funcTestNoteId]);
      await pool.query('DELETE FROM note WHERE id = $1', [funcTestNoteId]);
    });

    it('returns specific version content', async () => {
      const result = await pool.query(
        `
        SELECT * FROM get_note_version($1, 1)
      `,
        [funcTestNoteId],
      );

      expect(result.rows[0].content).toBe('v1 content');
    });

    it('returns null for non-existent version', async () => {
      const result = await pool.query(
        `
        SELECT * FROM get_note_version($1, 999)
      `,
        [funcTestNoteId],
      );

      expect(result.rows.length).toBe(0);
    });
  });

  describe('get_note_version_count() function', () => {
    it('returns correct version count', async () => {
      // Create note with known version count
      const note = await pool.query(`
        INSERT INTO note (user_email, title, content)
        VALUES ('count-test@example.com', 'Count Test', 'initial')
        RETURNING id
      `);
      const noteId = note.rows[0].id;

      await pool.query('UPDATE note SET content = $1 WHERE id = $2', ['change1', noteId]);
      await pool.query('UPDATE note SET content = $1 WHERE id = $2', ['change2', noteId]);

      const result = await pool.query('SELECT get_note_version_count($1)', [noteId]);
      expect(result.rows[0].get_note_version_count).toBe(2);

      // Cleanup
      await pool.query('DELETE FROM note_version WHERE note_id = $1', [noteId]);
      await pool.query('DELETE FROM note WHERE id = $1', [noteId]);
    });
  });
});
