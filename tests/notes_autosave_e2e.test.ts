/**
 * Autosave E2E Tests for Notes Feature
 * Part of Issue #780 - Notes autosave feature E2E tests
 *
 * These tests verify the autosave behavior at the API level:
 * - Auto-generated titles for new notes
 * - Multiple rapid updates (simulating autosave)
 * - Content persistence across requests
 * - Error handling and recovery scenarios
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import { buildServer } from '../src/api/server.ts';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';

/** Note response from API */
interface NoteResponse {
  id: string;
  notebookId: string | null;
  userEmail: string;
  title: string;
  content: string;
  summary: string | null;
  tags: string[];
  isPinned: boolean;
  sortOrder: number;
  visibility: string;
  hideFromAgents: boolean;
  embeddingStatus: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** E2E test timeout configuration */
const E2E_TEST_TIMEOUT = 30_000;
const E2E_HOOK_TIMEOUT = 60_000;

describe('Notes Autosave E2E (Issue #780)', () => {
  vi.setConfig({ testTimeout: E2E_TEST_TIMEOUT, hookTimeout: E2E_HOOK_TIMEOUT });

  const app = buildServer();
  let pool: Pool;

  const testUser = 'autosave-test@example.com';

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

  // ============================================
  // Title Validation and Frontend Auto-Naming Support
  // ============================================
  //
  // Note: Auto-generated titles are handled by the frontend UI, not the API.
  // The API requires a title and returns 400 for empty titles.
  // These tests verify API title behavior and support frontend auto-naming patterns.

  describe('Title Handling', () => {
    it('returns 400 for empty title (frontend handles auto-naming)', async () => {
      // The API requires a title - auto-naming is a frontend responsibility
      const res = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: testUser,
          title: '',
          content: 'Test content',
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for whitespace-only title', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: testUser,
          title: '   ',
          content: 'Test content',
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('preserves user-provided title', async () => {
      const customTitle = 'My Custom Note Title';
      const res = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: testUser,
          title: customTitle,
          content: 'Test content',
        },
      });

      expect(res.statusCode).toBe(201);
      const note = res.json<NoteResponse>();
      expect(note.title).toBe(customTitle);
    });

    it('accepts auto-generated title format from frontend', async () => {
      // Frontend generates titles in format "Untitled Note - <timestamp>"
      const autoTitle = `Untitled Note - ${new Date().toLocaleString()}`;
      const res = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: testUser,
          title: autoTitle,
          content: 'Auto-named note content',
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json<NoteResponse>().title).toBe(autoTitle);
    });

    it('allows updating title to new auto-generated value', async () => {
      // Create note with initial title
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: testUser,
          title: 'Original Title',
          content: 'Content',
        },
      });
      const noteId = createRes.json<NoteResponse>().id;

      // Update with new auto-generated title (as frontend would do)
      const newTitle = `Untitled Note - ${new Date().toLocaleString()}`;
      const updateRes = await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}`,
        payload: {
          user_email: testUser,
          title: newTitle,
        },
      });

      expect(updateRes.statusCode).toBe(200);
      expect(updateRes.json<NoteResponse>().title).toBe(newTitle);
    });
  });

  // ============================================
  // Autosave Simulation Tests (Rapid Updates)
  // ============================================

  describe('Autosave Simulation (Rapid Updates)', () => {
    it('handles multiple rapid content updates', async () => {
      // Create initial note
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: testUser,
          title: 'Autosave Test',
          content: 'Initial content',
        },
      });

      expect(createRes.statusCode).toBe(201);
      const noteId = createRes.json<NoteResponse>().id;

      // Simulate autosave with rapid updates (like typing)
      const updates = [
        'Initial content plus more',
        'Initial content plus more text',
        'Initial content plus more text being typed',
        'Initial content plus more text being typed here',
        'Initial content plus more text being typed here now',
      ];

      for (const content of updates) {
        const updateRes = await app.inject({
          method: 'PUT',
          url: `/api/notes/${noteId}`,
          payload: {
            user_email: testUser,
            content,
          },
        });

        expect(updateRes.statusCode).toBe(200);
      }

      // Verify final content persisted
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}`,
        query: { user_email: testUser },
      });

      expect(getRes.statusCode).toBe(200);
      expect(getRes.json<NoteResponse>().content).toBe(updates[updates.length - 1]);
    });

    it('handles concurrent title and content updates', async () => {
      // Create initial note
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: testUser,
          title: 'Original Title',
          content: 'Original content',
        },
      });

      const noteId = createRes.json<NoteResponse>().id;

      // Update title and content simultaneously
      const updateRes = await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}`,
        payload: {
          user_email: testUser,
          title: 'Updated Title',
          content: 'Updated content',
        },
      });

      expect(updateRes.statusCode).toBe(200);
      const updated = updateRes.json<NoteResponse>();
      expect(updated.title).toBe('Updated Title');
      expect(updated.content).toBe('Updated content');
    });

    it('creates version history on updates', async () => {
      // Create initial note
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: testUser,
          title: 'Version Test',
          content: 'Version 1 content',
        },
      });

      const noteId = createRes.json<NoteResponse>().id;

      // Make several updates
      await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}`,
        payload: {
          user_email: testUser,
          content: 'Version 2 content',
        },
      });

      await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}`,
        payload: {
          user_email: testUser,
          content: 'Version 3 content',
        },
      });

      // Check version history
      const versionsRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}/versions`,
        query: { user_email: testUser },
      });

      expect(versionsRes.statusCode).toBe(200);
      const versions = versionsRes.json();
      expect(versions.versions.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ============================================
  // Content Persistence Tests
  // ============================================

  describe('Content Persistence', () => {
    it('persists content across page reloads (simulated via API)', async () => {
      // Create note
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: testUser,
          title: 'Persistence Test',
          content: 'Content that should persist',
        },
      });

      const noteId = createRes.json<NoteResponse>().id;

      // Update content
      await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}`,
        payload: {
          user_email: testUser,
          content: 'Updated content that should persist',
        },
      });

      // "Reload" - fetch the note fresh
      const reloadRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}`,
        query: { user_email: testUser },
      });

      expect(reloadRes.statusCode).toBe(200);
      expect(reloadRes.json<NoteResponse>().content).toBe('Updated content that should persist');
    });

    it('maintains note state after rapid save sequence', async () => {
      // Create note
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: testUser,
          title: 'Rapid Save Test',
          content: 'Initial',
          tags: ['test'],
          is_pinned: false,
        },
      });

      const noteId = createRes.json<NoteResponse>().id;

      // Rapid sequence of updates (simulating user typing with autosave)
      const rapidUpdates = Array(10)
        .fill(null)
        .map((_, i) =>
          app.inject({
            method: 'PUT',
            url: `/api/notes/${noteId}`,
            payload: {
              user_email: testUser,
              content: `Content version ${i + 1}`,
            },
          })
        );

      const results = await Promise.all(rapidUpdates);

      // All updates should succeed
      expect(results.every((r) => r.statusCode === 200)).toBe(true);

      // Verify final state
      const finalRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}`,
        query: { user_email: testUser },
      });

      const finalNote = finalRes.json<NoteResponse>();
      expect(finalNote.title).toBe('Rapid Save Test');
      expect(finalNote.tags).toContain('test');
      // Content should be one of the versions (race conditions in parallel updates)
      expect(finalNote.content).toMatch(/Content version \d+/);
    });

    it('handles empty content save', async () => {
      // Create note with content
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: testUser,
          title: 'Empty Content Test',
          content: 'Some initial content',
        },
      });

      const noteId = createRes.json<NoteResponse>().id;

      // Clear the content (autosave of cleared content)
      const clearRes = await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}`,
        payload: {
          user_email: testUser,
          content: '',
        },
      });

      expect(clearRes.statusCode).toBe(200);
      expect(clearRes.json<NoteResponse>().content).toBe('');

      // Verify empty content persists
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}`,
        query: { user_email: testUser },
      });

      expect(getRes.json<NoteResponse>().content).toBe('');
    });
  });

  // ============================================
  // Error Handling and Recovery
  // ============================================

  describe('Error Handling and Recovery', () => {
    it('returns error for non-existent note update', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';

      const res = await app.inject({
        method: 'PUT',
        url: `/api/notes/${fakeId}`,
        payload: {
          user_email: testUser,
          content: 'Attempting to save to non-existent note',
        },
      });

      // Should return 404 (note not found) or 403 (not authorized)
      expect([404, 403]).toContain(res.statusCode);
    });

    it('returns error for unauthorized note update', async () => {
      // Create note as one user
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: testUser,
          title: 'Auth Test',
          content: 'Original content',
          visibility: 'private',
        },
      });

      const noteId = createRes.json<NoteResponse>().id;

      // Try to update as different user
      const updateRes = await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}`,
        payload: {
          user_email: 'other-user@example.com',
          content: 'Unauthorized update attempt',
        },
      });

      expect(updateRes.statusCode).toBe(403);
    });

    it('handles update after note deletion gracefully', async () => {
      // Create note
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: testUser,
          title: 'To Be Deleted',
          content: 'Content',
        },
      });

      const noteId = createRes.json<NoteResponse>().id;

      // Delete the note
      await app.inject({
        method: 'DELETE',
        url: `/api/notes/${noteId}`,
        query: { user_email: testUser },
      });

      // Try to update deleted note (simulating stale autosave)
      const updateRes = await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}`,
        payload: {
          user_email: testUser,
          content: 'Update to deleted note',
        },
      });

      // Should return 404 (soft deleted)
      expect(updateRes.statusCode).toBe(404);
    });

    it('recovers note after restore and allows updates', async () => {
      // Create, delete, restore workflow
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: testUser,
          title: 'Restore Test',
          content: 'Original content',
        },
      });

      const noteId = createRes.json<NoteResponse>().id;

      // Delete
      await app.inject({
        method: 'DELETE',
        url: `/api/notes/${noteId}`,
        query: { user_email: testUser },
      });

      // Restore
      const restoreRes = await app.inject({
        method: 'POST',
        url: `/api/notes/${noteId}/restore`,
        payload: { user_email: testUser },
      });

      expect(restoreRes.statusCode).toBe(200);

      // Update should now work (autosave after restore)
      const updateRes = await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}`,
        payload: {
          user_email: testUser,
          content: 'Content after restore',
        },
      });

      expect(updateRes.statusCode).toBe(200);
      expect(updateRes.json<NoteResponse>().content).toBe('Content after restore');
    });
  });

  // ============================================
  // Large Content Handling
  // ============================================

  describe('Large Content Handling', () => {
    it('handles large content saves', async () => {
      // Create note
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: testUser,
          title: 'Large Content Test',
          content: 'Initial',
        },
      });

      const noteId = createRes.json<NoteResponse>().id;

      // Generate large content (100KB)
      const largeContent = 'A'.repeat(100 * 1024);

      const updateRes = await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}`,
        payload: {
          user_email: testUser,
          content: largeContent,
        },
      });

      expect(updateRes.statusCode).toBe(200);

      // Verify content persisted
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}`,
        query: { user_email: testUser },
      });

      expect(getRes.json<NoteResponse>().content).toBe(largeContent);
    });

    it('handles content with special characters', async () => {
      // Note: Null bytes (\u0000) cause PostgreSQL errors, so avoid them
      const specialContent = `
# Heading with "quotes" and 'apostrophes'

Content with special chars: <>&'"
Unicode: éàü ñ 中文 日本語
Emoji: 🚀💻📝
Newlines and tabs:
\tTabbed content

Code block:
\`\`\`javascript
const x = "test";
\`\`\`
`;

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: testUser,
          title: 'Special Chars Test',
          content: specialContent,
        },
      });

      expect(createRes.statusCode).toBe(201);
      const noteId = createRes.json<NoteResponse>().id;

      // Verify retrieval
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}`,
        query: { user_email: testUser },
      });

      expect(getRes.statusCode).toBe(200);
      expect(getRes.json<NoteResponse>().content).toBe(specialContent);
    });
  });

  // ============================================
  // Notebook Context Tests
  // ============================================

  describe('Autosave with Notebook Context', () => {
    it('creates note in specified notebook', async () => {
      // Create notebook
      const nbRes = await app.inject({
        method: 'POST',
        url: '/api/notebooks',
        payload: {
          user_email: testUser,
          name: 'Test Notebook',
        },
      });
      const notebookId = nbRes.json().id;

      // Create note in notebook
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: testUser,
          title: 'Note in Notebook',
          content: 'Content',
          notebook_id: notebookId,
        },
      });

      expect(createRes.statusCode).toBe(201);
      expect(createRes.json<NoteResponse>().notebookId).toBe(notebookId);
    });

    it('maintains notebook association after updates', async () => {
      // Create notebook
      const nbRes = await app.inject({
        method: 'POST',
        url: '/api/notebooks',
        payload: {
          user_email: testUser,
          name: 'Persistent Notebook',
        },
      });
      const notebookId = nbRes.json().id;

      // Create note in notebook
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: {
          user_email: testUser,
          title: 'Notebook Note',
          content: 'V1',
          notebook_id: notebookId,
        },
      });
      const noteId = createRes.json<NoteResponse>().id;

      // Multiple content updates
      await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}`,
        payload: { user_email: testUser, content: 'V2' },
      });

      await app.inject({
        method: 'PUT',
        url: `/api/notes/${noteId}`,
        payload: { user_email: testUser, content: 'V3' },
      });

      // Verify notebook association persisted
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/notes/${noteId}`,
        query: { user_email: testUser },
      });

      expect(getRes.json<NoteResponse>().notebookId).toBe(notebookId);
    });
  });
});
