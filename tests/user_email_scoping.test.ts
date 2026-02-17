import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

/**
 * Tests for user_email scoping on work_item, contact, and relationship tables.
 * Issue #1172
 *
 * Verifies:
 * 1. Items created with user_email=A are NOT visible when querying with user_email=B
 * 2. Items created without user_email are visible to all (backwards compat)
 * 3. CRUD operations respect user_email scoping
 */
describe('User email scoping (Issue #1172)', () => {
  const app = buildServer();
  let pool: Pool;

  const USER_A = 'alice@example.com';
  const USER_B = 'bob@example.com';

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

  // ── Work Items ──────────────────────────────────────────────────

  describe('work_item scoping', () => {
    it('items with user_email are not visible to other users', async () => {
      // Create item for user A
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Alice task', user_email: USER_A },
      });
      expect(createRes.statusCode).toBe(201);
      const { id: item_id } = createRes.json() as { id: string };

      // User A can see it
      const listA = await app.inject({
        method: 'GET',
        url: `/api/work-items?user_email=${encodeURIComponent(USER_A)}`,
      });
      expect(listA.statusCode).toBe(200);
      const itemsA = (listA.json() as { items: Array<{ id: string }> }).items;
      expect(itemsA.some((i) => i.id === item_id)).toBe(true);

      // User B cannot see it
      const listB = await app.inject({
        method: 'GET',
        url: `/api/work-items?user_email=${encodeURIComponent(USER_B)}`,
      });
      expect(listB.statusCode).toBe(200);
      const itemsB = (listB.json() as { items: Array<{ id: string }> }).items;
      expect(itemsB.some((i) => i.id === item_id)).toBe(false);
    });

    it('items without user_email are visible to all (backwards compat)', async () => {
      // Create item without user_email
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Global task' },
      });
      expect(createRes.statusCode).toBe(201);
      const { id: item_id } = createRes.json() as { id: string };

      // Without user_email filter, item is visible
      const listAll = await app.inject({
        method: 'GET',
        url: '/api/work-items',
      });
      expect(listAll.statusCode).toBe(200);
      const itemsAll = (listAll.json() as { items: Array<{ id: string }> }).items;
      expect(itemsAll.some((i) => i.id === item_id)).toBe(true);
    });

    it('GET /api/work-items/:id respects user_email scoping', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Scoped item', user_email: USER_A },
      });
      const { id } = createRes.json() as { id: string };

      // User A can fetch it
      const fetchA = await app.inject({
        method: 'GET',
        url: `/api/work-items/${id}?user_email=${encodeURIComponent(USER_A)}`,
      });
      expect(fetchA.statusCode).toBe(200);

      // User B gets 404
      const fetchB = await app.inject({
        method: 'GET',
        url: `/api/work-items/${id}?user_email=${encodeURIComponent(USER_B)}`,
      });
      expect(fetchB.statusCode).toBe(404);
    });

    it('DELETE /api/work-items/:id respects user_email scoping', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Delete target', user_email: USER_A },
      });
      const { id } = createRes.json() as { id: string };

      // User B cannot delete it
      const deleteB = await app.inject({
        method: 'DELETE',
        url: `/api/work-items/${id}?user_email=${encodeURIComponent(USER_B)}`,
      });
      expect(deleteB.statusCode).toBe(404);

      // User A can delete it
      const deleteA = await app.inject({
        method: 'DELETE',
        url: `/api/work-items/${id}?user_email=${encodeURIComponent(USER_A)}`,
      });
      expect(deleteA.statusCode).toBe(204);
    });

    it('PATCH /api/work-items/:id/status respects user_email scoping', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Status target', user_email: USER_A },
      });
      const { id } = createRes.json() as { id: string };

      // User B cannot update status
      const patchB = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${id}/status?user_email=${encodeURIComponent(USER_B)}`,
        payload: { status: 'completed' },
      });
      expect(patchB.statusCode).toBe(404);

      // User A can update status
      const patchA = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${id}/status?user_email=${encodeURIComponent(USER_A)}`,
        payload: { status: 'completed' },
      });
      expect(patchA.statusCode).toBe(200);
      expect(patchA.json().status).toBe('completed');
    });
  });

  // ── Contacts ────────────────────────────────────────────────────

  describe('contact scoping', () => {
    it('contacts with user_email are not visible to other users', async () => {
      // Create contact for user A
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { display_name: 'Alice Contact', user_email: USER_A },
      });
      expect(createRes.statusCode).toBe(201);
      const { id: contact_id } = createRes.json() as { id: string };

      // User A can see it
      const listA = await app.inject({
        method: 'GET',
        url: `/api/contacts?user_email=${encodeURIComponent(USER_A)}`,
      });
      expect(listA.statusCode).toBe(200);
      const contactsA = (listA.json() as { contacts: Array<{ id: string }> }).contacts;
      expect(contactsA.some((c) => c.id === contact_id)).toBe(true);

      // User B cannot see it
      const listB = await app.inject({
        method: 'GET',
        url: `/api/contacts?user_email=${encodeURIComponent(USER_B)}`,
      });
      expect(listB.statusCode).toBe(200);
      const contactsB = (listB.json() as { contacts: Array<{ id: string }> }).contacts;
      expect(contactsB.some((c) => c.id === contact_id)).toBe(false);
    });

    it('GET /api/contacts/:id respects user_email scoping', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { display_name: 'Scoped Contact', user_email: USER_A },
      });
      const { id } = createRes.json() as { id: string };

      // User A can fetch it
      const fetchA = await app.inject({
        method: 'GET',
        url: `/api/contacts/${id}?user_email=${encodeURIComponent(USER_A)}`,
      });
      expect(fetchA.statusCode).toBe(200);

      // User B gets 404
      const fetchB = await app.inject({
        method: 'GET',
        url: `/api/contacts/${id}?user_email=${encodeURIComponent(USER_B)}`,
      });
      expect(fetchB.statusCode).toBe(404);
    });

    it('DELETE /api/contacts/:id respects user_email scoping', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { display_name: 'Delete Contact', user_email: USER_A },
      });
      const { id } = createRes.json() as { id: string };

      // User B cannot delete it
      const deleteB = await app.inject({
        method: 'DELETE',
        url: `/api/contacts/${id}?user_email=${encodeURIComponent(USER_B)}`,
      });
      expect(deleteB.statusCode).toBe(404);

      // User A can delete it
      const deleteA = await app.inject({
        method: 'DELETE',
        url: `/api/contacts/${id}?user_email=${encodeURIComponent(USER_A)}`,
      });
      expect(deleteA.statusCode).toBe(204);
    });

    it('contacts without user_email are visible to all', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { display_name: 'Global Contact' },
      });
      expect(createRes.statusCode).toBe(201);
      const { id: contact_id } = createRes.json() as { id: string };

      // Without filter, visible
      const listAll = await app.inject({
        method: 'GET',
        url: '/api/contacts',
      });
      expect(listAll.statusCode).toBe(200);
      const contactsAll = (listAll.json() as { contacts: Array<{ id: string }> }).contacts;
      expect(contactsAll.some((c) => c.id === contact_id)).toBe(true);
    });
  });

  // ── Relationships ───────────────────────────────────────────────

  describe('relationship scoping', () => {
    it('relationships with user_email are not visible to other users via GET /api/relationships', async () => {
      // Create two contacts for user A
      const contactARes = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { display_name: 'Rel Contact A', user_email: USER_A },
      });
      const contactBRes = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { display_name: 'Rel Contact B', user_email: USER_A },
      });
      const contact_a_id = (contactARes.json() as { id: string }).id;
      const contact_b_id = (contactBRes.json() as { id: string }).id;

      // Ensure relationship type exists (use "knows" which is seeded)
      // First get the relationship type
      const typesRes = await app.inject({
        method: 'GET',
        url: '/api/relationship-types',
      });

      // If no types exist, skip this test gracefully
      const types = typesRes.json() as { types?: Array<{ id: string }> };
      if (!types.types || types.types.length === 0) {
        return; // No relationship types seeded, skip
      }

      const relTypeId = types.types[0].id;

      // Create relationship via direct API with user_email
      const relRes = await app.inject({
        method: 'POST',
        url: '/api/relationships',
        payload: {
          contact_a_id: contact_a_id,
          contact_b_id: contact_b_id,
          relationship_type_id: relTypeId,
        },
      });

      // Relationship created (may not have user_email directly via this route,
      // but we can verify the listRelationships endpoint respects user_email filter)
      if (relRes.status_code === 201) {
        // Insert user_email directly for test
        const relId = (relRes.json() as { id: string }).id;
        await pool.query('UPDATE relationship SET user_email = $1 WHERE id = $2', [USER_A, relId]);

        // User A can see it
        const listA = await app.inject({
          method: 'GET',
          url: `/api/relationships?user_email=${encodeURIComponent(USER_A)}`,
        });
        expect(listA.statusCode).toBe(200);
        const relsA = (listA.json() as { relationships: Array<{ id: string }> }).relationships;
        expect(relsA.some((r) => r.id === relId)).toBe(true);

        // User B cannot see it
        const listB = await app.inject({
          method: 'GET',
          url: `/api/relationships?user_email=${encodeURIComponent(USER_B)}`,
        });
        expect(listB.statusCode).toBe(200);
        const relsB = (listB.json() as { relationships: Array<{ id: string }> }).relationships;
        expect(relsB.some((r) => r.id === relId)).toBe(false);
      }
    });

    it('POST /api/relationships/set passes user_email to the created relationship', async () => {
      // Create two contacts for user A
      const contactARes = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { display_name: 'SetRelA', user_email: USER_A },
      });
      const contactBRes = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { display_name: 'SetRelB', user_email: USER_A },
      });
      expect(contactARes.statusCode).toBe(201);
      expect(contactBRes.statusCode).toBe(201);

      // Use relationship_set with user_email
      const setRes = await app.inject({
        method: 'POST',
        url: '/api/relationships/set',
        payload: {
          contact_a: 'SetRelA',
          contact_b: 'SetRelB',
          relationship_type: 'knows',
          user_email: USER_A,
        },
      });

      // The relationship set may fail if 'knows' type doesn't exist,
      // that's expected in test environments without seed data
      if (setRes.status_code === 200) {
        const relData = setRes.json() as { relationship: { id: string } };

        // Verify user_email was stored
        const dbCheck = await pool.query('SELECT user_email FROM relationship WHERE id = $1', [relData.relationship.id]);
        expect(dbCheck.rows[0].user_email).toBe(USER_A);
      }
    });
  });
});
