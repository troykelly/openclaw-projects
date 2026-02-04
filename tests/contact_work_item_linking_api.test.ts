import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

describe('Contact-WorkItem Linking API (issue #118)', () => {
  const app = buildServer();
  let pool: Pool;
  let workItemId: string;
  let contactId: string;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);

    // Create a work item
    const wi = await app.inject({
      method: 'POST',
      url: '/api/work-items',
      payload: { title: 'Test Project', kind: 'project' },
    });
    workItemId = (wi.json() as { id: string }).id;

    // Create a contact
    const contact = await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { displayName: 'John Doe' },
    });
    contactId = (contact.json() as { id: string }).id;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  describe('POST /api/work-items/:id/contacts', () => {
    it('links a contact to a work item with relationship', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/work-items/${workItemId}/contacts`,
        payload: {
          contactId,
          relationship: 'owner',
        },
      });
      expect(res.statusCode).toBe(201);

      const body = res.json() as {
        workItemId: string;
        contactId: string;
        relationship: string;
        contactName: string;
      };
      expect(body.workItemId).toBe(workItemId);
      expect(body.contactId).toBe(contactId);
      expect(body.relationship).toBe('owner');
      expect(body.contactName).toBe('John Doe');
    });

    it('supports all relationship types', async () => {
      const relationships = ['owner', 'assignee', 'stakeholder', 'reviewer'];

      for (const relationship of relationships) {
        // Create a new contact for each relationship
        const contact = await app.inject({
          method: 'POST',
          url: '/api/contacts',
          payload: { displayName: `Contact ${relationship}` },
        });
        const cId = (contact.json() as { id: string }).id;

        const res = await app.inject({
          method: 'POST',
          url: `/api/work-items/${workItemId}/contacts`,
          payload: { contactId: cId, relationship },
        });
        expect(res.statusCode).toBe(201);
        expect(res.json().relationship).toBe(relationship);
      }
    });

    it('returns 400 for invalid relationship type', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/work-items/${workItemId}/contacts`,
        payload: {
          contactId,
          relationship: 'invalid',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('relationship must be one of');
    });

    it('returns 400 when contactId is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/work-items/${workItemId}/contacts`,
        payload: { relationship: 'owner' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'contactId is required' });
    });

    it('returns 400 when relationship is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/work-items/${workItemId}/contacts`,
        payload: { contactId },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'relationship is required' });
    });

    it('returns 404 for non-existent work item', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/work-items/00000000-0000-0000-0000-000000000000/contacts',
        payload: { contactId, relationship: 'owner' },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'work item not found' });
    });

    it('returns 400 for non-existent contact', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/work-items/${workItemId}/contacts`,
        payload: {
          contactId: '00000000-0000-0000-0000-000000000000',
          relationship: 'owner',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'contact not found' });
    });

    it('returns 409 when link already exists', async () => {
      // Create the link first
      await app.inject({
        method: 'POST',
        url: `/api/work-items/${workItemId}/contacts`,
        payload: { contactId, relationship: 'owner' },
      });

      // Try to create the same link again
      const res = await app.inject({
        method: 'POST',
        url: `/api/work-items/${workItemId}/contacts`,
        payload: { contactId, relationship: 'assignee' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'contact already linked to this work item' });
    });
  });

  describe('DELETE /api/work-items/:id/contacts/:contactId', () => {
    beforeEach(async () => {
      // Create a link
      await app.inject({
        method: 'POST',
        url: `/api/work-items/${workItemId}/contacts`,
        payload: { contactId, relationship: 'owner' },
      });
    });

    it('unlinks a contact from a work item', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/work-items/${workItemId}/contacts/${contactId}`,
      });
      expect(res.statusCode).toBe(204);

      // Verify the link is removed
      const check = await pool.query(
        'SELECT 1 FROM work_item_contact WHERE work_item_id = $1 AND contact_id = $2',
        [workItemId, contactId]
      );
      expect(check.rows.length).toBe(0);
    });

    it('returns 404 for non-existent work item', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/work-items/00000000-0000-0000-0000-000000000000/contacts/${contactId}`,
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not found' });
    });

    it('returns 404 when link does not exist', async () => {
      // Create another contact that is not linked
      const otherContact = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { displayName: 'Jane Doe' },
      });
      const otherContactId = (otherContact.json() as { id: string }).id;

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/work-items/${workItemId}/contacts/${otherContactId}`,
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not found' });
    });
  });

  describe('GET /api/work-items/:id/contacts', () => {
    it('returns linked contacts for a work item', async () => {
      // Create multiple contacts and link them
      const contact1 = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { displayName: 'Alice' },
      });
      const contact1Id = (contact1.json() as { id: string }).id;

      const contact2 = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { displayName: 'Bob' },
      });
      const contact2Id = (contact2.json() as { id: string }).id;

      await app.inject({
        method: 'POST',
        url: `/api/work-items/${workItemId}/contacts`,
        payload: { contactId: contact1Id, relationship: 'owner' },
      });
      await app.inject({
        method: 'POST',
        url: `/api/work-items/${workItemId}/contacts`,
        payload: { contactId: contact2Id, relationship: 'assignee' },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${workItemId}/contacts`,
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as {
        contacts: Array<{
          contactId: string;
          displayName: string;
          relationship: string;
        }>;
      };
      expect(body.contacts.length).toBe(2);

      const alice = body.contacts.find(c => c.displayName === 'Alice');
      const bob = body.contacts.find(c => c.displayName === 'Bob');
      expect(alice?.relationship).toBe('owner');
      expect(bob?.relationship).toBe('assignee');
    });

    it('returns empty array when no contacts linked', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${workItemId}/contacts`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ contacts: [] });
    });

    it('returns 404 for non-existent work item', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/work-items/00000000-0000-0000-0000-000000000000/contacts',
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not found' });
    });
  });
});
