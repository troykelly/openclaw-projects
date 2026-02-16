/**
 * Tests for presigned URL generation in file sharing.
 * Part of Issue #1320 - Ensures sharing.ts uses getExternalSignedUrl()
 * instead of the string-replace hack.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FileStorage, FileAttachment } from '../../src/api/file-storage/types.ts';
import type { Pool } from 'pg';

// Mock the service module
vi.mock('../../src/api/file-storage/service.ts', () => ({
  getFileMetadata: vi.fn(),
  getFileUrl: vi.fn(),
  FileNotFoundError: class FileNotFoundError extends Error {
    constructor(public fileId: string) {
      super(`File not found: ${fileId}`);
      this.name = 'FileNotFoundError';
    }
  },
}));

describe('createFileShare presigned mode', () => {
  const envBackup: Record<string, string | undefined> = {};
  const envKeys = ['FILE_SHARE_MODE', 'S3_ENDPOINT', 'S3_EXTERNAL_ENDPOINT', 'PUBLIC_BASE_URL'];

  beforeEach(() => {
    for (const key of envKeys) {
      envBackup[key] = process.env[key];
    }
    vi.resetModules();
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (envBackup[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = envBackup[key];
      }
    }
    vi.restoreAllMocks();
  });

  function createMockStorage(signedUrl: string, externalSignedUrl?: string): FileStorage {
    return {
      upload: vi.fn(),
      download: vi.fn(),
      getSignedUrl: vi.fn().mockResolvedValue(signedUrl),
      getExternalSignedUrl: vi.fn().mockResolvedValue(externalSignedUrl ?? signedUrl),
      delete: vi.fn(),
      exists: vi.fn(),
    };
  }

  function createMockPool(): Pool {
    return {} as Pool;
  }

  const mockMetadata: FileAttachment = {
    id: 'file-123',
    storageKey: '2026/02/15/test-uuid.pdf',
    originalFilename: 'report.pdf',
    contentType: 'application/pdf',
    sizeBytes: 1024,
    createdAt: new Date('2026-02-15'),
  };

  it('calls getExternalSignedUrl (not getSignedUrl) in presigned mode', async () => {
    process.env.FILE_SHARE_MODE = 'presigned';
    delete process.env.S3_EXTERNAL_ENDPOINT;

    const { getFileMetadata } = await import('../../src/api/file-storage/service.ts');
    (getFileMetadata as ReturnType<typeof vi.fn>).mockResolvedValue(mockMetadata);

    const { createFileShare } = await import('../../src/api/file-storage/sharing.ts');

    const storage = createMockStorage(
      'http://seaweedfs:8333/test-bucket/key?sig=internal',
      'https://s3.execdesk.ai/test-bucket/key?sig=external',
    );

    const result = await createFileShare(createMockPool(), storage, {
      fileId: 'file-123',
      expiresIn: 3600,
    });

    // Should call getExternalSignedUrl, NOT getSignedUrl
    expect(storage.getExternalSignedUrl).toHaveBeenCalledWith(mockMetadata.storageKey, 3600);
    expect(storage.getSignedUrl).not.toHaveBeenCalled();
  });

  it('returns the URL from getExternalSignedUrl without any string replacement', async () => {
    process.env.FILE_SHARE_MODE = 'presigned';
    delete process.env.S3_EXTERNAL_ENDPOINT;

    const { getFileMetadata } = await import('../../src/api/file-storage/service.ts');
    (getFileMetadata as ReturnType<typeof vi.fn>).mockResolvedValue(mockMetadata);

    const { createFileShare } = await import('../../src/api/file-storage/sharing.ts');

    const externalUrl = 'https://s3.execdesk.ai/test-bucket/key?X-Amz-Signature=valid123';
    const storage = createMockStorage(
      'http://seaweedfs:8333/test-bucket/key?X-Amz-Signature=internal123',
      externalUrl,
    );

    const result = await createFileShare(createMockPool(), storage, {
      fileId: 'file-123',
      expiresIn: 3600,
    });

    // URL should be exactly what getExternalSignedUrl returned (no manipulation)
    expect(result.url).toBe(externalUrl);
  });

  it('does not reference S3_EXTERNAL_ENDPOINT or S3_ENDPOINT env vars in sharing logic', async () => {
    // This test validates that sharing.ts no longer reads S3_EXTERNAL_ENDPOINT itself.
    // The external endpoint logic is now entirely in s3-storage.ts.
    process.env.FILE_SHARE_MODE = 'presigned';
    process.env.S3_ENDPOINT = 'http://seaweedfs:8333';
    process.env.S3_EXTERNAL_ENDPOINT = 'https://s3.execdesk.ai';

    const { getFileMetadata } = await import('../../src/api/file-storage/service.ts');
    (getFileMetadata as ReturnType<typeof vi.fn>).mockResolvedValue(mockMetadata);

    const { createFileShare } = await import('../../src/api/file-storage/sharing.ts');

    // Even with S3_EXTERNAL_ENDPOINT set, sharing.ts should NOT do string replacement
    const externalUrl = 'https://s3.execdesk.ai/test-bucket/key?X-Amz-Signature=correct';
    const storage = createMockStorage(
      'http://seaweedfs:8333/test-bucket/key?X-Amz-Signature=internal',
      externalUrl,
    );

    const result = await createFileShare(createMockPool(), storage, {
      fileId: 'file-123',
      expiresIn: 3600,
    });

    // URL should be exactly the external signed URL, not a string-replaced version
    expect(result.url).toBe(externalUrl);
  });
});
