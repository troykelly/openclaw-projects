/**
 * Tests for S3_FORCE_PATH_STYLE env var handling in createS3StorageFromEnv().
 * Part of Issue #2500 — env loader always supplies false when var is unset,
 * overriding the constructor's `?? !!config.endpoint` fallback.
 *
 * Acceptance criteria:
 *  - When S3_ENDPOINT is set and S3_FORCE_PATH_STYLE is unset → forcePathStyle: true
 *    (constructor fallback !!config.endpoint kicks in)
 *  - When S3_FORCE_PATH_STYLE=true → forcePathStyle: true
 *  - When S3_FORCE_PATH_STYLE=false → forcePathStyle: false
 *  - When neither env var is set → forcePathStyle: false (no endpoint, no explicit setting)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** Capture S3Client constructor configs */
const s3Instances: Array<{ _config: Record<string, unknown> }> = [];

vi.mock('@aws-sdk/client-s3', () => {
  class MockS3Client {
    _config: Record<string, unknown>;
    send = vi.fn();
    constructor(config: Record<string, unknown>) {
      this._config = config;
      s3Instances.push(this);
    }
  }
  class MockPutObjectCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  class MockGetObjectCommand {
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
  getSignedUrl: vi.fn().mockResolvedValue('https://example.com/presigned'),
}));

describe('createS3StorageFromEnv — S3_FORCE_PATH_STYLE handling (#2500)', () => {
  const envKeys = [
    'S3_BUCKET',
    'S3_REGION',
    'S3_ACCESS_KEY',
    'S3_SECRET_KEY',
    'S3_ENDPOINT',
    'S3_EXTERNAL_ENDPOINT',
    'S3_FORCE_PATH_STYLE',
  ] as const;

  const envBackup: Record<string, string | undefined> = {};

  beforeEach(() => {
    s3Instances.length = 0;
    vi.clearAllMocks();
    for (const key of envKeys) {
      envBackup[key] = process.env[key];
    }
    // Set required vars for all tests
    process.env.S3_BUCKET = 'test-bucket';
    process.env.S3_REGION = 'us-east-1';
    process.env.S3_ACCESS_KEY = 'test-access-key';
    process.env.S3_SECRET_KEY = 'test-secret-key';
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

  it('uses forcePathStyle=true via constructor fallback when S3_ENDPOINT is set but S3_FORCE_PATH_STYLE is unset', async () => {
    process.env.S3_ENDPOINT = 'http://seaweedfs:8333';
    delete process.env.S3_FORCE_PATH_STYLE;

    const { createS3StorageFromEnv } = await import('../../src/api/file-storage/s3-storage.ts');
    const storage = createS3StorageFromEnv();

    expect(storage).not.toBeNull();
    expect(s3Instances).toHaveLength(1);
    // Constructor fallback: forcePathStyle = config.force_path_style ?? !!config.endpoint
    // force_path_style is undefined → fallback to !!endpoint → true
    expect(s3Instances[0]._config.forcePathStyle).toBe(true);
  });

  it('uses forcePathStyle=true when S3_FORCE_PATH_STYLE=true is explicitly set', async () => {
    process.env.S3_ENDPOINT = 'http://seaweedfs:8333';
    process.env.S3_FORCE_PATH_STYLE = 'true';

    const { createS3StorageFromEnv } = await import('../../src/api/file-storage/s3-storage.ts');
    const storage = createS3StorageFromEnv();

    expect(storage).not.toBeNull();
    expect(s3Instances).toHaveLength(1);
    expect(s3Instances[0]._config.forcePathStyle).toBe(true);
  });

  it('uses forcePathStyle=false when S3_FORCE_PATH_STYLE=false is explicitly set', async () => {
    process.env.S3_ENDPOINT = 'http://seaweedfs:8333';
    process.env.S3_FORCE_PATH_STYLE = 'false';

    const { createS3StorageFromEnv } = await import('../../src/api/file-storage/s3-storage.ts');
    const storage = createS3StorageFromEnv();

    expect(storage).not.toBeNull();
    expect(s3Instances).toHaveLength(1);
    // Explicitly false overrides the endpoint fallback
    expect(s3Instances[0]._config.forcePathStyle).toBe(false);
  });

  it('uses forcePathStyle=false when neither S3_ENDPOINT nor S3_FORCE_PATH_STYLE is set', async () => {
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_FORCE_PATH_STYLE;

    const { createS3StorageFromEnv } = await import('../../src/api/file-storage/s3-storage.ts');
    const storage = createS3StorageFromEnv();

    expect(storage).not.toBeNull();
    expect(s3Instances).toHaveLength(1);
    // No endpoint, no explicit setting: forcePathStyle = undefined ?? !!undefined = false
    expect(s3Instances[0]._config.forcePathStyle).toBe(false);
  });

  it('treats empty string S3_FORCE_PATH_STYLE as false (not a recognised truthy value)', async () => {
    process.env.S3_ENDPOINT = 'http://seaweedfs:8333';
    // Explicitly set to empty string — the var is defined but not 'true'
    process.env.S3_FORCE_PATH_STYLE = '';

    const { createS3StorageFromEnv } = await import('../../src/api/file-storage/s3-storage.ts');
    const storage = createS3StorageFromEnv();

    expect(storage).not.toBeNull();
    expect(s3Instances).toHaveLength(1);
    // Variable is defined (not undefined) so undefined branch is not taken;
    // '' !== 'true' → force_path_style: false → forcePathStyle: false
    expect(s3Instances[0]._config.forcePathStyle).toBe(false);
  });
});
