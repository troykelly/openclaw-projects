/**
 * Tests for file share ownership checks.
 * Part of Issue #615.
 *
 * Verifies that users can only create share links for files they uploaded.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import type { Pool } from 'pg';
import { buildServer } from '../../src/api/server.ts';
import { createTestPool, truncateAllTables } from '../helpers/db.ts';
import { runMigrate } from '../helpers/migrate.ts';

// Mock the file storage module
vi.mock('../../src/api/file-storage/index.ts', async () => {
  const actual = await vi.importActual('../../src/api/file-storage/index.ts');

  // Mock storage implementation
  const mockFiles = new Map<string, { data: Buffer; contentType: string }>();

  const MockS3Storage = class {
    async upload(key: string, data: Buffer, contentType: string): Promise<string> {
      mockFiles.set(key, { data, contentType });
      return key;
    }

    async download(key: string): Promise<Buffer> {
      const file = mockFiles.get(key);
      if (!file) throw new Error(`File not found: ${key}`);
      return file.data;
    }

    async getSignedUrl(key: string, expiresIn: number): Promise<string> {
      return `https://mock.s3.com/${key}?expires=${expiresIn}`;
    }

    async delete(key: string): Promise<void> {
      mockFiles.delete(key);
    }

    async exists(key: string): Promise<boolean> {
      return mockFiles.has(key);
    }
  };

  return {
    ...actual,
    S3Storage: MockS3Storage,
    createS3StorageFromEnv: () => new MockS3Storage(),
  };
});

describe('File Share Ownership Check (Issue #615)', () => {
  const originalEnv = process.env;
  let pool: Pool;
  let app: ReturnType<typeof buildServer>;

  beforeAll(async () => {
    await runMigrate('up');
  });

  beforeEach(async () => {
    vi.resetModules();
    process.env = { ...originalEnv };
    // Enable authentication for these tests
    delete process.env.OPENCLAW_PROJECTS_AUTH_DISABLED;
    process.env.JWT_SECRET = 'test-jwt-secret-for-bearer-auth-minimum-32-bytes!';
    // Set mock S3 env vars
    process.env.S3_BUCKET = 'test-bucket';
    process.env.S3_REGION = 'us-east-1';
    process.env.S3_ACCESS_KEY = 'test-key';
    process.env.S3_SECRET_KEY = 'test-secret';
    process.env.S3_ENDPOINT = 'http://localhost:8333';
    // Use proxy mode for share tokens (so we use database-backed tokens)
    process.env.FILE_SHARE_MODE = 'proxy';
    process.env.PUBLIC_BASE_URL = 'http://localhost:3001';

    pool = createTestPool();
    await truncateAllTables(pool);
    app = buildServer({ logger: false });
  });

  afterEach(async () => {
    process.env = originalEnv;
    await pool.end();
    await app.close();
  });

  /**
   * Helper to create a session for a user.
   * Returns the session cookie value (which is the UUID id).
   */
  async function createSession(email: string): Promise<string> {
    const result = await pool.query(
      `INSERT INTO auth_session (email, expires_at)
       VALUES ($1, NOW() + INTERVAL '1 hour')
       RETURNING id::text`,
      [email],
    );
    return result.rows[0].id;
  }

  /**
   * Helper to create a file attachment in the database.
   */
  async function createFileInDb(fileId: string, uploadedBy: string | null): Promise<void> {
    await pool.query(
      `INSERT INTO file_attachment (id, storage_key, original_filename, content_type, size_bytes, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [fileId, `test/${fileId}.txt`, 'test.txt', 'text/plain', 100, uploadedBy],
    );
  }

  describe('POST /api/files/:id/share', () => {
    it('allows the file owner to create a share link', async () => {
      const ownerEmail = 'owner@example.com';
      const fileId = '11111111-1111-1111-1111-111111111111';

      // Create session and file owned by this user
      const sessionId = await createSession(ownerEmail);
      await createFileInDb(fileId, ownerEmail);

      const response = await app.inject({
        method: 'POST',
        url: `/api/files/${fileId}/share`,
        cookies: { projects_session: sessionId },
        payload: { expiresIn: 3600 },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty('url');
      expect(body).toHaveProperty('expiresAt');
    });

    it("returns 403 when trying to share another user's file", async () => {
      const ownerEmail = 'owner@example.com';
      const attackerEmail = 'attacker@example.com';
      const fileId = '22222222-2222-2222-2222-222222222222';

      // Create file owned by owner
      await createFileInDb(fileId, ownerEmail);

      // Create session for attacker
      const attackerSessionId = await createSession(attackerEmail);

      const response = await app.inject({
        method: 'POST',
        url: `/api/files/${fileId}/share`,
        cookies: { projects_session: attackerSessionId },
        payload: { expiresIn: 3600 },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error).toMatch(/permission/i);
    });

    it('returns 404 when file does not exist', async () => {
      const userEmail = 'user@example.com';
      const nonExistentFileId = '00000000-0000-0000-0000-000000000000';

      const sessionId = await createSession(userEmail);

      const response = await app.inject({
        method: 'POST',
        url: `/api/files/${nonExistentFileId}/share`,
        cookies: { projects_session: sessionId },
        payload: { expiresIn: 3600 },
      });

      expect(response.statusCode).toBe(404);
    });

    it('allows sharing files with no owner when auth is disabled (dev mode)', async () => {
      // Re-create app with auth disabled
      await app.close();
      process.env.OPENCLAW_PROJECTS_AUTH_DISABLED = 'true';
      app = buildServer({ logger: false });

      const fileId = '33333333-3333-3333-3333-333333333333';

      // Create file with no owner (uploaded_by is null)
      await createFileInDb(fileId, null);

      const response = await app.inject({
        method: 'POST',
        url: `/api/files/${fileId}/share`,
        payload: { expiresIn: 3600 },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveProperty('url');
    });

    it('allows sharing any file when auth is disabled (dev mode)', async () => {
      // Re-create app with auth disabled
      await app.close();
      process.env.OPENCLAW_PROJECTS_AUTH_DISABLED = 'true';
      app = buildServer({ logger: false });

      const ownerEmail = 'original-owner@example.com';
      const fileId = '44444444-4444-4444-4444-444444444444';

      // Create file owned by someone
      await createFileInDb(fileId, ownerEmail);

      // Should be able to share even without being the owner (auth disabled)
      const response = await app.inject({
        method: 'POST',
        url: `/api/files/${fileId}/share`,
        payload: { expiresIn: 3600 },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveProperty('url');
    });

    it('returns 401 when not authenticated and auth is enabled', async () => {
      const fileId = '55555555-5555-5555-5555-555555555555';
      await createFileInDb(fileId, 'someone@example.com');

      const response = await app.inject({
        method: 'POST',
        url: `/api/files/${fileId}/share`,
        payload: { expiresIn: 3600 },
        // No session cookie or bearer token
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
