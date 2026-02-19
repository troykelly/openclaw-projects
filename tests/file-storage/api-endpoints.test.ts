/**
 * Tests for file storage API endpoints.
 * Part of Issue #215.
 *
 * Note: These tests mock the S3 storage since SeaweedFS may not be available
 * in all test environments.
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

describe('File Storage API Endpoints', () => {
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

  describe('GET /api/files', () => {
    it('returns empty list initially', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/files',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.files).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('supports pagination parameters', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/files?limit=10&offset=0',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveProperty('files');
      expect(response.json()).toHaveProperty('total');
    });
  });

  describe('GET /api/files/:id/metadata', () => {
    it('returns 404 for non-existent file', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/files/00000000-0000-0000-0000-000000000000/metadata',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /api/files/:id', () => {
    it('returns 404 for non-existent file', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/files/00000000-0000-0000-0000-000000000000',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /api/files/:id/url', () => {
    it('returns 404 for non-existent file', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/files/00000000-0000-0000-0000-000000000000/url',
      });

      expect(response.statusCode).toBe(404);
    });

    it('validates expiresIn parameter', async () => {
      // First create a file
      await pool.query(
        `INSERT INTO file_attachment (id, storage_key, original_filename, content_type, size_bytes)
         VALUES ('11111111-1111-1111-1111-111111111111', 'test/key.txt', 'test.txt', 'text/plain', 100)`,
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/files/11111111-1111-1111-1111-111111111111/url?expires_in=10',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('expires_in');
    });
  });

  describe('DELETE /api/files/:id', () => {
    it('returns 404 for non-existent file', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/files/00000000-0000-0000-0000-000000000000',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('Work Item Attachments', () => {
    it('POST /api/work-items/:id/attachments requires file_id', async () => {
      // Create work item
      const wiResponse = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Test Task' },
      });
      const work_item_id = wiResponse.json().id;

      const response = await app.inject({
        method: 'POST',
        url: `/api/work-items/${work_item_id}/attachments`,
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('file_id');
    });

    it('POST /api/work-items/:id/attachments returns 404 for non-existent work item', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/work-items/00000000-0000-0000-0000-000000000000/attachments',
        payload: { file_id: '11111111-1111-1111-1111-111111111111' },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toBe('not found');
    });

    it('POST /api/work-items/:id/attachments returns 404 for non-existent file', async () => {
      // Create work item
      const wiResponse = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Test Task' },
      });
      const work_item_id = wiResponse.json().id;

      const response = await app.inject({
        method: 'POST',
        url: `/api/work-items/${work_item_id}/attachments`,
        payload: { file_id: '00000000-0000-0000-0000-000000000000' },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toContain('File');
    });

    it('GET /api/work-items/:id/attachments returns empty list', async () => {
      // Create work item
      const wiResponse = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Test Task' },
      });
      const work_item_id = wiResponse.json().id;

      const response = await app.inject({
        method: 'GET',
        url: `/api/work-items/${work_item_id}/attachments`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().attachments).toEqual([]);
    });

    it('full attachment workflow', async () => {
      // Create work item
      const wiResponse = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Test Task' },
      });
      const work_item_id = wiResponse.json().id;

      // Create file attachment directly in DB (since upload mock is complex)
      const fileId = '22222222-2222-2222-2222-222222222222';
      await pool.query(
        `INSERT INTO file_attachment (id, storage_key, original_filename, content_type, size_bytes)
         VALUES ($1, 'test/attachment.pdf', 'attachment.pdf', 'application/pdf', 1024)`,
        [fileId],
      );

      // Attach file to work item
      const attachResponse = await app.inject({
        method: 'POST',
        url: `/api/work-items/${work_item_id}/attachments`,
        payload: { file_id: fileId },
      });

      expect(attachResponse.statusCode).toBe(201);
      expect(attachResponse.json().attached).toBe(true);

      // List attachments
      const listResponse = await app.inject({
        method: 'GET',
        url: `/api/work-items/${work_item_id}/attachments`,
      });

      expect(listResponse.statusCode).toBe(200);
      expect(listResponse.json().attachments.length).toBe(1);
      expect(listResponse.json().attachments[0].original_filename).toBe('attachment.pdf');

      // Remove attachment
      const removeResponse = await app.inject({
        method: 'DELETE',
        url: `/api/work-items/${work_item_id}/attachments/${fileId}`,
      });

      expect(removeResponse.statusCode).toBe(204);

      // Verify removed
      const listResponse2 = await app.inject({
        method: 'GET',
        url: `/api/work-items/${work_item_id}/attachments`,
      });

      expect(listResponse2.json().attachments.length).toBe(0);
    });

    it('DELETE /api/work-items/:work_item_id/attachments/:fileId returns 404 if not attached', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/work-items/00000000-0000-0000-0000-000000000000/attachments/11111111-1111-1111-1111-111111111111',
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
