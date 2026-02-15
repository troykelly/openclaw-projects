/**
 * Integration tests for agent identity management (Issue #1287).
 *
 * Tests CRUD for agent identities, proposal workflow, history,
 * and rollback functionality.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/api/server.js';
import { createTestPool } from './helpers/db.js';

const TEST_EMAIL = 'identity-test@example.com';

describe('Agent Identity API (Issue #1287)', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let pool: ReturnType<typeof createTestPool>;

  beforeAll(async () => {
    pool = createTestPool();
    app = await buildServer();

    // Clean up any leftover test data
    await pool.query(`DELETE FROM agent_identity_history`);
    await pool.query(`DELETE FROM agent_identity WHERE name LIKE 'test-%'`);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM agent_identity_history`);
    await pool.query(`DELETE FROM agent_identity WHERE name LIKE 'test-%'`);
    await pool.end();
    await app.close();
  });

  // ─── Schema ────────────────────────────────────────────────────────────

  describe('Schema', () => {
    it('agent_identity table exists with expected columns', async () => {
      const result = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'agent_identity'
         ORDER BY ordinal_position`,
      );
      const columns = result.rows.map((r) => r.column_name);
      expect(columns).toContain('id');
      expect(columns).toContain('name');
      expect(columns).toContain('display_name');
      expect(columns).toContain('persona');
      expect(columns).toContain('principles');
      expect(columns).toContain('quirks');
      expect(columns).toContain('version');
    });

    it('agent_identity_history table exists with expected columns', async () => {
      const result = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'agent_identity_history'
         ORDER BY ordinal_position`,
      );
      const columns = result.rows.map((r) => r.column_name);
      expect(columns).toContain('id');
      expect(columns).toContain('identity_id');
      expect(columns).toContain('version');
      expect(columns).toContain('changed_by');
      expect(columns).toContain('change_type');
      expect(columns).toContain('full_snapshot');
    });
  });

  // ─── GET /api/identity ─────────────────────────────────────────────────

  describe('GET /api/identity', () => {
    it('returns the current identity (or 404 if none exists)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/identity',
        headers: { 'x-user-email': TEST_EMAIL },
      });

      // Could be 200 or 404 depending on whether one exists
      expect([200, 404]).toContain(res.statusCode);
    });
  });

  // ─── PUT /api/identity ─────────────────────────────────────────────────

  describe('PUT /api/identity', () => {
    it('creates or updates the identity', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/identity',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {
          name: 'test-quasar',
          display_name: 'Test Quasar',
          emoji: '✦',
          persona: 'A helpful, curious AI assistant that values clarity.',
          principles: ['Be helpful', 'Be honest', 'Be concise'],
          quirks: ['Uses bullet points for status updates'],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.name).toBe('test-quasar');
      expect(body.display_name).toBe('Test Quasar');
      expect(body.persona).toContain('helpful');
      expect(body.principles).toContain('Be helpful');
      expect(body.version).toBe(1);
    });

    it('returns 400 when name is missing', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/identity',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { display_name: 'No Name' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ─── PATCH /api/identity ───────────────────────────────────────────────

  describe('PATCH /api/identity', () => {
    it('updates identity fields and bumps version', async () => {
      // Ensure identity exists
      await app.inject({
        method: 'PUT',
        url: '/api/identity',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {
          name: 'test-patch',
          display_name: 'Patch Test',
          persona: 'Original persona text.',
        },
      });

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/identity',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {
          name: 'test-patch',
          persona: 'Updated persona with more detail.',
          quirks: ['Prefers markdown formatting'],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.persona).toBe('Updated persona with more detail.');
      expect(body.quirks).toContain('Prefers markdown formatting');
      expect(body.version).toBeGreaterThanOrEqual(2);
    });

    it('returns 404 for non-existent identity', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/identity',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {
          name: 'does-not-exist-999',
          persona: 'test',
        },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ─── POST /api/identity/proposals ──────────────────────────────────────

  describe('POST /api/identity/proposals', () => {
    it('creates a proposal for an identity change', async () => {
      // Ensure identity exists
      await app.inject({
        method: 'PUT',
        url: '/api/identity',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {
          name: 'test-proposals',
          display_name: 'Proposal Test',
          persona: 'A test persona.',
        },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/identity/proposals',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {
          name: 'test-proposals',
          field: 'quirks',
          new_value: 'Prefers bullet points for status updates',
          reason: 'Observed over 20+ interactions',
          proposed_by: 'agent:claude-code',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.change_type).toBe('propose');
      expect(body.field_changed).toBe('quirks');
      expect(body.new_value).toBe('Prefers bullet points for status updates');
    });

    it('returns 404 for non-existent identity', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/identity/proposals',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {
          name: 'does-not-exist-999',
          field: 'quirks',
          new_value: 'test',
          proposed_by: 'agent:test',
        },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ─── POST /api/identity/proposals/:id/approve ─────────────────────────

  describe('POST /api/identity/proposals/:id/approve', () => {
    it('approves a pending proposal and updates the identity', async () => {
      // Ensure identity
      await app.inject({
        method: 'PUT',
        url: '/api/identity',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {
          name: 'test-approve',
          display_name: 'Approve Test',
          persona: 'A test persona.',
          quirks: [],
        },
      });

      // Create a proposal
      const proposalRes = await app.inject({
        method: 'POST',
        url: '/api/identity/proposals',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {
          name: 'test-approve',
          field: 'quirks',
          new_value: 'Loves semicolons',
          reason: 'Test proposal',
          proposed_by: 'agent:test',
        },
      });
      const proposalId = proposalRes.json().id;

      // Approve it
      const res = await app.inject({
        method: 'POST',
        url: `/api/identity/proposals/${proposalId}/approve`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.change_type).toBe('approve');
      expect(body.approved_by).toBe(TEST_EMAIL);
    });

    it('returns 404 for non-existent proposal', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/identity/proposals/00000000-0000-0000-0000-000000000099/approve',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {},
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ─── POST /api/identity/proposals/:id/reject ──────────────────────────

  describe('POST /api/identity/proposals/:id/reject', () => {
    it('rejects a pending proposal', async () => {
      // Ensure identity
      await app.inject({
        method: 'PUT',
        url: '/api/identity',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {
          name: 'test-reject',
          display_name: 'Reject Test',
          persona: 'A test persona.',
        },
      });

      // Create a proposal
      const proposalRes = await app.inject({
        method: 'POST',
        url: '/api/identity/proposals',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {
          name: 'test-reject',
          field: 'persona',
          new_value: 'A totally different persona',
          reason: 'Just testing',
          proposed_by: 'agent:test',
        },
      });
      const proposalId = proposalRes.json().id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/identity/proposals/${proposalId}/reject`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { reason: 'Not aligned with personality' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.change_type).toBe('reject');
    });
  });

  // ─── GET /api/identity/history ─────────────────────────────────────────

  describe('GET /api/identity/history', () => {
    it('returns version history for an identity', async () => {
      // Ensure we have an identity with some history
      await app.inject({
        method: 'PUT',
        url: '/api/identity',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {
          name: 'test-history',
          display_name: 'History Test',
          persona: 'A test persona.',
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/identity/history?name=test-history',
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.history).toBeDefined();
      expect(Array.isArray(body.history)).toBe(true);
      expect(body.history.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── POST /api/identity/rollback ───────────────────────────────────────

  describe('POST /api/identity/rollback', () => {
    it('rolls back to a previous version', async () => {
      // Create identity
      await app.inject({
        method: 'PUT',
        url: '/api/identity',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {
          name: 'test-rollback',
          display_name: 'Rollback Test',
          persona: 'Version 1 persona.',
        },
      });

      // Update to v2
      await app.inject({
        method: 'PATCH',
        url: '/api/identity',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {
          name: 'test-rollback',
          persona: 'Version 2 persona.',
        },
      });

      // Rollback to v1
      const res = await app.inject({
        method: 'POST',
        url: '/api/identity/rollback',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { name: 'test-rollback', version: 1 },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.persona).toBe('Version 1 persona.');
    });

    it('returns 404 for non-existent identity', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/identity/rollback',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { name: 'does-not-exist-999', version: 1 },
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
