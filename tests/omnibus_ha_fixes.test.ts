/**
 * Omnibus HA bug fix tests.
 *
 * Covers:
 * - Bug #1900: GET /api/work-items status filter
 * - Bug #1902: suggest-match namespace scoping
 * - Bug #1831: contact_get field rendering
 * - Bug #1831: namespace_members 'access' field
 * - HA OAuth callback error handling
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables, ensureTestNamespace } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';
import { getAuthHeaders } from './helpers/auth.ts';

const TEST_EMAIL = 'omnibus-ha-test@example.com';

describe('Omnibus HA bug fixes', () => {
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

  // ============================================================
  // Bug #1900 — GET /api/work-items status filter
  // ============================================================
  describe('Bug #1900 — GET /api/work-items status filter', () => {
    async function createWorkItem(title: string, kind: string = 'task'): Promise<string> {
      const res = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title, kind },
      });
      expect(res.statusCode).toBe(201);
      return (res.json() as { id: string }).id;
    }

    async function setStatus(id: string, status: string): Promise<void> {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${id}/status`,
        payload: { status },
      });
      expect(res.statusCode).toBe(200);
    }

    it('filters by ?status=completed', async () => {
      const id1 = await createWorkItem('Open item');
      const id2 = await createWorkItem('Completed item');
      const id3 = await createWorkItem('In progress item');

      await setStatus(id2, 'completed');
      await setStatus(id3, 'in_progress');

      const res = await app.inject({
        method: 'GET',
        url: '/api/work-items?status=completed',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: Array<{ id: string; status: string }> };
      expect(body.items.length).toBe(1);
      expect(body.items[0].id).toBe(id2);
      expect(body.items[0].status).toBe('completed');
    });

    it('filters by ?status=open', async () => {
      const id1 = await createWorkItem('Open item 1');
      const id2 = await createWorkItem('Open item 2');
      const id3 = await createWorkItem('Completed item');

      await setStatus(id3, 'completed');

      const res = await app.inject({
        method: 'GET',
        url: '/api/work-items?status=open',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: Array<{ id: string; status: string }> };
      expect(body.items.length).toBe(2);
      for (const item of body.items) {
        expect(item.status).toBe('open');
      }
    });

    it('returns all items when no status param is provided', async () => {
      await createWorkItem('Item A');
      const id2 = await createWorkItem('Item B');
      const id3 = await createWorkItem('Item C');

      await setStatus(id2, 'completed');
      await setStatus(id3, 'in_progress');

      const res = await app.inject({
        method: 'GET',
        url: '/api/work-items',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: Array<{ id: string }> };
      expect(body.items.length).toBe(3);
    });

    it('accepts kind as alias for item_type', async () => {
      await createWorkItem('A task', 'task');
      await createWorkItem('An issue', 'issue');
      await createWorkItem('Another task', 'task');

      // Using ?kind=task
      const resKind = await app.inject({
        method: 'GET',
        url: '/api/work-items?kind=task',
      });
      expect(resKind.statusCode).toBe(200);
      const kindBody = resKind.json() as { items: Array<{ kind: string }> };
      expect(kindBody.items.length).toBe(2);
      for (const item of kindBody.items) {
        expect(item.kind).toBe('task');
      }

      // Using ?item_type=task should also work
      const resItemType = await app.inject({
        method: 'GET',
        url: '/api/work-items?item_type=task',
      });
      expect(resItemType.statusCode).toBe(200);
      const itemTypeBody = resItemType.json() as { items: Array<{ kind: string }> };
      expect(itemTypeBody.items.length).toBe(2);
      for (const item of itemTypeBody.items) {
        expect(item.kind).toBe('task');
      }
    });

    it('accepts parent_id as alias for parent_work_item_id', async () => {
      const parentId = await createWorkItem('Parent project', 'project');

      // Create children via POST with parent_id
      const childRes = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Child task', kind: 'task', parent_id: parentId },
      });
      expect(childRes.statusCode).toBe(201);

      await createWorkItem('Orphan task', 'task');

      // Using ?parent_id=
      const resParentId = await app.inject({
        method: 'GET',
        url: `/api/work-items?parent_id=${parentId}`,
      });
      expect(resParentId.statusCode).toBe(200);
      const parentIdBody = resParentId.json() as { items: Array<{ parent_id: string }> };
      expect(parentIdBody.items.length).toBe(1);
      expect(parentIdBody.items[0].parent_id).toBe(parentId);

      // Using ?parent_work_item_id= should also work
      const resLegacy = await app.inject({
        method: 'GET',
        url: `/api/work-items?parent_work_item_id=${parentId}`,
      });
      expect(resLegacy.statusCode).toBe(200);
      const legacyBody = resLegacy.json() as { items: Array<{ parent_id: string }> };
      expect(legacyBody.items.length).toBe(1);
      expect(legacyBody.items[0].parent_id).toBe(parentId);
    });

    it('respects the limit query param', async () => {
      for (let i = 0; i < 5; i++) {
        await createWorkItem(`Item ${i}`);
      }

      const res = await app.inject({
        method: 'GET',
        url: '/api/work-items?limit=2',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: Array<{ id: string }> };
      expect(body.items.length).toBe(2);
    });
  });

  // ============================================================
  // Bug #1902 — suggest-match namespace scoping
  // ============================================================
  describe('Bug #1902 — suggest-match namespace scoping', () => {
    it('returns a contact matched by email', async () => {
      // Create contact in default namespace via direct SQL
      const contactResult = await pool.query(
        `INSERT INTO contact (display_name, namespace)
         VALUES ('Email Match Test', 'default')
         RETURNING id::text as id`,
      );
      const contactId = contactResult.rows[0].id;

      // Add email endpoint
      await pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value)
         VALUES ($1, 'email', 'match-test@example.com')`,
        [contactId],
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/contacts/suggest-match?email=match-test@example.com',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        matches: Array<{
          contact_id: string;
          display_name: string;
          confidence: number;
          match_reasons: string[];
          endpoints: Array<{ type: string; value: string }>;
        }>;
      };
      expect(body.matches.length).toBeGreaterThanOrEqual(1);
      const match = body.matches.find((m) => m.contact_id === contactId);
      expect(match).toBeDefined();
      expect(match!.display_name).toBe('Email Match Test');
      expect(match!.confidence).toBe(1);
      expect(match!.match_reasons).toContain('email_exact');
    });

    it('returns a contact matched by phone', async () => {
      const contactResult = await pool.query(
        `INSERT INTO contact (display_name, namespace)
         VALUES ('Phone Match Test', 'default')
         RETURNING id::text as id`,
      );
      const contactId = contactResult.rows[0].id;

      await pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value)
         VALUES ($1, 'phone', '+61400999888')`,
        [contactId],
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/contacts/suggest-match?phone=%2B61400999888',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        matches: Array<{
          contact_id: string;
          display_name: string;
          confidence: number;
          match_reasons: string[];
        }>;
      };
      expect(body.matches.length).toBeGreaterThanOrEqual(1);
      const match = body.matches.find((m) => m.contact_id === contactId);
      expect(match).toBeDefined();
      expect(match!.display_name).toBe('Phone Match Test');
      expect(match!.match_reasons).toContain('phone_exact');
    });

    it('returns empty matches when no data matches', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/contacts/suggest-match?email=no-one-here@nonexistent.example',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { matches: unknown[] };
      expect(body.matches).toEqual([]);
    });
  });

  // ============================================================
  // Bug #1831 — contact_get field rendering
  // ============================================================
  describe('Bug #1831 — contact_get field rendering', () => {
    it('returns display_name and endpoints on GET /api/contacts/:id', async () => {
      // Create contact with display_name
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { display_name: 'Field Render Test' },
      });
      expect(createRes.statusCode).toBe(201);
      const { id } = createRes.json() as { id: string };

      // Add email endpoint
      await app.inject({
        method: 'POST',
        url: `/api/contacts/${id}/endpoints`,
        payload: { type: 'email', value: 'fieldtest@example.com' },
      });

      // Add phone endpoint
      await app.inject({
        method: 'POST',
        url: `/api/contacts/${id}/endpoints`,
        payload: { type: 'phone', value: '+15559876543' },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/contacts/${id}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        id: string;
        display_name: string;
        endpoints: Array<{ type: string; value: string }>;
      };
      expect(body.display_name).toBe('Field Render Test');
      expect(body.display_name).not.toBeNull();
      expect(body.display_name).not.toBeUndefined();
      expect(body.endpoints.length).toBe(2);

      const emailEndpoint = body.endpoints.find((e) => e.type === 'email');
      expect(emailEndpoint).toBeDefined();
      expect(emailEndpoint!.value).toBe('fieldtest@example.com');

      const phoneEndpoint = body.endpoints.find((e) => e.type === 'phone');
      expect(phoneEndpoint).toBeDefined();
      expect(phoneEndpoint!.value).toBe('+15559876543');
    });

    it('returns proper name fields for contact with given_name/family_name', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: {
          display_name: 'Jane Doe',
          given_name: 'Jane',
          family_name: 'Doe',
        },
      });
      expect(createRes.statusCode).toBe(201);
      const { id } = createRes.json() as { id: string };

      const res = await app.inject({
        method: 'GET',
        url: `/api/contacts/${id}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        display_name: string;
        given_name: string;
        family_name: string;
      };
      expect(body.display_name).toBeDefined();
      expect(body.display_name).not.toBeNull();
      expect(body.given_name).toBe('Jane');
      expect(body.family_name).toBe('Doe');
    });
  });

  // ============================================================
  // Bug #1831 — namespace_members 'access' field
  // ============================================================
  describe('Bug #1831 — namespace_members access field', () => {
    it('each member has a non-null access field', async () => {
      await ensureTestNamespace(pool, TEST_EMAIL);

      // Also insert a second grant
      await pool.query(
        `INSERT INTO user_setting (email) VALUES ('second-member@example.com')
         ON CONFLICT (email) DO NOTHING`,
      );
      await pool.query(
        `INSERT INTO namespace_grant (email, namespace, access, is_home)
         VALUES ('second-member@example.com', 'default', 'read', false)
         ON CONFLICT (email, namespace) DO NOTHING`,
      );

      const headers = await getAuthHeaders(TEST_EMAIL);
      const res = await app.inject({
        method: 'GET',
        url: '/api/namespaces/default',
        headers,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        namespace: string;
        members: Array<{ email: string; access: string }>;
        member_count: number;
      };

      expect(body.namespace).toBe('default');
      expect(body.members.length).toBeGreaterThanOrEqual(2);
      expect(body.member_count).toBe(body.members.length);

      for (const member of body.members) {
        expect(member.access).toBeDefined();
        expect(member.access).not.toBeNull();
        expect(['read', 'readwrite']).toContain(member.access);
      }
    });
  });

  // ============================================================
  // HA OAuth callback error handling
  // ============================================================
  describe('HA OAuth callback error handling', () => {
    it('returns 400 when state is invalid', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/oauth/callback?code=fake_code&state=invalid_state_value',
      });

      expect(res.statusCode).toBe(400);
      const body = res.json() as { error: string; code?: string };
      expect(body.error).toBeDefined();
      expect(body.code).toBe('INVALID_STATE');
    });

    it('returns 400 when state param is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/oauth/callback?code=fake_code',
      });

      expect(res.statusCode).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toContain('Missing OAuth state parameter');
    });

    it('returns 400 when error param is present', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/oauth/callback?error=access_denied',
      });

      expect(res.statusCode).toBe(400);
      const body = res.json() as { error: string; details?: string };
      expect(body.error).toContain('authorization failed');
      expect(body.details).toBe('access_denied');
    });
  });
});
