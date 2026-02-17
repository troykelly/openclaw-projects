/**
 * Tests for UUID validation on file storage API endpoints.
 * Part of Issue #613 - Missing UUID validation for file ID parameter.
 *
 * These tests verify that invalid UUIDs return 400 Bad Request
 * instead of causing database errors (500) that could leak schema info.
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
  const mockFiles = new Map<string, { data: Buffer; content_type: string }>();

  const MockS3Storage = class {
    async upload(key: string, data: Buffer, content_type: string): Promise<string> {
      mockFiles.set(key, { data, content_type });
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

describe('UUID Validation for File Share Endpoint', () => {
  const originalEnv = process.env;
  let pool: Pool;
  let app: ReturnType<typeof buildServer>;

  beforeAll(async () => {
    await runMigrate('up');
  });

  beforeEach(async () => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.OPENCLAW_PROJECTS_AUTH_DISABLED = 'true';
    // Set mock S3 env vars
    process.env.S3_BUCKET = 'test-bucket';
    process.env.S3_REGION = 'us-east-1';
    process.env.S3_ACCESS_KEY = 'test-key';
    process.env.S3_SECRET_KEY = 'test-secret';
    process.env.S3_ENDPOINT = 'http://localhost:8333';

    pool = createTestPool();
    await truncateAllTables(pool);
    app = buildServer({ logger: false });
  });

  afterEach(async () => {
    process.env = originalEnv;
    await pool.end();
    await app.close();
  });

  describe('POST /api/files/:id/share', () => {
    it('returns 400 Bad Request for "not-a-uuid"', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/files/not-a-uuid/share',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('Invalid file ID format');
    });

    it('returns 400 Bad Request for "123"', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/files/123/share',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('Invalid file ID format');
    });

    it('returns 400 Bad Request for "abc"', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/files/abc/share',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('Invalid file ID format');
    });

    it('returns 400 Bad Request for empty string path', async () => {
      // Note: Empty string in path would be /api/files//share which Fastify may handle differently
      // This tests the closest equivalent
      const response = await app.inject({
        method: 'POST',
        url: '/api/files/%20/share', // URL-encoded space
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('Invalid file ID format');
    });

    it('returns 400 Bad Request for partial UUID', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/files/12345678-1234-1234-1234/share', // Missing last segment
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('Invalid file ID format');
    });

    it('returns 400 Bad Request for UUID with invalid characters', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/files/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx/share',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('Invalid file ID format');
    });

    it('accepts valid UUID format and returns 404 for non-existent file', async () => {
      // This test verifies that valid UUIDs pass validation
      // and reach the database lookup (which returns 404 for non-existent files)
      const response = await app.inject({
        method: 'POST',
        url: '/api/files/00000000-0000-0000-0000-000000000000/share',
        payload: {},
      });

      // Should be 404 (file not found), NOT 400 (invalid UUID)
      expect(response.statusCode).toBe(404);
    });

    it('accepts valid UUID with uppercase letters', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/files/ABCDEF12-3456-7890-ABCD-EF1234567890/share',
        payload: {},
      });

      // Should be 404 (file not found), NOT 400 (invalid UUID)
      expect(response.statusCode).toBe(404);
    });
  });
});
