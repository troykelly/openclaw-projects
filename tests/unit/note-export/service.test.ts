import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the generators to avoid requiring Chromium/pandoc in unit tests
vi.mock('../../../src/api/note-export/generators/pdf.ts', () => ({
  generatePdf: vi.fn().mockResolvedValue(Buffer.from('mock-pdf')),
  sanitiseHtml: vi.fn((html: string) => html),
  resolveChromiumPath: vi.fn().mockReturnValue('/usr/bin/chromium'),
}));

vi.mock('../../../src/api/note-export/generators/docx.ts', () => ({
  generateDocx: vi.fn().mockResolvedValue(Buffer.from('mock-docx')),
}));

vi.mock('../../../src/api/note-export/generators/odf.ts', () => ({
  generateOdf: vi.fn().mockResolvedValue(Buffer.from('mock-odf')),
  resolvePandocPath: vi.fn().mockReturnValue('/usr/bin/pandoc'),
}));

vi.mock('../../../src/api/note-export/lexical-serialiser.ts', () => ({
  serialiseToHtml: vi.fn().mockResolvedValue('<p>Hello</p>'),
  serialiseToMarkdown: vi.fn().mockResolvedValue('# Hello'),
}));

import {
  createExportJob,
  getExportById,
  runExportJob,
  getDownloadUrl,
} from '../../../src/api/note-export/service.ts';

