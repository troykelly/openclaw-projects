/**
 * E2E tests for namespace-based scope isolation.
 * Epic #1418 — replaces user_email-based scoping with namespace-based scoping.
 *
 * Verifies that namespace scoping prevents cross-tenant data leakage
 * when hitting the live API. Two distinct namespaces are used to simulate
 * multi-tenant access via M2M tokens with X-Namespace headers.
 *
 * Run with: pnpm run test:e2e
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { defaultConfig, waitForService, signTestM2MJwt, type E2EConfig } from './setup.js';

const RUN_E2E = process.env.RUN_E2E === 'true';

/** Two distinct user emails (still used in request bodies where required). */
const USER_A = 'e2e-user-a@test.openclaw.local';
const USER_B = 'e2e-user-b@test.openclaw.local';

/** Unique namespace names per test run to avoid collisions. */
const RUN_ID = Date.now();
const NS_A = `e2e-ns-a-${RUN_ID}`;
const NS_B = `e2e-ns-b-${RUN_ID}`;

/**
 * Minimal fetch wrapper that returns the raw Response so callers
 * can assert on status codes (404, 204, etc.) directly.
 *
 * Uses M2M tokens. Does NOT include X-Namespace header — useful
 * for health checks, namespace management, and unscoped calls.
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
 * Namespace-aware M2M client. Adds X-Namespace header to ALL requests
 * so the server's resolveNamespaces middleware scopes every operation
 * to the specified namespace.
 */
