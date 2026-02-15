/**
 * Tests for S3 presigned URL generation with external endpoints.
 * Part of Issue #1320 - S3 presigned URL signature mismatch when using
 * external endpoint (FILE_SHARE_MODE=presigned).
 *
 * Verifies that presigned URLs are generated using the external endpoint
 * (when configured) so that the Signature V4 Host matches the endpoint
 * the browser actually hits.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { S3Storage } from '../../src/api/file-storage/s3-storage.ts';
import type { S3Config } from '../../src/api/file-storage/types.ts';

/** Track S3Client instances created by the mock */
const s3Instances: Array<{ _config: Record<string, unknown> }> = [];

// Mock AWS SDK modules — all exports that are used with `new` must be classes
vi.mock('@aws-sdk/client-s3', () => {
  class MockS3Client {
    _config: Record<string, unknown>;
    send = vi.fn();
    constructor(config: Record<string, unknown>) {
      this._config = config;
      s3Instances.push(this);
    }
  }
  class MockGetObjectCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }
  class MockPutObjectCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  class MockDeleteObjectCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  class MockHeadObjectCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  return {
    S3Client: MockS3Client,
    PutObjectCommand: MockPutObjectCommand,
    GetObjectCommand: MockGetObjectCommand,
    DeleteObjectCommand: MockDeleteObjectCommand,
    HeadObjectCommand: MockHeadObjectCommand,
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockImplementation(async (client: { _config: { endpoint?: string } }) => {
    const endpoint = client._config.endpoint ?? 'https://s3.amazonaws.com';
    return `${endpoint}/test-bucket/test-key?X-Amz-Signature=abc123`;
  }),
}));

describe('S3Storage external endpoint presigning', () => {
  const baseConfig: S3Config = {
    endpoint: 'http://seaweedfs:8333',
    bucket: 'test-bucket',
    region: 'us-east-1',
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret',
    forcePathStyle: true,
  };

  beforeEach(() => {
    s3Instances.length = 0;
    vi.clearAllMocks();
  });

  describe('getExternalSignedUrl', () => {
    it('uses external endpoint for signing when externalEndpoint is configured', async () => {
      const storage = new S3Storage({
        ...baseConfig,
        externalEndpoint: 'https://s3.execdesk.ai',
      });

      const url = await storage.getExternalSignedUrl('test-key', 3600);

      // The URL should be signed against the external endpoint
      expect(url).toContain('https://s3.execdesk.ai');
      expect(url).not.toContain('seaweedfs:8333');
    });

    it('falls back to internal client when no externalEndpoint is configured', async () => {
      const storage = new S3Storage(baseConfig);

      const url = await storage.getExternalSignedUrl('test-key', 3600);

      // Should use the internal endpoint since no external is configured
      expect(url).toContain('http://seaweedfs:8333');
    });

    it('creates a separate client for external signing (not reusing internal client)', async () => {
      const storage = new S3Storage({
        ...baseConfig,
        externalEndpoint: 'https://s3.execdesk.ai',
      });

      // After constructor: 1 instance (internal client)
      expect(s3Instances).toHaveLength(1);

      await storage.getExternalSignedUrl('test-key', 3600);

      // After first external call: 2 instances (internal + external)
      expect(s3Instances).toHaveLength(2);

      // The second instance should have the external endpoint
      expect(s3Instances[1]._config.endpoint).toBe('https://s3.execdesk.ai');
    });

    it('reuses the external client on subsequent calls (lazy singleton)', async () => {
      const storage = new S3Storage({
        ...baseConfig,
        externalEndpoint: 'https://s3.execdesk.ai',
      });

      await storage.getExternalSignedUrl('key1', 3600);
      await storage.getExternalSignedUrl('key2', 3600);

      // Should still only be 2 instances total (1 internal + 1 external, reused)
      expect(s3Instances).toHaveLength(2);
    });

    it('preserves other client config (region, credentials, forcePathStyle) on external client', async () => {
      const storage = new S3Storage({
        ...baseConfig,
        externalEndpoint: 'https://s3.execdesk.ai',
      });

      await storage.getExternalSignedUrl('test-key', 3600);

      const externalClientConfig = s3Instances[1]._config;
      expect(externalClientConfig.region).toBe('us-east-1');
      expect(externalClientConfig.credentials).toEqual({
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
      });
      expect(externalClientConfig.forcePathStyle).toBe(true);
    });
  });

  describe('getSignedUrl (internal, unchanged)', () => {
    it('still uses internal endpoint for regular signed URLs', async () => {
      const storage = new S3Storage({
        ...baseConfig,
        externalEndpoint: 'https://s3.execdesk.ai',
      });

      const url = await storage.getSignedUrl('test-key', 3600);

      // Regular getSignedUrl should still use internal endpoint
      expect(url).toContain('http://seaweedfs:8333');
    });
  });
});

describe('createS3StorageFromEnv with S3_EXTERNAL_ENDPOINT', () => {
  const envBackup: Record<string, string | undefined> = {};
  const envKeys = [
    'S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY', 'S3_SECRET_KEY',
    'S3_ENDPOINT', 'S3_EXTERNAL_ENDPOINT', 'S3_FORCE_PATH_STYLE',
  ];

  beforeEach(() => {
    s3Instances.length = 0;
    for (const key of envKeys) {
      envBackup[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (envBackup[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = envBackup[key];
      }
    }
  });

  it('passes S3_EXTERNAL_ENDPOINT to storage when set', async () => {
    process.env.S3_BUCKET = 'test-bucket';
    process.env.S3_REGION = 'us-east-1';
    process.env.S3_ACCESS_KEY = 'key';
    process.env.S3_SECRET_KEY = 'secret';
    process.env.S3_ENDPOINT = 'http://seaweedfs:8333';
    process.env.S3_EXTERNAL_ENDPOINT = 'https://s3.execdesk.ai';

    const { createS3StorageFromEnv } = await import('../../src/api/file-storage/s3-storage.ts');
    const storage = createS3StorageFromEnv();

    expect(storage).not.toBeNull();

    const url = await storage!.getExternalSignedUrl('test-key', 3600);
    expect(url).toContain('https://s3.execdesk.ai');
  });

  it('works without S3_EXTERNAL_ENDPOINT (fallback to internal)', async () => {
    process.env.S3_BUCKET = 'test-bucket';
    process.env.S3_REGION = 'us-east-1';
    process.env.S3_ACCESS_KEY = 'key';
    process.env.S3_SECRET_KEY = 'secret';
    process.env.S3_ENDPOINT = 'http://seaweedfs:8333';
    delete process.env.S3_EXTERNAL_ENDPOINT;

    const { createS3StorageFromEnv } = await import('../../src/api/file-storage/s3-storage.ts');
    const storage = createS3StorageFromEnv();

    expect(storage).not.toBeNull();

    const url = await storage!.getExternalSignedUrl('test-key', 3600);
    expect(url).toContain('http://seaweedfs:8333');
  });
});
