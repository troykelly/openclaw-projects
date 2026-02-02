import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { buildServer } from '../src/api/server.ts';
import { runMigrate } from './helpers/migrate.js';
import { createTestPool, truncateAllTables } from './helpers/db.js';
import { embeddingService } from '../src/api/embeddings/service.js';

describe('Memory Relationships API', () => {
  const app = buildServer();
  let pool: Pool;

  const hasApiKey = !!(
    process.env.VOYAGERAI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.GEMINI_API_KEY
  );

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
    embeddingService.clearCache();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  // Helper to create a work item
  async function createWorkItem(title: string = 'Test Project'): Promise<string> {
    const result = await pool.query(
      `INSERT INTO work_item (title, description, kind)
       VALUES ($1, 'Test description', 'project')
       RETURNING id::text as id`,
      [title]
    );
    return (result.rows[0] as { id: string }).id;
  }

  // Helper to create a memory
  async function createMemory(
    workItemId: string,
    title: string,
    content: string
  ): Promise<string> {
    const result = await pool.query(
      `INSERT INTO work_item_memory (work_item_id, title, content, memory_type)
       VALUES ($1, $2, $3, 'note')
       RETURNING id::text as id`,
      [workItemId, title, content]
    );
    return (result.rows[0] as { id: string }).id;
  }

  // Helper to create a contact
  async function createContact(name: string): Promise<string> {
    const result = await pool.query(
      `INSERT INTO contact (display_name)
       VALUES ($1)
       RETURNING id::text as id`,
      [name]
    );
    return (result.rows[0] as { id: string }).id;
  }

  describe('POST /api/memories/:id/contacts', () => {
    it('links a memory to a contact', async () => {
      const workItemId = await createWorkItem();
      const memoryId = await createMemory(workItemId, 'Test Memory', 'Test content');
      const contactId = await createContact('John Doe');

      const res = await app.inject({
        method: 'POST',
        url: `/api/memories/${memoryId}/contacts`,
        payload: {
          contactId,
          relationshipType: 'about',
          notes: 'This memory is about John',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.memoryId).toBe(memoryId);
      expect(body.contactId).toBe(contactId);
      expect(body.relationshipType).toBe('about');
      expect(body.notes).toBe('This memory is about John');
    });

    it('returns 400 when contactId is missing', async () => {
      const workItemId = await createWorkItem();
      const memoryId = await createMemory(workItemId, 'Test Memory', 'Test content');

      const res = await app.inject({
        method: 'POST',
        url: `/api/memories/${memoryId}/contacts`,
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('contactId is required');
    });

    it('returns 400 for invalid relationship type', async () => {
      const workItemId = await createWorkItem();
      const memoryId = await createMemory(workItemId, 'Test Memory', 'Test content');
      const contactId = await createContact('John Doe');

      const res = await app.inject({
        method: 'POST',
        url: `/api/memories/${memoryId}/contacts`,
        payload: {
          contactId,
          relationshipType: 'invalid_type',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('relationshipType must be one of');
    });

    it('returns 404 when memory does not exist', async () => {
      const contactId = await createContact('John Doe');

      const res = await app.inject({
        method: 'POST',
        url: '/api/memories/00000000-0000-0000-0000-000000000000/contacts',
        payload: { contactId },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('memory not found');
    });

    it('returns 404 when contact does not exist', async () => {
      const workItemId = await createWorkItem();
      const memoryId = await createMemory(workItemId, 'Test Memory', 'Test content');

      const res = await app.inject({
        method: 'POST',
        url: `/api/memories/${memoryId}/contacts`,
        payload: {
          contactId: '00000000-0000-0000-0000-000000000000',
        },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('contact not found');
    });

    it('upserts on duplicate relationship', async () => {
      const workItemId = await createWorkItem();
      const memoryId = await createMemory(workItemId, 'Test Memory', 'Test content');
      const contactId = await createContact('John Doe');

      // First create
      await app.inject({
        method: 'POST',
        url: `/api/memories/${memoryId}/contacts`,
        payload: {
          contactId,
          relationshipType: 'about',
          notes: 'Original notes',
        },
      });

      // Update with same relationship type
      const res = await app.inject({
        method: 'POST',
        url: `/api/memories/${memoryId}/contacts`,
        payload: {
          contactId,
          relationshipType: 'about',
          notes: 'Updated notes',
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().notes).toBe('Updated notes');
    });
  });

  describe('GET /api/memories/:id/contacts', () => {
    it('returns linked contacts', async () => {
      const workItemId = await createWorkItem();
      const memoryId = await createMemory(workItemId, 'Test Memory', 'Test content');
      const contact1Id = await createContact('John Doe');
      const contact2Id = await createContact('Jane Smith');

      // Link both contacts
      await pool.query(
        `INSERT INTO memory_contact (memory_id, contact_id, relationship_type)
         VALUES ($1, $2, 'about'), ($1, $3, 'from')`,
        [memoryId, contact1Id, contact2Id]
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/memories/${memoryId}/contacts`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.contacts).toHaveLength(2);
      expect(body.contacts.map((c: { contactName: string }) => c.contactName)).toContain('John Doe');
      expect(body.contacts.map((c: { contactName: string }) => c.contactName)).toContain('Jane Smith');
    });

    it('filters by relationship type', async () => {
      const workItemId = await createWorkItem();
      const memoryId = await createMemory(workItemId, 'Test Memory', 'Test content');
      const contact1Id = await createContact('John Doe');
      const contact2Id = await createContact('Jane Smith');

      await pool.query(
        `INSERT INTO memory_contact (memory_id, contact_id, relationship_type)
         VALUES ($1, $2, 'about'), ($1, $3, 'from')`,
        [memoryId, contact1Id, contact2Id]
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/memories/${memoryId}/contacts?relationshipType=about`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.contacts).toHaveLength(1);
      expect(body.contacts[0].contactName).toBe('John Doe');
    });

    it('returns 404 for non-existent memory', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/memories/00000000-0000-0000-0000-000000000000/contacts',
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/memories/:memoryId/contacts/:contactId', () => {
    it('removes memory-contact link', async () => {
      const workItemId = await createWorkItem();
      const memoryId = await createMemory(workItemId, 'Test Memory', 'Test content');
      const contactId = await createContact('John Doe');

      await pool.query(
        `INSERT INTO memory_contact (memory_id, contact_id, relationship_type)
         VALUES ($1, $2, 'about')`,
        [memoryId, contactId]
      );

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/memories/${memoryId}/contacts/${contactId}`,
      });

      expect(res.statusCode).toBe(204);

      // Verify it's deleted
      const check = await pool.query(
        'SELECT 1 FROM memory_contact WHERE memory_id = $1 AND contact_id = $2',
        [memoryId, contactId]
      );
      expect(check.rows).toHaveLength(0);
    });

    it('returns 404 when relationship does not exist', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/memories/00000000-0000-0000-0000-000000000000/contacts/00000000-0000-0000-0000-000000000001',
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /api/contacts/:id/memories', () => {
    it('returns memories linked to a contact', async () => {
      const workItemId = await createWorkItem();
      const memory1Id = await createMemory(workItemId, 'Memory 1', 'Content 1');
      const memory2Id = await createMemory(workItemId, 'Memory 2', 'Content 2');
      const contactId = await createContact('John Doe');

      await pool.query(
        `INSERT INTO memory_contact (memory_id, contact_id, relationship_type)
         VALUES ($1, $3, 'about'), ($2, $3, 'from')`,
        [memory1Id, memory2Id, contactId]
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/contacts/${contactId}/memories`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.memories).toHaveLength(2);
    });

    it('returns 404 for non-existent contact', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/contacts/00000000-0000-0000-0000-000000000000/memories',
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /api/memories/:id/related', () => {
    it('links two memories together', async () => {
      const workItemId = await createWorkItem();
      const memory1Id = await createMemory(workItemId, 'Memory 1', 'Content 1');
      const memory2Id = await createMemory(workItemId, 'Memory 2', 'Content 2');

      const res = await app.inject({
        method: 'POST',
        url: `/api/memories/${memory1Id}/related`,
        payload: {
          relatedMemoryId: memory2Id,
          relationshipType: 'supports',
          notes: 'Memory 2 supports Memory 1',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.memoryId).toBe(memory1Id);
      expect(body.relatedMemoryId).toBe(memory2Id);
      expect(body.relationshipType).toBe('supports');
    });

    it('returns 400 when relatedMemoryId is missing', async () => {
      const workItemId = await createWorkItem();
      const memoryId = await createMemory(workItemId, 'Memory 1', 'Content 1');

      const res = await app.inject({
        method: 'POST',
        url: `/api/memories/${memoryId}/related`,
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('relatedMemoryId is required');
    });

    it('returns 400 for self-referential relationship', async () => {
      const workItemId = await createWorkItem();
      const memoryId = await createMemory(workItemId, 'Memory 1', 'Content 1');

      const res = await app.inject({
        method: 'POST',
        url: `/api/memories/${memoryId}/related`,
        payload: {
          relatedMemoryId: memoryId,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('cannot create self-referential relationship');
    });

    it('returns 400 for invalid relationship type', async () => {
      const workItemId = await createWorkItem();
      const memory1Id = await createMemory(workItemId, 'Memory 1', 'Content 1');
      const memory2Id = await createMemory(workItemId, 'Memory 2', 'Content 2');

      const res = await app.inject({
        method: 'POST',
        url: `/api/memories/${memory1Id}/related`,
        payload: {
          relatedMemoryId: memory2Id,
          relationshipType: 'invalid_type',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('relationshipType must be one of');
    });

    it('returns 404 when one or both memories do not exist', async () => {
      const workItemId = await createWorkItem();
      const memoryId = await createMemory(workItemId, 'Memory 1', 'Content 1');

      const res = await app.inject({
        method: 'POST',
        url: `/api/memories/${memoryId}/related`,
        payload: {
          relatedMemoryId: '00000000-0000-0000-0000-000000000000',
        },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('one or both memories not found');
    });
  });

  describe('GET /api/memories/:id/related', () => {
    it('returns related memories in both directions', async () => {
      const workItemId = await createWorkItem();
      const memory1Id = await createMemory(workItemId, 'Memory 1', 'Content 1');
      const memory2Id = await createMemory(workItemId, 'Memory 2', 'Content 2');
      const memory3Id = await createMemory(workItemId, 'Memory 3', 'Content 3');

      // Memory 1 -> Memory 2 (outgoing)
      await pool.query(
        `INSERT INTO memory_relationship (memory_id, related_memory_id, relationship_type)
         VALUES ($1, $2, 'supports')`,
        [memory1Id, memory2Id]
      );

      // Memory 3 -> Memory 1 (incoming to memory 1)
      await pool.query(
        `INSERT INTO memory_relationship (memory_id, related_memory_id, relationship_type)
         VALUES ($1, $2, 'related')`,
        [memory3Id, memory1Id]
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/memories/${memory1Id}/related`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.related).toHaveLength(2);

      const outgoing = body.related.filter((r: { direction: string }) => r.direction === 'outgoing');
      const incoming = body.related.filter((r: { direction: string }) => r.direction === 'incoming');

      expect(outgoing).toHaveLength(1);
      expect(outgoing[0].title).toBe('Memory 2');

      expect(incoming).toHaveLength(1);
      expect(incoming[0].title).toBe('Memory 3');
    });

    it('filters by direction', async () => {
      const workItemId = await createWorkItem();
      const memory1Id = await createMemory(workItemId, 'Memory 1', 'Content 1');
      const memory2Id = await createMemory(workItemId, 'Memory 2', 'Content 2');
      const memory3Id = await createMemory(workItemId, 'Memory 3', 'Content 3');

      await pool.query(
        `INSERT INTO memory_relationship (memory_id, related_memory_id, relationship_type)
         VALUES ($1, $2, 'supports'), ($3, $1, 'related')`,
        [memory1Id, memory2Id, memory3Id]
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/memories/${memory1Id}/related?direction=outgoing`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.related).toHaveLength(1);
      expect(body.related[0].title).toBe('Memory 2');
    });

    it('returns 404 for non-existent memory', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/memories/00000000-0000-0000-0000-000000000000/related',
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/memories/:memoryId/related/:relatedMemoryId', () => {
    it('removes memory relationship in either direction', async () => {
      const workItemId = await createWorkItem();
      const memory1Id = await createMemory(workItemId, 'Memory 1', 'Content 1');
      const memory2Id = await createMemory(workItemId, 'Memory 2', 'Content 2');

      await pool.query(
        `INSERT INTO memory_relationship (memory_id, related_memory_id, relationship_type)
         VALUES ($1, $2, 'supports')`,
        [memory1Id, memory2Id]
      );

      // Delete using reverse order (should still work)
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/memories/${memory2Id}/related/${memory1Id}`,
      });

      expect(res.statusCode).toBe(204);

      // Verify it's deleted
      const check = await pool.query(
        'SELECT 1 FROM memory_relationship WHERE memory_id = $1 AND related_memory_id = $2',
        [memory1Id, memory2Id]
      );
      expect(check.rows).toHaveLength(0);
    });

    it('returns 404 when relationship does not exist', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/memories/00000000-0000-0000-0000-000000000000/related/00000000-0000-0000-0000-000000000001',
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /api/memories/:id/similar', () => {
    it('returns 404 for non-existent memory', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/memories/00000000-0000-0000-0000-000000000000/similar',
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 400 when memory has no embedding', async () => {
      const workItemId = await createWorkItem();
      const memoryId = await createMemory(workItemId, 'Test Memory', 'Test content');

      const res = await app.inject({
        method: 'GET',
        url: `/api/memories/${memoryId}/similar`,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('source memory does not have an embedding');
    });

    it.skipIf(!hasApiKey)('finds semantically similar memories', async () => {
      const workItemId = await createWorkItem();

      // Create memories via API to generate embeddings
      const create1 = await app.inject({
        method: 'POST',
        url: '/api/memory',
        payload: {
          title: 'Dark Mode Preference',
          content: 'User prefers dark mode for reduced eye strain',
          linkedItemId: workItemId,
          type: 'note',
        },
      });
      const memory1Id = create1.json().id;

      const create2 = await app.inject({
        method: 'POST',
        url: '/api/memory',
        payload: {
          title: 'Theme Settings',
          content: 'User likes dark themes with low contrast',
          linkedItemId: workItemId,
          type: 'note',
        },
      });

      const create3 = await app.inject({
        method: 'POST',
        url: '/api/memory',
        payload: {
          title: 'Grocery List',
          content: 'Need to buy milk, eggs, and bread',
          linkedItemId: workItemId,
          type: 'note',
        },
      });

      // Search for similar memories
      const res = await app.inject({
        method: 'GET',
        url: `/api/memories/${memory1Id}/similar?threshold=0.5`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.source_memory_id).toBe(memory1Id);
      expect(body.similar.length).toBeGreaterThan(0);
      // Theme settings should be more similar than grocery list
      const titles = body.similar.map((m: { title: string }) => m.title);
      expect(titles).toContain('Theme Settings');
    });
  });

  describe('GET /api/work-items/:id/related-entities', () => {
    it('returns 404 for non-existent work item', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/work-items/00000000-0000-0000-0000-000000000000/related-entities',
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns directly linked contacts and memories', async () => {
      const workItemId = await createWorkItem();
      const memoryId = await createMemory(workItemId, 'Test Memory', 'Test content');
      const contactId = await createContact('John Doe');

      // Link contact to work item
      await pool.query(
        `INSERT INTO work_item_contact (work_item_id, contact_id, relationship)
         VALUES ($1, $2, 'owner')`,
        [workItemId, contactId]
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${workItemId}/related-entities`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.contacts.direct).toHaveLength(1);
      expect(body.contacts.direct[0].displayName).toBe('John Doe');

      expect(body.memories.direct).toHaveLength(1);
      expect(body.memories.direct[0].title).toBe('Test Memory');
    });

    it('returns contacts linked via memories', async () => {
      const workItemId = await createWorkItem();
      const memoryId = await createMemory(workItemId, 'Test Memory', 'Test content');
      const contactId = await createContact('Jane Smith');

      // Link contact to memory (not directly to work item)
      await pool.query(
        `INSERT INTO memory_contact (memory_id, contact_id, relationship_type)
         VALUES ($1, $2, 'mentioned')`,
        [memoryId, contactId]
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${workItemId}/related-entities`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.contacts.direct).toHaveLength(0);
      expect(body.contacts.via_memory).toHaveLength(1);
      expect(body.contacts.via_memory[0].displayName).toBe('Jane Smith');
    });
  });
});
