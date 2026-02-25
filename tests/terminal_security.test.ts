/**
 * Integration tests for Terminal Security & Infrastructure API endpoints.
 *
 * Epic #1667 — TMux Session Management.
 * Issues: #1683 (enrollment tokens), #1686 (audit trail), #1687 (retention).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { createHash } from 'node:crypto';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

describe('Terminal Security API', () => {
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

  // ================================================================
  // Issue #1683 — Enrollment Token System
  // ================================================================

  describe('Enrollment Tokens (#1683)', () => {
    describe('POST /api/terminal/enrollment-tokens', () => {
      it('creates a token and returns plaintext once', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/enrollment-tokens',
          payload: { label: 'homelab-servers', max_uses: 10 },
        });

        expect(res.statusCode).toBe(201);
        const body = res.json() as Record<string, unknown>;
        expect(body.label).toBe('homelab-servers');
        expect(body.max_uses).toBe(10);
        expect(body.uses).toBe(0);
        expect(body.token).toBeTruthy();
        expect(typeof body.token).toBe('string');
        expect(body.enrollment_script).toBeTruthy();
      });

      it('stores token hash, not plaintext', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/enrollment-tokens',
          payload: { label: 'test-token' },
        });

        expect(res.statusCode).toBe(201);
        const body = res.json() as { token: string; id: string };

        // Verify hash stored in DB
        const dbResult = await pool.query(
          'SELECT token_hash FROM terminal_enrollment_token WHERE id = $1',
          [body.id],
        );
        const storedHash = dbResult.rows[0]?.token_hash as string;
        const expectedHash = createHash('sha256')
          .update(body.token)
          .digest('hex');
        expect(storedHash).toBe(expectedHash);
      });

      it('rejects missing label', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/enrollment-tokens',
          payload: {},
        });

        expect(res.statusCode).toBe(400);
        const body = res.json() as { error: string };
        expect(body.error).toContain('label');
      });

      it('creates token with expiry and connection defaults', async () => {
        const expiresAt = new Date(Date.now() + 86400000).toISOString();
        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/enrollment-tokens',
          payload: {
            label: 'expiring-token',
            max_uses: 5,
            expires_at: expiresAt,
            connection_defaults: { username: 'deploy' },
            allowed_tags: ['production'],
          },
        });

        expect(res.statusCode).toBe(201);
        const body = res.json() as Record<string, unknown>;
        expect(body.max_uses).toBe(5);
        expect(body.allowed_tags).toEqual(['production']);
      });
    });

    describe('GET /api/terminal/enrollment-tokens', () => {
      it('lists tokens without plaintext', async () => {
        await app.inject({
          method: 'POST',
          url: '/api/terminal/enrollment-tokens',
          payload: { label: 'token-1' },
        });
        await app.inject({
          method: 'POST',
          url: '/api/terminal/enrollment-tokens',
          payload: { label: 'token-2' },
        });

        const res = await app.inject({
          method: 'GET',
          url: '/api/terminal/enrollment-tokens',
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { tokens: Array<Record<string, unknown>>; total: number };
        expect(body.total).toBe(2);
        // Plaintext token must NOT be in listing
        for (const t of body.tokens) {
          expect(t).not.toHaveProperty('token');
          expect(t).not.toHaveProperty('token_hash');
        }
      });
    });

    describe('DELETE /api/terminal/enrollment-tokens/:id', () => {
      it('revokes a token (hard delete)', async () => {
        const createRes = await app.inject({
          method: 'POST',
          url: '/api/terminal/enrollment-tokens',
          payload: { label: 'to-revoke' },
        });
        const { id } = createRes.json() as { id: string };

        const deleteRes = await app.inject({
          method: 'DELETE',
          url: `/api/terminal/enrollment-tokens/${id}`,
        });
        expect(deleteRes.statusCode).toBe(204);

        // Verify it's gone
        const listRes = await app.inject({
          method: 'GET',
          url: '/api/terminal/enrollment-tokens',
        });
        const body = listRes.json() as { total: number };
        expect(body.total).toBe(0);
      });

      it('returns 404 for non-existent token', async () => {
        const res = await app.inject({
          method: 'DELETE',
          url: '/api/terminal/enrollment-tokens/00000000-0000-0000-0000-000000000000',
        });
        expect(res.statusCode).toBe(404);
      });
    });

    describe('POST /api/terminal/enroll', () => {
      it('enrolls with valid token and creates connection', async () => {
        const createRes = await app.inject({
          method: 'POST',
          url: '/api/terminal/enrollment-tokens',
          payload: {
            label: 'enroll-test',
            max_uses: 5,
            connection_defaults: { username: 'deploy' },
            allowed_tags: ['enrolled'],
          },
        });
        const { token } = createRes.json() as { token: string };

        const enrollRes = await app.inject({
          method: 'POST',
          url: '/api/terminal/enroll',
          payload: { token, hostname: 'my-server.local' },
        });

        expect(enrollRes.statusCode).toBe(201);
        const body = enrollRes.json() as {
          connection: { id: string; name: string; host: string; tags: string[] };
          enrollment_token_label: string;
        };
        expect(body.connection.name).toBe('my-server.local');
        expect(body.connection.host).toBe('my-server.local');
        expect(body.connection.tags).toContain('enrolled');
        expect(body.enrollment_token_label).toBe('enroll-test');
      });

      it('increments uses on enrollment', async () => {
        const createRes = await app.inject({
          method: 'POST',
          url: '/api/terminal/enrollment-tokens',
          payload: { label: 'uses-test', max_uses: 2 },
        });
        const { token, id } = createRes.json() as { token: string; id: string };

        // First enrollment
        await app.inject({
          method: 'POST',
          url: '/api/terminal/enroll',
          payload: { token, hostname: 'host-1' },
        });

        // Check uses incremented
        const dbResult = await pool.query(
          'SELECT uses FROM terminal_enrollment_token WHERE id = $1',
          [id],
        );
        expect(dbResult.rows[0]?.uses).toBe(1);
      });

      it('rejects enrollment past max_uses', async () => {
        const createRes = await app.inject({
          method: 'POST',
          url: '/api/terminal/enrollment-tokens',
          payload: { label: 'max-test', max_uses: 1 },
        });
        const { token } = createRes.json() as { token: string };

        // First enrollment succeeds
        const res1 = await app.inject({
          method: 'POST',
          url: '/api/terminal/enroll',
          payload: { token, hostname: 'host-1' },
        });
        expect(res1.statusCode).toBe(201);

        // Second enrollment fails
        const res2 = await app.inject({
          method: 'POST',
          url: '/api/terminal/enroll',
          payload: { token, hostname: 'host-2' },
        });
        expect(res2.statusCode).toBe(401);
      });

      it('rejects expired token', async () => {
        // Create token, then expire it manually
        const createRes = await app.inject({
          method: 'POST',
          url: '/api/terminal/enrollment-tokens',
          payload: { label: 'expired-test' },
        });
        const { token, id } = createRes.json() as { token: string; id: string };

        // Set expires_at to past
        await pool.query(
          `UPDATE terminal_enrollment_token SET expires_at = now() - interval '1 hour' WHERE id = $1`,
          [id],
        );

        const enrollRes = await app.inject({
          method: 'POST',
          url: '/api/terminal/enroll',
          payload: { token, hostname: 'host-1' },
        });
        expect(enrollRes.statusCode).toBe(401);
      });

      it('rejects invalid token', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/enroll',
          payload: { token: 'totally-invalid-token', hostname: 'host-1' },
        });
        expect(res.statusCode).toBe(401);
      });

      it('rejects missing hostname', async () => {
        const createRes = await app.inject({
          method: 'POST',
          url: '/api/terminal/enrollment-tokens',
          payload: { label: 'missing-hostname' },
        });
        const { token } = createRes.json() as { token: string };

        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/enroll',
          payload: { token },
        });
        expect(res.statusCode).toBe(400);
      });

      it('revoked token cannot be used', async () => {
        const createRes = await app.inject({
          method: 'POST',
          url: '/api/terminal/enrollment-tokens',
          payload: { label: 'revoke-test' },
        });
        const { token, id } = createRes.json() as { token: string; id: string };

        // Revoke
        await app.inject({
          method: 'DELETE',
          url: `/api/terminal/enrollment-tokens/${id}`,
        });

        // Try to enroll
        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/enroll',
          payload: { token, hostname: 'host-1' },
        });
        expect(res.statusCode).toBe(401);
      });
    });
  });

  // ================================================================
  // Issue #1686 — Audit Trail (Activity)
  // ================================================================

  describe('Audit Trail (#1686)', () => {
    describe('GET /api/terminal/activity', () => {
      it('returns empty activity list', async () => {
        const res = await app.inject({
          method: 'GET',
          url: '/api/terminal/activity',
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { items: unknown[]; total: number };
        expect(body.items).toEqual([]);
        expect(body.total).toBe(0);
      });

      it('records activity on enrollment token creation', async () => {
        // Create a token (which should record activity)
        await app.inject({
          method: 'POST',
          url: '/api/terminal/enrollment-tokens',
          payload: { label: 'activity-test' },
        });

        // Wait a tick for fire-and-forget
        await new Promise((r) => setTimeout(r, 100));

        const res = await app.inject({
          method: 'GET',
          url: '/api/terminal/activity',
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { items: Array<{ action: string }>; total: number };
        expect(body.total).toBeGreaterThanOrEqual(1);
        const createActions = body.items.filter(
          (i) => i.action === 'enrollment_token.create',
        );
        expect(createActions.length).toBeGreaterThanOrEqual(1);
      });

      it('records activity on enrollment', async () => {
        const createRes = await app.inject({
          method: 'POST',
          url: '/api/terminal/enrollment-tokens',
          payload: { label: 'enroll-activity' },
        });
        const { token } = createRes.json() as { token: string };

        await app.inject({
          method: 'POST',
          url: '/api/terminal/enroll',
          payload: { token, hostname: 'activity-host' },
        });

        await new Promise((r) => setTimeout(r, 100));

        const res = await app.inject({
          method: 'GET',
          url: '/api/terminal/activity?action=enrollment.register',
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { items: Array<{ action: string; detail: Record<string, unknown> }>; total: number };
        expect(body.total).toBeGreaterThanOrEqual(1);
        expect(body.items[0].action).toBe('enrollment.register');
      });

      it('filters by session_id', async () => {
        const connId = '00000000-0000-0000-0000-000000000001';
        const sessId = '00000000-0000-0000-0000-000000000010';

        await pool.query(
          `INSERT INTO terminal_connection (id, namespace, name, host) VALUES ($1, 'default', 'test', 'example.com')`,
          [connId],
        );
        await pool.query(
          `INSERT INTO terminal_session (id, namespace, connection_id, tmux_session_name, status) VALUES ($1, 'default', $2, 'sess', 'active')`,
          [sessId, connId],
        );

        // Insert activity directly
        await pool.query(
          `INSERT INTO terminal_activity (namespace, session_id, actor, action) VALUES ('default', $1, 'test', 'session.create')`,
          [sessId],
        );
        await pool.query(
          `INSERT INTO terminal_activity (namespace, actor, action) VALUES ('default', 'test', 'other.action')`,
        );

        const res = await app.inject({
          method: 'GET',
          url: `/api/terminal/activity?session_id=${sessId}`,
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { items: Array<{ action: string }>; total: number };
        expect(body.total).toBe(1);
        expect(body.items[0].action).toBe('session.create');
      });

      it('filters by action', async () => {
        await pool.query(
          `INSERT INTO terminal_activity (namespace, actor, action) VALUES ('default', 'agent-1', 'session.create')`,
        );
        await pool.query(
          `INSERT INTO terminal_activity (namespace, actor, action) VALUES ('default', 'agent-1', 'command.send')`,
        );

        const res = await app.inject({
          method: 'GET',
          url: '/api/terminal/activity?action=command.send',
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { items: Array<{ action: string }>; total: number };
        expect(body.total).toBe(1);
        expect(body.items[0].action).toBe('command.send');
      });

      it('filters by date range', async () => {
        await pool.query(
          `INSERT INTO terminal_activity (namespace, actor, action, created_at)
           VALUES ('default', 'agent-1', 'old.action', now() - interval '7 days')`,
        );
        await pool.query(
          `INSERT INTO terminal_activity (namespace, actor, action) VALUES ('default', 'agent-1', 'new.action')`,
        );

        const fromDate = new Date(Date.now() - 86400000).toISOString(); // 1 day ago
        const res = await app.inject({
          method: 'GET',
          url: `/api/terminal/activity?from=${fromDate}`,
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { items: Array<{ action: string }>; total: number };
        expect(body.total).toBe(1);
        expect(body.items[0].action).toBe('new.action');
      });

      it('respects namespace isolation', async () => {
        await pool.query(
          `INSERT INTO terminal_activity (namespace, actor, action) VALUES ('other-ns', 'agent-1', 'hidden.action')`,
        );

        const res = await app.inject({
          method: 'GET',
          url: '/api/terminal/activity',
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { total: number };
        expect(body.total).toBe(0);
      });
    });
  });

  // ================================================================
  // Issue #1687 — Entry Retention Policies
  // ================================================================

  describe('Entry Retention (#1687)', () => {
    describe('GET /api/terminal/settings', () => {
      it('returns default retention of 90 days', async () => {
        const res = await app.inject({
          method: 'GET',
          url: '/api/terminal/settings',
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { entry_retention_days: number };
        expect(body.entry_retention_days).toBe(90);
      });
    });

    describe('PATCH /api/terminal/settings', () => {
      it('updates retention days', async () => {
        const res = await app.inject({
          method: 'PATCH',
          url: '/api/terminal/settings',
          payload: { entry_retention_days: 30 },
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { entry_retention_days: number };
        expect(body.entry_retention_days).toBe(30);

        // Verify via GET
        const getRes = await app.inject({
          method: 'GET',
          url: '/api/terminal/settings',
        });
        const getBody = getRes.json() as { entry_retention_days: number };
        expect(getBody.entry_retention_days).toBe(30);
      });

      it('rejects invalid retention days (too low)', async () => {
        const res = await app.inject({
          method: 'PATCH',
          url: '/api/terminal/settings',
          payload: { entry_retention_days: 0 },
        });

        expect(res.statusCode).toBe(400);
      });

      it('rejects invalid retention days (too high)', async () => {
        const res = await app.inject({
          method: 'PATCH',
          url: '/api/terminal/settings',
          payload: { entry_retention_days: 5000 },
        });

        expect(res.statusCode).toBe(400);
      });

      it('rejects missing entry_retention_days', async () => {
        const res = await app.inject({
          method: 'PATCH',
          url: '/api/terminal/settings',
          payload: {},
        });

        expect(res.statusCode).toBe(400);
      });

      it('records activity on settings update', async () => {
        await app.inject({
          method: 'PATCH',
          url: '/api/terminal/settings',
          payload: { entry_retention_days: 60 },
        });

        await new Promise((r) => setTimeout(r, 100));

        const res = await app.inject({
          method: 'GET',
          url: '/api/terminal/activity?action=settings.update',
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { total: number };
        expect(body.total).toBeGreaterThanOrEqual(1);
      });
    });

    describe('Retention cleanup logic', () => {
      it('annotations are preserved by cleanup query', async () => {
        // This tests the SQL logic that would be used by the pgcron job.
        // We can test the WHERE clause directly.
        const connId = '00000000-0000-0000-0000-000000000001';
        const sessId = '00000000-0000-0000-0000-000000000010';

        await pool.query(
          `INSERT INTO terminal_connection (id, namespace, name, host)
           VALUES ($1, 'default', 'test', 'example.com')`,
          [connId],
        );
        await pool.query(
          `INSERT INTO terminal_session (id, namespace, connection_id, tmux_session_name, status)
           VALUES ($1, 'default', $2, 'sess', 'active')`,
          [sessId, connId],
        );

        // Insert old command entry
        await pool.query(
          `INSERT INTO terminal_session_entry (session_id, namespace, kind, content, captured_at)
           VALUES ($1, 'default', 'command', 'old-command', now() - interval '100 days')`,
          [sessId],
        );

        // Insert old annotation
        await pool.query(
          `INSERT INTO terminal_session_entry (session_id, namespace, kind, content, captured_at)
           VALUES ($1, 'default', 'annotation', 'important note', now() - interval '100 days')`,
          [sessId],
        );

        // Insert recent command
        await pool.query(
          `INSERT INTO terminal_session_entry (session_id, namespace, kind, content)
           VALUES ($1, 'default', 'command', 'recent-command')`,
          [sessId],
        );

        // Simulate retention cleanup (same query as pgcron job)
        const deleted = await pool.query(
          `DELETE FROM terminal_session_entry
           WHERE kind != 'annotation'
           AND captured_at < now() - interval '90 days'
           AND namespace = 'default'
           RETURNING id, kind`,
        );

        // Old command should be deleted
        expect(deleted.rowCount).toBe(1);
        expect(deleted.rows[0].kind).toBe('command');

        // Verify annotation and recent command still exist
        const remaining = await pool.query(
          `SELECT kind FROM terminal_session_entry WHERE session_id = $1 ORDER BY kind`,
          [sessId],
        );
        expect(remaining.rows).toHaveLength(2);
        expect(remaining.rows.map((r: { kind: string }) => r.kind).sort()).toEqual([
          'annotation',
          'command',
        ]);
      });
    });
  });

  // ================================================================
  // Enrollment token namespace scoping
  // ================================================================

  describe('Namespace scoping for new endpoints', () => {
    it('enrollment tokens are scoped to namespace', async () => {
      await pool.query(
        `INSERT INTO terminal_enrollment_token
           (namespace, token_hash, label) VALUES ('other-ns', 'hash123', 'hidden-token')`,
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/terminal/enrollment-tokens',
      });

      const body = res.json() as { total: number };
      expect(body.total).toBe(0);
    });
  });
});
