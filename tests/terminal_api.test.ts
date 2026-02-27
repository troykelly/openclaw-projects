/**
 * Integration tests for Terminal Management API endpoints.
 *
 * Epic #1667 — TMux Session Management.
 * Issues: #1672 (connections), #1673 (credentials), #1674 (sessions),
 *         #1675 (streaming), #1676 (commands).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

describe('Terminal API', () => {
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
  // Issue #1672 — Connection CRUD
  // ================================================================

  describe('Connection CRUD (#1672)', () => {
    describe('POST /api/terminal/connections', () => {
      it('creates a connection with required fields', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/connections',
          payload: {
            name: 'test-server',
            host: '192.168.1.100',
            port: 22,
            username: 'admin',
          },
        });

        expect(res.statusCode).toBe(201);
        const body = res.json() as Record<string, unknown>;
        expect(body.name).toBe('test-server');
        expect(body.host).toBe('192.168.1.100');
        expect(body.port).toBe(22);
        expect(body.username).toBe('admin');
        expect(body.id).toBeTruthy();
        expect(body.namespace).toBe('default');
      });

      it('rejects missing name', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/connections',
          payload: { host: '192.168.1.100' },
        });

        expect(res.statusCode).toBe(400);
        const body = res.json() as { error: string };
        expect(body.error).toContain('name is required');
      });

      it('rejects invalid auth_method', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/connections',
          payload: { name: 'test', auth_method: 'invalid' },
        });

        expect(res.statusCode).toBe(400);
        const body = res.json() as { error: string };
        expect(body.error).toContain('auth_method');
      });

      it('creates a local connection', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/connections',
          payload: { name: 'local-tmux', is_local: true },
        });

        expect(res.statusCode).toBe(201);
        const body = res.json() as Record<string, unknown>;
        expect(body.is_local).toBe(true);
      });

      it('creates connection with tags', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/connections',
          payload: {
            name: 'tagged-server',
            host: 'example.com',
            tags: ['production', 'web'],
          },
        });

        expect(res.statusCode).toBe(201);
        const body = res.json() as { tags: string[] };
        expect(body.tags).toEqual(['production', 'web']);
      });
    });

    describe('GET /api/terminal/connections', () => {
      it('returns empty list when no connections exist', async () => {
        const res = await app.inject({
          method: 'GET',
          url: '/api/terminal/connections',
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { connections: unknown[]; total: number };
        expect(body.connections).toEqual([]);
        expect(body.total).toBe(0);
      });

      it('lists connections with pagination', async () => {
        // Create 3 connections
        for (let i = 0; i < 3; i++) {
          await app.inject({
            method: 'POST',
            url: '/api/terminal/connections',
            payload: { name: `server-${i}`, host: `host-${i}.example.com` },
          });
        }

        const res = await app.inject({
          method: 'GET',
          url: '/api/terminal/connections?limit=2&offset=0',
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { connections: unknown[]; total: number };
        expect(body.connections).toHaveLength(2);
        expect(body.total).toBe(3);
      });

      it('filters by search term', async () => {
        await app.inject({
          method: 'POST',
          url: '/api/terminal/connections',
          payload: { name: 'production-web', host: 'prod.example.com' },
        });
        await app.inject({
          method: 'POST',
          url: '/api/terminal/connections',
          payload: { name: 'staging-db', host: 'staging.example.com' },
        });

        const res = await app.inject({
          method: 'GET',
          url: '/api/terminal/connections?search=production',
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { connections: Array<{ name: string }>; total: number };
        expect(body.total).toBe(1);
        expect(body.connections[0].name).toBe('production-web');
      });

      it('filters by tags', async () => {
        await app.inject({
          method: 'POST',
          url: '/api/terminal/connections',
          payload: { name: 'server-1', tags: ['production'] },
        });
        await app.inject({
          method: 'POST',
          url: '/api/terminal/connections',
          payload: { name: 'server-2', tags: ['staging'] },
        });

        const res = await app.inject({
          method: 'GET',
          url: '/api/terminal/connections?tags=production',
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { connections: Array<{ name: string }>; total: number };
        expect(body.total).toBe(1);
        expect(body.connections[0].name).toBe('server-1');
      });

      it('filters by is_local', async () => {
        await app.inject({
          method: 'POST',
          url: '/api/terminal/connections',
          payload: { name: 'remote', host: 'remote.example.com' },
        });
        await app.inject({
          method: 'POST',
          url: '/api/terminal/connections',
          payload: { name: 'local', is_local: true },
        });

        const res = await app.inject({
          method: 'GET',
          url: '/api/terminal/connections?is_local=true',
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { connections: Array<{ name: string }>; total: number };
        expect(body.total).toBe(1);
        expect(body.connections[0].name).toBe('local');
      });
    });

    describe('GET /api/terminal/connections/:id', () => {
      it('returns a specific connection', async () => {
        const created = await app.inject({
          method: 'POST',
          url: '/api/terminal/connections',
          payload: { name: 'my-server', host: 'example.com' },
        });
        const { id } = created.json() as { id: string };

        const res = await app.inject({
          method: 'GET',
          url: `/api/terminal/connections/${id}`,
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { id: string; name: string };
        expect(body.id).toBe(id);
        expect(body.name).toBe('my-server');
      });

      it('returns 404 for non-existent connection', async () => {
        const res = await app.inject({
          method: 'GET',
          url: '/api/terminal/connections/00000000-0000-0000-0000-000000000000',
        });

        expect(res.statusCode).toBe(404);
      });
    });

    describe('PATCH /api/terminal/connections/:id', () => {
      it('updates connection fields', async () => {
        const created = await app.inject({
          method: 'POST',
          url: '/api/terminal/connections',
          payload: { name: 'old-name', host: 'old.example.com' },
        });
        const { id } = created.json() as { id: string };

        const res = await app.inject({
          method: 'PATCH',
          url: `/api/terminal/connections/${id}`,
          payload: { name: 'new-name', host: 'new.example.com', tags: ['updated'] },
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { name: string; host: string; tags: string[] };
        expect(body.name).toBe('new-name');
        expect(body.host).toBe('new.example.com');
        expect(body.tags).toEqual(['updated']);
      });
    });

    describe('DELETE /api/terminal/connections/:id', () => {
      it('soft deletes a connection', async () => {
        const created = await app.inject({
          method: 'POST',
          url: '/api/terminal/connections',
          payload: { name: 'to-delete', host: 'delete.example.com' },
        });
        const { id } = created.json() as { id: string };

        const deleteRes = await app.inject({
          method: 'DELETE',
          url: `/api/terminal/connections/${id}`,
        });
        expect(deleteRes.statusCode).toBe(204);

        // Verify it's no longer visible
        const getRes = await app.inject({
          method: 'GET',
          url: `/api/terminal/connections/${id}`,
        });
        expect(getRes.statusCode).toBe(404);
      });
    });

    describe('POST /api/terminal/connections/import-ssh-config', () => {
      it('imports connections from SSH config', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/connections/import-ssh-config',
          payload: {
            config_text: `
Host web-server
  Hostname web.example.com
  User deploy
  Port 2222

Host db-server
  Hostname db.example.com
  User root
`,
          },
        });

        expect(res.statusCode).toBe(201);
        const body = res.json() as { imported: Array<{ id: string; name: string }>; count: number };
        expect(body.count).toBe(2);
        expect(body.imported[0].name).toBe('web-server');
        expect(body.imported[1].name).toBe('db-server');

        // Verify connections were created in DB
        const list = await app.inject({
          method: 'GET',
          url: '/api/terminal/connections',
        });
        const listBody = list.json() as { total: number };
        expect(listBody.total).toBe(2);
      });

      it('returns empty for config with only wildcards', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/connections/import-ssh-config',
          payload: { config_text: 'Host *\n  ServerAliveInterval 60\n' },
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { count: number };
        expect(body.count).toBe(0);
      });

      it('rejects empty config_text', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/connections/import-ssh-config',
          payload: {},
        });

        expect(res.statusCode).toBe(400);
      });
    });

    describe('POST /api/terminal/connections/:id/test', () => {
      it('returns 400 for invalid connection ID format', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/connections/not-a-uuid/test',
        });

        expect(res.statusCode).toBe(400);
        const body = res.json() as { error: string };
        expect(body.error).toContain('Invalid');
      });

      it('returns 404 for non-existent connection', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/connections/00000000-0000-0000-0000-000000000099/test',
        });

        expect(res.statusCode).toBe(404);
      });

      it('returns 502 when gRPC worker is unavailable', async () => {
        const connId = '00000000-0000-0000-0000-000000000001';
        await pool.query(
          `INSERT INTO terminal_connection (id, namespace, name, host) VALUES ($1, 'default', 'test-conn', 'example.com')`,
          [connId],
        );

        const res = await app.inject({
          method: 'POST',
          url: `/api/terminal/connections/${connId}/test`,
        });

        // Worker is not running in tests — gRPC call fails with 502
        expect(res.statusCode).toBe(502);
      });
    });
  });

  // ================================================================
  // Issue #1673 — Credential CRUD
  // ================================================================

  describe('Credential CRUD (#1673)', () => {
    describe('POST /api/terminal/credentials', () => {
      it('creates a password credential', async () => {
        // Set encryption key for credential operations
        process.env.OAUTH_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);

        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/credentials',
          payload: {
            name: 'test-password',
            kind: 'password',
            value: 'supersecret',
          },
        });

        expect(res.statusCode).toBe(201);
        const body = res.json() as Record<string, unknown>;
        expect(body.name).toBe('test-password');
        expect(body.kind).toBe('password');
        // SECURITY: encrypted_value must NEVER appear in response
        expect(body).not.toHaveProperty('encrypted_value');
        expect(body).not.toHaveProperty('value');
      });

      it('creates an SSH key credential', async () => {
        process.env.OAUTH_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);

        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/credentials',
          payload: {
            name: 'test-key',
            kind: 'ssh_key',
            value: '-----BEGIN OPENSSH PRIVATE KEY-----\nfake-key-data\n-----END OPENSSH PRIVATE KEY-----',
            fingerprint: 'SHA256:abc123',
            public_key: 'ssh-ed25519 AAAAC3...',
          },
        });

        expect(res.statusCode).toBe(201);
        const body = res.json() as Record<string, unknown>;
        expect(body.kind).toBe('ssh_key');
        expect(body.fingerprint).toBe('SHA256:abc123');
        expect(body).not.toHaveProperty('encrypted_value');
      });

      it('creates a command credential', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/credentials',
          payload: {
            name: 'op-credential',
            kind: 'command',
            command: 'op read op://vault/ssh-key/private-key',
            command_timeout_s: 5,
          },
        });

        expect(res.statusCode).toBe(201);
        const body = res.json() as Record<string, unknown>;
        expect(body.kind).toBe('command');
        expect(body.command).toBe('op read op://vault/ssh-key/private-key');
      });

      it('rejects missing name', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/credentials',
          payload: { kind: 'password', value: 'test' },
        });
        expect(res.statusCode).toBe(400);
      });

      it('rejects invalid kind', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/credentials',
          payload: { name: 'test', kind: 'invalid' },
        });
        expect(res.statusCode).toBe(400);
      });

      it('rejects ssh_key without value', async () => {
        process.env.OAUTH_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);
        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/credentials',
          payload: { name: 'test', kind: 'ssh_key' },
        });
        expect(res.statusCode).toBe(400);
      });
    });

    describe('GET /api/terminal/credentials', () => {
      it('lists credentials without encrypted_value', async () => {
        process.env.OAUTH_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);

        await app.inject({
          method: 'POST',
          url: '/api/terminal/credentials',
          payload: { name: 'cred-1', kind: 'password', value: 'secret1' },
        });
        await app.inject({
          method: 'POST',
          url: '/api/terminal/credentials',
          payload: { name: 'cred-2', kind: 'command', command: 'echo test' },
        });

        const res = await app.inject({
          method: 'GET',
          url: '/api/terminal/credentials',
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { credentials: Array<Record<string, unknown>>; total: number };
        expect(body.total).toBe(2);
        // SECURITY: No credential should have encrypted_value
        for (const cred of body.credentials) {
          expect(cred).not.toHaveProperty('encrypted_value');
        }
      });
    });

    describe('GET /api/terminal/credentials/:id', () => {
      it('returns credential metadata without encrypted_value', async () => {
        process.env.OAUTH_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);

        const created = await app.inject({
          method: 'POST',
          url: '/api/terminal/credentials',
          payload: { name: 'my-cred', kind: 'password', value: 'secret' },
        });
        const { id } = created.json() as { id: string };

        const res = await app.inject({
          method: 'GET',
          url: `/api/terminal/credentials/${id}`,
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as Record<string, unknown>;
        expect(body.name).toBe('my-cred');
        expect(body).not.toHaveProperty('encrypted_value');
      });
    });

    describe('PATCH /api/terminal/credentials/:id', () => {
      it('updates credential name', async () => {
        process.env.OAUTH_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);

        const created = await app.inject({
          method: 'POST',
          url: '/api/terminal/credentials',
          payload: { name: 'old-name', kind: 'password', value: 'test' },
        });
        const { id } = created.json() as { id: string };

        const res = await app.inject({
          method: 'PATCH',
          url: `/api/terminal/credentials/${id}`,
          payload: { name: 'new-name' },
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { name: string };
        expect(body.name).toBe('new-name');
      });
    });

    describe('DELETE /api/terminal/credentials/:id', () => {
      it('soft deletes a credential', async () => {
        process.env.OAUTH_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);

        const created = await app.inject({
          method: 'POST',
          url: '/api/terminal/credentials',
          payload: { name: 'to-delete', kind: 'password', value: 'test' },
        });
        const { id } = created.json() as { id: string };

        const deleteRes = await app.inject({
          method: 'DELETE',
          url: `/api/terminal/credentials/${id}`,
        });
        expect(deleteRes.statusCode).toBe(204);

        // Verify it's no longer visible
        const getRes = await app.inject({
          method: 'GET',
          url: `/api/terminal/credentials/${id}`,
        });
        expect(getRes.statusCode).toBe(404);
      });
    });

    describe('POST /api/terminal/credentials/generate', () => {
      it('generates an ed25519 key pair', async () => {
        process.env.OAUTH_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);

        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/credentials/generate',
          payload: { name: 'generated-key', type: 'ed25519' },
        });

        expect(res.statusCode).toBe(201);
        const body = res.json() as Record<string, unknown>;
        expect(body.name).toBe('generated-key');
        expect(body.kind).toBe('ssh_key');
        expect(body.public_key).toBeTruthy();
        expect(typeof body.public_key).toBe('string');
        // SECURITY: No private key or encrypted_value in response
        expect(body).not.toHaveProperty('encrypted_value');
        expect(body).not.toHaveProperty('private_key');
      });

      it('generates an RSA key pair', async () => {
        process.env.OAUTH_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);

        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/credentials/generate',
          payload: { name: 'rsa-key', type: 'rsa' },
        });

        expect(res.statusCode).toBe(201);
        const body = res.json() as Record<string, unknown>;
        expect(body.kind).toBe('ssh_key');
        expect(body.public_key).toBeTruthy();
      });

      it('rejects invalid key type', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/credentials/generate',
          payload: { name: 'bad-key', type: 'dsa' },
        });

        expect(res.statusCode).toBe(400);
      });

      it('rejects missing name', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/credentials/generate',
          payload: { type: 'ed25519' },
        });

        expect(res.statusCode).toBe(400);
      });
    });
  });

  // ================================================================
  // Issue #1674 — Session Lifecycle (DB-only tests, gRPC calls mocked by worker being unavailable)
  // ================================================================

  describe('Session Lifecycle (#1674)', () => {
    describe('GET /api/terminal/sessions', () => {
      it('returns empty list when no sessions exist', async () => {
        const res = await app.inject({
          method: 'GET',
          url: '/api/terminal/sessions',
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { sessions: unknown[]; total: number };
        expect(body.sessions).toEqual([]);
        expect(body.total).toBe(0);
      });

      it('lists sessions with filtering by status', async () => {
        // Create session directly in DB for list test
        await pool.query(
          `INSERT INTO terminal_connection (id, namespace, name, host) VALUES ($1, 'default', 'test-conn', 'example.com')`,
          ['00000000-0000-0000-0000-000000000001'],
        );
        await pool.query(
          `INSERT INTO terminal_session (id, namespace, connection_id, tmux_session_name, status)
           VALUES ($1, 'default', $2, 'sess-1', 'active')`,
          ['00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001'],
        );
        await pool.query(
          `INSERT INTO terminal_session (id, namespace, connection_id, tmux_session_name, status)
           VALUES ($1, 'default', $2, 'sess-2', 'terminated')`,
          ['00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001'],
        );

        const res = await app.inject({
          method: 'GET',
          url: '/api/terminal/sessions?status=active',
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { sessions: Array<{ status: string }>; total: number };
        expect(body.total).toBe(1);
        expect(body.sessions[0].status).toBe('active');
      });
    });

    describe('POST /api/terminal/sessions', () => {
      it('rejects missing connection_id', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/sessions',
          payload: {},
        });

        expect(res.statusCode).toBe(400);
      });

      it('rejects non-existent connection_id', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/sessions',
          payload: { connection_id: '00000000-0000-0000-0000-000000000099' },
        });

        expect(res.statusCode).toBe(404);
      });

      it('returns 502 when worker is unavailable', async () => {
        await pool.query(
          `INSERT INTO terminal_connection (id, namespace, name, host) VALUES ($1, 'default', 'test-conn', 'example.com')`,
          ['00000000-0000-0000-0000-000000000001'],
        );

        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/sessions',
          payload: { connection_id: '00000000-0000-0000-0000-000000000001' },
        });

        // Worker is not running in tests, should get 502
        expect(res.statusCode).toBe(502);
      });
    });

    describe('GET /api/terminal/sessions/:id', () => {
      it('returns session with windows and panes', async () => {
        // Create test data
        const connId = '00000000-0000-0000-0000-000000000001';
        const sessId = '00000000-0000-0000-0000-000000000010';
        const winId = '00000000-0000-0000-0000-000000000020';
        const paneId = '00000000-0000-0000-0000-000000000030';

        await pool.query(
          `INSERT INTO terminal_connection (id, namespace, name, host) VALUES ($1, 'default', 'test', 'example.com')`,
          [connId],
        );
        await pool.query(
          `INSERT INTO terminal_session (id, namespace, connection_id, tmux_session_name, status)
           VALUES ($1, 'default', $2, 'test-sess', 'active')`,
          [sessId, connId],
        );
        await pool.query(
          `INSERT INTO terminal_session_window (id, session_id, namespace, window_index, window_name, is_active)
           VALUES ($1, $2, 'default', 0, 'main', true)`,
          [winId, sessId],
        );
        await pool.query(
          `INSERT INTO terminal_session_pane (id, window_id, namespace, pane_index, is_active)
           VALUES ($1, $2, 'default', 0, true)`,
          [paneId, winId],
        );

        const res = await app.inject({
          method: 'GET',
          url: `/api/terminal/sessions/${sessId}`,
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as {
          id: string;
          windows: Array<{
            id: string;
            panes: Array<{ id: string }>;
          }>;
        };
        expect(body.id).toBe(sessId);
        expect(body.windows).toHaveLength(1);
        expect(body.windows[0].panes).toHaveLength(1);
      });
    });

    describe('PATCH /api/terminal/sessions/:id', () => {
      it('updates session notes and tags', async () => {
        const connId = '00000000-0000-0000-0000-000000000001';
        const sessId = '00000000-0000-0000-0000-000000000010';

        await pool.query(
          `INSERT INTO terminal_connection (id, namespace, name, host) VALUES ($1, 'default', 'test', 'example.com')`,
          [connId],
        );
        await pool.query(
          `INSERT INTO terminal_session (id, namespace, connection_id, tmux_session_name, status)
           VALUES ($1, 'default', $2, 'test-sess', 'active')`,
          [sessId, connId],
        );

        const res = await app.inject({
          method: 'PATCH',
          url: `/api/terminal/sessions/${sessId}`,
          payload: { notes: 'Updated notes', tags: ['important'] },
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { notes: string; tags: string[] };
        expect(body.notes).toBe('Updated notes');
        expect(body.tags).toEqual(['important']);
      });
    });

    describe('DELETE /api/terminal/sessions/:id', () => {
      it('returns 400 for invalid session ID format', async () => {
        const res = await app.inject({
          method: 'DELETE',
          url: '/api/terminal/sessions/not-a-uuid',
        });

        expect(res.statusCode).toBe(400);
        const body = res.json() as { error: string };
        expect(body.error).toContain('Invalid session ID');
      });

      it('returns 404 for non-existent session', async () => {
        const res = await app.inject({
          method: 'DELETE',
          url: '/api/terminal/sessions/00000000-0000-0000-0000-000000000099',
        });

        expect(res.statusCode).toBe(404);
      });

      it('returns 502 when gRPC worker is unavailable', async () => {
        const connId = '00000000-0000-0000-0000-000000000001';
        const sessId = '00000000-0000-0000-0000-000000000010';

        await pool.query(
          `INSERT INTO terminal_connection (id, namespace, name, host) VALUES ($1, 'default', 'test', 'example.com')`,
          [connId],
        );
        await pool.query(
          `INSERT INTO terminal_session (id, namespace, connection_id, tmux_session_name, status)
           VALUES ($1, 'default', $2, 'test-sess', 'active')`,
          [sessId, connId],
        );

        const res = await app.inject({
          method: 'DELETE',
          url: `/api/terminal/sessions/${sessId}`,
        });

        // Worker is not running in tests — gRPC call fails with 502
        expect(res.statusCode).toBe(502);
        const body = res.json() as { error: string };
        expect(body.error).toContain('Failed to terminate');
      });
    });

    describe('POST /api/terminal/sessions/:id/annotate', () => {
      it('adds an annotation entry to a session', async () => {
        const connId = '00000000-0000-0000-0000-000000000001';
        const sessId = '00000000-0000-0000-0000-000000000010';

        await pool.query(
          `INSERT INTO terminal_connection (id, namespace, name, host) VALUES ($1, 'default', 'test', 'example.com')`,
          [connId],
        );
        await pool.query(
          `INSERT INTO terminal_session (id, namespace, connection_id, tmux_session_name, status)
           VALUES ($1, 'default', $2, 'test-sess', 'active')`,
          [sessId, connId],
        );

        const res = await app.inject({
          method: 'POST',
          url: `/api/terminal/sessions/${sessId}/annotate`,
          payload: {
            content: 'Important observation about server state',
            metadata: { severity: 'info' },
          },
        });

        expect(res.statusCode).toBe(201);
        const body = res.json() as { kind: string; content: string };
        expect(body.kind).toBe('annotation');
        expect(body.content).toBe('Important observation about server state');
      });

      it('rejects empty annotation content', async () => {
        const connId = '00000000-0000-0000-0000-000000000001';
        const sessId = '00000000-0000-0000-0000-000000000010';

        await pool.query(
          `INSERT INTO terminal_connection (id, namespace, name, host) VALUES ($1, 'default', 'test', 'example.com')`,
          [connId],
        );
        await pool.query(
          `INSERT INTO terminal_session (id, namespace, connection_id, tmux_session_name, status)
           VALUES ($1, 'default', $2, 'test-sess', 'active')`,
          [sessId, connId],
        );

        const res = await app.inject({
          method: 'POST',
          url: `/api/terminal/sessions/${sessId}/annotate`,
          payload: { content: '' },
        });

        expect(res.statusCode).toBe(400);
      });
    });
  });

  // ================================================================
  // Issue #1676 — Command Execution (gRPC-dependent, returns 502 without worker)
  // ================================================================

  describe('Command Execution (#1676)', () => {
    describe('POST /api/terminal/sessions/:id/send-command', () => {
      it('rejects missing command', async () => {
        const connId = '00000000-0000-0000-0000-000000000001';
        const sessId = '00000000-0000-0000-0000-000000000010';

        await pool.query(
          `INSERT INTO terminal_connection (id, namespace, name, host) VALUES ($1, 'default', 'test', 'example.com')`,
          [connId],
        );
        await pool.query(
          `INSERT INTO terminal_session (id, namespace, connection_id, tmux_session_name, status)
           VALUES ($1, 'default', $2, 'test-sess', 'active')`,
          [sessId, connId],
        );

        const res = await app.inject({
          method: 'POST',
          url: `/api/terminal/sessions/${sessId}/send-command`,
          payload: {},
        });

        expect(res.statusCode).toBe(400);
        const body = res.json() as { error: string };
        expect(body.error).toContain('command is required');
      });

      it('returns 502 when worker is unavailable', async () => {
        const connId = '00000000-0000-0000-0000-000000000001';
        const sessId = '00000000-0000-0000-0000-000000000010';

        await pool.query(
          `INSERT INTO terminal_connection (id, namespace, name, host) VALUES ($1, 'default', 'test', 'example.com')`,
          [connId],
        );
        await pool.query(
          `INSERT INTO terminal_session (id, namespace, connection_id, tmux_session_name, status)
           VALUES ($1, 'default', $2, 'test-sess', 'active')`,
          [sessId, connId],
        );

        const res = await app.inject({
          method: 'POST',
          url: `/api/terminal/sessions/${sessId}/send-command`,
          payload: { command: 'ls -la', timeout_s: 5 },
        });

        expect(res.statusCode).toBe(502);
      });
    });

    describe('POST /api/terminal/sessions/:id/send-keys', () => {
      it('rejects missing keys', async () => {
        const connId = '00000000-0000-0000-0000-000000000001';
        const sessId = '00000000-0000-0000-0000-000000000010';

        await pool.query(
          `INSERT INTO terminal_connection (id, namespace, name, host) VALUES ($1, 'default', 'test', 'example.com')`,
          [connId],
        );
        await pool.query(
          `INSERT INTO terminal_session (id, namespace, connection_id, tmux_session_name, status)
           VALUES ($1, 'default', $2, 'test-sess', 'active')`,
          [sessId, connId],
        );

        const res = await app.inject({
          method: 'POST',
          url: `/api/terminal/sessions/${sessId}/send-keys`,
          payload: {},
        });

        expect(res.statusCode).toBe(400);
      });
    });

    describe('GET /api/terminal/sessions/:id/capture', () => {
      it('returns 502 when worker is unavailable', async () => {
        const connId = '00000000-0000-0000-0000-000000000001';
        const sessId = '00000000-0000-0000-0000-000000000010';

        await pool.query(
          `INSERT INTO terminal_connection (id, namespace, name, host) VALUES ($1, 'default', 'test', 'example.com')`,
          [connId],
        );
        await pool.query(
          `INSERT INTO terminal_session (id, namespace, connection_id, tmux_session_name, status)
           VALUES ($1, 'default', $2, 'test-sess', 'active')`,
          [sessId, connId],
        );

        const res = await app.inject({
          method: 'GET',
          url: `/api/terminal/sessions/${sessId}/capture`,
        });

        expect(res.statusCode).toBe(502);
      });
    });
  });

  // ================================================================
  // Namespace scoping tests
  // ================================================================

  describe('Namespace scoping', () => {
    it('connections are scoped to namespace', async () => {
      // Create connection in default namespace
      await pool.query(
        `INSERT INTO terminal_connection (id, namespace, name, host) VALUES ($1, 'other-ns', 'hidden-conn', 'example.com')`,
        ['00000000-0000-0000-0000-000000000099'],
      );

      // Query from default namespace should not see it
      const res = await app.inject({
        method: 'GET',
        url: '/api/terminal/connections',
      });

      const body = res.json() as { total: number };
      expect(body.total).toBe(0);
    });

    it('credentials are scoped to namespace', async () => {
      await pool.query(
        `INSERT INTO terminal_credential (id, namespace, name, kind) VALUES ($1, 'other-ns', 'hidden-cred', 'password')`,
        ['00000000-0000-0000-0000-000000000099'],
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/terminal/credentials',
      });

      const body = res.json() as { total: number };
      expect(body.total).toBe(0);
    });

    it('sessions are scoped to namespace', async () => {
      await pool.query(
        `INSERT INTO terminal_connection (id, namespace, name, host) VALUES ($1, 'other-ns', 'conn', 'example.com')`,
        ['00000000-0000-0000-0000-000000000001'],
      );
      await pool.query(
        `INSERT INTO terminal_session (id, namespace, connection_id, tmux_session_name, status)
         VALUES ($1, 'other-ns', $2, 'hidden-sess', 'active')`,
        ['00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001'],
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/terminal/sessions',
      });

      const body = res.json() as { total: number };
      expect(body.total).toBe(0);
    });
  });

  // ================================================================
  // Issue #1677 — Window and Pane Management
  // ================================================================

  describe('Window and Pane Management (#1677)', () => {
    const connId = '00000000-0000-0000-0000-000000000001';
    const sessId = '00000000-0000-0000-0000-000000000010';

    async function createSessionFixture() {
      await pool.query(
        `INSERT INTO terminal_connection (id, namespace, name, host) VALUES ($1, 'default', 'test-conn', 'example.com')`,
        [connId],
      );
      await pool.query(
        `INSERT INTO terminal_session (id, namespace, connection_id, tmux_session_name, status)
         VALUES ($1, 'default', $2, 'test-sess', 'active')`,
        [sessId, connId],
      );
    }

    describe('POST /api/terminal/sessions/:id/windows', () => {
      it('returns 502 when worker is unavailable', async () => {
        await createSessionFixture();

        const res = await app.inject({
          method: 'POST',
          url: `/api/terminal/sessions/${sessId}/windows`,
          payload: { name: 'new-window' },
        });

        expect(res.statusCode).toBe(502);
      });

      it('returns 404 for non-existent session', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/sessions/00000000-0000-0000-0000-000000000099/windows',
          payload: { name: 'window' },
        });

        expect(res.statusCode).toBe(404);
      });

      it('returns 400 for invalid session ID', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/sessions/not-a-uuid/windows',
          payload: {},
        });

        expect(res.statusCode).toBe(400);
      });
    });

    describe('DELETE /api/terminal/sessions/:sid/windows/:wid', () => {
      it('returns 502 when worker is unavailable', async () => {
        await createSessionFixture();

        const res = await app.inject({
          method: 'DELETE',
          url: `/api/terminal/sessions/${sessId}/windows/0`,
        });

        expect(res.statusCode).toBe(502);
      });

      it('returns 400 for invalid window index', async () => {
        await createSessionFixture();

        const res = await app.inject({
          method: 'DELETE',
          url: `/api/terminal/sessions/${sessId}/windows/-1`,
        });

        expect(res.statusCode).toBe(400);
      });
    });

    describe('POST /api/terminal/sessions/:sid/windows/:wid/split', () => {
      it('returns 502 when worker is unavailable', async () => {
        await createSessionFixture();

        const res = await app.inject({
          method: 'POST',
          url: `/api/terminal/sessions/${sessId}/windows/0/split`,
          payload: { direction: 'horizontal' },
        });

        expect(res.statusCode).toBe(502);
      });

      it('returns 400 for invalid window index', async () => {
        await createSessionFixture();

        const res = await app.inject({
          method: 'POST',
          url: `/api/terminal/sessions/${sessId}/windows/abc/split`,
          payload: { direction: 'vertical' },
        });

        expect(res.statusCode).toBe(400);
      });
    });

    describe('DELETE /api/terminal/sessions/:sid/panes/:pid', () => {
      it('returns 502 when worker is unavailable', async () => {
        await createSessionFixture();

        const res = await app.inject({
          method: 'DELETE',
          url: `/api/terminal/sessions/${sessId}/panes/0`,
        });

        expect(res.statusCode).toBe(502);
      });

      it('returns 400 for invalid pane index', async () => {
        await createSessionFixture();

        const res = await app.inject({
          method: 'DELETE',
          url: `/api/terminal/sessions/${sessId}/panes/-5`,
        });

        expect(res.statusCode).toBe(400);
      });
    });
  });

  // ================================================================
  // Issue #1678 — SSH Tunnel Management
  // ================================================================

  describe('SSH Tunnel Management (#1678)', () => {
    const connId = '00000000-0000-0000-0000-000000000001';

    async function createConnectionFixture() {
      await pool.query(
        `INSERT INTO terminal_connection (id, namespace, name, host) VALUES ($1, 'default', 'test-conn', 'example.com')`,
        [connId],
      );
    }

    describe('GET /api/terminal/tunnels', () => {
      it('returns empty list when no tunnels exist', async () => {
        const res = await app.inject({
          method: 'GET',
          url: '/api/terminal/tunnels',
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { tunnels: unknown[]; total: number };
        expect(body.tunnels).toEqual([]);
        expect(body.total).toBe(0);
      });

      it('lists tunnels with filter by direction', async () => {
        await createConnectionFixture();

        // Insert tunnel directly
        await pool.query(
          `INSERT INTO terminal_tunnel (id, namespace, connection_id, direction, bind_host, bind_port, target_host, target_port, status)
           VALUES ($1, 'default', $2, 'local', '127.0.0.1', 8080, 'remote.host', 80, 'active')`,
          ['00000000-0000-0000-0000-000000000050', connId],
        );
        await pool.query(
          `INSERT INTO terminal_tunnel (id, namespace, connection_id, direction, bind_host, bind_port, status)
           VALUES ($1, 'default', $2, 'dynamic', '127.0.0.1', 1080, 'active')`,
          ['00000000-0000-0000-0000-000000000051', connId],
        );

        const res = await app.inject({
          method: 'GET',
          url: '/api/terminal/tunnels?direction=local',
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { tunnels: Array<{ direction: string }>; total: number };
        expect(body.total).toBe(1);
        expect(body.tunnels[0].direction).toBe('local');
      });

      it('filters by connection_id', async () => {
        await createConnectionFixture();
        const otherId = '00000000-0000-0000-0000-000000000002';
        await pool.query(
          `INSERT INTO terminal_connection (id, namespace, name, host) VALUES ($1, 'default', 'other-conn', 'other.com')`,
          [otherId],
        );

        await pool.query(
          `INSERT INTO terminal_tunnel (id, namespace, connection_id, direction, bind_host, bind_port, target_host, target_port, status)
           VALUES ($1, 'default', $2, 'local', '127.0.0.1', 8080, 'remote', 80, 'active')`,
          ['00000000-0000-0000-0000-000000000050', connId],
        );
        await pool.query(
          `INSERT INTO terminal_tunnel (id, namespace, connection_id, direction, bind_host, bind_port, target_host, target_port, status)
           VALUES ($1, 'default', $2, 'remote', '0.0.0.0', 9090, 'localhost', 3000, 'active')`,
          ['00000000-0000-0000-0000-000000000051', otherId],
        );

        const res = await app.inject({
          method: 'GET',
          url: `/api/terminal/tunnels?connection_id=${connId}`,
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { total: number };
        expect(body.total).toBe(1);
      });
    });

    describe('POST /api/terminal/tunnels', () => {
      it('rejects missing connection_id', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/tunnels',
          payload: {
            direction: 'local',
            bind_port: 8080,
            target_host: 'remote',
            target_port: 80,
          },
        });

        expect(res.statusCode).toBe(400);
      });

      it('rejects invalid direction', async () => {
        await createConnectionFixture();

        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/tunnels',
          payload: {
            connection_id: connId,
            direction: 'invalid',
            bind_port: 8080,
          },
        });

        expect(res.statusCode).toBe(400);
        const body = res.json() as { error: string };
        expect(body.error).toContain('direction');
      });

      it('rejects missing bind_port', async () => {
        await createConnectionFixture();

        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/tunnels',
          payload: {
            connection_id: connId,
            direction: 'local',
          },
        });

        expect(res.statusCode).toBe(400);
        const body = res.json() as { error: string };
        expect(body.error).toContain('bind_port');
      });

      it('rejects local tunnel without target_host', async () => {
        await createConnectionFixture();

        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/tunnels',
          payload: {
            connection_id: connId,
            direction: 'local',
            bind_port: 8080,
            target_port: 80,
          },
        });

        expect(res.statusCode).toBe(400);
        const body = res.json() as { error: string };
        expect(body.error).toContain('target_host');
      });

      it('returns 502 when worker is unavailable for valid request', async () => {
        await createConnectionFixture();

        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/tunnels',
          payload: {
            connection_id: connId,
            direction: 'local',
            bind_port: 8080,
            target_host: 'remote.host',
            target_port: 80,
          },
        });

        expect(res.statusCode).toBe(502);
      });

      it('allows dynamic tunnel without target_host/target_port', async () => {
        await createConnectionFixture();

        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/tunnels',
          payload: {
            connection_id: connId,
            direction: 'dynamic',
            bind_port: 1080,
          },
        });

        // Worker unavailable but validation passed
        expect(res.statusCode).toBe(502);
      });
    });

    describe('DELETE /api/terminal/tunnels/:id', () => {
      it('returns 404 for non-existent tunnel', async () => {
        const res = await app.inject({
          method: 'DELETE',
          url: '/api/terminal/tunnels/00000000-0000-0000-0000-000000000099',
        });

        expect(res.statusCode).toBe(404);
      });

      it('returns 400 for invalid tunnel ID', async () => {
        const res = await app.inject({
          method: 'DELETE',
          url: '/api/terminal/tunnels/not-a-uuid',
        });

        expect(res.statusCode).toBe(400);
      });
    });

    describe('Namespace scoping for tunnels', () => {
      it('tunnels in other namespace are not visible', async () => {
        await pool.query(
          `INSERT INTO terminal_connection (id, namespace, name, host) VALUES ($1, 'other-ns', 'conn', 'example.com')`,
          [connId],
        );
        await pool.query(
          `INSERT INTO terminal_tunnel (id, namespace, connection_id, direction, bind_host, bind_port, status)
           VALUES ($1, 'other-ns', $2, 'dynamic', '127.0.0.1', 1080, 'active')`,
          ['00000000-0000-0000-0000-000000000050', connId],
        );

        const res = await app.inject({
          method: 'GET',
          url: '/api/terminal/tunnels',
        });

        const body = res.json() as { total: number };
        expect(body.total).toBe(0);
      });
    });
  });

  // ================================================================
  // Issue #1679 — Known Host Verification
  // ================================================================

  describe('Known Host Verification (#1679)', () => {
    describe('GET /api/terminal/known-hosts', () => {
      it('returns empty list when no hosts exist', async () => {
        const res = await app.inject({
          method: 'GET',
          url: '/api/terminal/known-hosts',
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { known_hosts: unknown[]; total: number };
        expect(body.known_hosts).toEqual([]);
        expect(body.total).toBe(0);
      });

      it('lists known hosts with filter by host', async () => {
        await pool.query(
          `INSERT INTO terminal_known_host (id, namespace, host, port, key_type, key_fingerprint, public_key)
           VALUES ($1, 'default', 'server1.example.com', 22, 'ssh-ed25519', 'SHA256:abc', 'ssh-ed25519 AAAA...')`,
          ['00000000-0000-0000-0000-000000000060'],
        );
        await pool.query(
          `INSERT INTO terminal_known_host (id, namespace, host, port, key_type, key_fingerprint, public_key)
           VALUES ($1, 'default', 'other.host.com', 22, 'ssh-rsa', 'SHA256:xyz', 'ssh-rsa AAAA...')`,
          ['00000000-0000-0000-0000-000000000061'],
        );

        const res = await app.inject({
          method: 'GET',
          url: '/api/terminal/known-hosts?host=server1',
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { known_hosts: Array<{ host: string }>; total: number };
        expect(body.total).toBe(1);
        expect(body.known_hosts[0].host).toBe('server1.example.com');
      });
    });

    describe('POST /api/terminal/known-hosts', () => {
      it('trusts a host key', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/known-hosts',
          payload: {
            host: 'server.example.com',
            port: 22,
            key_type: 'ssh-ed25519',
            key_fingerprint: 'SHA256:abc123',
            public_key: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA...',
          },
        });

        expect(res.statusCode).toBe(201);
        const body = res.json() as Record<string, unknown>;
        expect(body.host).toBe('server.example.com');
        expect(body.key_type).toBe('ssh-ed25519');
        expect(body.key_fingerprint).toBe('SHA256:abc123');
        expect(body.trusted_by).toBe('user');
      });

      it('upserts on conflict (same host+port+key_type)', async () => {
        // First trust
        await app.inject({
          method: 'POST',
          url: '/api/terminal/known-hosts',
          payload: {
            host: 'server.example.com',
            port: 22,
            key_type: 'ssh-ed25519',
            key_fingerprint: 'SHA256:old',
            public_key: 'ssh-ed25519 old-key',
          },
        });

        // Second trust with new fingerprint
        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/known-hosts',
          payload: {
            host: 'server.example.com',
            port: 22,
            key_type: 'ssh-ed25519',
            key_fingerprint: 'SHA256:new',
            public_key: 'ssh-ed25519 new-key',
          },
        });

        expect(res.statusCode).toBe(201);
        const body = res.json() as { key_fingerprint: string };
        expect(body.key_fingerprint).toBe('SHA256:new');

        // Verify only one entry exists
        const list = await app.inject({
          method: 'GET',
          url: '/api/terminal/known-hosts',
        });
        const listBody = list.json() as { total: number };
        expect(listBody.total).toBe(1);
      });

      it('rejects missing required fields', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/known-hosts',
          payload: { host: 'server.example.com' },
        });

        expect(res.statusCode).toBe(400);
      });
    });

    describe('POST /api/terminal/known-hosts/approve', () => {
      it('rejects missing session_id', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/known-hosts/approve',
          payload: {
            host: 'server.example.com',
            key_type: 'ssh-ed25519',
            fingerprint: 'SHA256:abc',
            public_key: 'ssh-ed25519 AAAA...',
          },
        });

        expect(res.statusCode).toBe(400);
      });

      it('rejects invalid session_id', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/known-hosts/approve',
          payload: {
            session_id: 'not-a-uuid',
            host: 'server.example.com',
            key_type: 'ssh-ed25519',
            fingerprint: 'SHA256:abc',
            public_key: 'ssh-ed25519 AAAA...',
          },
        });

        expect(res.statusCode).toBe(400);
      });

      it('returns 404 for non-existent session', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/known-hosts/approve',
          payload: {
            session_id: '00000000-0000-0000-0000-000000000099',
            host: 'server.example.com',
            key_type: 'ssh-ed25519',
            fingerprint: 'SHA256:abc',
            public_key: 'ssh-ed25519 AAAA...',
          },
        });

        expect(res.statusCode).toBe(404);
      });

      it('stores key and returns 502 when worker unavailable', async () => {
        const connId = '00000000-0000-0000-0000-000000000001';
        const sessId = '00000000-0000-0000-0000-000000000010';

        await pool.query(
          `INSERT INTO terminal_connection (id, namespace, name, host) VALUES ($1, 'default', 'test', 'example.com')`,
          [connId],
        );
        await pool.query(
          `INSERT INTO terminal_session (id, namespace, connection_id, tmux_session_name, status)
           VALUES ($1, 'default', $2, 'test-sess', 'pending_host_verification')`,
          [sessId, connId],
        );

        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/known-hosts/approve',
          payload: {
            session_id: sessId,
            host: 'example.com',
            port: 22,
            key_type: 'ssh-ed25519',
            fingerprint: 'SHA256:abc',
            public_key: 'ssh-ed25519 AAAA...',
          },
        });

        // Worker unavailable for gRPC call, but host key was stored
        expect(res.statusCode).toBe(502);

        // Verify the known host was stored
        const list = await app.inject({
          method: 'GET',
          url: '/api/terminal/known-hosts',
        });
        const body = list.json() as { known_hosts: Array<{ host: string }>; total: number };
        expect(body.total).toBe(1);
        expect(body.known_hosts[0].host).toBe('example.com');
      });
    });

    describe('DELETE /api/terminal/known-hosts/:id', () => {
      it('revokes trust', async () => {
        const hostId = '00000000-0000-0000-0000-000000000060';
        await pool.query(
          `INSERT INTO terminal_known_host (id, namespace, host, port, key_type, key_fingerprint, public_key)
           VALUES ($1, 'default', 'server.example.com', 22, 'ssh-ed25519', 'SHA256:abc', 'ssh-ed25519 AAAA...')`,
          [hostId],
        );

        const deleteRes = await app.inject({
          method: 'DELETE',
          url: `/api/terminal/known-hosts/${hostId}`,
        });
        expect(deleteRes.statusCode).toBe(204);

        // Verify it's gone
        const list = await app.inject({
          method: 'GET',
          url: '/api/terminal/known-hosts',
        });
        const body = list.json() as { total: number };
        expect(body.total).toBe(0);
      });

      it('returns 404 for non-existent host', async () => {
        const res = await app.inject({
          method: 'DELETE',
          url: '/api/terminal/known-hosts/00000000-0000-0000-0000-000000000099',
        });

        expect(res.statusCode).toBe(404);
      });
    });

    describe('Namespace scoping for known hosts', () => {
      it('known hosts in other namespace are not visible', async () => {
        await pool.query(
          `INSERT INTO terminal_known_host (id, namespace, host, port, key_type, key_fingerprint, public_key)
           VALUES ($1, 'other-ns', 'server.example.com', 22, 'ssh-ed25519', 'SHA256:abc', 'ssh-ed25519 AAAA...')`,
          ['00000000-0000-0000-0000-000000000060'],
        );

        const res = await app.inject({
          method: 'GET',
          url: '/api/terminal/known-hosts',
        });

        const body = res.json() as { total: number };
        expect(body.total).toBe(0);
      });
    });
  });

  // ================================================================
  // Issue #1680 — Entry Recording (API endpoints)
  // ================================================================

  describe('Entry Recording API (#1680)', () => {
    const connId = '00000000-0000-0000-0000-000000000001';
    const sessId = '00000000-0000-0000-0000-000000000010';

    async function createSessionWithEntries() {
      await pool.query(
        `INSERT INTO terminal_connection (id, namespace, name, host) VALUES ($1, 'default', 'test-conn', 'example.com')`,
        [connId],
      );
      await pool.query(
        `INSERT INTO terminal_session (id, namespace, connection_id, tmux_session_name, status, started_at)
         VALUES ($1, 'default', $2, 'test-sess', 'active', NOW())`,
        [sessId, connId],
      );
      // Insert sample entries
      await pool.query(
        `INSERT INTO terminal_session_entry (id, session_id, namespace, kind, content, metadata)
         VALUES
           ($1, $2, 'default', 'command', 'ls -la', '{"exit_code": 0}'),
           ($3, $2, 'default', 'output', 'total 42\ndrwxr-xr-x 5 user user 4096 Feb 20 14:30 .', NULL),
           ($4, $2, 'default', 'command', 'cat /etc/hostname', '{"exit_code": 0}'),
           ($5, $2, 'default', 'output', 'web-server-1', NULL),
           ($6, $2, 'default', 'annotation', 'Server is running correctly', NULL)`,
        [
          '00000000-0000-0000-0000-000000000100',
          sessId,
          '00000000-0000-0000-0000-000000000101',
          '00000000-0000-0000-0000-000000000102',
          '00000000-0000-0000-0000-000000000103',
          '00000000-0000-0000-0000-000000000104',
        ],
      );
    }

    describe('GET /api/terminal/sessions/:id/entries', () => {
      it('lists entries for a session', async () => {
        await createSessionWithEntries();

        const res = await app.inject({
          method: 'GET',
          url: `/api/terminal/sessions/${sessId}/entries`,
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { entries: Array<{ kind: string }>; total: number };
        expect(body.total).toBe(5);
        expect(body.entries).toHaveLength(5);
      });

      it('filters by kind', async () => {
        await createSessionWithEntries();

        const res = await app.inject({
          method: 'GET',
          url: `/api/terminal/sessions/${sessId}/entries?kind=command`,
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { entries: Array<{ kind: string }>; total: number };
        expect(body.total).toBe(2);
        for (const entry of body.entries) {
          expect(entry.kind).toBe('command');
        }
      });

      it('supports pagination', async () => {
        await createSessionWithEntries();

        const res = await app.inject({
          method: 'GET',
          url: `/api/terminal/sessions/${sessId}/entries?limit=2&offset=0`,
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { entries: unknown[]; total: number };
        expect(body.entries).toHaveLength(2);
        expect(body.total).toBe(5);
      });

      it('returns 404 for non-existent session', async () => {
        const res = await app.inject({
          method: 'GET',
          url: '/api/terminal/sessions/00000000-0000-0000-0000-000000000099/entries',
        });

        expect(res.statusCode).toBe(404);
      });
    });

    describe('GET /api/terminal/sessions/:id/entries/export', () => {
      it('exports entries as plain text', async () => {
        await createSessionWithEntries();

        const res = await app.inject({
          method: 'GET',
          url: `/api/terminal/sessions/${sessId}/entries/export?format=text`,
        });

        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toContain('text/plain');
        const text = res.payload;
        expect(text).toContain('$ ls -la');
        expect(text).toContain('web-server-1');
        expect(text).toContain('[NOTE] Server is running correctly');
      });

      it('exports entries as markdown', async () => {
        await createSessionWithEntries();

        const res = await app.inject({
          method: 'GET',
          url: `/api/terminal/sessions/${sessId}/entries/export?format=markdown`,
        });

        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toContain('text/markdown');
        const md = res.payload;
        expect(md).toContain('# Terminal Session');
        expect(md).toContain('```bash');
        expect(md).toContain('$ ls -la');
        expect(md).toContain('> **Note:** Server is running correctly');
      });

      it('returns 404 for non-existent session', async () => {
        const res = await app.inject({
          method: 'GET',
          url: '/api/terminal/sessions/00000000-0000-0000-0000-000000000099/entries/export',
        });

        expect(res.statusCode).toBe(404);
      });
    });
  });

  // ================================================================
  // Issue #1681 — Semantic Search
  // ================================================================

  describe('Semantic Search (#1681)', () => {
    const connId = '00000000-0000-0000-0000-000000000001';
    const sessId = '00000000-0000-0000-0000-000000000010';

    async function createSearchableEntries() {
      await pool.query(
        `INSERT INTO terminal_connection (id, namespace, name, host) VALUES ($1, 'default', 'web-server', 'web.example.com')`,
        [connId],
      );
      await pool.query(
        `INSERT INTO terminal_session (id, namespace, connection_id, tmux_session_name, status, tags)
         VALUES ($1, 'default', $2, 'deploy-prod', 'active', $3)`,
        [sessId, connId, ['production', 'deploy']],
      );
      // Insert entries with embedded_at set to make them searchable
      await pool.query(
        `INSERT INTO terminal_session_entry (id, session_id, namespace, kind, content, metadata, embedded_at)
         VALUES
           ($1, $2, 'default', 'command', 'sudo nano /etc/nginx/sites-available/myapp', '{"exit_code": 0}', NOW()),
           ($3, $2, 'default', 'output', 'server { listen 80; proxy_pass http://localhost:3000; }', NULL, NOW()),
           ($4, $2, 'default', 'command', 'systemctl restart nginx', '{"exit_code": 0}', NOW()),
           ($5, $2, 'default', 'annotation', 'Configured nginx reverse proxy for the app', NULL, NOW())`,
        [
          '00000000-0000-0000-0000-000000000100',
          sessId,
          '00000000-0000-0000-0000-000000000101',
          '00000000-0000-0000-0000-000000000102',
          '00000000-0000-0000-0000-000000000103',
        ],
      );
    }

    describe('POST /api/terminal/search', () => {
      it('searches entries by content', async () => {
        await createSearchableEntries();

        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/search',
          payload: { query: 'nginx' },
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as {
          items: Array<{
            content: string;
            session_name: string;
            connection_name: string;
            connection_host: string;
            context: { before: unknown[]; after: unknown[] };
          }>;
          total: number;
        };
        expect(body.total).toBeGreaterThan(0);
        // At least one result should contain nginx
        expect(body.items.some((item) => item.content.includes('nginx'))).toBe(true);
        // Session and connection info should be populated
        const first = body.items[0];
        expect(first.session_name).toBe('deploy-prod');
        expect(first.connection_name).toBe('web-server');
        expect(first.connection_host).toBe('web.example.com');
      });

      it('filters by kind', async () => {
        await createSearchableEntries();

        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/search',
          payload: { query: 'nginx', kind: ['command'] },
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { items: Array<{ kind: string }>; total: number };
        for (const item of body.items) {
          expect(item.kind).toBe('command');
        }
      });

      it('filters by tags', async () => {
        await createSearchableEntries();

        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/search',
          payload: { query: 'nginx', tags: ['production'] },
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { items: unknown[]; total: number };
        expect(body.total).toBeGreaterThan(0);
      });

      it('filters by host', async () => {
        await createSearchableEntries();

        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/search',
          payload: { query: 'nginx', host: 'web.example' },
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { items: unknown[]; total: number };
        expect(body.total).toBeGreaterThan(0);
      });

      it('returns empty for non-matching query', async () => {
        await createSearchableEntries();

        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/search',
          payload: { query: 'kubernetes-nonexistent-term' },
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { items: unknown[]; total: number };
        expect(body.total).toBe(0);
        expect(body.items).toEqual([]);
      });

      it('rejects missing query', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/search',
          payload: {},
        });

        expect(res.statusCode).toBe(400);
        const body = res.json() as { error: string };
        expect(body.error).toContain('query is required');
      });

      it('includes surrounding context', async () => {
        await createSearchableEntries();

        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/search',
          payload: { query: 'proxy_pass' },
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as {
          items: Array<{
            context: { before: unknown[]; after: unknown[] };
          }>;
        };
        if (body.items.length > 0) {
          expect(body.items[0].context).toHaveProperty('before');
          expect(body.items[0].context).toHaveProperty('after');
        }
      });

      it('respects namespace scoping', async () => {
        // Create entry in other namespace
        await pool.query(
          `INSERT INTO terminal_connection (id, namespace, name, host) VALUES ($1, 'other-ns', 'hidden', 'hidden.com')`,
          [connId],
        );
        await pool.query(
          `INSERT INTO terminal_session (id, namespace, connection_id, tmux_session_name, status)
           VALUES ($1, 'other-ns', $2, 'hidden-sess', 'active')`,
          [sessId, connId],
        );
        await pool.query(
          `INSERT INTO terminal_session_entry (id, session_id, namespace, kind, content, embedded_at)
           VALUES ($1, $2, 'other-ns', 'command', 'secret-nginx-config', NOW())`,
          ['00000000-0000-0000-0000-000000000100', sessId],
        );

        const res = await app.inject({
          method: 'POST',
          url: '/api/terminal/search',
          payload: { query: 'secret-nginx' },
        });

        const body = res.json() as { total: number };
        expect(body.total).toBe(0);
      });
    });
  });

  // ================================================================
  // Issue #1682 — Worker Status Endpoint
  // ================================================================

  describe('Worker Status (#1682)', () => {
    describe('GET /api/terminal/worker/status', () => {
      it('returns 502 when worker is unavailable', async () => {
        const res = await app.inject({
          method: 'GET',
          url: '/api/terminal/worker/status',
        });

        expect(res.statusCode).toBe(502);
      });
    });
  });
});
