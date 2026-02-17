/**
 * Tests for file storage service functions.
 * Part of Issue #215.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool, truncateAllTables } from '../helpers/db.ts';
import { runMigrate } from '../helpers/migrate.ts';
import {
  generateStorageKey,
  calculateChecksum,
  uploadFile,
  downloadFile,
  getFileUrl,
  deleteFile,
  listFiles,
  getFileMetadata,
  FileTooLargeError,
  FileNotFoundError,
} from '../../src/api/file-storage/index.ts';
import type { FileStorage } from '../../src/api/file-storage/index.ts';

// Mock file storage for tests
class MockFileStorage implements FileStorage {
  private files: Map<string, { data: Buffer; content_type: string }> = new Map();

  async upload(key: string, data: Buffer, content_type: string): Promise<string> {
    this.files.set(key, { data, content_type });
    return key;
  }

  async download(key: string): Promise<Buffer> {
    const file = this.files.get(key);
    if (!file) {
      throw new Error(`File not found: ${key}`);
    }
    return file.data;
  }

  async getSignedUrl(key: string, expiresIn: number): Promise<string> {
    if (!this.files.has(key)) {
      throw new Error(`File not found: ${key}`);
    }
    return `https://mock-storage.example.com/${key}?expires=${expiresIn}`;
  }

  async delete(key: string): Promise<void> {
    this.files.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.files.has(key);
  }

  clear(): void {
    this.files.clear();
  }
}

describe('File Storage Service', () => {
  let pool: Pool;
  let mockStorage: MockFileStorage;

  beforeAll(async () => {
    await runMigrate('up');
  });

  beforeEach(async () => {
    pool = createTestPool();
    await truncateAllTables(pool);
    mockStorage = new MockFileStorage();
  });

  afterEach(async () => {
    await pool.end();
    mockStorage.clear();
  });

  describe('generateStorageKey', () => {
    it('generates a unique key with date path', () => {
      const key = generateStorageKey('test.pdf');
      expect(key).toMatch(/^\d{4}\/\d{2}\/\d{2}\/[\w-]+\.pdf$/);
    });

    it('handles files without extension', () => {
      const key = generateStorageKey('noextension');
      expect(key).toMatch(/^\d{4}\/\d{2}\/\d{2}\/[\w-]+$/);
    });

    it('generates unique keys', () => {
      const key1 = generateStorageKey('test.pdf');
      const key2 = generateStorageKey('test.pdf');
      expect(key1).not.toBe(key2);
    });
  });

  describe('calculateChecksum', () => {
    it('calculates SHA256 checksum', () => {
      const data = Buffer.from('hello world');
      const checksum = calculateChecksum(data);
      expect(checksum).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
    });

    it('produces different checksums for different data', () => {
      const checksum1 = calculateChecksum(Buffer.from('data1'));
      const checksum2 = calculateChecksum(Buffer.from('data2'));
      expect(checksum1).not.toBe(checksum2);
    });
  });

  describe('uploadFile', () => {
    it('uploads a file and stores metadata', async () => {
      const data = Buffer.from('test file content');
      const result = await uploadFile(pool, mockStorage, {
        filename: 'test.txt',
        content_type: 'text/plain',
        data,
        uploaded_by: 'test@example.com',
      });

      expect(result.id).toBeDefined();
      expect(result.storage_key).toMatch(/^\d{4}\/\d{2}\/\d{2}\/[\w-]+\.txt$/);
      expect(result.original_filename).toBe('test.txt');
      expect(result.content_type).toBe('text/plain');
      expect(result.size_bytes).toBe(data.length);
      expect(result.checksum_sha256).toBeDefined();
      expect(result.created_at).toBeInstanceOf(Date);
    });

    it('throws FileTooLargeError for oversized files', async () => {
      const data = Buffer.alloc(100); // 100 bytes
      await expect(
        uploadFile(
          pool,
          mockStorage,
          {
            filename: 'large.txt',
            content_type: 'text/plain',
            data,
          },
          50,
        ), // max 50 bytes
      ).rejects.toThrow(FileTooLargeError);
    });

    it('stores file in mock storage', async () => {
      const data = Buffer.from('content');
      const result = await uploadFile(pool, mockStorage, {
        filename: 'stored.txt',
        content_type: 'text/plain',
        data,
      });

      expect(await mockStorage.exists(result.storage_key)).toBe(true);
    });
  });

  describe('getFileMetadata', () => {
    it('retrieves file metadata', async () => {
      const data = Buffer.from('test');
      const uploaded = await uploadFile(pool, mockStorage, {
        filename: 'meta.txt',
        content_type: 'text/plain',
        data,
        uploaded_by: 'user@test.com',
      });

      const metadata = await getFileMetadata(pool, uploaded.id);
      expect(metadata).not.toBeNull();
      expect(metadata?.id).toBe(uploaded.id);
      expect(metadata?.original_filename).toBe('meta.txt');
      expect(metadata?.content_type).toBe('text/plain');
      expect(metadata?.size_bytes).toBe(data.length);
      expect(metadata?.uploaded_by).toBe('user@test.com');
    });

    it('returns null for non-existent file', async () => {
      const metadata = await getFileMetadata(pool, '00000000-0000-0000-0000-000000000000');
      expect(metadata).toBeNull();
    });
  });

  describe('downloadFile', () => {
    it('downloads file data and metadata', async () => {
      const data = Buffer.from('download test');
      const uploaded = await uploadFile(pool, mockStorage, {
        filename: 'download.txt',
        content_type: 'text/plain',
        data,
      });

      const result = await downloadFile(pool, mockStorage, uploaded.id);
      expect(result.data.toString()).toBe('download test');
      expect(result.metadata.original_filename).toBe('download.txt');
    });

    it('throws FileNotFoundError for non-existent file', async () => {
      await expect(downloadFile(pool, mockStorage, '00000000-0000-0000-0000-000000000000')).rejects.toThrow(FileNotFoundError);
    });
  });

  describe('getFileUrl', () => {
    it('returns signed URL for file', async () => {
      const data = Buffer.from('url test');
      const uploaded = await uploadFile(pool, mockStorage, {
        filename: 'url.txt',
        content_type: 'text/plain',
        data,
      });

      const result = await getFileUrl(pool, mockStorage, uploaded.id, 3600);
      expect(result.url).toContain('mock-storage.example.com');
      expect(result.url).toContain('expires=3600');
      expect(result.metadata.original_filename).toBe('url.txt');
    });

    it('throws FileNotFoundError for non-existent file', async () => {
      await expect(getFileUrl(pool, mockStorage, '00000000-0000-0000-0000-000000000000')).rejects.toThrow(FileNotFoundError);
    });
  });

  describe('deleteFile', () => {
    it('deletes file from storage and database', async () => {
      const data = Buffer.from('delete test');
      const uploaded = await uploadFile(pool, mockStorage, {
        filename: 'delete.txt',
        content_type: 'text/plain',
        data,
      });

      const deleted = await deleteFile(pool, mockStorage, uploaded.id);
      expect(deleted).toBe(true);

      // Verify deleted from database
      const metadata = await getFileMetadata(pool, uploaded.id);
      expect(metadata).toBeNull();

      // Verify deleted from storage
      expect(await mockStorage.exists(uploaded.storage_key)).toBe(false);
    });

    it('returns false for non-existent file', async () => {
      const deleted = await deleteFile(pool, mockStorage, '00000000-0000-0000-0000-000000000000');
      expect(deleted).toBe(false);
    });
  });

  describe('listFiles', () => {
    it('lists all files', async () => {
      // Upload several files
      await uploadFile(pool, mockStorage, {
        filename: 'file1.txt',
        content_type: 'text/plain',
        data: Buffer.from('1'),
      });
      await uploadFile(pool, mockStorage, {
        filename: 'file2.txt',
        content_type: 'text/plain',
        data: Buffer.from('2'),
      });
      await uploadFile(pool, mockStorage, {
        filename: 'file3.txt',
        content_type: 'text/plain',
        data: Buffer.from('3'),
      });

      const result = await listFiles(pool);
      expect(result.files.length).toBe(3);
      expect(result.total).toBe(3);
    });

    it('supports pagination', async () => {
      for (let i = 0; i < 5; i++) {
        await uploadFile(pool, mockStorage, {
          filename: `file${i}.txt`,
          content_type: 'text/plain',
          data: Buffer.from(`${i}`),
        });
      }

      const result = await listFiles(pool, { limit: 2, offset: 0 });
      expect(result.files.length).toBe(2);
      expect(result.total).toBe(5);
    });

    it('filters by uploaded_by', async () => {
      await uploadFile(pool, mockStorage, {
        filename: 'user1.txt',
        content_type: 'text/plain',
        data: Buffer.from('1'),
        uploaded_by: 'user1@test.com',
      });
      await uploadFile(pool, mockStorage, {
        filename: 'user2.txt',
        content_type: 'text/plain',
        data: Buffer.from('2'),
        uploaded_by: 'user2@test.com',
      });

      const result = await listFiles(pool, { uploaded_by: 'user1@test.com' });
      expect(result.files.length).toBe(1);
      expect(result.files[0].uploaded_by).toBe('user1@test.com');
    });
  });
});
