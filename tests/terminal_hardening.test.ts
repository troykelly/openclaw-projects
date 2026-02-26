/**
 * Tests for terminal API hardening — activity recording, credential
 * re-encryption, gRPC lifecycle.
 *
 * Issues: #1868 (activity recording), #1869 (credential PATCH re-encryption),
 *         #1870 (gRPC writable guard), #1871 (schema indexes/cascades).
 *
 * Epic #1844 — Complete TMux Worker Implementation.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';
import {
  encryptCredential,
  decryptCredential,
  parseEncryptionKey,
} from '../src/tmux-worker/credentials/index.ts';

// ── Helpers ──────────────────────────────────────────────────

/** Query the terminal_activity table for a specific action. */
async function getActivityByAction(
  pool: Pool,
  action: string,
): Promise<Array<{ action: string; actor: string; detail: Record<string, unknown> | null; connection_id: string | null; session_id: string | null }>> {
  const result = await pool.query(
    `SELECT action, actor, detail, connection_id, session_id
     FROM terminal_activity WHERE action = $1 ORDER BY created_at DESC`,
    [action],
  );
  return result.rows as Array<{
    action: string;
    actor: string;
    detail: Record<string, unknown> | null;
    connection_id: string | null;
    session_id: string | null;
  }>;
}

// ── Tests ────────────────────────────────────────────────────

/** Test encryption key (64 hex chars = 32 bytes). */
const TEST_ENCRYPTION_KEY = 'a'.repeat(64);

