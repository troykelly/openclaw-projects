import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { Pool } from 'pg';
import { existsSync } from 'fs';
import { runMigrate } from './helpers/migrate.ts';

/**
 * Tests for Issue #341 - Note Sharing and Permissions Schema
 * Validates migration 041_note_sharing_schema
 */
describe('Note Sharing Schema (Migration 041)', () => {
  let pool: Pool;
  let testNoteId: string;
  let testNotebookId: string;

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

    // Create test notebook and note for sharing tests
    const notebook = await pool.query(`
      INSERT INTO notebook (user_email, name)
      VALUES ('owner@example.com', 'Test Notebook for Sharing')
      RETURNING id
    `);
    testNotebookId = notebook.rows[0].id;

    const note = await pool.query(`
      INSERT INTO note (user_email, title, content, notebook_id, visibility)
      VALUES ('owner@example.com', 'Test Note', 'Test content', $1, 'shared')
      RETURNING id
    `, [testNotebookId]);
    testNoteId = note.rows[0].id;
  });

  afterAll(async () => {
    // Cleanup test data
    await pool.query('DELETE FROM note_collaborator WHERE note_id = $1', [testNoteId]);
    await pool.query('DELETE FROM note_share WHERE note_id = $1', [testNoteId]);
    await pool.query('DELETE FROM notebook_share WHERE notebook_id = $1', [testNotebookId]);
    await pool.query('DELETE FROM note WHERE user_email = $1', ['owner@example.com']);
    await pool.query('DELETE FROM notebook WHERE user_email = $1', ['owner@example.com']);
    await pool.end();
  });

  describe('note_share table', () => {
    afterEach(async () => {
      // Clean up shares after each test
      await pool.query('DELETE FROM note_share WHERE note_id = $1', [testNoteId]);
    });

    it('exists with all required columns', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'note_share'
        ORDER BY ordinal_position
      `);

      const columns = result.rows.map((r) => r.column_name);
      expect(columns).toContain('id');
      expect(columns).toContain('note_id');
      expect(columns).toContain('shared_with_email');
      expect(columns).toContain('share_link_token');
      expect(columns).toContain('permission');
      expect(columns).toContain('is_single_view');
      expect(columns).toContain('view_count');
      expect(columns).toContain('max_views');
      expect(columns).toContain('expires_at');
      expect(columns).toContain('created_by_email');
      expect(columns).toContain('note_title_snapshot');
      expect(columns).toContain('created_at');
      expect(columns).toContain('last_accessed_at');
    });

    it('enforces permission CHECK constraint', async () => {
      // Valid permission should work
      const valid = await pool.query(`
        INSERT INTO note_share (note_id, shared_with_email, permission, created_by_email)
        VALUES ($1, 'reader@example.com', 'read', 'owner@example.com')
        RETURNING id
      `, [testNoteId]);
      expect(valid.rows[0].id).toBeDefined();

      // Invalid permission should fail
      await expect(
        pool.query(`
          INSERT INTO note_share (note_id, shared_with_email, permission, created_by_email)
          VALUES ($1, 'bad@example.com', 'admin', 'owner@example.com')
        `, [testNoteId])
      ).rejects.toThrow();
    });

    it('requires at least one target (shared_with_email or share_link_token)', async () => {
      // Should fail without either target
      await expect(
        pool.query(`
          INSERT INTO note_share (note_id, permission, created_by_email)
          VALUES ($1, 'read', 'owner@example.com')
        `, [testNoteId])
      ).rejects.toThrow();

      // Should succeed with email
      const withEmail = await pool.query(`
        INSERT INTO note_share (note_id, shared_with_email, permission, created_by_email)
        VALUES ($1, 'user@example.com', 'read', 'owner@example.com')
        RETURNING id
      `, [testNoteId]);
      expect(withEmail.rows[0].id).toBeDefined();

      // Should succeed with token
      const withToken = await pool.query(`
        INSERT INTO note_share (note_id, share_link_token, permission, created_by_email)
        VALUES ($1, 'unique-token-123', 'read', 'owner@example.com')
        RETURNING id
      `, [testNoteId]);
      expect(withToken.rows[0].id).toBeDefined();
    });

    it('cascades delete when note is deleted', async () => {
      // Create a temporary note
      const tempNote = await pool.query(`
        INSERT INTO note (user_email, title)
        VALUES ('owner@example.com', 'Temp Note for Cascade Test')
        RETURNING id
      `);
      const tempNoteId = tempNote.rows[0].id;

      // Create a share
      await pool.query(`
        INSERT INTO note_share (note_id, shared_with_email, permission, created_by_email)
        VALUES ($1, 'user@example.com', 'read', 'owner@example.com')
      `, [tempNoteId]);

      // Delete the note
      await pool.query('DELETE FROM note WHERE id = $1', [tempNoteId]);

      // Share should be gone
      const shares = await pool.query('SELECT id FROM note_share WHERE note_id = $1', [tempNoteId]);
      expect(shares.rows.length).toBe(0);
    });
  });

  describe('notebook_share table', () => {
    afterEach(async () => {
      await pool.query('DELETE FROM notebook_share WHERE notebook_id = $1', [testNotebookId]);
    });

    it('exists with all required columns', async () => {
      const result = await pool.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'notebook_share'
        ORDER BY ordinal_position
      `);

      const columns = result.rows.map((r) => r.column_name);
      expect(columns).toContain('id');
      expect(columns).toContain('notebook_id');
      expect(columns).toContain('shared_with_email');
      expect(columns).toContain('share_link_token');
      expect(columns).toContain('permission');
      expect(columns).toContain('expires_at');
      expect(columns).toContain('created_by_email');
    });

    it('cascades delete when notebook is deleted', async () => {
      // Create temp notebook
      const tempNotebook = await pool.query(`
        INSERT INTO notebook (user_email, name)
        VALUES ('owner@example.com', 'Temp Notebook for Cascade')
        RETURNING id
      `);
      const tempNotebookId = tempNotebook.rows[0].id;

      // Create share
      await pool.query(`
        INSERT INTO notebook_share (notebook_id, shared_with_email, permission, created_by_email)
        VALUES ($1, 'user@example.com', 'read', 'owner@example.com')
      `, [tempNotebookId]);

      // Delete notebook
      await pool.query('DELETE FROM notebook WHERE id = $1', [tempNotebookId]);

      // Share should be gone
      const shares = await pool.query('SELECT id FROM notebook_share WHERE notebook_id = $1', [tempNotebookId]);
      expect(shares.rows.length).toBe(0);
    });
  });

  describe('note_collaborator table', () => {
    afterEach(async () => {
      await pool.query('DELETE FROM note_collaborator WHERE note_id = $1', [testNoteId]);
    });

    it('exists with required columns', async () => {
      const result = await pool.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'note_collaborator'
        ORDER BY ordinal_position
      `);

      const columns = result.rows.map((r) => r.column_name);
      expect(columns).toContain('id');
      expect(columns).toContain('note_id');
      expect(columns).toContain('user_email');
      expect(columns).toContain('last_seen_at');
      expect(columns).toContain('cursor_position');
    });

    it('enforces unique constraint on note_id + user_email', async () => {
      await pool.query(`
        INSERT INTO note_collaborator (note_id, user_email)
        VALUES ($1, 'collab@example.com')
      `, [testNoteId]);

      // Duplicate should fail
      await expect(
        pool.query(`
          INSERT INTO note_collaborator (note_id, user_email)
          VALUES ($1, 'collab@example.com')
        `, [testNoteId])
      ).rejects.toThrow();
    });

    it('stores cursor position as JSONB', async () => {
      const cursorPos = { line: 10, column: 25 };
      const result = await pool.query(`
        INSERT INTO note_collaborator (note_id, user_email, cursor_position)
        VALUES ($1, 'editor@example.com', $2)
        RETURNING cursor_position
      `, [testNoteId, JSON.stringify(cursorPos)]);

      expect(result.rows[0].cursor_position).toEqual(cursorPos);
    });
  });

  describe('user_can_access_note() function', () => {
    beforeEach(async () => {
      // Update test note visibility to shared
      await pool.query(`UPDATE note SET visibility = 'shared' WHERE id = $1`, [testNoteId]);
    });

    afterEach(async () => {
      await pool.query('DELETE FROM note_share WHERE note_id = $1', [testNoteId]);
      await pool.query('DELETE FROM notebook_share WHERE notebook_id = $1', [testNotebookId]);
    });

    it('returns true for note owner', async () => {
      const result = await pool.query(`
        SELECT user_can_access_note($1, 'owner@example.com', 'read_write')
      `, [testNoteId]);
      expect(result.rows[0].user_can_access_note).toBe(true);
    });

    it('returns false for unshared note', async () => {
      const result = await pool.query(`
        SELECT user_can_access_note($1, 'stranger@example.com', 'read')
      `, [testNoteId]);
      expect(result.rows[0].user_can_access_note).toBe(false);
    });

    it('returns true when note is directly shared with user', async () => {
      await pool.query(`
        INSERT INTO note_share (note_id, shared_with_email, permission, created_by_email)
        VALUES ($1, 'reader@example.com', 'read', 'owner@example.com')
      `, [testNoteId]);

      const result = await pool.query(`
        SELECT user_can_access_note($1, 'reader@example.com', 'read')
      `, [testNoteId]);
      expect(result.rows[0].user_can_access_note).toBe(true);
    });

    it('returns false when user only has read but needs read_write', async () => {
      await pool.query(`
        INSERT INTO note_share (note_id, shared_with_email, permission, created_by_email)
        VALUES ($1, 'reader@example.com', 'read', 'owner@example.com')
      `, [testNoteId]);

      const result = await pool.query(`
        SELECT user_can_access_note($1, 'reader@example.com', 'read_write')
      `, [testNoteId]);
      expect(result.rows[0].user_can_access_note).toBe(false);
    });

    it('returns true when notebook is shared with user', async () => {
      await pool.query(`
        INSERT INTO notebook_share (notebook_id, shared_with_email, permission, created_by_email)
        VALUES ($1, 'nb-reader@example.com', 'read', 'owner@example.com')
      `, [testNotebookId]);

      const result = await pool.query(`
        SELECT user_can_access_note($1, 'nb-reader@example.com', 'read')
      `, [testNoteId]);
      expect(result.rows[0].user_can_access_note).toBe(true);
    });

    it('respects share expiration', async () => {
      // Create expired share
      await pool.query(`
        INSERT INTO note_share (note_id, shared_with_email, permission, created_by_email, expires_at)
        VALUES ($1, 'expired@example.com', 'read', 'owner@example.com', NOW() - INTERVAL '1 day')
      `, [testNoteId]);

      const result = await pool.query(`
        SELECT user_can_access_note($1, 'expired@example.com', 'read')
      `, [testNoteId]);
      expect(result.rows[0].user_can_access_note).toBe(false);
    });

    it('grants read access to public notes', async () => {
      // Make note public
      await pool.query(`UPDATE note SET visibility = 'public' WHERE id = $1`, [testNoteId]);

      const result = await pool.query(`
        SELECT user_can_access_note($1, 'anyone@example.com', 'read')
      `, [testNoteId]);
      expect(result.rows[0].user_can_access_note).toBe(true);
    });
  });

  describe('agent_can_access_note() function', () => {
    afterEach(async () => {
      await pool.query(`
        UPDATE note SET visibility = 'shared', hide_from_agents = false WHERE id = $1
      `, [testNoteId]);
    });

    it('returns false for private notes', async () => {
      await pool.query(`UPDATE note SET visibility = 'private' WHERE id = $1`, [testNoteId]);

      const result = await pool.query(`SELECT agent_can_access_note($1)`, [testNoteId]);
      expect(result.rows[0].agent_can_access_note).toBe(false);
    });

    it('returns true for shared notes without hide_from_agents', async () => {
      await pool.query(`UPDATE note SET visibility = 'shared' WHERE id = $1`, [testNoteId]);

      const result = await pool.query(`SELECT agent_can_access_note($1)`, [testNoteId]);
      expect(result.rows[0].agent_can_access_note).toBe(true);
    });

    it('returns false when hide_from_agents is true', async () => {
      await pool.query(`
        UPDATE note SET visibility = 'public', hide_from_agents = true WHERE id = $1
      `, [testNoteId]);

      const result = await pool.query(`SELECT agent_can_access_note($1)`, [testNoteId]);
      expect(result.rows[0].agent_can_access_note).toBe(false);
    });
  });

  describe('validate_share_link() function', () => {
    afterEach(async () => {
      await pool.query('DELETE FROM note_share WHERE note_id = $1', [testNoteId]);
    });

    it('returns is_valid=false for non-existent token', async () => {
      const result = await pool.query(`SELECT * FROM validate_share_link('nonexistent-token')`);
      expect(result.rows[0].is_valid).toBe(false);
      expect(result.rows[0].error_message).toBe('Invalid or expired link');
    });

    it('returns is_valid=true for valid token', async () => {
      await pool.query(`
        INSERT INTO note_share (note_id, share_link_token, permission, created_by_email)
        VALUES ($1, 'valid-token', 'read', 'owner@example.com')
      `, [testNoteId]);

      const result = await pool.query(`SELECT * FROM validate_share_link('valid-token')`);
      expect(result.rows[0].is_valid).toBe(true);
      expect(result.rows[0].note_id).toBe(testNoteId);
      expect(result.rows[0].permission).toBe('read');
    });

    it('increments view count', async () => {
      await pool.query(`
        INSERT INTO note_share (note_id, share_link_token, permission, created_by_email)
        VALUES ($1, 'count-token', 'read', 'owner@example.com')
      `, [testNoteId]);

      await pool.query(`SELECT * FROM validate_share_link('count-token')`);
      await pool.query(`SELECT * FROM validate_share_link('count-token')`);

      const share = await pool.query(`
        SELECT view_count FROM note_share WHERE share_link_token = 'count-token'
      `);
      expect(share.rows[0].view_count).toBe(2);
    });

    it('rejects single-view links after first view', async () => {
      await pool.query(`
        INSERT INTO note_share (note_id, share_link_token, permission, created_by_email, is_single_view)
        VALUES ($1, 'single-view-token', 'read', 'owner@example.com', true)
      `, [testNoteId]);

      // First view should work
      const first = await pool.query(`SELECT * FROM validate_share_link('single-view-token')`);
      expect(first.rows[0].is_valid).toBe(true);

      // Second view should fail
      const second = await pool.query(`SELECT * FROM validate_share_link('single-view-token')`);
      expect(second.rows[0].is_valid).toBe(false);
      expect(second.rows[0].error_message).toBe('This link can only be viewed once');
    });

    it('rejects expired links', async () => {
      await pool.query(`
        INSERT INTO note_share (note_id, share_link_token, permission, created_by_email, expires_at)
        VALUES ($1, 'expired-token', 'read', 'owner@example.com', NOW() - INTERVAL '1 hour')
      `, [testNoteId]);

      const result = await pool.query(`SELECT * FROM validate_share_link('expired-token')`);
      expect(result.rows[0].is_valid).toBe(false);
      expect(result.rows[0].error_message).toBe('Link has expired');
    });

    it('rejects max-views exceeded links', async () => {
      await pool.query(`
        INSERT INTO note_share (note_id, share_link_token, permission, created_by_email, max_views, view_count)
        VALUES ($1, 'max-views-token', 'read', 'owner@example.com', 3, 3)
      `, [testNoteId]);

      const result = await pool.query(`SELECT * FROM validate_share_link('max-views-token')`);
      expect(result.rows[0].is_valid).toBe(false);
      expect(result.rows[0].error_message).toBe('Maximum views reached for this link');
    });
  });

  describe('generate_share_token() function', () => {
    it('generates URL-safe tokens', async () => {
      const result = await pool.query(`SELECT generate_share_token() as token`);
      const token = result.rows[0].token;

      // Should be non-empty
      expect(token.length).toBeGreaterThan(0);

      // Should be URL-safe (no hyphens, plus, or slash)
      expect(token).not.toContain('+');
      expect(token).not.toContain('/');
      expect(token).not.toContain('-');

      // Should be 64 chars (two UUIDs without hyphens)
      expect(token.length).toBe(64);

      // Should only contain hex characters
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    it('generates unique tokens', async () => {
      const result = await pool.query(`
        SELECT generate_share_token() as t1, generate_share_token() as t2
      `);
      expect(result.rows[0].t1).not.toBe(result.rows[0].t2);
    });
  });

  describe('indexes', () => {
    it('has required indexes', async () => {
      const result = await pool.query(`
        SELECT indexname FROM pg_indexes
        WHERE tablename IN ('note_share', 'notebook_share', 'note_collaborator')
        ORDER BY indexname
      `);

      const indexes = result.rows.map((r) => r.indexname);

      // note_share indexes
      expect(indexes).toContain('idx_note_share_note_id');
      expect(indexes).toContain('idx_note_share_shared_with_email');
      expect(indexes).toContain('idx_note_share_token');
      expect(indexes).toContain('idx_note_share_expires_at');

      // notebook_share indexes
      expect(indexes).toContain('idx_notebook_share_notebook_id');
      expect(indexes).toContain('idx_notebook_share_shared_with_email');
      expect(indexes).toContain('idx_notebook_share_token');

      // note_collaborator indexes
      expect(indexes).toContain('idx_note_collaborator_note');
      expect(indexes).toContain('idx_note_collaborator_user');
    });
  });
});