/** Creates a mock Pool */
function createMockPool() {
  const queryResults: Array<{ rows: Record<string, unknown>[]; rowCount: number }> = [];

  const queryFn = vi.fn().mockImplementation((_sql: string, _params?: unknown[]) => {
    if (queryResults.length > 0) {
      return Promise.resolve(queryResults.shift());
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });

  const pool = {
    query: queryFn,
    connect: vi.fn().mockResolvedValue({
      query: queryFn,
      release: vi.fn(),
    }),
    pushResult(result: { rows: Record<string, unknown>[]; rowCount: number }) {
      queryResults.push(result);
    },
  };

  return pool;
}

/** Creates a mock FileStorage */
function createMockStorage() {
  return {
    upload: vi.fn().mockResolvedValue('ok'),
    download: vi.fn().mockResolvedValue(Buffer.from('')),
    getSignedUrl: vi.fn().mockResolvedValue('https://signed.url/key'),
    getExternalSignedUrl: vi.fn().mockResolvedValue('https://external.url/key'),
    delete: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(true),
  };
}

describe('Export Service', () => {
  describe('createExportJob', () => {
    it('inserts note_export and internal_job records in a transaction', async () => {
      const pool = createMockPool();
      const now = new Date();

      // Result for BEGIN
      pool.pushResult({ rows: [], rowCount: 0 });

      // Result for INSERT INTO note_export
      pool.pushResult({
        rows: [{
          id: 'export-1',
          namespace: 'default',
          requested_by: 'user@test.com',
          source_type: 'note',
          source_id: 'note-1',
          format: 'pdf',
          options: {},
          status: 'pending',
          error_message: null,
          storage_key: null,
          original_filename: null,
          size_bytes: null,
          attempt_count: 0,
          started_at: null,
          expires_at: now.toISOString(),
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
        }],
        rowCount: 1,
      });

      // Result for INSERT INTO internal_job
      pool.pushResult({ rows: [], rowCount: 1 });

      // Result for COMMIT
      pool.pushResult({ rows: [], rowCount: 0 });

      // Result for NOTIFY (on pool, not client)
      pool.pushResult({ rows: [], rowCount: 0 });

      const result = await createExportJob(pool as unknown as import('pg').Pool, {
        namespace: 'default',
        requested_by: 'user@test.com',
        source_type: 'note',
        source_id: 'note-1',
        format: 'pdf',
      });

      expect(result.id).toBe('export-1');
      expect(result.status).toBe('pending');
      expect(result.format).toBe('pdf');

      // Should have used pool.connect for transaction
      expect(pool.connect).toHaveBeenCalledTimes(1);
    });
  });

  describe('getDownloadUrl', () => {
    it('returns presigned URL for owner', async () => {
      const pool = createMockPool();
      const storage = createMockStorage();

      pool.pushResult({
        rows: [{
          id: 'export-1',
          namespace: 'default',
          requested_by: 'user@test.com',
          source_type: 'note',
          source_id: 'note-1',
          format: 'pdf',
          options: {},
          status: 'ready',
          error_message: null,
          storage_key: 'exports/default/note/note-1/export-1.pdf',
          original_filename: 'test.pdf',
          size_bytes: 1234,
          attempt_count: 1,
          started_at: new Date().toISOString(),
          expires_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }],
        rowCount: 1,
      });

      const url = await getDownloadUrl(
        pool as unknown as import('pg').Pool,
        storage,
        'export-1',
        'user@test.com',
      );

      expect(url).toBe('https://external.url/key');
      expect(storage.getExternalSignedUrl).toHaveBeenCalled();
    });

    it('rejects access from non-owner', async () => {
      const pool = createMockPool();
      const storage = createMockStorage();

      pool.pushResult({
        rows: [{
          id: 'export-1',
          namespace: 'default',
          requested_by: 'owner@test.com',
          source_type: 'note',
          source_id: 'note-1',
          format: 'pdf',
          options: {},
          status: 'ready',
          storage_key: 'exports/key.pdf',
          original_filename: 'test.pdf',
          size_bytes: 1234,
          attempt_count: 1,
          started_at: new Date().toISOString(),
          expires_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }],
        rowCount: 1,
      });

      await expect(
        getDownloadUrl(
          pool as unknown as import('pg').Pool,
          storage,
          'export-1',
          'other@test.com',
        ),
      ).rejects.toThrow('Access denied');
    });

    it('rejects download for non-ready export', async () => {
      const pool = createMockPool();
      const storage = createMockStorage();

      pool.pushResult({
        rows: [{
          id: 'export-1',
          namespace: 'default',
          requested_by: 'user@test.com',
          source_type: 'note',
          source_id: 'note-1',
          format: 'pdf',
          options: {},
          status: 'generating',
          storage_key: null,
          original_filename: null,
          size_bytes: null,
          attempt_count: 1,
          started_at: new Date().toISOString(),
          expires_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }],
        rowCount: 1,
      });

      await expect(
        getDownloadUrl(
          pool as unknown as import('pg').Pool,
          storage,
          'export-1',
          'user@test.com',
        ),
      ).rejects.toThrow('not ready');
    });
  });

  describe('runExportJob', () => {
    it('transitions status through generating to ready', async () => {
      const pool = createMockPool();
      const storage = createMockStorage();

      // getExportById query
      pool.pushResult({
        rows: [{
          id: 'export-1',
          namespace: 'default',
          requested_by: 'user@test.com',
          source_type: 'note',
          source_id: 'note-1',
          format: 'docx',
          options: {},
          status: 'pending',
          error_message: null,
          storage_key: null,
          original_filename: null,
          size_bytes: null,
          attempt_count: 0,
          started_at: null,
          expires_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }],
        rowCount: 1,
      });

      // UPDATE to generating
      pool.pushResult({ rows: [], rowCount: 1 });

      // SELECT note content
      pool.pushResult({
        rows: [{ title: 'Test Note', content: '# Hello' }],
        rowCount: 1,
      });

      // UPDATE to ready
      pool.pushResult({ rows: [], rowCount: 1 });

      await runExportJob(
        pool as unknown as import('pg').Pool,
        storage,
        'export-1',
      );

      // Should have uploaded to S3
      expect(storage.upload).toHaveBeenCalledTimes(1);

      // Verify the queries: getExportById, UPDATE generating, SELECT note, UPDATE ready
      expect(pool.query).toHaveBeenCalledTimes(4);
    });

    it('sets status to failed on error', async () => {
      const pool = createMockPool();
      const storage = createMockStorage();
      storage.upload.mockRejectedValue(new Error('S3 timeout'));

      // getExportById
      pool.pushResult({
        rows: [{
          id: 'export-1',
          namespace: 'default',
          requested_by: 'user@test.com',
          source_type: 'note',
          source_id: 'note-1',
          format: 'pdf',
          options: {},
          status: 'pending',
          error_message: null,
          storage_key: null,
          original_filename: null,
          size_bytes: null,
          attempt_count: 0,
          started_at: null,
          expires_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }],
        rowCount: 1,
      });

      // UPDATE to generating
      pool.pushResult({ rows: [], rowCount: 1 });

      // SELECT note content
      pool.pushResult({
        rows: [{ title: 'Test Note', content: '# Hello' }],
        rowCount: 1,
      });

      // UPDATE to failed
      pool.pushResult({ rows: [], rowCount: 1 });

      await expect(
        runExportJob(pool as unknown as import('pg').Pool, storage, 'export-1'),
      ).rejects.toThrow('S3 timeout');
    });

    it('rejects export that exceeded max retries', async () => {
      const pool = createMockPool();
      const storage = createMockStorage();

      // getExportById - already at max retries
      pool.pushResult({
        rows: [{
          id: 'export-1',
          namespace: 'default',
          requested_by: 'user@test.com',
          source_type: 'note',
          source_id: 'note-1',
          format: 'pdf',
          options: {},
          status: 'generating',
          error_message: null,
          storage_key: null,
          original_filename: null,
          size_bytes: null,
          attempt_count: 3, // at max retries
          started_at: new Date().toISOString(),
          expires_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }],
        rowCount: 1,
      });

      // UPDATE to failed
      pool.pushResult({ rows: [], rowCount: 1 });

      // Should not throw - just marks as failed
      await runExportJob(pool as unknown as import('pg').Pool, storage, 'export-1');

      // Should have updated status to failed
      expect(pool.query).toHaveBeenCalledTimes(2);
    });
  });
});
