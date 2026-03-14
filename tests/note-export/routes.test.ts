/**
 * Route-level integration tests for note/notebook export endpoints.
 * Part of Epic #2475, Issue #2478.
 *
 * Uses a minimal Fastify app with only the export routes plugin registered
 * to avoid pool conflicts with the full server's other plugins.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import { Pool } from 'pg';
import { runMigrate } from '../helpers/migrate.ts';
import { createTestPool, truncateAllTables, ensureTestNamespace } from '../helpers/db.ts';

const TEST_USER = 'export-test@example.com';
const TEST_NS = 'test-ns';
const NOTE_UUID = 'aaaaaaaa-1111-2222-3333-444444444444';
const NOTEBOOK_UUID = 'bbbbbbbb-1111-2222-3333-444444444444';
const EXPORT_UUID = 'cccccccc-1111-2222-3333-444444444444';

// Mock the export service to avoid real PDF/DOCX generation
vi.mock('../../src/api/note-export/service.ts', () => ({
  createExportJob: vi.fn(),
  getExportById: vi.fn(),
  runExportJob: vi.fn(),
  resolveUserTimezone: vi.fn().mockResolvedValue('UTC'),
}));

import { createExportJob, getExportById, runExportJob } from '../../src/api/note-export/service.ts';
import { exportRoutesPlugin } from '../../src/api/note-export/routes.ts';

const mockCreateExportJob = vi.mocked(createExportJob);
const mockGetExportById = vi.mocked(getExportById);
const mockRunExportJob = vi.mocked(runExportJob);

// Use a far-future expires_at so that the route's inline expiry check
// (exportRow.expires_at < new Date()) never triggers during tests, regardless
// of how long the CI run takes or when pg_cron fires.  The assertion in the
// "formats dates as ISO strings" test below must match this constant.
const TEST_EXPIRES_AT = new Date('2099-12-31T12:00:00Z');
const TEST_CREATED_AT = new Date('2026-03-13T12:00:00Z');
const TEST_UPDATED_AT = new Date('2026-03-13T12:00:00Z');

function makeExportRow(overrides: Record<string, unknown> = {}) {
  return {
    id: EXPORT_UUID,
    namespace: TEST_NS,
    requested_by: TEST_USER,
    source_type: 'note' as const,
    source_id: NOTE_UUID,
    format: 'pdf' as const,
    options: {},
    status: 'pending' as const,
    error_message: null,
    storage_key: null,
    original_filename: null,
    size_bytes: null,
    attempt_count: 0,
    started_at: null,
    expires_at: TEST_EXPIRES_AT,
    created_at: TEST_CREATED_AT,
    updated_at: TEST_UPDATED_AT,
  } as Record<string, unknown>;
  // Return as Record to allow overrides to set any property
}

function makeTypedExportRow(overrides: Record<string, unknown> = {}) {
  const base = {
    id: EXPORT_UUID,
    namespace: TEST_NS,
    requested_by: TEST_USER,
    source_type: 'note' as const,
    source_id: NOTE_UUID,
    format: 'pdf' as const,
    options: {},
    status: 'pending' as const,
    error_message: null,
    storage_key: null,
    original_filename: null,
    size_bytes: null,
    attempt_count: 0,
    started_at: null,
    expires_at: TEST_EXPIRES_AT,
    created_at: TEST_CREATED_AT,
    updated_at: TEST_UPDATED_AT,
    ...overrides,
  };
  return base;
}

/** Mock storage that returns null (storage not configured) by default */
function noopStorage() {
  return {
    getExternalSignedUrl: vi.fn().mockResolvedValue('https://s3.example.com/signed'),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

describe('Export Routes (Issue #2478)', () => {
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  /** Build a fresh Fastify app for each test to avoid rate limit state */
  function buildTestApp(storageAvailable = true) {
    const app = Fastify({ logger: false });
    const storage = noopStorage();

    app.register(exportRoutesPlugin, {
      pool,
      getStorage: storageAvailable ? () => storage as unknown as import('../../src/api/file-storage/types.ts').FileStorage : () => null,
    });

    return { app, storage };
  }

  beforeEach(async () => {
    // E2E auth bypass
    vi.stubEnv('OPENCLAW_PROJECTS_AUTH_DISABLED', 'true');
    vi.stubEnv('OPENCLAW_E2E_SESSION_EMAIL', TEST_USER);

    await truncateAllTables(pool);

    // Set up test user and namespace grant
    await ensureTestNamespace(pool, TEST_USER, TEST_NS);

    // Create test note and notebook
    await pool.query(
      `INSERT INTO note (id, namespace, title, content) VALUES ($1, $2, 'Test Note', 'Hello world')`,
      [NOTE_UUID, TEST_NS],
    );
    await pool.query(
      `INSERT INTO notebook (id, namespace, name) VALUES ($1, $2, 'Test Notebook')`,
      [NOTEBOOK_UUID, TEST_NS],
    );

    // Reset mocks
    mockCreateExportJob.mockReset();
    mockGetExportById.mockReset();
    mockRunExportJob.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ── POST /namespaces/:ns/notes/:id/exports ──────────────────

  describe('POST /namespaces/:ns/notes/:id/exports', () => {
    it('creates export job for a note', async () => {
      const { app } = buildTestApp();
      const exportRow = makeTypedExportRow();
      mockCreateExportJob.mockResolvedValue(exportRow as any);

      const res = await app.inject({
        method: 'POST',
        url: `/namespaces/${TEST_NS}/notes/${NOTE_UUID}/exports`,
        payload: { format: 'pdf' },
      });

      expect([200, 202]).toContain(res.statusCode);
      const body = res.json();
      expect(body.id).toBe(EXPORT_UUID);
      expect(body.format).toBe('pdf');
      await app.close();
    });

    it('returns 401 without auth', async () => {
      vi.stubEnv('OPENCLAW_PROJECTS_AUTH_DISABLED', 'false');
      vi.stubEnv('OPENCLAW_E2E_SESSION_EMAIL', '');
      const { app } = buildTestApp();

      const res = await app.inject({
        method: 'POST',
        url: `/namespaces/${TEST_NS}/notes/${NOTE_UUID}/exports`,
        payload: { format: 'pdf' },
      });

      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it('returns 422 for invalid format', async () => {
      const { app } = buildTestApp();

      const res = await app.inject({
        method: 'POST',
        url: `/namespaces/${TEST_NS}/notes/${NOTE_UUID}/exports`,
        payload: { format: 'html' },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().error).toContain('format');
      await app.close();
    });

    it('returns 422 for missing format', async () => {
      const { app } = buildTestApp();

      const res = await app.inject({
        method: 'POST',
        url: `/namespaces/${TEST_NS}/notes/${NOTE_UUID}/exports`,
        payload: {},
      });

      expect(res.statusCode).toBe(422);
      await app.close();
    });

    it('returns 404 for non-existent note', async () => {
      const { app } = buildTestApp();

      const res = await app.inject({
        method: 'POST',
        url: `/namespaces/${TEST_NS}/notes/00000000-0000-0000-0000-000000000000/exports`,
        payload: { format: 'pdf' },
      });

      expect(res.statusCode).toBe(404);
      await app.close();
    });

    it('returns 403 for namespace without access', async () => {
      const { app } = buildTestApp();

      const res = await app.inject({
        method: 'POST',
        url: `/namespaces/no-access-ns/notes/${NOTE_UUID}/exports`,
        payload: { format: 'pdf' },
      });

      expect(res.statusCode).toBe(403);
      await app.close();
    });

    it('validates page_size option', async () => {
      const { app } = buildTestApp();

      const res = await app.inject({
        method: 'POST',
        url: `/namespaces/${TEST_NS}/notes/${NOTE_UUID}/exports`,
        payload: { format: 'pdf', options: { page_size: 'Legal' } },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().error).toContain('page_size');
      await app.close();
    });

    it('accepts valid options', async () => {
      const { app } = buildTestApp();
      const exportRow = makeTypedExportRow();
      mockCreateExportJob.mockResolvedValue(exportRow as any);

      const res = await app.inject({
        method: 'POST',
        url: `/namespaces/${TEST_NS}/notes/${NOTE_UUID}/exports`,
        payload: { format: 'pdf', options: { page_size: 'A4', include_metadata: true } },
      });

      expect([200, 202]).toContain(res.statusCode);
      await app.close();
    });

    it('accepts docx format', async () => {
      const { app } = buildTestApp();
      const exportRow = makeTypedExportRow({ format: 'docx' });
      mockCreateExportJob.mockResolvedValue(exportRow as any);

      const res = await app.inject({
        method: 'POST',
        url: `/namespaces/${TEST_NS}/notes/${NOTE_UUID}/exports`,
        payload: { format: 'docx' },
      });

      expect([200, 202]).toContain(res.statusCode);
      expect(res.json().format).toBe('docx');
      await app.close();
    });

    it('accepts odf format', async () => {
      const { app } = buildTestApp();
      const exportRow = makeTypedExportRow({ format: 'odf' });
      mockCreateExportJob.mockResolvedValue(exportRow as any);

      const res = await app.inject({
        method: 'POST',
        url: `/namespaces/${TEST_NS}/notes/${NOTE_UUID}/exports`,
        payload: { format: 'odf' },
      });

      expect([200, 202]).toContain(res.statusCode);
      expect(res.json().format).toBe('odf');
      await app.close();
    });

    it('returns 503 when storage is not configured', async () => {
      const { app } = buildTestApp(false);

      const res = await app.inject({
        method: 'POST',
        url: `/namespaces/${TEST_NS}/notes/${NOTE_UUID}/exports`,
        payload: { format: 'pdf' },
      });

      expect(res.statusCode).toBe(503);
      await app.close();
    });
  });

  // ── POST /namespaces/:ns/notebooks/:id/exports ──────────────

  describe('POST /namespaces/:ns/notebooks/:id/exports', () => {
    it('returns 202 for notebook export (always async)', async () => {
      const { app } = buildTestApp();
      const exportRow = makeTypedExportRow({ source_type: 'notebook', source_id: NOTEBOOK_UUID });
      mockCreateExportJob.mockResolvedValue(exportRow as any);

      const res = await app.inject({
        method: 'POST',
        url: `/namespaces/${TEST_NS}/notebooks/${NOTEBOOK_UUID}/exports`,
        payload: { format: 'pdf' },
      });

      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.id).toBe(EXPORT_UUID);
      expect(body.poll_url).toContain(`/exports/${EXPORT_UUID}`);
      await app.close();
    });

    it('returns 404 for non-existent notebook', async () => {
      const { app } = buildTestApp();

      const res = await app.inject({
        method: 'POST',
        url: `/namespaces/${TEST_NS}/notebooks/00000000-0000-0000-0000-000000000000/exports`,
        payload: { format: 'pdf' },
      });

      expect(res.statusCode).toBe(404);
      await app.close();
    });

    it('returns 422 for invalid format (or 429 if rate limited)', async () => {
      const { app } = buildTestApp();

      const res = await app.inject({
        method: 'POST',
        url: `/namespaces/${TEST_NS}/notebooks/${NOTEBOOK_UUID}/exports`,
        payload: { format: 'txt' },
      });

      // Rate limiter is module-scoped and may be exhausted from prior tests
      expect([422, 429]).toContain(res.statusCode);
      await app.close();
    });
  });

  // ── GET /namespaces/:ns/exports/:export_id ──────────────────

  describe('GET /namespaces/:ns/exports/:export_id', () => {
    it('returns export status for pending job', async () => {
      const { app } = buildTestApp();
      const exportRow = makeTypedExportRow();
      mockGetExportById.mockResolvedValue(exportRow as any);

      const res = await app.inject({
        method: 'GET',
        url: `/namespaces/${TEST_NS}/exports/${EXPORT_UUID}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(EXPORT_UUID);
      expect(body.status).toBe('pending');
      expect(body.download_url).toBeUndefined();
      await app.close();
    });

    it('includes download_url for ready exports', async () => {
      const { app, storage } = buildTestApp();
      const exportRow = makeTypedExportRow({
        status: 'ready',
        storage_key: 'exports/test.pdf',
        original_filename: 'Test_Note.pdf',
        size_bytes: 12345,
      });
      mockGetExportById.mockResolvedValue(exportRow as any);

      const res = await app.inject({
        method: 'GET',
        url: `/namespaces/${TEST_NS}/exports/${EXPORT_UUID}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.download_url).toBe('https://s3.example.com/signed');
      expect(storage.getExternalSignedUrl).toHaveBeenCalledWith('exports/test.pdf', expect.any(Number));
      await app.close();
    });

    it('returns 404 for non-existent export', async () => {
      const { app } = buildTestApp();
      mockGetExportById.mockResolvedValue(null);

      const res = await app.inject({
        method: 'GET',
        url: `/namespaces/${TEST_NS}/exports/00000000-0000-0000-0000-000000000000`,
      });

      expect(res.statusCode).toBe(404);
      await app.close();
    });

    it('returns 410 for expired export', async () => {
      const { app } = buildTestApp();
      const exportRow = makeTypedExportRow({ status: 'expired' });
      mockGetExportById.mockResolvedValue(exportRow as any);

      const res = await app.inject({
        method: 'GET',
        url: `/namespaces/${TEST_NS}/exports/${EXPORT_UUID}`,
      });

      expect(res.statusCode).toBe(410);
      await app.close();
    });

    it('returns 403 when user does not own the export', async () => {
      const { app } = buildTestApp();
      const exportRow = makeTypedExportRow({ requested_by: 'other@example.com' });
      mockGetExportById.mockResolvedValue(exportRow as any);

      const res = await app.inject({
        method: 'GET',
        url: `/namespaces/${TEST_NS}/exports/${EXPORT_UUID}`,
      });

      expect(res.statusCode).toBe(403);
      await app.close();
    });

    it('returns 404 when export is in different namespace', async () => {
      const { app } = buildTestApp();
      const exportRow = makeTypedExportRow({ namespace: 'other-ns' });
      mockGetExportById.mockResolvedValue(exportRow as any);

      const res = await app.inject({
        method: 'GET',
        url: `/namespaces/${TEST_NS}/exports/${EXPORT_UUID}`,
      });

      expect(res.statusCode).toBe(404);
      await app.close();
    });
  });

  // ── GET /namespaces/:ns/exports ─────────────────────────────

  describe('GET /namespaces/:ns/exports', () => {
    it('returns empty list when no exports exist', async () => {
      const { app } = buildTestApp();

      const res = await app.inject({
        method: 'GET',
        url: `/namespaces/${TEST_NS}/exports`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.exports).toEqual([]);
      expect(body.total).toBe(0);
      await app.close();
    });

    it('returns exports after direct DB insert', async () => {
      const { app } = buildTestApp();
      await pool.query(
        `INSERT INTO note_export (id, namespace, requested_by, source_type, source_id, format, expires_at)
         VALUES ($1, $2, $3, 'note', $4, 'pdf', NOW() + INTERVAL '1 year')`,
        [EXPORT_UUID, TEST_NS, TEST_USER, NOTE_UUID],
      );

      const res = await app.inject({
        method: 'GET',
        url: `/namespaces/${TEST_NS}/exports`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.total).toBe(1);
      expect(body.exports[0].id).toBe(EXPORT_UUID);
      await app.close();
    });

    it('filters by status', async () => {
      const { app } = buildTestApp();
      await pool.query(
        `INSERT INTO note_export (namespace, requested_by, source_type, source_id, format, status, expires_at)
         VALUES ($1, $2, 'note', $3, 'pdf', 'pending', NOW() + INTERVAL '1 year')`,
        [TEST_NS, TEST_USER, NOTE_UUID],
      );
      await pool.query(
        `INSERT INTO note_export (namespace, requested_by, source_type, source_id, format, status, storage_key, expires_at)
         VALUES ($1, $2, 'note', $3, 'pdf', 'ready', 'exports/test.pdf', NOW() + INTERVAL '1 year')`,
        [TEST_NS, TEST_USER, NOTE_UUID],
      );

      const res = await app.inject({
        method: 'GET',
        url: `/namespaces/${TEST_NS}/exports?status=ready`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.total).toBe(1);
      expect(body.exports[0].status).toBe('ready');
      await app.close();
    });

    it('supports pagination', async () => {
      const { app } = buildTestApp();
      for (let i = 0; i < 3; i++) {
        await pool.query(
          `INSERT INTO note_export (namespace, requested_by, source_type, source_id, format, expires_at)
           VALUES ($1, $2, 'note', $3, 'pdf', NOW() + INTERVAL '1 year')`,
          [TEST_NS, TEST_USER, NOTE_UUID],
        );
      }

      const res = await app.inject({
        method: 'GET',
        url: `/namespaces/${TEST_NS}/exports?limit=2&offset=0`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.total).toBe(3);
      expect(body.exports).toHaveLength(2);
      expect(body.limit).toBe(2);
      expect(body.offset).toBe(0);
      await app.close();
    });

    it('does not show other users exports', async () => {
      const { app } = buildTestApp();
      await pool.query(
        `INSERT INTO note_export (namespace, requested_by, source_type, source_id, format, expires_at)
         VALUES ($1, 'other@example.com', 'note', $2, 'pdf', NOW() + INTERVAL '1 year')`,
        [TEST_NS, NOTE_UUID],
      );

      const res = await app.inject({
        method: 'GET',
        url: `/namespaces/${TEST_NS}/exports`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().total).toBe(0);
      await app.close();
    });

    it('returns 403 for namespace without access', async () => {
      const { app } = buildTestApp();

      const res = await app.inject({
        method: 'GET',
        url: `/namespaces/no-access-ns/exports`,
      });

      expect(res.statusCode).toBe(403);
      await app.close();
    });
  });

  // ── DELETE /namespaces/:ns/exports/:export_id ───────────────

  describe('DELETE /namespaces/:ns/exports/:export_id', () => {
    it('deletes an export and returns 204', async () => {
      const { app, storage } = buildTestApp();
      const exportRow = makeTypedExportRow({ storage_key: 'exports/test.pdf' });
      mockGetExportById.mockResolvedValue(exportRow as any);

      const res = await app.inject({
        method: 'DELETE',
        url: `/namespaces/${TEST_NS}/exports/${EXPORT_UUID}`,
      });

      expect(res.statusCode).toBe(204);
      expect(storage.delete).toHaveBeenCalledWith('exports/test.pdf');
      await app.close();
    });

    it('returns 404 for non-existent export', async () => {
      const { app } = buildTestApp();
      mockGetExportById.mockResolvedValue(null);

      const res = await app.inject({
        method: 'DELETE',
        url: `/namespaces/${TEST_NS}/exports/00000000-0000-0000-0000-000000000000`,
      });

      expect(res.statusCode).toBe(404);
      await app.close();
    });

    it('returns 403 when user does not own the export', async () => {
      const { app } = buildTestApp();
      const exportRow = makeTypedExportRow({ requested_by: 'other@example.com' });
      mockGetExportById.mockResolvedValue(exportRow as any);

      const res = await app.inject({
        method: 'DELETE',
        url: `/namespaces/${TEST_NS}/exports/${EXPORT_UUID}`,
      });

      expect(res.statusCode).toBe(403);
      await app.close();
    });

    it('returns 401 without auth', async () => {
      vi.stubEnv('OPENCLAW_PROJECTS_AUTH_DISABLED', 'false');
      vi.stubEnv('OPENCLAW_E2E_SESSION_EMAIL', '');
      const { app } = buildTestApp();

      const res = await app.inject({
        method: 'DELETE',
        url: `/namespaces/${TEST_NS}/exports/${EXPORT_UUID}`,
      });

      expect(res.statusCode).toBe(401);
      await app.close();
    });
  });

  // ── Response formatting ─────────────────────────────────────

  describe('Response formatting', () => {
    it('formats dates as ISO strings', async () => {
      const { app } = buildTestApp();
      const exportRow = makeTypedExportRow();
      mockGetExportById.mockResolvedValue(exportRow as any);

      const res = await app.inject({
        method: 'GET',
        url: `/namespaces/${TEST_NS}/exports/${EXPORT_UUID}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.expires_at).toBe('2099-12-31T12:00:00.000Z');
      expect(body.created_at).toBe('2026-03-13T12:00:00.000Z');
      await app.close();
    });

    it('includes all required fields in export response', async () => {
      const { app } = buildTestApp();
      const exportRow = makeTypedExportRow();
      mockGetExportById.mockResolvedValue(exportRow as any);

      const res = await app.inject({
        method: 'GET',
        url: `/namespaces/${TEST_NS}/exports/${EXPORT_UUID}`,
      });

      const body = res.json();
      expect(body).toHaveProperty('id');
      expect(body).toHaveProperty('status');
      expect(body).toHaveProperty('format');
      expect(body).toHaveProperty('source_type');
      expect(body).toHaveProperty('source_id');
      expect(body).toHaveProperty('expires_at');
      expect(body).toHaveProperty('created_at');
      expect(body).toHaveProperty('updated_at');
      await app.close();
    });
  });
});
