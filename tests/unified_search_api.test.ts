import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { buildServer } from '../src/api/server.ts';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { embeddingService } from '../src/api/embeddings/service.ts';

describe('Unified Search API', () => {
  const app = buildServer();
  let pool: Pool;

  const hasApiKey = !!(process.env.VOYAGERAI_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY);

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

  // Helper to create a work item (as a project, which doesn't require a parent)
  async function createWorkItem(title: string, description: string = ''): Promise<string> {
    const result = await pool.query(
      `INSERT INTO work_item (title, description, kind)
       VALUES ($1, $2, 'project')
       RETURNING id::text as id`,
      [title, description],
    );
    return (result.rows[0] as { id: string }).id;
  }

  // Helper to create a contact
  async function createContact(name: string, notes: string = ''): Promise<string> {
    const result = await pool.query(
      `INSERT INTO contact (display_name, notes)
       VALUES ($1, $2)
       RETURNING id::text as id`,
      [name, notes],
    );
    return (result.rows[0] as { id: string }).id;
  }

  // Helper to create a memory
  async function createMemory(workItemId: string, title: string, content: string): Promise<string> {
    const result = await pool.query(
      `INSERT INTO memory (work_item_id, title, content, memory_type)
       VALUES ($1, $2, $3, 'note')
       RETURNING id::text as id`,
      [workItemId, title, content],
    );
    return (result.rows[0] as { id: string }).id;
  }

  // Helper to create a message (requires contact and endpoint)
  async function createMessage(body: string): Promise<string> {
    // Create a contact first
    const contact = await pool.query(
      `INSERT INTO contact (display_name) VALUES ('Test Sender')
       RETURNING id::text as id`,
    );
    const contactId = (contact.rows[0] as { id: string }).id;

    // Create an endpoint for the contact
    const endpoint = await pool.query(
      `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value, normalized_value)
       VALUES ($1, 'email', 'test@example.com', 'test@example.com')
       RETURNING id::text as id`,
      [contactId],
    );
    const endpointId = (endpoint.rows[0] as { id: string }).id;

    // Create thread with endpoint
    const thread = await pool.query(
      `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
       VALUES ($1, 'email', $2)
       RETURNING id::text as id`,
      [endpointId, `thread-${Date.now()}`],
    );
    const threadId = (thread.rows[0] as { id: string }).id;

    const result = await pool.query(
      `INSERT INTO external_message (thread_id, external_message_key, direction, body)
       VALUES ($1, $2, 'inbound', $3)
       RETURNING id::text as id`,
      [threadId, `msg-${Date.now()}`, body],
    );
    return (result.rows[0] as { id: string }).id;
  }

  describe('GET /api/search', () => {
    it('returns empty results when query is empty', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/search',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results).toEqual([]);
      expect(body.total).toBe(0);
      expect(body.facets).toBeDefined();
    });

    it('returns empty results when query has no matches', async () => {
      await createWorkItem('Test Project', 'A sample project');

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=nonexistent_xyz_123',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results).toEqual([]);
    });

    it('searches work items by title', async () => {
      await createWorkItem('Build tiny house foundation', 'Concrete and rebar work');
      await createWorkItem('Paint bedroom walls', 'Blue color scheme');

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=tiny+house',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results.length).toBeGreaterThan(0);
      expect(body.results[0].type).toBe('work_item');
      expect(body.results[0].title).toContain('tiny house');
    });

    it('searches work items by description', async () => {
      await createWorkItem('Foundation Work', 'Pour concrete and set rebar anchors');

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=concrete+rebar',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results.length).toBeGreaterThan(0);
      expect(body.results[0].type).toBe('work_item');
    });

    it('searches contacts by display name', async () => {
      await createContact('John Smith', 'Project manager');
      await createContact('Jane Doe', 'Designer');

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=john+smith',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results.length).toBeGreaterThan(0);
      expect(body.results[0].type).toBe('contact');
      expect(body.results[0].title).toBe('John Smith');
    });

    it('searches memories by title and content', async () => {
      const workItemId = await createWorkItem('Test Project', 'Test');
      await createMemory(workItemId, 'Meeting Notes', 'Discussed the budget for solar panels');

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=solar+panels',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results.length).toBeGreaterThan(0);
      expect(body.results[0].type).toBe('memory');
    });

    it('searches messages by body', async () => {
      await createMessage('Please review the project timeline and let me know your thoughts');

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=project+timeline',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results.length).toBeGreaterThan(0);
      expect(body.results[0].type).toBe('message');
    });

    it('filters by entity types', async () => {
      await createWorkItem('Tiny House Build', 'Main project');
      await createContact('Tiny Tim', 'Helper');

      // Search only work items
      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=tiny&types=work_item',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results.every((r: { type: string }) => r.type === 'work_item')).toBe(true);
    });

    it('filters by multiple entity types', async () => {
      await createWorkItem('Tiny House Build', 'Main project');
      await createContact('Tiny Tim', 'Helper');
      const workItemId = await createWorkItem('Parent', 'Test');
      await createMemory(workItemId, 'Tiny home specs', 'Dimensions and materials');

      // Search work items and memories only
      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=tiny&types=work_item,memory',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results.every((r: { type: string }) => r.type === 'work_item' || r.type === 'memory')).toBe(true);
      // Should not include contacts
      expect(body.results.some((r: { type: string }) => r.type === 'contact')).toBe(false);
    });

    it('respects limit parameter', async () => {
      // Create many work items
      for (let i = 0; i < 10; i++) {
        await createWorkItem(`Project ${i}`, 'Test project description');
      }

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=project&limit=3',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results.length).toBeLessThanOrEqual(3);
    });

    it('returns facet counts', async () => {
      await createWorkItem('Tiny house project', 'Main build');
      await createContact('Tiny Tim', 'Helper');

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=tiny',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.facets).toBeDefined();
      expect(body.facets.work_item).toBeGreaterThanOrEqual(0);
      expect(body.facets.contact).toBeGreaterThanOrEqual(0);
      expect(body.facets.memory).toBeGreaterThanOrEqual(0);
      expect(body.facets.message).toBeGreaterThanOrEqual(0);
    });

    it('returns search type indicator', async () => {
      await createWorkItem('Test Project', 'Description');

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=test',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(['text', 'semantic', 'hybrid']).toContain(body.search_type);
    });

    it('can disable semantic search', async () => {
      await createWorkItem('Test Project', 'Description');

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=test&semantic=false',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.search_type).toBe('text');
    });

    it('includes URL for work items', async () => {
      const id = await createWorkItem('Test Project', 'Description');

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=test',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      const workItemResult = body.results.find((r: { type: string }) => r.type === 'work_item');
      expect(workItemResult.url).toBe(`/app/work-items/${id}`);
    });

    it('includes URL for contacts', async () => {
      const id = await createContact('Test Person', 'Notes');

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=test',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      const contactResult = body.results.find((r: { type: string }) => r.type === 'contact');
      expect(contactResult.url).toBe(`/app/contacts/${id}`);
    });

    it('returns results ranked by relevance', async () => {
      // Create items with varying relevance
      await createWorkItem('Tiny house construction', 'Building a tiny house from scratch');
      await createWorkItem('Construction materials', 'General building supplies');

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=tiny+house',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results.length).toBeGreaterThan(0);
      // First result should have "tiny house" in title (more relevant)
      expect(body.results[0].title.toLowerCase()).toContain('tiny house');
    });

    it.skipIf(!hasApiKey)('performs hybrid search with embeddings', async () => {
      const workItemId = await createWorkItem('Test Project', 'Test');

      // Create memory via API (generates embedding)
      await app.inject({
        method: 'POST',
        url: '/api/memory',
        payload: {
          title: 'Dark Theme Preference',
          content: 'User prefers dark mode for reduced eye strain during evening work',
          linkedItemId: workItemId,
          type: 'note',
        },
      });

      // Search with semantic enabled (default)
      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=night+mode+theme&types=memory',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.search_type).toBe('hybrid');
      expect(body.embedding_provider).toBeDefined();
    });
  });

  describe('Full-text search features', () => {
    it('handles stemming (finds "building" when searching "build")', async () => {
      await createWorkItem('Building a deck', 'Deck construction project');

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=build',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results.length).toBeGreaterThan(0);
      expect(body.results[0].title.toLowerCase()).toContain('building');
    });

    it('handles multiple word queries', async () => {
      await createWorkItem('Solar panel installation', 'Installing panels on the roof');

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=solar+panel+roof',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results.length).toBeGreaterThan(0);
    });

    it('searches across multiple entity types simultaneously', async () => {
      await createWorkItem('Budget planning', 'Financial planning for project');
      await createContact('Budget Manager', 'Handles finances');
      const workItemId = await createWorkItem('Parent', 'Test');
      await createMemory(workItemId, 'Budget decisions', 'Set budget to $50,000');
      await createMessage('Please update the budget spreadsheet');

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=budget',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      // Should have results from multiple types
      const types = new Set(body.results.map((r: { type: string }) => r.type));
      expect(types.size).toBeGreaterThan(1);
    });
  });
});
