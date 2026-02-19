/**
 * Integration tests for fuzzy contact matching (Issue #1270).
 *
 * Tests the suggest-match API route and message-to-contact linking.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/api/server.js';
import { createTestPool } from './helpers/db.js';

const TEST_EMAIL = 'fuzzy-match-test@example.com';

describe('Fuzzy Contact Matching (Issue #1270)', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let pool: ReturnType<typeof createTestPool>;

  // IDs populated in beforeAll
  let contactAliceId: string;
  let contactBobId: string;
  let contactCharlieId: string;
  let endpointAlicePhone: string;
  let endpointAliceEmail: string;
  let endpointBobPhone: string;
  let endpointCharlieEmail: string;
  let thread_id: string;
  let unlinkedMessageId: string;

  beforeAll(async () => {
    pool = createTestPool();
    app = await buildServer();

    // Clean up test data
    await pool.query(`DELETE FROM external_message WHERE external_message_key LIKE 'fuzzy-test-%'`);
    await pool.query(`DELETE FROM external_thread WHERE external_thread_key LIKE 'fuzzy-test-%'`);
    await pool.query(`DELETE FROM contact WHERE display_name LIKE 'Fuzzy Test%'`);

    // Create test contacts with endpoints
    // Alice - has phone and email
    const aliceResult = await pool.query(
      `INSERT INTO contact (display_name, namespace)
       VALUES ('Fuzzy Test Alice Smith', 'default')
       RETURNING id::text as id`,
    );
    contactAliceId = aliceResult.rows[0].id;

    const alicePhoneResult = await pool.query(
      `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value)
       VALUES ($1, 'phone', '+61400123456')
       RETURNING id::text as id`,
      [contactAliceId],
    );
    endpointAlicePhone = alicePhoneResult.rows[0].id;

    const aliceEmailResult = await pool.query(
      `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value)
       VALUES ($1, 'email', 'alice.smith@example.com')
       RETURNING id::text as id`,
      [contactAliceId],
    );
    endpointAliceEmail = aliceEmailResult.rows[0].id;

    // Bob - has phone only
    const bobResult = await pool.query(
      `INSERT INTO contact (display_name, namespace)
       VALUES ('Fuzzy Test Bob Jones', 'default')
       RETURNING id::text as id`,
    );
    contactBobId = bobResult.rows[0].id;

    const bobPhoneResult = await pool.query(
      `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value)
       VALUES ($1, 'phone', '+61400123457')
       RETURNING id::text as id`,
      [contactBobId],
    );
    endpointBobPhone = bobPhoneResult.rows[0].id;

    // Charlie - has email only (same domain as Alice)
    const charlieResult = await pool.query(
      `INSERT INTO contact (display_name, namespace)
       VALUES ('Fuzzy Test Charlie Brown', 'default')
       RETURNING id::text as id`,
    );
    contactCharlieId = charlieResult.rows[0].id;

    const charlieEmailResult = await pool.query(
      `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value)
       VALUES ($1, 'email', 'charlie.brown@example.com')
       RETURNING id::text as id`,
      [contactCharlieId],
    );
    endpointCharlieEmail = charlieEmailResult.rows[0].id;

    // Create an unlinked thread + message (thread without a known contact endpoint)
    // We need a "dummy" endpoint for the thread - use Alice's for setup, then test with unlinked message
    const threadResult = await pool.query(
      `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
       VALUES ($1, 'phone', 'fuzzy-test-thread-01')
       RETURNING id::text as id`,
      [endpointAlicePhone],
    );
    thread_id = threadResult.rows[0].id;

    const msgResult = await pool.query(
      `INSERT INTO external_message (thread_id, external_message_key, direction, body, from_address, received_at)
       VALUES ($1, 'fuzzy-test-msg-01', 'inbound', 'Hello from unknown', '+61400999888', NOW())
       RETURNING id::text as id`,
      [thread_id],
    );
    unlinkedMessageId = msgResult.rows[0].id;
  });

  afterAll(async () => {
    // Clean up
    await pool.query(`DELETE FROM external_message WHERE external_message_key LIKE 'fuzzy-test-%'`);
    await pool.query(`DELETE FROM external_thread WHERE external_thread_key LIKE 'fuzzy-test-%'`);
    await pool.query(`DELETE FROM contact WHERE display_name LIKE 'Fuzzy Test%'`);
    await pool.end();
    await app.close();
  });

  // ─── GET /api/contacts/suggest-match ───────────────────────────────────

  describe('GET /api/contacts/suggest-match', () => {
    it('returns 400 when no search parameters provided', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/contacts/suggest-match',
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(400);
    });

    it('matches by exact phone number', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/contacts/suggest-match?phone=%2B61400123456',
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.matches).toBeDefined();
      expect(body.matches.length).toBeGreaterThanOrEqual(1);

      // Alice should be top match with high confidence
      const aliceMatch = body.matches.find((m: { contact_id: string }) => m.contact_id === contactAliceId);
      expect(aliceMatch).toBeDefined();
      expect(aliceMatch.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('matches by similar phone number (last digits)', async () => {
      // Search for a phone number that shares the same prefix as Alice/Bob
      const res = await app.inject({
        method: 'GET',
        url: '/api/contacts/suggest-match?phone=%2B61400123499&user_email=' + encodeURIComponent(TEST_EMAIL),
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.matches).toBeDefined();
      // Should find Alice (+61400123456) and Bob (+61400123457) as partial matches
      // since they share the first 9 digits (+6140012345x)
      const matchIds = body.matches.map((m: { contact_id: string }) => m.contact_id);
      expect(matchIds).toContain(contactAliceId);
      expect(matchIds).toContain(contactBobId);
    });

    it('matches by exact email address', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/contacts/suggest-match?email=alice.smith%40example.com',
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.matches.length).toBeGreaterThanOrEqual(1);

      const aliceMatch = body.matches.find((m: { contact_id: string }) => m.contact_id === contactAliceId);
      expect(aliceMatch).toBeDefined();
      expect(aliceMatch.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('matches by email domain', async () => {
      // Search for unknown email at same domain
      const res = await app.inject({
        method: 'GET',
        url: '/api/contacts/suggest-match?email=unknown%40example.com',
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Should find Alice and Charlie who both have @example.com endpoints
      const matchIds = body.matches.map((m: { contact_id: string }) => m.contact_id);
      expect(matchIds).toContain(contactAliceId);
      expect(matchIds).toContain(contactCharlieId);
    });

    it('matches by name', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/contacts/suggest-match?name=Alice',
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.matches.length).toBeGreaterThanOrEqual(1);

      const aliceMatch = body.matches.find((m: { contact_id: string }) => m.contact_id === contactAliceId);
      expect(aliceMatch).toBeDefined();
    });

    it('combines multiple signals for higher confidence', async () => {
      // Search with both phone and name that match Alice
      const res = await app.inject({
        method: 'GET',
        url: '/api/contacts/suggest-match?phone=%2B61400123456&name=Alice',
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.matches.length).toBeGreaterThanOrEqual(1);

      // Alice should be top with very high confidence (phone exact + name match)
      expect(body.matches[0].contact_id).toBe(contactAliceId);
      expect(body.matches[0].confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('returns results sorted by confidence descending', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/contacts/suggest-match?phone=%2B61400123458&name=Alice',
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      for (let i = 1; i < body.matches.length; i++) {
        expect(body.matches[i - 1].confidence).toBeGreaterThanOrEqual(body.matches[i].confidence);
      }
    });

    it('returns contact display_name and endpoints in match results', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/contacts/suggest-match?phone=%2B61400123456',
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      const aliceMatch = body.matches.find((m: { contact_id: string }) => m.contact_id === contactAliceId);

      expect(aliceMatch.display_name).toBe('Fuzzy Test Alice Smith');
      expect(aliceMatch.endpoints).toBeDefined();
      expect(aliceMatch.endpoints.length).toBeGreaterThanOrEqual(1);
    });

    it('respects limit parameter', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/contacts/suggest-match?name=Fuzzy+Test&limit=1',
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.matches.length).toBeLessThanOrEqual(1);
    });

    it('returns empty matches when no contacts match', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/contacts/suggest-match?phone=%2B99999999999',
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.matches).toEqual([]);
    });

    it('respects user_email scoping', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/contacts/suggest-match?name=Alice&user_email=' + encodeURIComponent('other-user@example.com'),
        headers: { 'x-user-email': 'other-user@example.com' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Our test contacts have user_email set to TEST_EMAIL, so other user should not see them
      const aliceMatch = body.matches.find((m: { contact_id: string }) => m.contact_id === contactAliceId);
      expect(aliceMatch).toBeUndefined();
    });
  });

  // ─── POST /api/messages/:id/link-contact ───────────────────────────────

  describe('POST /api/messages/:id/link-contact', () => {
    it('returns 400 when contact_id is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/messages/${unlinkedMessageId}/link-contact`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 404 for non-existent message', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/messages/00000000-0000-0000-0000-000000000099/link-contact',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { contact_id: contactAliceId },
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 404 for non-existent contact', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/messages/${unlinkedMessageId}/link-contact`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { contact_id: '00000000-0000-0000-0000-000000000099' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('links a message sender to a contact', async () => {
      // Create a fresh message for this test to avoid side effects
      const msgResult = await pool.query(
        `INSERT INTO external_message (thread_id, external_message_key, direction, body, from_address, received_at)
         VALUES ($1, 'fuzzy-test-msg-link', 'inbound', 'Link me', '+61400999777', NOW())
         RETURNING id::text as id`,
        [thread_id],
      );
      const message_id = msgResult.rows[0].id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/messages/${message_id}/link-contact`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { contact_id: contactBobId },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.contact_id).toBe(contactBobId);
      expect(body.message_id).toBe(message_id);
    });

    it('returns 400 for invalid message id format', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/messages/not-a-uuid/link-contact',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { contact_id: contactAliceId },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for invalid contact_id format', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/messages/${unlinkedMessageId}/link-contact`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { contact_id: 'not-a-uuid' },
      });

      expect(res.statusCode).toBe(400);
    });
  });
});
