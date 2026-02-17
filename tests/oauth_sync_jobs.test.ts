/**
 * Integration tests for OAuth sync job infrastructure.
 * Tests the migration, pgcron enqueue function, job handler, and sync lifecycle.
 * Part of Issue #1055.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { encryptToken } from '../src/api/oauth/crypto.ts';

describe('OAuth sync job infrastructure', () => {
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  /**
   * Helper to create a test OAuth connection with encrypted tokens.
   */
  async function createTestConnection(overrides: {
    enabled_features?: string[];
    is_active?: boolean;
    sync_status?: Record<string, unknown>;
    provider?: string;
    user_email?: string;
  } = {}): Promise<string> {
    const features = overrides.enabled_features ?? ['contacts'];
    const is_active = overrides.is_active ?? true;
    const sync_status = overrides.sync_status ?? {};
    const provider = overrides.provider ?? 'google';
    const user_email = overrides.user_email ?? 'test@example.com';

    // Insert with placeholder tokens, then encrypt using the row ID
    const result = await pool.query(
      `INSERT INTO oauth_connection (
         user_email, provider, access_token, refresh_token, scopes,
         enabled_features, is_active, sync_status
       )
       VALUES ($1, $2, 'placeholder', 'placeholder', ARRAY['contacts.read'], $3, $4, $5::jsonb)
       RETURNING id::text as id`,
      [user_email, provider, features, is_active, JSON.stringify(sync_status)],
    );

    const id = (result.rows[0] as { id: string }).id;

    // Encrypt tokens with the row ID as salt
    const encryptedAccess = encryptToken('fake-access-token', id);
    const encryptedRefresh = encryptToken('fake-refresh-token', id);

    await pool.query(
      `UPDATE oauth_connection SET access_token = $1, refresh_token = $2 WHERE id = $3`,
      [encryptedAccess, encryptedRefresh, id],
    );

    return id;
  }

  describe('enqueue_oauth_contact_sync_jobs() SQL function', () => {
    it('enqueues a job for active connections with contacts enabled', async () => {
      const connection_id = await createTestConnection({ enabled_features: ['contacts'] });

      const result = await pool.query('SELECT enqueue_oauth_contact_sync_jobs()');
      const count = (result.rows[0] as { enqueue_oauth_contact_sync_jobs: number }).enqueue_oauth_contact_sync_jobs;

      expect(count).toBe(1);

      // Verify the job was created
      const jobs = await pool.query(
        `SELECT kind, payload->>'connection_id' as connection_id, payload->>'feature' as feature
         FROM internal_job
         WHERE kind = 'oauth.sync.contacts'`,
      );

      expect(jobs.rows).toHaveLength(1);
      expect(jobs.rows[0]).toEqual({
        kind: 'oauth.sync.contacts',
        connection_id: connection_id,
        feature: 'contacts',
      });
    });

    it('is idempotent — does not duplicate jobs', async () => {
      await createTestConnection({ enabled_features: ['contacts'] });

      await pool.query('SELECT enqueue_oauth_contact_sync_jobs()');
      await pool.query('SELECT enqueue_oauth_contact_sync_jobs()');

      const jobs = await pool.query(
        `SELECT COUNT(*) as count FROM internal_job WHERE kind = 'oauth.sync.contacts'`,
      );

      expect(parseInt((jobs.rows[0] as { count: string }).count, 10)).toBe(1);
    });

    it('skips inactive connections', async () => {
      await createTestConnection({ enabled_features: ['contacts'], is_active: false });

      const result = await pool.query('SELECT enqueue_oauth_contact_sync_jobs()');
      const count = (result.rows[0] as { enqueue_oauth_contact_sync_jobs: number }).enqueue_oauth_contact_sync_jobs;

      expect(count).toBe(0);
    });

    it('skips connections without contacts feature', async () => {
      await createTestConnection({ enabled_features: ['email'] });

      const result = await pool.query('SELECT enqueue_oauth_contact_sync_jobs()');
      const count = (result.rows[0] as { enqueue_oauth_contact_sync_jobs: number }).enqueue_oauth_contact_sync_jobs;

      expect(count).toBe(0);
    });

    it('skips connections that synced recently', async () => {
      const recentSync = new Date().toISOString();
      await createTestConnection({
        enabled_features: ['contacts'],
        sync_status: {
          contacts: {
            lastSuccess: recentSync,
            consecutiveFailures: 0,
          },
        },
      });

      const result = await pool.query('SELECT enqueue_oauth_contact_sync_jobs()');
      const count = (result.rows[0] as { enqueue_oauth_contact_sync_jobs: number }).enqueue_oauth_contact_sync_jobs;

      expect(count).toBe(0);
    });

    it('enqueues for connections with stale last sync', async () => {
      const staleSync = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(); // 7 hours ago
      await createTestConnection({
        enabled_features: ['contacts'],
        sync_status: {
          contacts: {
            lastSuccess: staleSync,
            consecutiveFailures: 0,
          },
        },
      });

      const result = await pool.query('SELECT enqueue_oauth_contact_sync_jobs()');
      const count = (result.rows[0] as { enqueue_oauth_contact_sync_jobs: number }).enqueue_oauth_contact_sync_jobs;

      expect(count).toBe(1);
    });

    it('enqueues for multiple connections', async () => {
      await createTestConnection({ enabled_features: ['contacts'], user_email: 'a@test.com' });
      await createTestConnection({ enabled_features: ['contacts'], user_email: 'b@test.com' });
      await createTestConnection({ enabled_features: ['email'], user_email: 'c@test.com' }); // no contacts

      const result = await pool.query('SELECT enqueue_oauth_contact_sync_jobs()');
      const count = (result.rows[0] as { enqueue_oauth_contact_sync_jobs: number }).enqueue_oauth_contact_sync_jobs;

      expect(count).toBe(2);
    });
  });

  describe('pgcron job registration', () => {
    it('registers the oauth_contact_sync_enqueue cron job', async () => {
      const result = await pool.query(
        `SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'oauth_contact_sync_enqueue'`,
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({
        jobname: 'oauth_contact_sync_enqueue',
        schedule: '*/5 * * * *',
      });
      expect((result.rows[0] as { command: string }).command).toContain('enqueue_oauth_contact_sync_jobs');
    });
  });

  describe('enqueueSyncJob', () => {
    it('creates an internal_job for a connection', async () => {
      const { enqueueSyncJob } = await import('../src/api/oauth/sync.ts');
      const connection_id = await createTestConnection();

      const jobId = await enqueueSyncJob(pool, connection_id, 'contacts');
      expect(jobId).toBeTruthy();

      const job = await pool.query(
        `SELECT kind, payload->>'connection_id' as connection_id
         FROM internal_job WHERE id = $1::uuid`,
        [jobId],
      );

      expect(job.rows[0]).toEqual({
        kind: 'oauth.sync.contacts',
        connection_id: connection_id,
      });
    });

    it('returns null for duplicate jobs (idempotency)', async () => {
      const { enqueueSyncJob } = await import('../src/api/oauth/sync.ts');
      const connection_id = await createTestConnection();

      const firstId = await enqueueSyncJob(pool, connection_id, 'contacts');
      const secondId = await enqueueSyncJob(pool, connection_id, 'contacts');

      expect(firstId).toBeTruthy();
      expect(secondId).toBeNull();
    });
  });

  describe('removePendingSyncJobs', () => {
    it('removes pending sync jobs for a connection', async () => {
      const { enqueueSyncJob, removePendingSyncJobs } = await import('../src/api/oauth/sync.ts');
      const connection_id = await createTestConnection();

      await enqueueSyncJob(pool, connection_id, 'contacts');

      const removed = await removePendingSyncJobs(pool, connection_id);
      expect(removed).toBe(1);

      const remaining = await pool.query(
        `SELECT COUNT(*) as count FROM internal_job
         WHERE kind = 'oauth.sync.contacts' AND completed_at IS NULL`,
      );
      expect(parseInt((remaining.rows[0] as { count: string }).count, 10)).toBe(0);
    });

    it('does not remove jobs for other connections', async () => {
      const { enqueueSyncJob, removePendingSyncJobs } = await import('../src/api/oauth/sync.ts');
      const conn1 = await createTestConnection({ user_email: 'a@test.com' });
      const conn2 = await createTestConnection({ user_email: 'b@test.com' });

      await enqueueSyncJob(pool, conn1, 'contacts');
      await enqueueSyncJob(pool, conn2, 'contacts');

      const removed = await removePendingSyncJobs(pool, conn1);
      expect(removed).toBe(1);

      const remaining = await pool.query(
        `SELECT COUNT(*) as count FROM internal_job
         WHERE kind = 'oauth.sync.contacts' AND completed_at IS NULL`,
      );
      expect(parseInt((remaining.rows[0] as { count: string }).count, 10)).toBe(1);
    });
  });

  describe('updateFeatureSyncStatus', () => {
    it('updates sync_status for a specific feature', async () => {
      const { updateFeatureSyncStatus } = await import('../src/api/oauth/sync.ts');
      const connection_id = await createTestConnection();

      await updateFeatureSyncStatus(pool, connection_id, 'contacts', {
        lastSync: '2026-01-01T00:00:00Z',
        lastSuccess: '2026-01-01T00:00:00Z',
        consecutiveFailures: 0,
        cursor: 'cursor-123',
      });

      const result = await pool.query(
        `SELECT sync_status FROM oauth_connection WHERE id = $1::uuid`,
        [connection_id],
      );

      const status = (result.rows[0] as { sync_status: Record<string, unknown> }).sync_status;
      const contacts = status.contacts as Record<string, unknown>;
      expect(contacts.lastSync).toBe('2026-01-01T00:00:00Z');
      expect(contacts.consecutiveFailures).toBe(0);
      expect(contacts.cursor).toBe('cursor-123');
    });

    it('preserves other feature statuses when updating one', async () => {
      const { updateFeatureSyncStatus } = await import('../src/api/oauth/sync.ts');
      const connection_id = await createTestConnection({
        sync_status: { email: { lastSync: '2026-01-01T00:00:00Z' } },
      });

      await updateFeatureSyncStatus(pool, connection_id, 'contacts', {
        lastSync: '2026-02-01T00:00:00Z',
        consecutiveFailures: 0,
      });

      const result = await pool.query(
        `SELECT sync_status FROM oauth_connection WHERE id = $1::uuid`,
        [connection_id],
      );

      const status = (result.rows[0] as { sync_status: Record<string, unknown> }).sync_status;
      expect(status.email).toBeDefined();
      expect(status.contacts).toBeDefined();
    });
  });

  describe('getSyncStatus', () => {
    it('returns sync status for a connection', async () => {
      const { getSyncStatus, updateFeatureSyncStatus } = await import('../src/api/oauth/sync.ts');
      const connection_id = await createTestConnection();

      await updateFeatureSyncStatus(pool, connection_id, 'contacts', {
        lastSync: '2026-01-01T00:00:00Z',
        consecutiveFailures: 0,
      });

      const status = await getSyncStatus(pool, connection_id);
      expect(status).toBeTruthy();
      expect(status?.contacts).toBeDefined();
    });

    it('returns null for non-existent connection', async () => {
      const { getSyncStatus } = await import('../src/api/oauth/sync.ts');
      const status = await getSyncStatus(pool, '00000000-0000-0000-0000-000000000000');
      expect(status).toBeNull();
    });
  });

  describe('handleContactSyncJob', () => {
    it('returns failure for missing connection_id in payload', async () => {
      const { handleContactSyncJob } = await import('../src/api/jobs/sync-handler.ts');

      const result = await handleContactSyncJob(pool, {
        id: 'test-id',
        kind: 'oauth.sync.contacts',
        runAt: new Date(),
        payload: {},
        attempts: 0,
        lastError: null,
        lockedAt: null,
        lockedBy: null,
        completed_at: null,
        idempotency_key: null,
        created_at: new Date(),
        updated_at: new Date(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('missing connection_id');
    });
  });

  describe('executeContactSync', () => {
    it('returns failure for non-existent connection', async () => {
      const { executeContactSync } = await import('../src/api/oauth/sync.ts');

      const result = await executeContactSync(pool, '00000000-0000-0000-0000-000000000000');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('returns failure for inactive connection', async () => {
      const { executeContactSync } = await import('../src/api/oauth/sync.ts');
      const connection_id = await createTestConnection({ is_active: false });

      const result = await executeContactSync(pool, connection_id);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not active');
    });

    it('returns failure for connection without contacts feature', async () => {
      const { executeContactSync } = await import('../src/api/oauth/sync.ts');
      const connection_id = await createTestConnection({ enabled_features: ['email'] });

      const result = await executeContactSync(pool, connection_id);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not enabled');
    });

    it('skips sync when interval has not elapsed', async () => {
      const { executeContactSync } = await import('../src/api/oauth/sync.ts');
      const recentSync = new Date().toISOString();
      const connection_id = await createTestConnection({
        enabled_features: ['contacts'],
        sync_status: {
          contacts: {
            lastSuccess: recentSync,
            consecutiveFailures: 0,
          },
        },
      });

      const result = await executeContactSync(pool, connection_id);

      // Should succeed (not an error) but without syncing
      expect(result.error).toBeUndefined();
      expect(result.success).toBe(true);
      expect(result.synced_count).toBeUndefined();
    });
  });
});
