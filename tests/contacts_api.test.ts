import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

/**
 * Tests for Contacts API endpoints (issue #132).
 */
describe('Contacts API', () => {
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

  describe('GET /api/contacts', () => {
    it('returns empty array when no contacts exist', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/contacts',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { contacts: unknown[]; total: number };
      expect(body.contacts).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('returns contacts with endpoints', async () => {
      // Create a contact
      const created = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { displayName: 'John Doe', notes: 'Test contact' },
      });
      const { id } = created.json() as { id: string };

      // Add an endpoint
      await app.inject({
        method: 'POST',
        url: `/api/contacts/${id}/endpoints`,
        payload: { endpointType: 'email', endpointValue: 'john@example.com' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/contacts',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        contacts: Array<{
          id: string;
          display_name: string;
          notes: string;
          endpoints: Array<{ type: string; value: string }>;
        }>;
        total: number;
      };
      expect(body.contacts.length).toBe(1);
      expect(body.contacts[0].display_name).toBe('John Doe');
      expect(body.contacts[0].notes).toBe('Test contact');
      expect(body.contacts[0].endpoints.length).toBe(1);
      expect(body.contacts[0].endpoints[0].type).toBe('email');
      expect(body.contacts[0].endpoints[0].value).toBe('john@example.com');
      expect(body.total).toBe(1);
    });

    it('supports search by name', async () => {
      // Create two contacts
      await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { displayName: 'Alice Smith' },
      });
      await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { displayName: 'Bob Jones' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/contacts?search=alice',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { contacts: Array<{ display_name: string }>; total: number };
      expect(body.contacts.length).toBe(1);
      expect(body.contacts[0].display_name).toBe('Alice Smith');
    });

    it('supports search by email', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { displayName: 'Alice Smith' },
      });
      const { id } = created.json() as { id: string };

      await app.inject({
        method: 'POST',
        url: `/api/contacts/${id}/endpoints`,
        payload: { endpointType: 'email', endpointValue: 'alice@example.com' },
      });

      await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { displayName: 'Bob Jones' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/contacts?search=alice@example',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { contacts: Array<{ display_name: string }>; total: number };
      expect(body.contacts.length).toBe(1);
      expect(body.contacts[0].display_name).toBe('Alice Smith');
    });

    it('supports pagination with limit and offset', async () => {
      // Create 5 contacts
      for (let i = 0; i < 5; i++) {
        await app.inject({
          method: 'POST',
          url: '/api/contacts',
          payload: { displayName: `Contact ${i}` },
        });
      }

      const res = await app.inject({
        method: 'GET',
        url: '/api/contacts?limit=2&offset=2',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { contacts: unknown[]; total: number };
      expect(body.contacts.length).toBe(2);
      expect(body.total).toBe(5);
    });
  });

  describe('POST /api/contacts (snake_case fields, issue #1411)', () => {
    it('accepts display_name (snake_case) instead of displayName', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { display_name: 'Snake Case Name', notes: 'Created with snake_case' },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string };
      expect(body.id).toBeDefined();

      // Verify the contact was created with the correct name
      const get = await app.inject({
        method: 'GET',
        url: `/api/contacts/${body.id}`,
      });
      expect(get.statusCode).toBe(200);
      const contact = get.json() as { display_name: string; notes: string };
      expect(contact.display_name).toBe('Snake Case Name');
      expect(contact.notes).toBe('Created with snake_case');
    });

    it('accepts contact_kind (snake_case) instead of contactKind', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { display_name: 'Org Contact', contact_kind: 'organisation' },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string };

      const get = await app.inject({
        method: 'GET',
        url: `/api/contacts/${body.id}`,
      });
      const contact = get.json() as { contact_kind: string };
      expect(contact.contact_kind).toBe('organisation');
    });

    it('prefers displayName over display_name when both provided', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { displayName: 'CamelWins', display_name: 'SnakeLoses' },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string };

      const get = await app.inject({
        method: 'GET',
        url: `/api/contacts/${body.id}`,
      });
      const contact = get.json() as { display_name: string };
      expect(contact.display_name).toBe('CamelWins');
    });

    it('rejects request when neither displayName nor display_name is provided', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { notes: 'No name provided' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/contacts/:id', () => {
    it('returns 404 for non-existent contact', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/contacts/00000000-0000-0000-0000-000000000000',
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns single contact with endpoints', async () => {
      // Create a contact
      const created = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { displayName: 'Jane Doe', notes: 'VIP contact' },
      });
      const { id } = created.json() as { id: string };

      // Add endpoints
      await app.inject({
        method: 'POST',
        url: `/api/contacts/${id}/endpoints`,
        payload: { endpointType: 'email', endpointValue: 'jane@example.com' },
      });
      await app.inject({
        method: 'POST',
        url: `/api/contacts/${id}/endpoints`,
        payload: { endpointType: 'phone', endpointValue: '+1234567890' },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/contacts/${id}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        id: string;
        display_name: string;
        notes: string;
        endpoints: Array<{ type: string; value: string }>;
        created_at: string;
      };
      expect(body.id).toBe(id);
      expect(body.display_name).toBe('Jane Doe');
      expect(body.notes).toBe('VIP contact');
      expect(body.endpoints.length).toBe(2);
      expect(body.created_at).toBeDefined();
    });
  });

  describe('PATCH /api/contacts/:id', () => {
    it('returns 404 for non-existent contact', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/contacts/00000000-0000-0000-0000-000000000000',
        payload: { displayName: 'Updated' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('updates contact display name', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { displayName: 'Original Name' },
      });
      const { id } = created.json() as { id: string };

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/contacts/${id}`,
        payload: { displayName: 'Updated Name' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { display_name: string };
      expect(body.display_name).toBe('Updated Name');
    });

    it('updates contact notes', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { displayName: 'Test Contact', notes: 'Original notes' },
      });
      const { id } = created.json() as { id: string };

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/contacts/${id}`,
        payload: { notes: 'Updated notes' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { notes: string };
      expect(body.notes).toBe('Updated notes');
    });

    it('allows clearing notes with null', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { displayName: 'Test Contact', notes: 'Some notes' },
      });
      const { id } = created.json() as { id: string };

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/contacts/${id}`,
        payload: { notes: null },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { notes: string | null };
      expect(body.notes).toBeNull();
    });
  });

  describe('DELETE /api/contacts/:id', () => {
    it('returns 404 for non-existent contact', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/contacts/00000000-0000-0000-0000-000000000000',
      });

      expect(res.statusCode).toBe(404);
    });

    it('deletes contact and returns 204', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { displayName: 'To Delete' },
      });
      const { id } = created.json() as { id: string };

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/contacts/${id}`,
      });

      expect(res.statusCode).toBe(204);

      // Verify it's deleted
      const check = await app.inject({
        method: 'GET',
        url: `/api/contacts/${id}`,
      });
      expect(check.statusCode).toBe(404);
    });

    it('deletes associated endpoints (cascade)', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { displayName: 'With Endpoints' },
      });
      const { id } = created.json() as { id: string };

      await app.inject({
        method: 'POST',
        url: `/api/contacts/${id}/endpoints`,
        payload: { endpointType: 'email', endpointValue: 'test@example.com' },
      });

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/contacts/${id}`,
      });

      expect(res.statusCode).toBe(204);
    });
  });

  describe('GET /api/contacts/:id/work-items', () => {
    it('returns 404 for non-existent contact', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/contacts/00000000-0000-0000-0000-000000000000/work-items',
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns empty array when contact has no associated work items', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { displayName: 'No Work Items' },
      });
      const { id } = created.json() as { id: string };

      const res = await app.inject({
        method: 'GET',
        url: `/api/contacts/${id}/work-items`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { work_items: unknown[] };
      expect(body.work_items).toEqual([]);
    });
  });
});
