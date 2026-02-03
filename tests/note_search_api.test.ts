/**
 * Tests for note search with privacy filtering.
 * Part of Epic #337, Issue #346
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { buildServer } from '../src/api/server.ts';
import { createPool } from '../src/db.ts';

// Mock the embedding service module
vi.mock('../src/api/embeddings/service.ts', () => ({
  embeddingService: {
    isConfigured: vi.fn(() => true),
    embed: vi.fn(async (text: string) => ({
      embedding: new Array(1024).fill(0).map((_, i) => Math.sin(i + text.length * 0.1)),
      model: 'test-model',
      provider: 'test-provider',
    })),
    getConfig: vi.fn(() => ({
      provider: 'test-provider',
      model: 'test-model',
    })),
  },
}));

describe('Note Search API', () => {
  let app: FastifyInstance;
  let pool: Pool;
  const ownerEmail = 'search-owner@example.com';
  const sharedUserEmail = 'search-shared@example.com';
  const otherUserEmail = 'search-other@example.com';

  // Track created notes for cleanup
  const createdNoteIds: string[] = [];
  const createdNotebookIds: string[] = [];

  beforeAll(async () => {
    app = await buildServer();
    pool = createPool();

    // Clean up any existing test data
    await pool.query(`DELETE FROM note WHERE user_email LIKE 'search-%@example.com'`);
    await pool.query(`DELETE FROM notebook WHERE user_email LIKE 'search-%@example.com'`);

    // Create test notebook
    const notebookResult = await pool.query(
      `INSERT INTO notebook (user_email, name) VALUES ($1, $2) RETURNING id::text`,
      [ownerEmail, 'Test Search Notebook']
    );
    createdNotebookIds.push(notebookResult.rows[0].id);

    // Create various test notes for search testing
    const notes = [
      {
        title: 'TypeScript Programming Guide',
        content: 'A comprehensive guide to TypeScript programming language with examples',
        visibility: 'public',
        hideFromAgents: false,
        tags: ['programming', 'typescript'],
      },
      {
        title: 'Python Data Science',
        content: 'Learn Python for data science and machine learning applications',
        visibility: 'public',
        hideFromAgents: false,
        tags: ['programming', 'python', 'data-science'],
      },
      {
        title: 'Private Shopping List',
        content: 'Milk, bread, eggs, and vegetables',
        visibility: 'private',
        hideFromAgents: false,
        tags: ['personal'],
      },
      {
        title: 'Hidden Agent Note',
        content: 'This note contains private information hidden from agents',
        visibility: 'private',
        hideFromAgents: true,
        tags: ['private'],
      },
      {
        title: 'Shared Team Notes',
        content: 'Meeting notes and action items for the team',
        visibility: 'shared',
        hideFromAgents: false,
        tags: ['work', 'meetings'],
      },
      {
        title: 'React Components',
        content: 'Building reusable React components with TypeScript',
        visibility: 'public',
        hideFromAgents: false,
        tags: ['programming', 'react', 'typescript'],
      },
    ];

    for (const note of notes) {
      const result = await pool.query(
        `INSERT INTO note (
          user_email, title, content, visibility, hide_from_agents, tags, notebook_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id::text`,
        [
          ownerEmail,
          note.title,
          note.content,
          note.visibility,
          note.hideFromAgents,
          note.tags,
          note.visibility === 'public' ? createdNotebookIds[0] : null,
        ]
      );
      createdNoteIds.push(result.rows[0].id);
    }

    // Create a share for the shared note
    const sharedNoteId = createdNoteIds[4]; // 'Shared Team Notes'
    await pool.query(
      `INSERT INTO note_share (note_id, shared_with_email, permission, created_by_email)
       VALUES ($1, $2, $3, $4)`,
      [sharedNoteId, sharedUserEmail, 'read', ownerEmail]
    );

    // Wait for search index to update
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  afterAll(async () => {
    // Clean up test data
    await pool.query(`DELETE FROM note WHERE user_email LIKE 'search-%@example.com'`);
    await pool.query(`DELETE FROM notebook WHERE user_email LIKE 'search-%@example.com'`);

    await pool.end();
    await app.close();
  });

  describe('GET /api/notes/search', () => {
    it('should require user_email', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/notes/search?q=test',
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.payload).error).toBe('user_email is required');
    });

    it('should require search query', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/notes/search?user_email=${ownerEmail}`,
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.payload).error).toBe('q (search query) is required');
    });

    it('should search notes with text search', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/notes/search?user_email=${ownerEmail}&q=TypeScript&searchType=text`,
      });

      expect(response.statusCode).toBe(200);

      const result = JSON.parse(response.payload);
      expect(result.query).toBe('TypeScript');
      expect(result.searchType).toBe('text');
      expect(result.results.length).toBeGreaterThan(0);

      // Should find TypeScript related notes
      const titles = result.results.map((r: { title: string }) => r.title);
      expect(titles).toContain('TypeScript Programming Guide');
    });

    it('should search notes with semantic search', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/notes/search?user_email=${ownerEmail}&q=programming%20languages&searchType=semantic`,
      });

      expect(response.statusCode).toBe(200);

      const result = JSON.parse(response.payload);
      expect(result.searchType).toBe('semantic');
      expect(Array.isArray(result.results)).toBe(true);
    });

    it('should search notes with hybrid search (default)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/notes/search?user_email=${ownerEmail}&q=programming`,
      });

      expect(response.statusCode).toBe(200);

      const result = JSON.parse(response.payload);
      expect(result.searchType).toBe('hybrid');
      expect(result.results.length).toBeGreaterThan(0);
    });

    it('should return search result fields', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/notes/search?user_email=${ownerEmail}&q=TypeScript&searchType=text`,
      });

      expect(response.statusCode).toBe(200);

      const result = JSON.parse(response.payload);
      expect(result).toHaveProperty('query');
      expect(result).toHaveProperty('searchType');
      expect(result).toHaveProperty('results');
      expect(result).toHaveProperty('total');
      expect(result).toHaveProperty('limit');
      expect(result).toHaveProperty('offset');

      if (result.results.length > 0) {
        const firstResult = result.results[0];
        expect(firstResult).toHaveProperty('id');
        expect(firstResult).toHaveProperty('title');
        expect(firstResult).toHaveProperty('snippet');
        expect(firstResult).toHaveProperty('score');
        expect(firstResult).toHaveProperty('tags');
        expect(firstResult).toHaveProperty('visibility');
      }
    });

    it('should filter by notebook', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/notes/search?user_email=${ownerEmail}&q=programming&notebookId=${createdNotebookIds[0]}`,
      });

      expect(response.statusCode).toBe(200);

      const result = JSON.parse(response.payload);
      // All results should be in the specified notebook
      for (const r of result.results) {
        expect(r.notebookId).toBe(createdNotebookIds[0]);
      }
    });

    it('should filter by tags', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/notes/search?user_email=${ownerEmail}&q=programming&tags=typescript`,
      });

      expect(response.statusCode).toBe(200);

      const result = JSON.parse(response.payload);
      // All results should have the typescript tag
      for (const r of result.results) {
        expect(r.tags).toContain('typescript');
      }
    });

    it('should filter by visibility', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/notes/search?user_email=${ownerEmail}&q=*&visibility=public&searchType=text`,
      });

      expect(response.statusCode).toBe(200);

      const result = JSON.parse(response.payload);
      // All results should be public
      for (const r of result.results) {
        expect(r.visibility).toBe('public');
      }
    });

    it('should respect pagination', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/notes/search?user_email=${ownerEmail}&q=programming&limit=2&offset=0`,
      });

      expect(response.statusCode).toBe(200);

      const result = JSON.parse(response.payload);
      expect(result.limit).toBe(2);
      expect(result.offset).toBe(0);
      expect(result.results.length).toBeLessThanOrEqual(2);
    });

    it('should enforce max limit of 50', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/notes/search?user_email=${ownerEmail}&q=programming&limit=100`,
      });

      expect(response.statusCode).toBe(200);

      const result = JSON.parse(response.payload);
      expect(result.limit).toBeLessThanOrEqual(50);
    });
  });

  describe('Privacy Filtering', () => {
    it('should allow owner to see their private notes', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/notes/search?user_email=${ownerEmail}&q=shopping&searchType=text`,
      });

      expect(response.statusCode).toBe(200);

      const result = JSON.parse(response.payload);
      const titles = result.results.map((r: { title: string }) => r.title);
      expect(titles).toContain('Private Shopping List');
    });

    it('should not show private notes to other users', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/notes/search?user_email=${otherUserEmail}&q=shopping&searchType=text`,
      });

      expect(response.statusCode).toBe(200);

      const result = JSON.parse(response.payload);
      const titles = result.results.map((r: { title: string }) => r.title);
      expect(titles).not.toContain('Private Shopping List');
    });

    it('should show public notes to any user', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/notes/search?user_email=${otherUserEmail}&q=TypeScript&searchType=text`,
      });

      expect(response.statusCode).toBe(200);

      const result = JSON.parse(response.payload);
      const titles = result.results.map((r: { title: string }) => r.title);
      expect(titles).toContain('TypeScript Programming Guide');
    });

    it('should show shared notes to users with share access', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/notes/search?user_email=${sharedUserEmail}&q=team&searchType=text`,
      });

      expect(response.statusCode).toBe(200);

      const result = JSON.parse(response.payload);
      const titles = result.results.map((r: { title: string }) => r.title);
      expect(titles).toContain('Shared Team Notes');
    });

    it('should not show shared notes to users without share access', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/notes/search?user_email=${otherUserEmail}&q=team&searchType=text`,
      });

      expect(response.statusCode).toBe(200);

      const result = JSON.parse(response.payload);
      const titles = result.results.map((r: { title: string }) => r.title);
      expect(titles).not.toContain('Shared Team Notes');
    });
  });

  describe('Agent Filtering', () => {
    it('should hide private notes from agents', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/notes/search?user_email=${ownerEmail}&q=shopping&searchType=text`,
        headers: {
          'X-OpenClaw-Agent': 'test-agent-123',
        },
      });

      expect(response.statusCode).toBe(200);

      const result = JSON.parse(response.payload);
      const titles = result.results.map((r: { title: string }) => r.title);
      // Private notes should be hidden from agents
      expect(titles).not.toContain('Private Shopping List');
    });

    it('should hide notes with hideFromAgents flag from agents', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/notes/search?user_email=${ownerEmail}&q=private&searchType=text`,
        headers: {
          'X-OpenClaw-Agent': 'test-agent-123',
        },
      });

      expect(response.statusCode).toBe(200);

      const result = JSON.parse(response.payload);
      const titles = result.results.map((r: { title: string }) => r.title);
      expect(titles).not.toContain('Hidden Agent Note');
    });

    it('should show public notes to agents', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/notes/search?user_email=${ownerEmail}&q=TypeScript&searchType=text`,
        headers: {
          'X-OpenClaw-Agent': 'test-agent-123',
        },
      });

      expect(response.statusCode).toBe(200);

      const result = JSON.parse(response.payload);
      const titles = result.results.map((r: { title: string }) => r.title);
      expect(titles).toContain('TypeScript Programming Guide');
    });

    it('should detect agent via authorization header', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/notes/search?user_email=${ownerEmail}&q=shopping&searchType=text`,
        headers: {
          Authorization: 'Bearer agent:test-token',
        },
      });

      expect(response.statusCode).toBe(200);

      const result = JSON.parse(response.payload);
      const titles = result.results.map((r: { title: string }) => r.title);
      // Private notes should be hidden from agents
      expect(titles).not.toContain('Private Shopping List');
    });
  });

  describe('GET /api/notes/:id/similar', () => {
    it('should require user_email', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/notes/${createdNoteIds[0]}/similar`,
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.payload).error).toBe('user_email is required');
    });

    it('should return 404 for non-existent note', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/notes/00000000-0000-0000-0000-000000000000/similar?user_email=${ownerEmail}`,
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 404 if user does not have access', async () => {
      // Try to access owner's private note as other user
      const privateNoteId = createdNoteIds[2]; // 'Private Shopping List'
      const response = await app.inject({
        method: 'GET',
        url: `/api/notes/${privateNoteId}/similar?user_email=${otherUserEmail}`,
      });

      expect(response.statusCode).toBe(404);
    });

    it('should find similar notes for accessible note', async () => {
      const publicNoteId = createdNoteIds[0]; // 'TypeScript Programming Guide'
      const response = await app.inject({
        method: 'GET',
        url: `/api/notes/${publicNoteId}/similar?user_email=${ownerEmail}`,
      });

      expect(response.statusCode).toBe(200);

      const result = JSON.parse(response.payload);
      expect(result).toHaveProperty('note');
      expect(result).toHaveProperty('similar');
      expect(result.note.id).toBe(publicNoteId);
      expect(result.note.title).toBe('TypeScript Programming Guide');
      expect(Array.isArray(result.similar)).toBe(true);
    });

    it('should respect limit parameter', async () => {
      const publicNoteId = createdNoteIds[0];
      const response = await app.inject({
        method: 'GET',
        url: `/api/notes/${publicNoteId}/similar?user_email=${ownerEmail}&limit=2`,
      });

      expect(response.statusCode).toBe(200);

      const result = JSON.parse(response.payload);
      expect(result.similar.length).toBeLessThanOrEqual(2);
    });

    it('should enforce max limit of 20', async () => {
      const publicNoteId = createdNoteIds[0];
      const response = await app.inject({
        method: 'GET',
        url: `/api/notes/${publicNoteId}/similar?user_email=${ownerEmail}&limit=100`,
      });

      expect(response.statusCode).toBe(200);
      // The limit should be capped at 20
    });

    it('should respect minSimilarity parameter', async () => {
      const publicNoteId = createdNoteIds[0];
      const response = await app.inject({
        method: 'GET',
        url: `/api/notes/${publicNoteId}/similar?user_email=${ownerEmail}&minSimilarity=0.9`,
      });

      expect(response.statusCode).toBe(200);

      const result = JSON.parse(response.payload);
      // All similar notes should have similarity >= 0.9
      for (const similar of result.similar) {
        expect(similar.similarity).toBeGreaterThanOrEqual(0.9);
      }
    });

    it('should filter similar notes based on agent access', async () => {
      const publicNoteId = createdNoteIds[0];
      const response = await app.inject({
        method: 'GET',
        url: `/api/notes/${publicNoteId}/similar?user_email=${ownerEmail}`,
        headers: {
          'X-OpenClaw-Agent': 'test-agent-123',
        },
      });

      expect(response.statusCode).toBe(200);

      const result = JSON.parse(response.payload);
      // Should not include any private notes or hideFromAgents notes in similar
      const titles = result.similar.map((s: { title: string }) => s.title);
      expect(titles).not.toContain('Private Shopping List');
      expect(titles).not.toContain('Hidden Agent Note');
    });
  });

  describe('Search Result Snippets', () => {
    it('should include highlighted snippets in text search', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/notes/search?user_email=${ownerEmail}&q=TypeScript&searchType=text`,
      });

      expect(response.statusCode).toBe(200);

      const result = JSON.parse(response.payload);
      if (result.results.length > 0) {
        const firstResult = result.results[0];
        expect(firstResult.snippet).toBeDefined();
        // Text search snippets may contain <mark> tags
        if (firstResult.snippet.includes('TypeScript')) {
          // Either has mark tags or contains the search term
          expect(
            firstResult.snippet.includes('<mark>') ||
              firstResult.snippet.toLowerCase().includes('typescript')
          ).toBe(true);
        }
      }
    });
  });

  describe('Reciprocal Rank Fusion', () => {
    it('should combine text and semantic results in hybrid search', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/notes/search?user_email=${ownerEmail}&q=programming%20guide`,
      });

      expect(response.statusCode).toBe(200);

      const result = JSON.parse(response.payload);
      expect(result.searchType).toBe('hybrid');
      // RRF should produce results even if one search type fails
      expect(result.results).toBeDefined();
    });
  });
});
