/**
 * Tests for PUBLIC_BASE_URL usage in sharing modules.
 * Part of Issue #1328 — Standardize PUBLIC_BASE_URL as app domain.
 *
 * Verifies that all sharing modules (files, notebooks, notes) use
 * PUBLIC_BASE_URL (the app/root domain) for generating share links,
 * not the old APP_BASE_URL variable.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Pool, QueryResult } from 'pg';

// Mock file-storage service
vi.mock('../src/api/file-storage/service.ts', () => ({
  getFileMetadata: vi.fn(),
  getFileUrl: vi.fn(),
  FileNotFoundError: class FileNotFoundError extends Error {
    constructor(public fileId: string) {
      super(`File not found: ${fileId}`);
      this.name = 'FileNotFoundError';
    }
  },
}));

// Mock notes service
vi.mock('../src/api/notes/service.ts', () => ({
  userOwnsNote: vi.fn().mockResolvedValue(true),
}));

function createMockPool(responses: QueryResult[]): Pool {
  let callIndex = 0;
  return {
    query: vi.fn().mockImplementation(() => {
      const response = responses[callIndex] ?? { rows: [], rowCount: 0 };
      callIndex++;
      return Promise.resolve(response);
    }),
  } as unknown as Pool;
}

describe('Sharing modules use PUBLIC_BASE_URL', () => {
  const envBackup: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ['PUBLIC_BASE_URL', 'APP_BASE_URL', 'FILE_SHARE_MODE']) {
      envBackup[key] = process.env[key];
    }
    vi.resetModules();
  });

  afterEach(() => {
    for (const key of Object.keys(envBackup)) {
      if (envBackup[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = envBackup[key];
      }
    }
    vi.restoreAllMocks();
  });

  describe('file-storage/sharing.ts', () => {
    it('uses PUBLIC_BASE_URL for proxy mode share URLs', async () => {
      process.env.FILE_SHARE_MODE = 'proxy';
      process.env.PUBLIC_BASE_URL = 'https://myapp.example.com';
      delete process.env.APP_BASE_URL;

      const { getFileMetadata } = await import('../src/api/file-storage/service.ts');
      (getFileMetadata as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'file-1',
        storage_key: 'key',
        original_filename: 'test.pdf',
        content_type: 'application/pdf',
        size_bytes: 100,
        created_at: new Date(),
      });

      const { createFileShare } = await import('../src/api/file-storage/sharing.ts');
      const pool = createMockPool([
        { rows: [{ token: 'abc123' }], rowCount: 1 } as QueryResult,
        { rows: [], rowCount: 1 } as QueryResult,
      ]);
      const storage = {
        upload: vi.fn(),
        download: vi.fn(),
        getSignedUrl: vi.fn(),
        getExternalSignedUrl: vi.fn(),
        delete: vi.fn(),
        exists: vi.fn(),
      };

      const result = await createFileShare(pool, storage, {
        file_id: 'file-1',
        expires_in: 3600,
      });

      expect(result.url).toContain('https://myapp.example.com');
    });

    it('defaults to http://localhost:3000 when PUBLIC_BASE_URL is unset', async () => {
      process.env.FILE_SHARE_MODE = 'proxy';
      delete process.env.PUBLIC_BASE_URL;
      delete process.env.APP_BASE_URL;

      const { getFileMetadata } = await import('../src/api/file-storage/service.ts');
      (getFileMetadata as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'file-1',
        storage_key: 'key',
        original_filename: 'test.pdf',
        content_type: 'application/pdf',
        size_bytes: 100,
        created_at: new Date(),
      });

      const { createFileShare } = await import('../src/api/file-storage/sharing.ts');
      const pool = createMockPool([
        { rows: [{ token: 'abc123' }], rowCount: 1 } as QueryResult,
        { rows: [], rowCount: 1 } as QueryResult,
      ]);
      const storage = {
        upload: vi.fn(),
        download: vi.fn(),
        getSignedUrl: vi.fn(),
        getExternalSignedUrl: vi.fn(),
        delete: vi.fn(),
        exists: vi.fn(),
      };

      const result = await createFileShare(pool, storage, {
        file_id: 'file-1',
        expires_in: 3600,
      });

      expect(result.url).toContain('http://localhost:3000');
    });
  });

  describe('notebooks/sharing.ts', () => {
    it('uses PUBLIC_BASE_URL for notebook share link URLs', async () => {
      process.env.PUBLIC_BASE_URL = 'https://myapp.example.com';
      delete process.env.APP_BASE_URL;

      const { createLinkShare } = await import('../src/api/notebooks/sharing.ts');
      const pool = createMockPool([
        // userOwnsNotebook check
        { rows: [{ user_email: 'test@example.com' }], rowCount: 1 } as QueryResult,
        // generate_share_token
        { rows: [{ token: 'nb-token-123' }], rowCount: 1 } as QueryResult,
        // INSERT
        {
          rows: [{
            id: 'share-1',
            notebook_id: 'nb-1',
            share_link_token: 'nb-token-123',
            permission: 'read',
            expires_at: null,
            created_by_email: 'test@example.com',
            created_at: new Date().toISOString(),
            last_accessed_at: null,
          }],
          rowCount: 1,
        } as unknown as QueryResult,
      ]);

      const result = await createLinkShare(pool, 'nb-1', {}, 'test@example.com');
      expect(result).not.toBeNull();
      expect(result!.url).toContain('https://myapp.example.com');
      expect(result!.url).toContain('/shared/notebooks/nb-token-123');
    });
  });

  describe('notes/sharing.ts', () => {
    it('uses PUBLIC_BASE_URL for note share link URLs', async () => {
      process.env.PUBLIC_BASE_URL = 'https://myapp.example.com';
      delete process.env.APP_BASE_URL;

      const { userOwnsNote } = await import('../src/api/notes/service.ts');
      (userOwnsNote as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const { createLinkShare } = await import('../src/api/notes/sharing.ts');
      const pool = createMockPool([
        // userOwnsNote is mocked at module level
        // SELECT title
        { rows: [{ title: 'Test Note' }], rowCount: 1 } as QueryResult,
        // generate_share_token
        { rows: [{ token: 'note-token-456' }], rowCount: 1 } as QueryResult,
        // INSERT
        {
          rows: [{
            id: 'share-2',
            note_id: 'note-1',
            share_link_token: 'note-token-456',
            permission: 'read',
            is_single_view: false,
            view_count: 0,
            max_views: null,
            expires_at: null,
            created_by_email: 'test@example.com',
            created_at: new Date().toISOString(),
            last_accessed_at: null,
          }],
          rowCount: 1,
        } as unknown as QueryResult,
      ]);

      const result = await createLinkShare(pool, 'note-1', {}, 'test@example.com');
      expect(result).not.toBeNull();
      expect(result!.url).toContain('https://myapp.example.com');
      expect(result!.url).toContain('/shared/notes/note-token-456');
    });
  });
});
