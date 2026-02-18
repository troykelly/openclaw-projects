/**
 * E2E tests for user_email cross-scope isolation.
 * Issue #1172, Phase 14 (#1193).
 *
 * Verifies that user_email scoping prevents cross-tenant data leakage
 * when hitting the live API. Two user identities are used to simulate
 * multi-agent access.
 *
 * Run with: pnpm run test:e2e
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { defaultConfig, waitForService, signTestJwt, signTestM2MJwt, type E2EConfig } from './setup.js';

const RUN_E2E = process.env.RUN_E2E === 'true';

/** Two distinct user scopes for isolation testing. */
const USER_A = 'e2e-user-a@test.openclaw.local';
const USER_B = 'e2e-user-b@test.openclaw.local';

/**
 * Minimal fetch wrapper that returns the raw Response so callers
 * can assert on status codes (404, 204, etc.) directly.
 *
 * Uses M2M tokens so that user_email parameters are honored
 * (user tokens are subject to principal binding and ignore
 * user_email params — Issue #1353).
 */
function createRawClient(baseUrl: string) {
  return {
    async get(path: string): Promise<Response> {
      const token = await signTestM2MJwt();
      return fetch(`${baseUrl}${path}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` },
      });
    },
    async post(path: string, body: unknown): Promise<Response> {
      const token = await signTestM2MJwt();
      return fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(body),
      });
    },
    async put(path: string, body: unknown): Promise<Response> {
      const token = await signTestM2MJwt();
      return fetch(`${baseUrl}${path}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(body),
      });
    },
    async patch(path: string, body: unknown): Promise<Response> {
      const token = await signTestM2MJwt();
      return fetch(`${baseUrl}${path}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(body),
      });
    },
    async delete(path: string): Promise<Response> {
      const token = await signTestM2MJwt();
      return fetch(`${baseUrl}${path}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
    },
  };
}

/**
 * Client that uses per-user JWTs for testing principal binding.
 * Each request is signed with a JWT for the specified user email.
 */
function createUserClient(baseUrl: string, user_email: string) {
  return {
    async get(path: string): Promise<Response> {
      const token = await signTestJwt(user_email);
      return fetch(`${baseUrl}${path}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` },
      });
    },
    async post(path: string, body: unknown): Promise<Response> {
      const token = await signTestJwt(user_email);
      return fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(body),
      });
    },
    async patch(path: string, body: unknown): Promise<Response> {
      const token = await signTestJwt(user_email);
      return fetch(`${baseUrl}${path}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(body),
      });
    },
    async delete(path: string): Promise<Response> {
      const token = await signTestJwt(user_email);
      return fetch(`${baseUrl}${path}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
    },
  };
}

type RawClient = ReturnType<typeof createRawClient>;

/**
 * Retry a POST request up to `maxRetries` times on transient 500 errors
 * (e.g. database deadlocks when sharing a DB with other processes).
 */
async function postWithRetry(
  api: RawClient,
  path: string,
  body: unknown,
  maxRetries = 3,
): Promise<Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await api.post(path, body);
    if (res.status !== 500 || attempt === maxRetries - 1) return res;
    // Consume the body to avoid leaking connections
    await res.text();
    await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
  }
  // Unreachable, but satisfies the type checker
  return api.post(path, body);
}

describe.skipIf(!RUN_E2E)('User-email cross-scope isolation (E2E)', () => {
  const config: E2EConfig = defaultConfig;
  const api = createRawClient(config.apiUrl);

  /** IDs to clean up after all tests complete. */
  const cleanupWorkItems: string[] = [];
  const cleanupContacts: string[] = [];

  beforeAll(async () => {
    await waitForService(`${config.apiUrl}/api/health`, config.healthCheckRetries);
  });

  afterAll(async () => {
    // Best-effort cleanup; ignore errors (items may already be deleted by tests).
    for (const id of cleanupWorkItems) {
      try {
        await api.delete(`/api/work-items/${id}?permanent=true`);
      } catch {
        /* ignore */
      }
    }
    for (const id of cleanupContacts) {
      try {
        await api.delete(`/api/contacts/${id}?permanent=true`);
      } catch {
        /* ignore */
      }
    }
  });

  // ── Work Item Isolation ──────────────────────────────────────────

  describe('Work item isolation', () => {
    let itemIdA: string;

    beforeAll(async () => {
      const res = await postWithRetry(api, '/api/work-items', {
        title: `E2E Scoped WI ${Date.now()}`,
        kind: 'issue',
        user_email: USER_A,
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string };
      itemIdA = body.id;
      cleanupWorkItems.push(itemIdA);
    });

    it('user A can list the item', async () => {
      const res = await api.get(`/api/work-items?user_email=${encodeURIComponent(USER_A)}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: Array<{ id: string }> };
      expect(body.items.some((i) => i.id === itemIdA)).toBe(true);
    });

    it('user B cannot list the item', async () => {
      const res = await api.get(`/api/work-items?user_email=${encodeURIComponent(USER_B)}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: Array<{ id: string }> };
      expect(body.items.some((i) => i.id === itemIdA)).toBe(false);
    });

    it('user A can GET the item by id', async () => {
      const res = await api.get(`/api/work-items/${itemIdA}?user_email=${encodeURIComponent(USER_A)}`);
      expect(res.status).toBe(200);
    });

    it('user B gets 404 for GET by id', async () => {
      const res = await api.get(`/api/work-items/${itemIdA}?user_email=${encodeURIComponent(USER_B)}`);
      expect(res.status).toBe(404);
    });
  });

  // ── Contact Isolation ────────────────────────────────────────────

  describe('Contact isolation', () => {
    let contactIdA: string;

    beforeAll(async () => {
      const res = await postWithRetry(api, '/api/contacts', {
        display_name: `E2E Scoped Contact ${Date.now()}`,
        user_email: USER_A,
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string };
      contactIdA = body.id;
      cleanupContacts.push(contactIdA);
    });

    it('user A can list the contact', async () => {
      const res = await api.get(`/api/contacts?user_email=${encodeURIComponent(USER_A)}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { contacts: Array<{ id: string }> };
      expect(body.contacts.some((c) => c.id === contactIdA)).toBe(true);
    });

    it('user B cannot list the contact', async () => {
      const res = await api.get(`/api/contacts?user_email=${encodeURIComponent(USER_B)}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { contacts: Array<{ id: string }> };
      expect(body.contacts.some((c) => c.id === contactIdA)).toBe(false);
    });

    it('user A can GET the contact by id', async () => {
      const res = await api.get(`/api/contacts/${contactIdA}?user_email=${encodeURIComponent(USER_A)}`);
      expect(res.status).toBe(200);
    });

    it('user B gets 404 for GET contact by id', async () => {
      const res = await api.get(`/api/contacts/${contactIdA}?user_email=${encodeURIComponent(USER_B)}`);
      expect(res.status).toBe(404);
    });
  });

  // ── Relationship Isolation ───────────────────────────────────────

  describe('Relationship isolation', () => {
    let contactA1: string;
    const relTypeName = `e2e-colleague-${Date.now()}`;

    beforeAll(async () => {
      const uniqueTag = Date.now().toString();

      // Ensure a relationship type exists for this test
      const typeRes = await api.post('/api/relationship-types', {
        name: relTypeName,
        label: 'E2E Colleague',
      });
      expect([201, 409]).toContain(typeRes.status);

      // Create two contacts for user A
      const c1 = await postWithRetry(api, '/api/contacts', {
        display_name: `E2E RelA1 ${uniqueTag}`,
        user_email: USER_A,
      });
      expect(c1.status).toBe(201);
      contactA1 = ((await c1.json()) as { id: string }).id;
      cleanupContacts.push(contactA1);

      const c2 = await postWithRetry(api, '/api/contacts', {
        display_name: `E2E RelA2 ${uniqueTag}`,
        user_email: USER_A,
      });
      expect(c2.status).toBe(201);
      const contactA2 = ((await c2.json()) as { id: string }).id;
      cleanupContacts.push(contactA2);

      // Create relationship via /api/relationships/set with user_email
      const relRes = await postWithRetry(api, '/api/relationships/set', {
        contact_a: `E2E RelA1 ${uniqueTag}`,
        contact_b: `E2E RelA2 ${uniqueTag}`,
        relationship_type: relTypeName,
        user_email: USER_A,
      });
      expect(relRes.status).toBe(200);
    });

    it('user A can list relationships', async () => {
      const res = await api.get(
        `/api/relationships?contact_id=${contactA1}&user_email=${encodeURIComponent(USER_A)}`,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { relationships: Array<{ id: string }> };
      expect(body.relationships.length).toBeGreaterThan(0);
    });

    it('user B cannot see user A relationships', async () => {
      const res = await api.get(
        `/api/relationships?contact_id=${contactA1}&user_email=${encodeURIComponent(USER_B)}`,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { relationships: Array<{ id: string }> };
      expect(body.relationships.length).toBe(0);
    });
  });

  // ── Backwards Compatibility ──────────────────────────────────────

  describe('Backwards compatibility', () => {
    let unscopedItemId: string;
    let unscopedContactId: string;

    it('work items created without user_email are visible to all', async () => {
      const res = await postWithRetry(api, '/api/work-items', {
        title: `E2E Unscoped WI ${Date.now()}`,
        kind: 'issue',
      });
      expect(res.status).toBe(201);
      unscopedItemId = ((await res.json()) as { id: string }).id;
      cleanupWorkItems.push(unscopedItemId);

      // Listing without user_email filter should include it
      const listRes = await api.get('/api/work-items');
      expect(listRes.status).toBe(200);
      const body = (await listRes.json()) as { items: Array<{ id: string }> };
      expect(body.items.some((i) => i.id === unscopedItemId)).toBe(true);
    });

    it('contacts created without user_email are visible to all', async () => {
      const res = await postWithRetry(api, '/api/contacts', {
        display_name: `E2E Unscoped Contact ${Date.now()}`,
      });
      expect(res.status).toBe(201);
      unscopedContactId = ((await res.json()) as { id: string }).id;
      cleanupContacts.push(unscopedContactId);

      const listRes = await api.get('/api/contacts');
      expect(listRes.status).toBe(200);
      const body = (await listRes.json()) as { contacts: Array<{ id: string }> };
      expect(body.contacts.some((c) => c.id === unscopedContactId)).toBe(true);
    });
  });

  // ── Cross-scope Update / Delete Protection ───────────────────────

  describe('Cross-scope update/delete protection', () => {
    describe('work items', () => {
      let protectedItemId: string;

      beforeAll(async () => {
        const res = await postWithRetry(api, '/api/work-items', {
          title: `E2E Protected WI ${Date.now()}`,
          kind: 'issue',
          user_email: USER_A,
        });
        expect(res.status).toBe(201);
        protectedItemId = ((await res.json()) as { id: string }).id;
        cleanupWorkItems.push(protectedItemId);
      });

      it('user B cannot update user A work item status', async () => {
        const res = await api.patch(
          `/api/work-items/${protectedItemId}/status?user_email=${encodeURIComponent(USER_B)}`,
          { status: 'completed' },
        );
        expect(res.status).toBe(404);
      });

      it('user B cannot delete user A work item', async () => {
        const res = await api.delete(
          `/api/work-items/${protectedItemId}?user_email=${encodeURIComponent(USER_B)}`,
        );
        expect(res.status).toBe(404);
      });

      it('user A can update their own work item status', async () => {
        const res = await api.patch(
          `/api/work-items/${protectedItemId}/status?user_email=${encodeURIComponent(USER_A)}`,
          { status: 'completed' },
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as { status: string };
        expect(body.status).toBe('completed');
      });

      it('user A can delete their own work item', async () => {
        const res = await api.delete(
          `/api/work-items/${protectedItemId}?user_email=${encodeURIComponent(USER_A)}`,
        );
        expect(res.status).toBe(204);
        // Remove from cleanup since already deleted
        const idx = cleanupWorkItems.indexOf(protectedItemId);
        if (idx >= 0) cleanupWorkItems.splice(idx, 1);
      });
    });

    describe('contacts', () => {
      let protectedContactId: string;

      beforeAll(async () => {
        const res = await postWithRetry(api, '/api/contacts', {
          display_name: `E2E Protected Contact ${Date.now()}`,
          user_email: USER_A,
        });
        expect(res.status).toBe(201);
        protectedContactId = ((await res.json()) as { id: string }).id;
        cleanupContacts.push(protectedContactId);
      });

      it('user B cannot update user A contact', async () => {
        const res = await api.patch(
          `/api/contacts/${protectedContactId}?user_email=${encodeURIComponent(USER_B)}`,
          { display_name: 'Hacked' },
        );
        expect(res.status).toBe(404);
      });

      it('user B cannot delete user A contact', async () => {
        const res = await api.delete(
          `/api/contacts/${protectedContactId}?user_email=${encodeURIComponent(USER_B)}`,
        );
        expect(res.status).toBe(404);
      });

      it('user A can update their own contact', async () => {
        const res = await api.patch(
          `/api/contacts/${protectedContactId}?user_email=${encodeURIComponent(USER_A)}`,
          { display_name: 'Updated Name' },
        );
        expect(res.status).toBe(200);
      });

      it('user A can delete their own contact', async () => {
        const res = await api.delete(
          `/api/contacts/${protectedContactId}?user_email=${encodeURIComponent(USER_A)}`,
        );
        expect(res.status).toBe(204);
        const idx = cleanupContacts.indexOf(protectedContactId);
        if (idx >= 0) cleanupContacts.splice(idx, 1);
      });
    });
  });

  // ── Principal Binding (Issue #1353) ───────────────────────────────
  // User tokens are subject to principal binding: the server ignores
  // user_email in query/body and always scopes to the JWT subject.

  describe('Principal binding (Issue #1353)', () => {
    const userAClient = createUserClient(config.apiUrl, USER_A);

    describe('user token cannot access another user data via user_email param', () => {
      let itemForB: string;

      beforeAll(async () => {
        // Use M2M client to create a work item owned by USER_B
        const res = await postWithRetry(api, '/api/work-items', {
          title: `E2E PB Item ${Date.now()}`,
          kind: 'issue',
          user_email: USER_B,
        });
        expect(res.status).toBe(201);
        itemForB = ((await res.json()) as { id: string }).id;
        cleanupWorkItems.push(itemForB);
      });

      it('user A token with user_email=USER_B still sees only own data', async () => {
        // User A's JWT means the server overrides user_email to USER_A
        const res = await userAClient.get(
          `/api/work-items?user_email=${encodeURIComponent(USER_B)}`,
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as { items: Array<{ id: string }> };
        // Should NOT see USER_B's item — principal binding overrides the param
        expect(body.items.some((i) => i.id === itemForB)).toBe(false);
      });

      it('user A token cannot GET user B item by id', async () => {
        const res = await userAClient.get(
          `/api/work-items/${itemForB}?user_email=${encodeURIComponent(USER_B)}`,
        );
        // Principal binding overrides user_email to USER_A, so scope check fails
        expect(res.status).toBe(404);
      });
    });

    describe('M2M token can access any user data', () => {
      let itemForA: string;

      beforeAll(async () => {
        const res = await postWithRetry(api, '/api/work-items', {
          title: `E2E M2M Item ${Date.now()}`,
          kind: 'issue',
          user_email: USER_A,
        });
        expect(res.status).toBe(201);
        itemForA = ((await res.json()) as { id: string }).id;
        cleanupWorkItems.push(itemForA);
      });

      it('M2M token can list user A items', async () => {
        const res = await api.get(
          `/api/work-items?user_email=${encodeURIComponent(USER_A)}`,
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as { items: Array<{ id: string }> };
        expect(body.items.some((i) => i.id === itemForA)).toBe(true);
      });

      it('M2M token can list user B items', async () => {
        const res = await api.get(
          `/api/work-items?user_email=${encodeURIComponent(USER_B)}`,
        );
        expect(res.status).toBe(200);
        // This should succeed (even if empty), not error
        const body = (await res.json()) as { items: Array<{ id: string }> };
        expect(Array.isArray(body.items)).toBe(true);
      });
    });
  });
});