describe('Terminal API Hardening', () => {
  const app = buildServer();
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
    process.env.OAUTH_TOKEN_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  // ================================================================
  // Issue #1868 — Activity Recording
  // ================================================================

  describe('Activity Recording (#1868)', () => {
    it('records activity on connection create', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/terminal/connections',
        payload: { name: 'audit-test', host: '10.0.0.1' },
      });
      expect(res.statusCode).toBe(201);

      // Allow fire-and-forget to complete
      await new Promise((r) => setTimeout(r, 100));

      const activities = await getActivityByAction(pool, 'connection.create');
      expect(activities).toHaveLength(1);
      expect(activities[0].detail).toMatchObject({ name: 'audit-test' });
    });

    it('records activity on connection update', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/terminal/connections',
        payload: { name: 'update-me', host: 'example.com' },
      });
      const { id } = created.json() as { id: string };

      await app.inject({
        method: 'PATCH',
        url: `/api/terminal/connections/${id}`,
        payload: { name: 'updated-name' },
      });

      await new Promise((r) => setTimeout(r, 100));

      const activities = await getActivityByAction(pool, 'connection.update');
      expect(activities).toHaveLength(1);
      expect(activities[0].connection_id).toBe(id);
    });

    it('records activity on connection delete', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/terminal/connections',
        payload: { name: 'delete-me', host: 'example.com' },
      });
      const { id } = created.json() as { id: string };

      await app.inject({
        method: 'DELETE',
        url: `/api/terminal/connections/${id}`,
      });

      await new Promise((r) => setTimeout(r, 100));

      const activities = await getActivityByAction(pool, 'connection.delete');
      expect(activities).toHaveLength(1);
      expect(activities[0].connection_id).toBe(id);
    });

    it('records activity on credential create', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/terminal/credentials',
        payload: { name: 'test-cred', kind: 'password', value: 'secret123' },
      });
      expect(res.statusCode).toBe(201);

      await new Promise((r) => setTimeout(r, 100));

      const activities = await getActivityByAction(pool, 'credential.create');
      expect(activities).toHaveLength(1);
      expect(activities[0].detail).toMatchObject({ name: 'test-cred', kind: 'password' });
      // SECURITY: value should NOT be in the detail
      expect(activities[0].detail).not.toHaveProperty('value');
    });

    it('records activity on credential delete', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/terminal/credentials',
        payload: { name: 'del-cred', kind: 'password', value: 'secret123' },
      });
      const { id } = created.json() as { id: string };

      await app.inject({
        method: 'DELETE',
        url: `/api/terminal/credentials/${id}`,
      });

      await new Promise((r) => setTimeout(r, 100));

      const activities = await getActivityByAction(pool, 'credential.delete');
      expect(activities).toHaveLength(1);
    });

    it('records activity on credential generate', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/terminal/credentials/generate',
        payload: { name: 'gen-key', type: 'ed25519' },
      });
      expect(res.statusCode).toBe(201);

      await new Promise((r) => setTimeout(r, 100));

      const activities = await getActivityByAction(pool, 'credential.generate');
      expect(activities).toHaveLength(1);
      expect(activities[0].detail).toMatchObject({ name: 'gen-key', key_type: 'ed25519' });
    });

    it('records activity on settings update', async () => {
      await app.inject({
        method: 'PATCH',
        url: '/api/terminal/settings',
        payload: { entry_retention_days: 30 },
      });

      await new Promise((r) => setTimeout(r, 100));

      const activities = await getActivityByAction(pool, 'settings.update');
      expect(activities).toHaveLength(1);
      expect(activities[0].detail).toMatchObject({ entry_retention_days: 30 });
    });

    it('records activity on enrollment token create and revoke', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/terminal/enrollment-tokens',
        payload: { label: 'test-token' },
      });
      expect(createRes.statusCode).toBe(201);
      const { id } = createRes.json() as { id: string };

      await new Promise((r) => setTimeout(r, 100));

      const createActivities = await getActivityByAction(pool, 'enrollment_token.create');
      expect(createActivities).toHaveLength(1);

      await app.inject({
        method: 'DELETE',
        url: `/api/terminal/enrollment-tokens/${id}`,
      });

      await new Promise((r) => setTimeout(r, 100));

      const revokeActivities = await getActivityByAction(pool, 'enrollment_token.revoke');
      expect(revokeActivities).toHaveLength(1);
    });

    it('records activity on known host trust', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/terminal/known-hosts',
        payload: {
          host: 'example.com',
          key_type: 'ssh-ed25519',
          key_fingerprint: 'SHA256:abc123',
          public_key: 'AAAAC3NzaC1lZDI1NTE5AAAAIG...',
        },
      });
      expect(res.statusCode).toBe(201);

      await new Promise((r) => setTimeout(r, 100));

      const activities = await getActivityByAction(pool, 'known_host.trust');
      expect(activities).toHaveLength(1);
      expect(activities[0].detail).toMatchObject({ host: 'example.com' });
    });

    it('records activity on known host delete', async () => {
      // Create a known host first
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/terminal/known-hosts',
        payload: {
          host: 'del-host.example.com',
          key_type: 'ssh-ed25519',
          key_fingerprint: 'SHA256:def456',
          public_key: 'AAAAC3NzaC1lZDI1NTE5AAAAIG...',
        },
      });
      const { id } = createRes.json() as { id: string };

      await app.inject({
        method: 'DELETE',
        url: `/api/terminal/known-hosts/${id}`,
      });

      await new Promise((r) => setTimeout(r, 100));

      const activities = await getActivityByAction(pool, 'known_host.delete');
      expect(activities).toHaveLength(1);
    });

    it('records activity on SSH config import', async () => {
      const config = `Host web-server\n  HostName 192.168.1.10\n  User admin\n  Port 2222`;
      const res = await app.inject({
        method: 'POST',
        url: '/api/terminal/connections/import-ssh-config',
        payload: { config_text: config },
      });
      expect(res.statusCode).toBe(201);

      await new Promise((r) => setTimeout(r, 100));

      const activities = await getActivityByAction(pool, 'connection.import_ssh_config');
      expect(activities).toHaveLength(1);
      expect(activities[0].detail).toMatchObject({ count: 1 });
    });
  });

  // ================================================================
  // Issue #1869 — Credential PATCH Re-encryption
  // ================================================================

  describe('Credential PATCH Re-encryption (#1869)', () => {
    it('re-encrypts value when provided in PATCH', async () => {
      // Create a password credential
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/terminal/credentials',
        payload: { name: 'reencrypt-test', kind: 'password', value: 'original-password' },
      });
      expect(createRes.statusCode).toBe(201);
      const { id } = createRes.json() as { id: string };

      // Verify original encryption
      const originalRow = await pool.query(
        `SELECT encrypted_value FROM terminal_credential WHERE id = $1`,
        [id],
      );
      const originalEncrypted = originalRow.rows[0].encrypted_value as Buffer;
      expect(originalEncrypted).toBeTruthy();

      // PATCH with a new value
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/terminal/credentials/${id}`,
        payload: { value: 'new-password' },
      });
      expect(patchRes.statusCode).toBe(200);

      // Verify response does NOT contain encrypted_value
      const patchBody = patchRes.json() as Record<string, unknown>;
      expect(patchBody).not.toHaveProperty('encrypted_value');

      // Verify the encrypted value changed in the DB
      const updatedRow = await pool.query(
        `SELECT encrypted_value FROM terminal_credential WHERE id = $1`,
        [id],
      );
      const updatedEncrypted = updatedRow.rows[0].encrypted_value as Buffer;
      expect(updatedEncrypted).toBeTruthy();
      expect(Buffer.compare(originalEncrypted, updatedEncrypted)).not.toBe(0);

      // Verify we can decrypt the new value
      const masterKey = parseEncryptionKey(TEST_ENCRYPTION_KEY);
      const decrypted = decryptCredential(updatedEncrypted, masterKey, id);
      expect(decrypted).toBe('new-password');
    });

    it('updates metadata fields without touching encrypted_value when value not provided', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/terminal/credentials',
        payload: { name: 'metadata-test', kind: 'password', value: 'dont-change-me' },
      });
      const { id } = createRes.json() as { id: string };

      // Get original encrypted value
      const originalRow = await pool.query(
        `SELECT encrypted_value FROM terminal_credential WHERE id = $1`,
        [id],
      );
      const originalEncrypted = originalRow.rows[0].encrypted_value as Buffer;

      // PATCH only metadata
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/terminal/credentials/${id}`,
        payload: { name: 'renamed-credential' },
      });
      expect(patchRes.statusCode).toBe(200);
      expect((patchRes.json() as { name: string }).name).toBe('renamed-credential');

      // Verify encrypted value is UNCHANGED
      const updatedRow = await pool.query(
        `SELECT encrypted_value FROM terminal_credential WHERE id = $1`,
        [id],
      );
      const updatedEncrypted = updatedRow.rows[0].encrypted_value as Buffer;
      expect(Buffer.compare(originalEncrypted, updatedEncrypted)).toBe(0);
    });

    it('records activity with value_changed flag on credential update', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/terminal/credentials',
        payload: { name: 'activity-test', kind: 'password', value: 'secret' },
      });
      const { id } = createRes.json() as { id: string };

      // PATCH with value
      await app.inject({
        method: 'PATCH',
        url: `/api/terminal/credentials/${id}`,
        payload: { value: 'new-secret', name: 'updated-name' },
      });

      await new Promise((r) => setTimeout(r, 100));

      const activities = await getActivityByAction(pool, 'credential.update');
      expect(activities).toHaveLength(1);
      expect(activities[0].detail).toMatchObject({
        credential_id: id,
        value_changed: true,
      });
      // SECURITY: The actual value must NEVER appear in the audit detail
      expect(JSON.stringify(activities[0].detail)).not.toContain('new-secret');
    });
  });

  // ================================================================
  // Issue #1870 — gRPC Client Lifecycle
  // ================================================================

  describe('gRPC Client Lifecycle (#1870)', () => {
    it('closeGrpcClient is idempotent (can be called multiple times)', async () => {
      const { closeGrpcClient } = await import(
        '../src/api/terminal/grpc-client.ts'
      );
      // Should not throw even when no client exists
      closeGrpcClient();
      closeGrpcClient();
    });
  });

  // ================================================================
  // Issue #1871 — Schema Indexes (verified via migration)
  // ================================================================

  describe('Schema Hardening (#1871)', () => {
    it('has index on terminal_session_window.session_id', async () => {
      const result = await pool.query(
        `SELECT indexname FROM pg_indexes
         WHERE tablename = 'terminal_session_window'
         AND indexdef LIKE '%session_id%'`,
      );
      expect(result.rows.length).toBeGreaterThan(0);
    });

    it('has index on terminal_activity.connection_id', async () => {
      const result = await pool.query(
        `SELECT indexname FROM pg_indexes
         WHERE tablename = 'terminal_activity'
         AND indexdef LIKE '%connection_id%'`,
      );
      expect(result.rows.length).toBeGreaterThan(0);
    });

    it('has index on terminal_tunnel.session_id', async () => {
      const result = await pool.query(
        `SELECT indexname FROM pg_indexes
         WHERE tablename = 'terminal_tunnel'
         AND indexdef LIKE '%session_id%'`,
      );
      expect(result.rows.length).toBeGreaterThan(0);
    });

    it('terminal_activity.session_id FK allows SET NULL on delete', async () => {
      // Create a session-less activity row to verify SET NULL works
      // First create a connection+session, then a linked activity, then delete the session
      const connRes = await app.inject({
        method: 'POST',
        url: '/api/terminal/connections',
        payload: { name: 'cascade-test', host: 'cascade.example.com' },
      });
      const connId = (connRes.json() as { id: string }).id;

      // Insert a session row directly
      const sessionResult = await pool.query(
        `INSERT INTO terminal_session (namespace, connection_id, tmux_session_name, status)
         VALUES ('default', $1, 'cascade-test-session', 'terminated')
         RETURNING id`,
        [connId],
      );
      const sessionId = (sessionResult.rows[0] as { id: string }).id;

      // Insert an activity row linked to the session
      await pool.query(
        `INSERT INTO terminal_activity (namespace, session_id, actor, action)
         VALUES ('default', $1, 'test', 'test.action')`,
        [sessionId],
      );

      // Delete the session — should SET NULL on activity.session_id, not fail
      await pool.query(`DELETE FROM terminal_session WHERE id = $1`, [sessionId]);

      const activityResult = await pool.query(
        `SELECT session_id FROM terminal_activity WHERE action = 'test.action'`,
      );
      expect(activityResult.rows.length).toBe(1);
      expect(activityResult.rows[0].session_id).toBeNull();
    });
  });
});
