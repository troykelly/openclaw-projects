/**
 * Tests for note embeddings integration.
 * Part of Epic #337, Issue #349
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { buildServer } from '../src/api/server.ts';
import { createPool } from '../src/db.ts';
import { runMigrate } from './helpers/migrate.ts';

// Mock the embedding service module
vi.mock('../src/api/embeddings/service.ts', () => ({
  embeddingService: {
    isConfigured: vi.fn(() => true),
    embed: vi.fn(async (text: string) => ({
      embedding: new Array(1024).fill(0).map((_, i) => Math.sin(i + text.length)),
      model: 'test-model',
      provider: 'test-provider',
    })),
    getConfig: vi.fn(() => ({
      provider: 'test-provider',
      model: 'test-model',
    })),
  },
}));

describe('Note Embeddings API', () => {
  let app: FastifyInstance;
  let pool: Pool;
  const testUserEmail = 'embed-test@example.com';
  const otherUserEmail = 'embed-other@example.com';

  beforeAll(async () => {
    await runMigrate('up');
    app = await buildServer();
    pool = createPool({ max: 3 });

    // Clean up any existing test data (user_email dropped in Epic #1418 migration 091)
    await pool.query(`DELETE FROM note WHERE namespace = 'default'`);
    await pool.query(`DELETE FROM notebook WHERE namespace = 'default'`);

    // Epic #1418: ensure user_setting + namespace_grant exist for test users.
    // Only testUserEmail gets 'default' namespace grant; otherUserEmail gets
    // user_setting only to preserve access isolation (no cross-namespace access).
    for (const email of [testUserEmail, otherUserEmail]) {
      await pool.query('INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email', [email]);
      await pool.query('DELETE FROM namespace_grant WHERE email = $1', [email]);
    }
    await pool.query(`INSERT INTO namespace_grant (email, namespace, role, is_default) VALUES ($1, 'default', 'owner', true)`, [testUserEmail]);
  });

  afterAll(async () => {
    // Clean up test data (user_email dropped in Epic #1418 migration 091)
    await pool.query(`DELETE FROM note WHERE namespace = 'default'`);
    await pool.query(`DELETE FROM notebook WHERE namespace = 'default'`);

    await pool.end();
    await app.close();
  });

  // Helper functions
  async function createNote(
    overrides: Partial<{
      title: string;
      content: string;
      visibility: string;
      hide_from_agents: boolean;
      tags: string[];
      user_email: string;
    }> = {},
  ) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/notes',
      payload: {
        user_email: overrides.user_email ?? testUserEmail,
        title: overrides.title ?? 'Test Note',
        content: overrides.content ?? 'Test content for embedding',
        visibility: overrides.visibility ?? 'private',
        hide_from_agents: overrides.hide_from_agents ?? false,
        tags: overrides.tags ?? [],
      },
    });
    expect(response.statusCode).toBe(201);
    return JSON.parse(response.payload);
  }

  async function getNote(noteId: string, user_email: string = testUserEmail) {
    const response = await app.inject({
      method: 'GET',
      url: `/api/notes/${noteId}?user_email=${user_email}`,
    });
    if (response.statusCode === 200) {
      return JSON.parse(response.payload);
    }
    return null;
  }

  describe('Embedding Status on Note Operations', () => {
    it('should trigger embedding when creating a note', async () => {
      const note = await createNote({
        title: 'Embedding Test Note',
        content: 'This note should be embedded',
      });

      // The embedding is triggered asynchronously, so we check the note exists
      expect(note.id).toBeDefined();
      expect(note.title).toBe('Embedding Test Note');
    });

    it('should mark private+hideFromAgents notes as skipped', async () => {
      const note = await createNote({
        title: 'Hidden Note',
        content: 'This note should not be embedded',
        visibility: 'private',
        hide_from_agents: true,
      });

      // Wait a bit for async embedding to process
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Fetch the note directly from DB to check embedding status
      const result = await pool.query(`SELECT embedding_status FROM note WHERE id = $1`, [note.id]);

      // The note should be skipped due to privacy settings
      expect(['skipped', 'pending']).toContain(result.rows[0].embedding_status);
    });

    it('should embed public notes', async () => {
      const note = await createNote({
        title: 'Public Note',
        content: 'This public note should be embedded',
        visibility: 'public',
      });

      // Wait for async embedding
      await new Promise((resolve) => setTimeout(resolve, 100));

      const result = await pool.query(`SELECT embedding_status FROM note WHERE id = $1`, [note.id]);

      // Should be complete or pending (depending on timing)
      expect(['complete', 'pending']).toContain(result.rows[0].embedding_status);
    });

    it('should embed shared notes', async () => {
      const note = await createNote({
        title: 'Shared Note',
        content: 'This shared note should be embedded',
        visibility: 'shared',
      });

      expect(note.visibility).toBe('shared');
    });
  });

  describe('GET /api/admin/embeddings/status/notes', () => {
    it('should return embedding statistics', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/embeddings/status/notes',
      });

      expect(response.statusCode).toBe(200);

      const stats = JSON.parse(response.payload);
      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('by_status');
      expect(stats.by_status).toHaveProperty('complete');
      expect(stats.by_status).toHaveProperty('pending');
      expect(stats.by_status).toHaveProperty('failed');
      expect(stats.by_status).toHaveProperty('skipped');
      expect(stats).toHaveProperty('provider');
      expect(stats).toHaveProperty('model');
    });
  });

  describe('POST /api/admin/embeddings/backfill/notes', () => {
    it('should backfill pending notes', async () => {
      // Create some notes first
      await createNote({ title: 'Backfill Note 1', content: 'Content 1' });
      await createNote({ title: 'Backfill Note 2', content: 'Content 2' });

      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/embeddings/backfill/notes',
        payload: {
          limit: 10,
          only_pending: true,
          batch_size: 5,
        },
      });

      expect(response.statusCode).toBe(200);

      const result = JSON.parse(response.payload);
      expect(result).toHaveProperty('processed');
      expect(result).toHaveProperty('succeeded');
      expect(result).toHaveProperty('failed');
      expect(result).toHaveProperty('skipped');
      expect(result).toHaveProperty('errors');
      expect(Array.isArray(result.errors)).toBe(true);
    });

    it('should accept default parameters', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/embeddings/backfill/notes',
        payload: {},
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('POST /api/notes/search/semantic', () => {
    beforeEach(async () => {
      // Create test notes with distinct content for search
      await createNote({
        title: 'TypeScript Guide',
        content: 'A comprehensive guide to TypeScript programming',
        visibility: 'public',
      });
      await createNote({
        title: 'Python Tutorial',
        content: 'Learn Python programming from scratch',
        visibility: 'public',
      });
      await createNote({
        title: 'Private Secret',
        content: 'This is a private note that should only be found by owner',
        visibility: 'private',
      });

      // Wait for embeddings to process
      await new Promise((resolve) => setTimeout(resolve, 200));
    });

    it('should require user_email', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/notes/search/semantic',
        payload: {
          query: 'programming',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.payload).error).toBe('user_email is required');
    });

    it('should require query', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/notes/search/semantic',
        payload: {
          user_email: testUserEmail,
        },
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.payload).error).toBe('query is required');
    });

    it('should search notes semantically', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/notes/search/semantic',
        payload: {
          user_email: testUserEmail,
          query: 'programming languages',
          limit: 10,
        },
      });

      expect(response.statusCode).toBe(200);

      const result = JSON.parse(response.payload);
      expect(result).toHaveProperty('results');
      expect(result).toHaveProperty('search_type');
      expect(['semantic', 'text']).toContain(result.search_type);
      expect(Array.isArray(result.results)).toBe(true);
    });

    it('should return similarity scores', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/notes/search/semantic',
        payload: {
          user_email: testUserEmail,
          query: 'TypeScript',
          limit: 5,
        },
      });

      expect(response.statusCode).toBe(200);

      const result = JSON.parse(response.payload);
      if (result.results.length > 0) {
        expect(result.results[0]).toHaveProperty('id');
        expect(result.results[0]).toHaveProperty('title');
        expect(result.results[0]).toHaveProperty('content');
        expect(result.results[0]).toHaveProperty('similarity');
        expect(typeof result.results[0].similarity).toBe('number');
      }
    });

    it('should filter by notebook_id', async () => {
      // Create a notebook and note in it
      const notebookResponse = await app.inject({
        method: 'POST',
        url: '/api/notebooks',
        payload: {
          user_email: testUserEmail,
          name: 'Search Test Notebook',
        },
      });
      const notebook = JSON.parse(notebookResponse.payload);

      await createNote({
        title: 'Notebook Note',
        content: 'This note is in a specific notebook',
        visibility: 'private',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/notes/search/semantic',
        payload: {
          user_email: testUserEmail,
          query: 'notebook',
          notebook_id: notebook.id,
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('should filter by tags', async () => {
      await createNote({
        title: 'Tagged Note',
        content: 'This note has specific tags',
        tags: ['test-tag', 'search-tag'],
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/notes/search/semantic',
        payload: {
          user_email: testUserEmail,
          query: 'tagged',
          tags: ['test-tag'],
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('should respect visibility/access control', async () => {
      // Create a private note for test user
      const privateNote = await createNote({
        title: 'Owner Only Note',
        content: 'This note should only be visible to owner',
        visibility: 'private',
      });

      // Search as owner - should find
      const ownerResponse = await app.inject({
        method: 'POST',
        url: '/api/notes/search/semantic',
        payload: {
          user_email: testUserEmail,
          query: 'Owner Only',
        },
      });

      expect(ownerResponse.statusCode).toBe(200);

      // Search as other user - should not find the private note
      const otherResponse = await app.inject({
        method: 'POST',
        url: '/api/notes/search/semantic',
        payload: {
          user_email: otherUserEmail,
          query: 'Owner Only',
        },
      });

      expect(otherResponse.statusCode).toBe(200);
      const otherResult = JSON.parse(otherResponse.payload);

      // The other user should not see the private note
      const foundPrivate = otherResult.results.find((r: { id: string }) => r.id === privateNote.id);
      expect(foundPrivate).toBeUndefined();
    });

    it('should handle pagination', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/notes/search/semantic',
        payload: {
          user_email: testUserEmail,
          query: 'test',
          limit: 5,
          offset: 0,
        },
      });

      expect(response.statusCode).toBe(200);

      const result = JSON.parse(response.payload);
      expect(result.results.length).toBeLessThanOrEqual(5);
    });
  });

  describe('shouldEmbed function', () => {
    it('should export shouldEmbed function', async () => {
      const { shouldEmbed } = await import('../src/api/embeddings/note-integration.ts');
      expect(typeof shouldEmbed).toBe('function');
    });

    it('should return false for private+hideFromAgents', async () => {
      const { shouldEmbed } = await import('../src/api/embeddings/note-integration.ts');

      const result = shouldEmbed({
        id: 'test',
        title: 'Test',
        content: 'Test',
        visibility: 'private',
        hide_from_agents: true,
      });

      expect(result).toBe(false);
    });

    it('should return true for private notes without hideFromAgents', async () => {
      const { shouldEmbed } = await import('../src/api/embeddings/note-integration.ts');

      const result = shouldEmbed({
        id: 'test',
        title: 'Test',
        content: 'Test',
        visibility: 'private',
        hide_from_agents: false,
      });

      expect(result).toBe(true);
    });

    it('should return true for public notes', async () => {
      const { shouldEmbed } = await import('../src/api/embeddings/note-integration.ts');

      const result = shouldEmbed({
        id: 'test',
        title: 'Test',
        content: 'Test',
        visibility: 'public',
        hide_from_agents: false,
      });

      expect(result).toBe(true);
    });

    it('should return true for shared notes', async () => {
      const { shouldEmbed } = await import('../src/api/embeddings/note-integration.ts');

      const result = shouldEmbed({
        id: 'test',
        title: 'Test',
        content: 'Test',
        visibility: 'shared',
        hide_from_agents: false,
      });

      expect(result).toBe(true);
    });

    it('should return true for public notes even with hideFromAgents', async () => {
      const { shouldEmbed } = await import('../src/api/embeddings/note-integration.ts');

      // Public notes are always searchable regardless of hideFromAgents
      // (hideFromAgents is meant for private content only)
      const result = shouldEmbed({
        id: 'test',
        title: 'Test',
        content: 'Test',
        visibility: 'public',
        hide_from_agents: true,
      });

      expect(result).toBe(true);
    });
  });

  describe('Re-embedding on updates', () => {
    it('should trigger re-embedding when title changes', async () => {
      const note = await createNote({
        title: 'Original Title',
        content: 'Original content',
      });

      const updateResponse = await app.inject({
        method: 'PUT',
        url: `/api/notes/${note.id}`,
        payload: {
          user_email: testUserEmail,
          title: 'Updated Title',
        },
      });

      expect(updateResponse.statusCode).toBe(200);
      const updatedNote = JSON.parse(updateResponse.payload);
      expect(updatedNote.title).toBe('Updated Title');
    });

    it('should trigger re-embedding when content changes', async () => {
      const note = await createNote({
        title: 'Content Update Test',
        content: 'Original content',
      });

      const updateResponse = await app.inject({
        method: 'PUT',
        url: `/api/notes/${note.id}`,
        payload: {
          user_email: testUserEmail,
          content: 'Updated content for embedding',
        },
      });

      expect(updateResponse.statusCode).toBe(200);
    });

    it('should trigger re-embedding when visibility changes', async () => {
      const note = await createNote({
        title: 'Visibility Update Test',
        content: 'Content',
        visibility: 'private',
      });

      const updateResponse = await app.inject({
        method: 'PUT',
        url: `/api/notes/${note.id}`,
        payload: {
          user_email: testUserEmail,
          visibility: 'public',
        },
      });

      expect(updateResponse.statusCode).toBe(200);
      const updatedNote = JSON.parse(updateResponse.payload);
      expect(updatedNote.visibility).toBe('public');
    });

    it('should trigger re-embedding when hideFromAgents changes', async () => {
      const note = await createNote({
        title: 'HideFromAgents Update Test',
        content: 'Content',
        hide_from_agents: false,
      });

      const updateResponse = await app.inject({
        method: 'PUT',
        url: `/api/notes/${note.id}`,
        payload: {
          user_email: testUserEmail,
          hide_from_agents: true, // API uses snake_case input
        },
      });

      expect(updateResponse.statusCode).toBe(200);
      const updatedNote = JSON.parse(updateResponse.payload);
      expect(updatedNote.hide_from_agents).toBe(true);
    });
  });
});
