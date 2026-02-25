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
});
