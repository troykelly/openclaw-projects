import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.js';
import { createTestPool, truncateAllTables } from './helpers/db.js';
import { buildServer } from '../src/api/server.js';

/**
 * Tests for Contacts Page integration (issue #133).
 * These tests verify that the /app/contacts route works and
 * the contacts API returns data in the correct format for the page.
 */
describe('Contacts Page', () => {
  const app = buildServer();
  let pool: Pool;

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

  describe('GET /app/contacts', () => {
    it('renders the contacts page (returns HTML)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/app/contacts',
        headers: {
          accept: 'text/html',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
    });

    it('returns bootstrap data with contacts route', async () => {
      // Create a session cookie for authentication
      const pool2 = createTestPool();
      const session = await pool2.query(
        `INSERT INTO auth_session (email, expires_at)
         VALUES ('test@example.com', now() + interval '1 hour')
         RETURNING id::text as id`
      );
      const sessionId = (session.rows[0] as { id: string }).id;
      await pool2.end();

      const res = await app.inject({
        method: 'GET',
        url: '/app/contacts',
        cookies: {
          projects_session: sessionId,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.payload).toContain('app-bootstrap');
      expect(res.payload).toContain('"contacts"');
    });
  });

  describe('Contacts API for Page', () => {
    it('returns contacts list for the page to display', async () => {
      // Create some contacts (using display_name, the actual column name)
      await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('Alice Smith'), ('Bob Jones')`
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/contacts',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { contacts: unknown[]; total: number };
      expect(body.contacts.length).toBe(2);
      expect(body.total).toBe(2);
    });

    it('allows creating a contact from the page', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: {
          displayName: 'New Contact',
          notes: 'Some notes',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string; display_name: string };
      expect(body.display_name).toBe('New Contact');
      expect(body.id).toBeDefined();
    });

    it('allows updating a contact from the page', async () => {
      const contact = await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('Original Name')
         RETURNING id::text as id`
      );
      const contactId = (contact.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/contacts/${contactId}`,
        payload: {
          displayName: 'Updated Name',
          notes: 'Added notes',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { display_name: string; notes: string };
      expect(body.display_name).toBe('Updated Name');
      expect(body.notes).toBe('Added notes');
    });

    it('allows deleting a contact from the page', async () => {
      const contact = await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('To Delete')
         RETURNING id::text as id`
      );
      const contactId = (contact.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/contacts/${contactId}`,
      });

      expect(res.statusCode).toBe(204);

      // Verify deleted
      const checkRes = await app.inject({
        method: 'GET',
        url: `/api/contacts/${contactId}`,
      });
      expect(checkRes.statusCode).toBe(404);
    });

    it('returns contact details with endpoints', async () => {
      // Create a contact
      const contact = await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('With Endpoints')
         RETURNING id::text as id`
      );
      const contactId = (contact.rows[0] as { id: string }).id;

      // Add an endpoint
      await pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value, normalized_value)
         VALUES ($1, 'email', 'test@example.com', 'test@example.com')`,
        [contactId]
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/contacts/${contactId}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        display_name: string;
        endpoints: Array<{ type: string; value: string }>;
      };
      expect(body.display_name).toBe('With Endpoints');
      expect(body.endpoints.length).toBe(1);
      expect(body.endpoints[0].type).toBe('email');
    });

    it('supports search filtering contacts', async () => {
      await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('Alice Smith'), ('Bob Jones'), ('Charlie Acme')`
      );

      // Add email endpoints for searching
      const contacts = await pool.query(
        `SELECT id::text as id, display_name FROM contact ORDER BY display_name`
      );
      const rows = contacts.rows as Array<{ id: string; display_name: string }>;

      // Alice has acme email
      await pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value, normalized_value)
         VALUES ($1, 'email', 'alice@acme.com', 'alice@acme.com')`,
        [rows[0].id]
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/contacts?search=acme',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { contacts: Array<{ display_name: string }> };
      // Should match Alice (email acme.com) and Charlie (name contains Acme)
      expect(body.contacts.length).toBeGreaterThanOrEqual(2);
      const names = body.contacts.map((c) => c.display_name);
      expect(names).toContain('Alice Smith');
      expect(names).toContain('Charlie Acme');
    });

    it('returns associated work items for a contact', async () => {
      // Create a contact with an email endpoint
      const contact = await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('Linked Contact')
         RETURNING id::text as id`
      );
      const contactId = (contact.rows[0] as { id: string }).id;

      const endpoint = await pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value, normalized_value)
         VALUES ($1, 'email', 'linked@example.com', 'linked@example.com')
         RETURNING id::text as id`,
        [contactId]
      );
      const endpointId = (endpoint.rows[0] as { id: string }).id;

      // Create a work item
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`
      );
      const itemId = (item.rows[0] as { id: string }).id;

      // Create external thread (requires endpoint_id)
      const thread = await pool.query(
        `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
         VALUES ($1, 'email', 'linked@example.com')
         RETURNING id::text as id`,
        [endpointId]
      );
      const threadId = (thread.rows[0] as { id: string }).id;

      await pool.query(
        `INSERT INTO work_item_communication (work_item_id, thread_id)
         VALUES ($1, $2)`,
        [itemId, threadId]
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/contacts/${contactId}/work-items`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { work_items: Array<{ title: string }> };
      expect(body.work_items.length).toBe(1);
      expect(body.work_items[0].title).toBe('Test Item');
    });
  });
});
