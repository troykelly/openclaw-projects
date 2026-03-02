/**
 * Integration tests for dev session terminal orchestration (Issue #1988).
 *
 * Tests the junction table, linking terminal sessions to dev sessions,
 * and terminal lifecycle management from dev session operations.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/api/server.js';
import { createTestPool } from './helpers/db.js';

const TEST_EMAIL = 'dev-session-terminal-test@example.com';

describe('Dev Session Terminal Orchestration (Issue #1988)', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let pool: ReturnType<typeof createTestPool>;
  let devSessionId: string;
  let terminalSessionId: string;
  let connectionId: string;

  beforeAll(async () => {
    pool = createTestPool();
    app = await buildServer();

    // Clean up any previous test data
    await pool.query(`DELETE FROM dev_session_terminal WHERE dev_session_id IN (
      SELECT id FROM dev_session WHERE user_email = $1
    )`, [TEST_EMAIL]);
    await pool.query(`DELETE FROM dev_session WHERE user_email = $1`, [TEST_EMAIL]);

    // Create a terminal connection for testing
    const connResult = await pool.query(
      `INSERT INTO terminal_connection (name, namespace, host, port, username, is_local)
       VALUES ('test-conn', 'default', 'localhost', 22, 'testuser', true)
       RETURNING id::text as id`,
    );
    connectionId = connResult.rows[0].id;

    // Create a terminal session for testing linking
    const tsResult = await pool.query(
      `INSERT INTO terminal_session (connection_id, namespace, tmux_session_name, status)
       VALUES ($1, 'default', 'test-session-link', 'active')
       RETURNING id::text as id`,
      [connectionId],
    );
    terminalSessionId = tsResult.rows[0].id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM dev_session_terminal WHERE dev_session_id IN (
      SELECT id FROM dev_session WHERE user_email = $1
    )`, [TEST_EMAIL]);
    await pool.query(`DELETE FROM dev_session WHERE user_email = $1`, [TEST_EMAIL]);
    await pool.query(`DELETE FROM terminal_session WHERE connection_id = $1`, [connectionId]);
    await pool.query(`DELETE FROM terminal_connection WHERE id = $1`, [connectionId]);
    await pool.end();
    await app.close();
  });

  // ─── Schema ──────────────────────────────────────────────────────────

  describe('Schema', () => {
    it('dev_session_terminal junction table exists with expected columns', async () => {
      const result = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'dev_session_terminal'
         ORDER BY ordinal_position`,
      );
      const columns = result.rows.map((r: { column_name: string }) => r.column_name);
      expect(columns).toContain('dev_session_id');
      expect(columns).toContain('terminal_session_id');
      expect(columns).toContain('linked_at');
    });

    it('has composite primary key on (dev_session_id, terminal_session_id)', async () => {
      const result = await pool.query(
        `SELECT kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
         WHERE tc.table_name = 'dev_session_terminal'
           AND tc.constraint_type = 'PRIMARY KEY'
         ORDER BY kcu.ordinal_position`,
      );
      const columns = result.rows.map((r: { column_name: string }) => r.column_name);
      expect(columns).toEqual(['dev_session_id', 'terminal_session_id']);
    });

    it('has foreign key to dev_session', async () => {
      const result = await pool.query(
        `SELECT ccu.table_name AS referenced_table
         FROM information_schema.table_constraints tc
         JOIN information_schema.constraint_column_usage ccu
           ON tc.constraint_name = ccu.constraint_name
         WHERE tc.table_name = 'dev_session_terminal'
           AND tc.constraint_type = 'FOREIGN KEY'
           AND ccu.table_name = 'dev_session'`,
      );
      expect(result.rows.length).toBeGreaterThan(0);
    });

    it('has foreign key to terminal_session', async () => {
      const result = await pool.query(
        `SELECT ccu.table_name AS referenced_table
         FROM information_schema.table_constraints tc
         JOIN information_schema.constraint_column_usage ccu
           ON tc.constraint_name = ccu.constraint_name
         WHERE tc.table_name = 'dev_session_terminal'
           AND tc.constraint_type = 'FOREIGN KEY'
           AND ccu.table_name = 'terminal_session'`,
      );
      expect(result.rows.length).toBeGreaterThan(0);
    });
  });

  // ─── POST /dev-sessions/:id/terminals (Link) ──────────────────────

  describe('POST /dev-sessions/:id/terminals', () => {
    it('links a terminal session to a dev session', async () => {
      // First create a dev session
      const createRes = await app.inject({
        method: 'POST',
        url: '/dev-sessions',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { session_name: 'terminal-link-test', node: 'test-node' },
      });
      expect(createRes.statusCode).toBe(201);
      devSessionId = createRes.json().id;

      // Link the terminal session
      const linkRes = await app.inject({
        method: 'POST',
        url: `/dev-sessions/${devSessionId}/terminals`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { terminal_session_id: terminalSessionId },
      });
      expect(linkRes.statusCode).toBe(201);
      const body = linkRes.json();
      expect(body.dev_session_id).toBe(devSessionId);
      expect(body.terminal_session_id).toBe(terminalSessionId);
      expect(body.linked_at).toBeDefined();
    });

    it('returns 409 when linking same terminal again', async () => {
      const linkRes = await app.inject({
        method: 'POST',
        url: `/dev-sessions/${devSessionId}/terminals`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { terminal_session_id: terminalSessionId },
      });
      expect(linkRes.statusCode).toBe(409);
    });

    it('returns 400 with invalid terminal_session_id', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/dev-sessions/${devSessionId}/terminals`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { terminal_session_id: 'not-a-uuid' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 404 with non-existent dev session', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/dev-sessions/00000000-0000-0000-0000-000000000000/terminals`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { terminal_session_id: terminalSessionId },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 with non-existent terminal session', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/dev-sessions/${devSessionId}/terminals`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { terminal_session_id: '00000000-0000-0000-0000-000000000000' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ─── GET /dev-sessions/:id/terminals ──────────────────────────────

  describe('GET /dev-sessions/:id/terminals', () => {
    it('returns linked terminal sessions with status', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/dev-sessions/${devSessionId}/terminals`,
        headers: { 'x-user-email': TEST_EMAIL },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.terminals).toBeInstanceOf(Array);
      expect(body.terminals.length).toBe(1);
      expect(body.terminals[0].terminal_session_id).toBe(terminalSessionId);
      expect(body.terminals[0].status).toBe('active');
      expect(body.terminals[0].linked_at).toBeDefined();
    });

    it('returns empty array for dev session with no terminals', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/dev-sessions',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { session_name: 'no-terminals-test', node: 'test-node' },
      });
      const noTerminalSessionId = createRes.json().id;

      const res = await app.inject({
        method: 'GET',
        url: `/dev-sessions/${noTerminalSessionId}/terminals`,
        headers: { 'x-user-email': TEST_EMAIL },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().terminals).toEqual([]);
    });
  });

  // ─── GET /dev-sessions/:id (includes terminals) ──────────────────

  describe('GET /dev-sessions/:id (with terminals)', () => {
    it('includes linked terminal sessions in the response', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/dev-sessions/${devSessionId}`,
        headers: { 'x-user-email': TEST_EMAIL },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.terminals).toBeInstanceOf(Array);
      expect(body.terminals.length).toBe(1);
      expect(body.terminals[0].terminal_session_id).toBe(terminalSessionId);
      expect(body.terminals[0].status).toBe('active');
    });
  });

  // ─── PATCH /dev-sessions/:id (link terminal) ─────────────────────

  describe('PATCH /dev-sessions/:id (terminal_session_id linking)', () => {
    it('links a terminal session via update', async () => {
      // Create a new terminal session
      const newTsResult = await pool.query(
        `INSERT INTO terminal_session (connection_id, namespace, tmux_session_name, status)
         VALUES ($1, 'default', 'update-link-test', 'active')
         RETURNING id::text as id`,
        [connectionId],
      );
      const newTerminalId = newTsResult.rows[0].id;

      const res = await app.inject({
        method: 'PATCH',
        url: `/dev-sessions/${devSessionId}`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { terminal_session_id: newTerminalId },
      });
      expect(res.statusCode).toBe(200);

      // Verify the link was created
      const linkCheck = await pool.query(
        `SELECT * FROM dev_session_terminal WHERE dev_session_id = $1 AND terminal_session_id = $2`,
        [devSessionId, newTerminalId],
      );
      expect(linkCheck.rows.length).toBe(1);
    });
  });

  // ─── DELETE /dev-sessions/:id/terminals/:terminal_id ──────────────

  describe('DELETE /dev-sessions/:id/terminals/:terminal_id', () => {
    it('unlinks a terminal session from a dev session', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/dev-sessions/${devSessionId}/terminals/${terminalSessionId}`,
        headers: { 'x-user-email': TEST_EMAIL },
      });
      expect(res.statusCode).toBe(204);

      // Verify the link was removed
      const linkCheck = await pool.query(
        `SELECT * FROM dev_session_terminal WHERE dev_session_id = $1 AND terminal_session_id = $2`,
        [devSessionId, terminalSessionId],
      );
      expect(linkCheck.rows.length).toBe(0);
    });

    it('returns 404 when unlinking non-existent link', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/dev-sessions/${devSessionId}/terminals/00000000-0000-0000-0000-000000000000`,
        headers: { 'x-user-email': TEST_EMAIL },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ─── POST /dev-sessions/:id/complete (terminate_terminals) ────────

  describe('POST /dev-sessions/:id/complete (terminate_terminals)', () => {
    it('marks linked terminals as terminated when terminate_terminals is true', async () => {
      // Create a fresh dev session with a linked terminal
      const createRes = await app.inject({
        method: 'POST',
        url: '/dev-sessions',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { session_name: 'terminate-test', node: 'test-node' },
      });
      const freshSessionId = createRes.json().id;

      // Create a terminal session to terminate
      const tsResult = await pool.query(
        `INSERT INTO terminal_session (connection_id, namespace, tmux_session_name, status)
         VALUES ($1, 'default', 'terminate-me', 'active')
         RETURNING id::text as id`,
        [connectionId],
      );
      const terminateTsId = tsResult.rows[0].id;

      // Link it
      await app.inject({
        method: 'POST',
        url: `/dev-sessions/${freshSessionId}/terminals`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { terminal_session_id: terminateTsId },
      });

      // Complete with terminate_terminals
      const completeRes = await app.inject({
        method: 'POST',
        url: `/dev-sessions/${freshSessionId}/complete`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {
          completion_summary: 'Done with terminate',
          terminate_terminals: true,
        },
      });
      expect(completeRes.statusCode).toBe(200);
      expect(completeRes.json().status).toBe('completed');

      // Verify the terminal session status was updated to terminated
      const tsCheck = await pool.query(
        `SELECT status FROM terminal_session WHERE id = $1`,
        [terminateTsId],
      );
      expect(tsCheck.rows[0].status).toBe('terminated');
    });

    it('does not terminate terminals when terminate_terminals is not provided', async () => {
      // Create a fresh dev session with a linked terminal
      const createRes = await app.inject({
        method: 'POST',
        url: '/dev-sessions',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { session_name: 'no-terminate-test', node: 'test-node' },
      });
      const freshSessionId = createRes.json().id;

      // Create a terminal session
      const tsResult = await pool.query(
        `INSERT INTO terminal_session (connection_id, namespace, tmux_session_name, status)
         VALUES ($1, 'default', 'keep-alive', 'active')
         RETURNING id::text as id`,
        [connectionId],
      );
      const keepAliveTsId = tsResult.rows[0].id;

      // Link it
      await app.inject({
        method: 'POST',
        url: `/dev-sessions/${freshSessionId}/terminals`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { terminal_session_id: keepAliveTsId },
      });

      // Complete without terminate_terminals
      const completeRes = await app.inject({
        method: 'POST',
        url: `/dev-sessions/${freshSessionId}/complete`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { completion_summary: 'Done, keep terminals' },
      });
      expect(completeRes.statusCode).toBe(200);

      // Verify the terminal session is still active
      const tsCheck = await pool.query(
        `SELECT status FROM terminal_session WHERE id = $1`,
        [keepAliveTsId],
      );
      expect(tsCheck.rows[0].status).toBe('active');
    });
  });
});
