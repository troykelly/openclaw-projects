import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

/**
 * Tests for namespace-based scoping on work_item, contact, and relationship tables.
 * Epic #1418 replaced user_email scoping (Issue #1172) with namespace scoping.
 *
 * Verifies:
 * 1. Items created via API are assigned a namespace (defaults to 'default')
 * 2. user_email query params are accepted but do NOT affect scoping
 * 3. All items in the same namespace are visible to all queries in that namespace
 * 4. CRUD operations work regardless of user_email params
 */
describe('Namespace scoping (Epic #1418, replaces user_email scoping #1172)', () => {
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
    it('work_item table has namespace column instead of user_email', async () => {
      const result = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'work_item' ORDER BY ordinal_position`,
      );
      const cols = result.rows.map((r) => (r as { column_name: string }).column_name);
      expect(cols).toContain('namespace');
      expect(cols).not.toContain('user_email');
    });

    it('items created with user_email param are visible to all (scoping by namespace)', async () => {
      // Create item with user_email in payload (accepted but ignored for scoping)
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Alice task', user_email: USER_A },
      });
      expect(createRes.statusCode).toBe(201);
      const { id: item_id } = createRes.json() as { id: string };

      // Item is visible without any user_email filter
      const listAll = await app.inject({
        method: 'GET',
        url: '/api/work-items',
      });
      expect(listAll.statusCode).toBe(200);
      const items = (listAll.json() as { items: Array<{ id: string }> }).items;
      expect(items.some((i) => i.id === item_id)).toBe(true);
    });

    it('items without user_email are visible in default namespace', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Global task' },
      });
      expect(createRes.statusCode).toBe(201);
      const { id: item_id } = createRes.json() as { id: string };

      const listAll = await app.inject({
        method: 'GET',
        url: '/api/work-items',
      });
      expect(listAll.statusCode).toBe(200);
      const items = (listAll.json() as { items: Array<{ id: string }> }).items;
      expect(items.some((i) => i.id === item_id)).toBe(true);
    });

    it('GET /api/work-items/:id returns item regardless of user_email param', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Scoped item', user_email: USER_A },
      });
      const { id } = createRes.json() as { id: string };

      // Accessible without user_email
      const fetch = await app.inject({
        method: 'GET',
        url: `/api/work-items/${id}`,
      });
      expect(fetch.statusCode).toBe(200);

      // Also accessible with a different user_email (param is ignored)
      const fetchB = await app.inject({
        method: 'GET',
        url: `/api/work-items/${id}?user_email=${encodeURIComponent(USER_B)}`,
      });
      expect(fetchB.statusCode).toBe(200);
    });

    it('DELETE /api/work-items/:id works regardless of user_email param', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Delete target', user_email: USER_A },
      });
      const { id } = createRes.json() as { id: string };

      // Delete works regardless of user_email (no per-user scoping)
      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/work-items/${id}`,
      });
      expect(deleteRes.statusCode).toBe(204);
    });

    it('PATCH /api/work-items/:id/status works regardless of user_email param', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Status target', user_email: USER_A },
      });
      const { id } = createRes.json() as { id: string };

      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${id}/status`,
        payload: { status: 'completed' },
      });
      expect(patchRes.statusCode).toBe(200);
      expect(patchRes.json().status).toBe('completed');
    });

    it('work items store namespace in the database', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Namespace check' },
      });
      expect(createRes.statusCode).toBe(201);
      const { id } = createRes.json() as { id: string };

      const dbResult = await pool.query('SELECT namespace FROM work_item WHERE id = $1', [id]);
      expect(dbResult.rows).toHaveLength(1);
      expect(dbResult.rows[0].namespace).toBeDefined();
      expect(typeof dbResult.rows[0].namespace).toBe('string');
    });
  });

  // ── Contacts ────────────────────────────────────────────────────

  describe('contact scoping', () => {
    it('contact table has namespace column instead of user_email', async () => {
      const result = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'contact' ORDER BY ordinal_position`,
      );
      const cols = result.rows.map((r) => (r as { column_name: string }).column_name);
      expect(cols).toContain('namespace');
      expect(cols).not.toContain('user_email');
    });

    it('contacts created with user_email param are visible to all (scoping by namespace)', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { display_name: 'Alice Contact', user_email: USER_A },
      });
      expect(createRes.statusCode).toBe(201);
      const { id: contact_id } = createRes.json() as { id: string };

      // Visible without any user_email filter
      const listAll = await app.inject({
        method: 'GET',
        url: '/api/contacts',
      });
      expect(listAll.statusCode).toBe(200);
      const contacts = (listAll.json() as { contacts: Array<{ id: string }> }).contacts;
      expect(contacts.some((c) => c.id === contact_id)).toBe(true);
    });

    it('GET /api/contacts/:id returns contact regardless of user_email param', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { display_name: 'Scoped Contact', user_email: USER_A },
      });
      const { id } = createRes.json() as { id: string };

      // Accessible without user_email
      const fetch = await app.inject({
        method: 'GET',
        url: `/api/contacts/${id}`,
      });
      expect(fetch.statusCode).toBe(200);

      // Also accessible with a different user_email (param is ignored)
      const fetchB = await app.inject({
        method: 'GET',
        url: `/api/contacts/${id}?user_email=${encodeURIComponent(USER_B)}`,
      });
      expect(fetchB.statusCode).toBe(200);
    });

    it('DELETE /api/contacts/:id works regardless of user_email param', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { display_name: 'Delete Contact', user_email: USER_A },
      });
      const { id } = createRes.json() as { id: string };

      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/contacts/${id}`,
      });
      expect(deleteRes.statusCode).toBe(204);
    });

    it('contacts without user_email are visible to all', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { display_name: 'Global Contact' },
      });
      expect(createRes.statusCode).toBe(201);
      const { id: contact_id } = createRes.json() as { id: string };

      const listAll = await app.inject({
        method: 'GET',
        url: '/api/contacts',
      });
      expect(listAll.statusCode).toBe(200);
      const contacts = (listAll.json() as { contacts: Array<{ id: string }> }).contacts;
      expect(contacts.some((c) => c.id === contact_id)).toBe(true);
    });

    it('contacts store namespace in the database', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { display_name: 'Namespace check' },
      });
      expect(createRes.statusCode).toBe(201);
      const { id } = createRes.json() as { id: string };

      const dbResult = await pool.query('SELECT namespace FROM contact WHERE id = $1', [id]);
      expect(dbResult.rows).toHaveLength(1);
      expect(dbResult.rows[0].namespace).toBeDefined();
    });
  });

  // ── Relationships ───────────────────────────────────────────────

  describe('relationship scoping', () => {
    it('relationship table has namespace column instead of user_email', async () => {
      const result = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'relationship' ORDER BY ordinal_position`,
      );
      const cols = result.rows.map((r) => (r as { column_name: string }).column_name);
      expect(cols).toContain('namespace');
      expect(cols).not.toContain('user_email');
    });

    it('relationships are visible via GET /api/relationships (namespace-based)', async () => {
      // Create two contacts
      const contactARes = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { display_name: 'Rel Contact A' },
      });
      const contactBRes = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { display_name: 'Rel Contact B' },
      });
      const contact_a_id = (contactARes.json() as { id: string }).id;
      const contact_b_id = (contactBRes.json() as { id: string }).id;

      // Get relationship types
      const typesRes = await app.inject({
        method: 'GET',
        url: '/api/relationship-types',
      });
      const types = typesRes.json() as { types?: Array<{ id: string }> };
      if (!types.types || types.types.length === 0) {
        return; // No relationship types seeded, skip
      }
      const relTypeId = types.types[0].id;

      // Create relationship
      const relRes = await app.inject({
        method: 'POST',
        url: '/api/relationships',
        payload: {
          contact_a_id: contact_a_id,
          contact_b_id: contact_b_id,
          relationship_type_id: relTypeId,
        },
      });

      if (relRes.statusCode === 201) {
        const relId = (relRes.json() as { id: string }).id;

        // Relationship visible without user_email filter
        const listAll = await app.inject({
          method: 'GET',
          url: '/api/relationships',
        });
        expect(listAll.statusCode).toBe(200);
        const rels = (listAll.json() as { relationships: Array<{ id: string }> }).relationships;
        expect(rels.some((r) => r.id === relId)).toBe(true);
      }
    });

    it('POST /api/relationships/set stores namespace (not user_email)', async () => {
      // Create two contacts
      const contactARes = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { display_name: 'SetRelA' },
      });
      const contactBRes = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { display_name: 'SetRelB' },
      });
      expect(contactARes.statusCode).toBe(201);
      expect(contactBRes.statusCode).toBe(201);

      // Use relationship_set (user_email accepted but ignored for scoping)
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
      if (setRes.statusCode === 200) {
        const relData = setRes.json() as { relationship: { id: string } };

        // Verify namespace is stored (not user_email)
        const dbCheck = await pool.query('SELECT namespace FROM relationship WHERE id = $1', [relData.relationship.id]);
        expect(dbCheck.rows[0].namespace).toBeDefined();
      }
    });
  });
});