function createNamespacedClient(baseUrl: string, namespace: string) {
  return {
    async get(path: string): Promise<Response> {
      const token = await signTestM2MJwt();
      return fetch(`${baseUrl}${path}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}`, 'X-Namespace': namespace },
      });
    },
    async post(path: string, body: unknown): Promise<Response> {
      const token = await signTestM2MJwt();
      return fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'X-Namespace': namespace },
        body: JSON.stringify(body),
      });
    },
    async put(path: string, body: unknown): Promise<Response> {
      const token = await signTestM2MJwt();
      return fetch(`${baseUrl}${path}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'X-Namespace': namespace },
        body: JSON.stringify(body),
      });
    },
    async patch(path: string, body: unknown): Promise<Response> {
      const token = await signTestM2MJwt();
      return fetch(`${baseUrl}${path}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'X-Namespace': namespace },
        body: JSON.stringify(body),
      });
    },
    async delete(path: string): Promise<Response> {
      const token = await signTestM2MJwt();
      return fetch(`${baseUrl}${path}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}`, 'X-Namespace': namespace },
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

describe.skipIf(!RUN_E2E)('Namespace-based scope isolation (E2E)', () => {
  const config: E2EConfig = defaultConfig;
  const raw = createRawClient(config.apiUrl);
  const nsA = createNamespacedClient(config.apiUrl, NS_A);
  const nsB = createNamespacedClient(config.apiUrl, NS_B);

  /** IDs to clean up after all tests complete, keyed by namespace client. */
  const cleanupWorkItemsA: string[] = [];
  const cleanupWorkItemsB: string[] = [];
  const cleanupContactsA: string[] = [];
  const cleanupContactsB: string[] = [];
  /** Items created without explicit namespace (default). */
  const cleanupWorkItemsDefault: string[] = [];
  const cleanupContactsDefault: string[] = [];

  beforeAll(async () => {
    await waitForService(`${config.apiUrl}/api/health`, config.healthCheckRetries);

    // Create the two namespaces via the raw (unscoped) M2M client.
    // 409 is acceptable if the namespace already exists from a previous run.
    const nsARes = await raw.post('/api/namespaces', { name: NS_A });
    expect([201, 409]).toContain(nsARes.status);

    const nsBRes = await raw.post('/api/namespaces', { name: NS_B });
    expect([201, 409]).toContain(nsBRes.status);
  });

  afterAll(async () => {
    // Best-effort cleanup; ignore errors (items may already be deleted by tests).
    for (const id of cleanupWorkItemsA) {
      try { await nsA.delete(`/api/work-items/${id}?permanent=true`); } catch { /* ignore */ }
    }
    for (const id of cleanupWorkItemsB) {
      try { await nsB.delete(`/api/work-items/${id}?permanent=true`); } catch { /* ignore */ }
    }
    for (const id of cleanupWorkItemsDefault) {
      try { await raw.delete(`/api/work-items/${id}?permanent=true`); } catch { /* ignore */ }
    }
    for (const id of cleanupContactsA) {
      try { await nsA.delete(`/api/contacts/${id}?permanent=true`); } catch { /* ignore */ }
    }
    for (const id of cleanupContactsB) {
      try { await nsB.delete(`/api/contacts/${id}?permanent=true`); } catch { /* ignore */ }
    }
    for (const id of cleanupContactsDefault) {
      try { await raw.delete(`/api/contacts/${id}?permanent=true`); } catch { /* ignore */ }
    }
  });

  // ── Work Item Isolation ──────────────────────────────────────────

  describe('Work item isolation', () => {
    let itemIdA: string;

    beforeAll(async () => {
      const res = await postWithRetry(nsA, '/api/work-items', {
        title: `E2E NS-A WI ${Date.now()}`,
        kind: 'issue',
        user_email: USER_A,
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string; namespace?: string };
      itemIdA = body.id;
      console.error(`[DIAG] Created WI in NS_A: id=${itemIdA}, namespace=${body.namespace}, NS_A=${NS_A}`);
      cleanupWorkItemsA.push(itemIdA);
    });

    it('namespace A can list the item', async () => {
      const res = await nsA.get('/api/work-items');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: Array<{ id: string }> };
      expect(body.items.some((i) => i.id === itemIdA)).toBe(true);
    });

    it('namespace B cannot list the item', async () => {
      const res = await nsB.get('/api/work-items');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: Array<{ id: string }> };
      expect(body.items.some((i) => i.id === itemIdA)).toBe(false);
    });

    it('namespace A can GET the item by id', async () => {
      const res = await nsA.get(`/api/work-items/${itemIdA}`);
      expect(res.status).toBe(200);
    });

    it('namespace B gets 404 for GET by id', async () => {
      const res = await nsB.get(`/api/work-items/${itemIdA}`);
      if (res.status !== 404) {
        const body = await res.clone().text();
        console.error(`[DIAG] WI GET cross-ns: expected 404, got ${res.status}. NS_B=${NS_B}, id=${itemIdA}, body=${body.slice(0, 300)}`);
      }
      expect(res.status).toBe(404);
    });
  });

  // ── Contact Isolation ────────────────────────────────────────────

  describe('Contact isolation', () => {
    let contactIdA: string;

    beforeAll(async () => {
      const res = await postWithRetry(nsA, '/api/contacts', {
        display_name: `E2E NS-A Contact ${Date.now()}`,
        user_email: USER_A,
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string; namespace?: string };
      contactIdA = body.id;
      console.error(`[DIAG] Created Contact in NS_A: id=${contactIdA}, namespace=${body.namespace}, NS_A=${NS_A}`);
      cleanupContactsA.push(contactIdA);
    });

    it('namespace A can list the contact', async () => {
      const res = await nsA.get('/api/contacts');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { contacts: Array<{ id: string }> };
      expect(body.contacts.some((c) => c.id === contactIdA)).toBe(true);
    });

    it('namespace B cannot list the contact', async () => {
      const res = await nsB.get('/api/contacts');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { contacts: Array<{ id: string }> };
      expect(body.contacts.some((c) => c.id === contactIdA)).toBe(false);
    });

    it('namespace A can GET the contact by id', async () => {
      const res = await nsA.get(`/api/contacts/${contactIdA}`);
      expect(res.status).toBe(200);
    });

    it('namespace B gets 404 for GET contact by id', async () => {
      const res = await nsB.get(`/api/contacts/${contactIdA}`);
      if (res.status !== 404) {
        const body = await res.clone().text();
        console.error(`[DIAG] Contact GET cross-ns: expected 404, got ${res.status}. NS_B=${NS_B}, id=${contactIdA}, body=${body.slice(0, 300)}`);
      }
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
      const typeRes = await raw.post('/api/relationship-types', {
        name: relTypeName,
        label: 'E2E Colleague',
      });
      expect([201, 409]).toContain(typeRes.status);

      // Create two contacts in namespace A
      const c1 = await postWithRetry(nsA, '/api/contacts', {
        display_name: `E2E RelA1 ${uniqueTag}`,
        user_email: USER_A,
      });
      expect(c1.status).toBe(201);
      contactA1 = ((await c1.json()) as { id: string }).id;
      cleanupContactsA.push(contactA1);

      const c2 = await postWithRetry(nsA, '/api/contacts', {
        display_name: `E2E RelA2 ${uniqueTag}`,
        user_email: USER_A,
      });
      expect(c2.status).toBe(201);
      const contactA2 = ((await c2.json()) as { id: string }).id;
      cleanupContactsA.push(contactA2);

      // Create relationship via namespace A scoped client
      const relRes = await postWithRetry(nsA, '/api/relationships/set', {
        contact_a: `E2E RelA1 ${uniqueTag}`,
        contact_b: `E2E RelA2 ${uniqueTag}`,
        relationship_type: relTypeName,
        user_email: USER_A,
      });
      expect(relRes.status).toBe(200);
    });

    it('namespace A can list relationships', async () => {
      const res = await nsA.get(`/api/relationships?contact_id=${contactA1}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { relationships: Array<{ id: string }> };
      expect(body.relationships.length).toBeGreaterThan(0);
    });

    it('namespace B cannot see namespace A relationships', async () => {
      const res = await nsB.get(`/api/relationships?contact_id=${contactA1}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { relationships: Array<{ id: string }> };
      expect(body.relationships.length).toBe(0);
    });
  });

  // ── Backwards Compatibility ──────────────────────────────────────

  describe('Backwards compatibility', () => {
    let unscopedItemId: string;
    let unscopedContactId: string;

    it('work items created without explicit namespace go to default', async () => {
      // Use the raw client (no X-Namespace header). M2M without requested
      // namespace resolves to 'default'.
      const res = await postWithRetry(raw, '/api/work-items', {
        title: `E2E Unscoped WI ${Date.now()}`,
        kind: 'issue',
      });
      expect(res.status).toBe(201);
      unscopedItemId = ((await res.json()) as { id: string }).id;
      cleanupWorkItemsDefault.push(unscopedItemId);

      // Listing without namespace header (also defaults to 'default') should include it
      const listRes = await raw.get('/api/work-items');
      expect(listRes.status).toBe(200);
      const body = (await listRes.json()) as { items: Array<{ id: string }> };
      expect(body.items.some((i) => i.id === unscopedItemId)).toBe(true);
    });

    it('contacts created without explicit namespace go to default', async () => {
      const res = await postWithRetry(raw, '/api/contacts', {
        display_name: `E2E Unscoped Contact ${Date.now()}`,
      });
      expect(res.status).toBe(201);
      unscopedContactId = ((await res.json()) as { id: string }).id;
      cleanupContactsDefault.push(unscopedContactId);

      const listRes = await raw.get('/api/contacts');
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
        const res = await postWithRetry(nsA, '/api/work-items', {
          title: `E2E Protected WI ${Date.now()}`,
          kind: 'issue',
          user_email: USER_A,
        });
        expect(res.status).toBe(201);
        protectedItemId = ((await res.json()) as { id: string }).id;
        cleanupWorkItemsA.push(protectedItemId);
      });

      it('namespace B cannot update namespace A work item status', async () => {
        const res = await nsB.patch(
          `/api/work-items/${protectedItemId}/status`,
          { status: 'completed' },
        );
        expect(res.status).toBe(404);
      });

      it('namespace B cannot delete namespace A work item', async () => {
        const res = await nsB.delete(`/api/work-items/${protectedItemId}`);
        expect(res.status).toBe(404);
      });

      it('namespace A can update their own work item status', async () => {
        const res = await nsA.patch(
          `/api/work-items/${protectedItemId}/status`,
          { status: 'completed' },
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as { status: string };
        expect(body.status).toBe('completed');
      });

      it('namespace A can delete their own work item', async () => {
        const res = await nsA.delete(`/api/work-items/${protectedItemId}`);
        expect(res.status).toBe(204);
        // Remove from cleanup since already deleted
        const idx = cleanupWorkItemsA.indexOf(protectedItemId);
        if (idx >= 0) cleanupWorkItemsA.splice(idx, 1);
      });
    });

    describe('contacts', () => {
      let protectedContactId: string;

      beforeAll(async () => {
        const res = await postWithRetry(nsA, '/api/contacts', {
          display_name: `E2E Protected Contact ${Date.now()}`,
          user_email: USER_A,
        });
        expect(res.status).toBe(201);
        protectedContactId = ((await res.json()) as { id: string }).id;
        cleanupContactsA.push(protectedContactId);
      });

      it('namespace B cannot update namespace A contact', async () => {
        const res = await nsB.patch(
          `/api/contacts/${protectedContactId}`,
          { display_name: 'Hacked' },
        );
        if (res.status !== 404) {
          const body = await res.clone().text();
          console.error(`[DIAG] Contact PATCH cross-ns: expected 404, got ${res.status}. NS_B=${NS_B}, id=${protectedContactId}, body=${body.slice(0, 300)}`);
        }
        expect(res.status).toBe(404);
      });

      it('namespace B cannot delete namespace A contact', async () => {
        const res = await nsB.delete(`/api/contacts/${protectedContactId}`);
        if (res.status !== 404) {
          console.error(`[DIAG] Contact DELETE cross-ns: expected 404, got ${res.status}. NS_B=${NS_B}, id=${protectedContactId}`);
        }
        expect(res.status).toBe(404);
      });

      it('namespace A can update their own contact', async () => {
        const res = await nsA.patch(
          `/api/contacts/${protectedContactId}`,
          { display_name: 'Updated Name' },
        );
        expect(res.status).toBe(200);
      });

      it('namespace A can delete their own contact', async () => {
        const res = await nsA.delete(`/api/contacts/${protectedContactId}`);
        expect(res.status).toBe(204);
        const idx = cleanupContactsA.indexOf(protectedContactId);
        if (idx >= 0) cleanupContactsA.splice(idx, 1);
      });
    });
  });

  // ── Principal Binding via Namespace (M2M Cross-Namespace) ────────
  // M2M tokens can target any namespace by setting the X-Namespace header.
  // This verifies that namespace isolation is enforced per-request based
  // on the namespace header, not the token identity.

  describe('Principal binding via namespace (M2M cross-namespace)', () => {
    describe('M2M client in namespace A cannot access namespace B data', () => {
      let itemForB: string;

      beforeAll(async () => {
        // Create a work item in namespace B
        const res = await postWithRetry(nsB, '/api/work-items', {
          title: `E2E PB Item ${Date.now()}`,
          kind: 'issue',
          user_email: USER_B,
        });
        expect(res.status).toBe(201);
        const pbBody = (await res.json()) as { id: string; namespace?: string };
        itemForB = pbBody.id;
        console.error(`[DIAG] Created WI in NS_B: id=${itemForB}, namespace=${pbBody.namespace}, NS_B=${NS_B}`);
        cleanupWorkItemsB.push(itemForB);
      });

      it('namespace A client listing does not include namespace B item', async () => {
        const res = await nsA.get('/api/work-items');
        expect(res.status).toBe(200);
        const body = (await res.json()) as { items: Array<{ id: string }> };
        // Should NOT see namespace B's item
        expect(body.items.some((i) => i.id === itemForB)).toBe(false);
      });

      it('namespace A client cannot GET namespace B item by id', async () => {
        const res = await nsA.get(`/api/work-items/${itemForB}`);
        if (res.status !== 404) {
          const body = await res.clone().text();
          console.error(`[DIAG] M2M cross-ns GET: expected 404, got ${res.status}. NS_A=${NS_A}, itemInB=${itemForB}, body=${body.slice(0, 300)}`);
        }
        // Namespace scoping prevents access — item is in namespace B
        expect(res.status).toBe(404);
      });
    });

    describe('M2M token can access data in any namespace it targets', () => {
      let itemForA: string;

      beforeAll(async () => {
        const res = await postWithRetry(nsA, '/api/work-items', {
          title: `E2E M2M NS Item ${Date.now()}`,
          kind: 'issue',
          user_email: USER_A,
        });
        expect(res.status).toBe(201);
        itemForA = ((await res.json()) as { id: string }).id;
        cleanupWorkItemsA.push(itemForA);
      });

      it('M2M client targeting namespace A can list namespace A items', async () => {
        const res = await nsA.get('/api/work-items');
        expect(res.status).toBe(200);
        const body = (await res.json()) as { items: Array<{ id: string }> };
        expect(body.items.some((i) => i.id === itemForA)).toBe(true);
      });

      it('M2M client targeting namespace B gets empty list for namespace B', async () => {
        const res = await nsB.get('/api/work-items');
        expect(res.status).toBe(200);
        // This should succeed (even if empty), not error
        const body = (await res.json()) as { items: Array<{ id: string }> };
        expect(Array.isArray(body.items)).toBe(true);
        // Namespace B should NOT contain namespace A's item
        expect(body.items.some((i) => i.id === itemForA)).toBe(false);
      });
    });
  });
});
