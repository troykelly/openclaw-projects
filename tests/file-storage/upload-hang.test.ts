/**
 * Test for Issue #1136: File upload to /api/files/upload hangs indefinitely
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import type { Pool } from 'pg';
import { buildServer } from '../../src/api/server.ts';
import { createTestPool, truncateAllTables } from '../helpers/db.ts';
import { runMigrate } from '../helpers/migrate.ts';

// Mock the file storage module
vi.mock('../../src/api/file-storage/index.ts', async () => {
  const actual = await vi.importActual('../../src/api/file-storage/index.ts');

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

describe('Issue #1136 - File Upload Hang', () => {
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

  it('should return a response when uploading a file (not hang)', async () => {
    // Create a simple multipart/form-data payload
    const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
    const content = Buffer.from('test file content');
    const payload = [
      `------${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="test.txt"',
      'Content-Type: text/plain',
      '',
      content.toString(),
      `------${boundary}--`,
    ].join('\r\n');

    const response = await app.inject({
      method: 'POST',
      url: '/api/files/upload',
      headers: {
        'content-type': `multipart/form-data; boundary=----${boundary}`,
      },
      payload,
    });

    // Should get a response, not hang
    expect(response.statusCode).toBeGreaterThanOrEqual(200);
    expect(response.statusCode).toBeLessThan(600);

    // If successful, should return 201 with file metadata
    if (response.statusCode === 201) {
      const body = response.json();
      expect(body).toHaveProperty('id');
      expect(body).toHaveProperty('originalFilename', 'test.txt');
      expect(body).toHaveProperty('contentType', 'text/plain');
      expect(body).toHaveProperty('sizeBytes');
    }
  }, 10000); // 10 second timeout to detect hang

  it('should handle empty upload request without hanging', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/files/upload',
      headers: {
        'content-type': 'multipart/form-data; boundary=----test',
      },
      payload: '------test--',
    });

    // Should get a response (likely 400), not hang
    expect(response.statusCode).toBeGreaterThanOrEqual(200);
    expect(response.statusCode).toBeLessThan(600);
  }, 10000);

  it('should handle malformed multipart request without hanging', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/files/upload',
      headers: {
        'content-type': 'multipart/form-data; boundary=----test',
      },
      payload: 'invalid multipart data',
    });

    // Should get a response (likely 400), not hang
    expect(response.statusCode).toBeGreaterThanOrEqual(200);
    expect(response.statusCode).toBeLessThan(600);
  }, 10000);
});
