/**
 * OAuth sync job management.
 * Manages pgcron-based periodic sync jobs for OAuth connections.
 * Only contacts sync locally; email/files/calendar use live API access.
 * Part of Issue #1055.
 */

import type { Pool } from 'pg';
import type { OAuthConnection, OAuthFeature, ContactSyncResult } from './types.ts';
import { getConnection } from './service.ts';
import { syncContacts, getContactSyncCursor } from './contacts.ts';
import { enqueueWebhook } from '../webhooks/dispatcher.ts';
import { getWebhookDestination } from '../webhooks/payloads.ts';

/** Default sync intervals (can be overridden by env vars). */
const DEFAULT_CONTACT_SYNC_INTERVAL = '6 hours';

/** Maximum consecutive failures before user notification. */
const MAX_CONSECUTIVE_FAILURES = 3;

/** Sync job kinds for the internal_job table. */
export const SYNC_JOB_KIND = 'oauth.sync.contacts' as const;

/** Sync feature types that use local sync (not live API). */
export const LOCAL_SYNC_FEATURES = ['contacts'] as const;
export type LocalSyncFeature = (typeof LOCAL_SYNC_FEATURES)[number];

/** Result of a sync job execution. */
export interface SyncJobResult {
  connectionId: string;
  feature: LocalSyncFeature;
  success: boolean;
  error?: string;
  syncedCount?: number;
  createdCount?: number;
  updatedCount?: number;
}

/** Sync status stored in oauth_connection.sync_status per feature. */
export interface FeatureSyncStatus {
  lastSync?: string;
  lastSuccess?: string;
  lastError?: string;
  consecutiveFailures: number;
  cursor?: string;
}

/**
 * Get the contact sync interval from environment or default.
 */
export function getContactSyncInterval(): string {
  return process.env.OAUTH_SYNC_CONTACTS_INTERVAL || DEFAULT_CONTACT_SYNC_INTERVAL;
}

/**
 * Enqueue a sync job for a connection's feature.
 * Uses idempotency key to prevent duplicate jobs.
 */
export async function enqueueSyncJob(
  pool: Pool,
  connectionId: string,
  feature: LocalSyncFeature,
): Promise<string | null> {
  const idempotencyKey = `oauth_sync:${connectionId}:${feature}`;

  const result = await pool.query(
    `INSERT INTO internal_job (kind, run_at, payload, idempotency_key)
     VALUES ($1, now(), $2::jsonb, $3)
     ON CONFLICT (kind, idempotency_key) WHERE idempotency_key IS NOT NULL
     DO NOTHING
     RETURNING id::text as id`,
    [
      SYNC_JOB_KIND,
      JSON.stringify({ connection_id: connectionId, feature }),
      idempotencyKey,
    ],
  );

  if (result.rows.length === 0) {
    return null; // Already enqueued
  }

  return (result.rows[0] as { id: string }).id;
}

// Note: The oauth_contact_sync_enqueue pgcron job is managed by migration 058.
// No application-level registration is needed — the migration handles creation.

/**
 * Execute a contact sync for a single connection.
 * This is the core sync logic called by the job processor.
 *
 * 1. Validates connection exists and is active
 * 2. Checks 'contacts' feature is enabled
 * 3. Checks if enough time has elapsed since last sync
 * 4. Performs incremental sync (using stored cursor)
 * 5. Updates sync_status with result
 * 6. Fires OpenClaw hook if new contacts found
 * 7. Tracks consecutive failures, notifies after threshold
 */
export async function executeContactSync(pool: Pool, connectionId: string): Promise<SyncJobResult> {
  // 1. Validate connection
  const connection = await getConnection(pool, connectionId);
  if (!connection) {
    return {
      connectionId,
      feature: 'contacts',
      success: false,
      error: `Connection ${connectionId} not found`,
    };
  }

  if (!connection.isActive) {
    return {
      connectionId,
      feature: 'contacts',
      success: false,
      error: `Connection ${connectionId} is not active`,
    };
  }

  // 2. Check contacts feature is enabled
  if (!connection.enabledFeatures.includes('contacts')) {
    return {
      connectionId,
      feature: 'contacts',
      success: false,
      error: `Contacts feature not enabled on connection ${connectionId}`,
    };
  }

  // 3. Check time elapsed since last sync
  const syncInterval = getContactSyncInterval();
  const intervalMs = parseIntervalToMs(syncInterval);
  const contactStatus = (connection.syncStatus?.contacts as FeatureSyncStatus | undefined);
  const lastSuccessStr = contactStatus?.lastSuccess;

  if (lastSuccessStr) {
    const lastSuccess = new Date(lastSuccessStr);
    const elapsed = Date.now() - lastSuccess.getTime();
    if (elapsed < intervalMs) {
      return {
        connectionId,
        feature: 'contacts',
        success: true, // Not an error, just not time yet
      };
    }
  }

  // 4. Perform incremental sync
  try {
    const syncCursor = await getContactSyncCursor(pool, connectionId);
    const result = await syncContacts(pool, connectionId, { syncCursor });

    // 5. Update sync_status with success
    const newStatus: FeatureSyncStatus = {
      lastSync: new Date().toISOString(),
      lastSuccess: new Date().toISOString(),
      consecutiveFailures: 0,
      cursor: result.syncCursor,
    };

    await updateFeatureSyncStatus(pool, connectionId, 'contacts', newStatus);

    // 6. Fire hook if new contacts were synced
    if (result.createdCount > 0 || result.updatedCount > 0) {
      await fireContactSyncHook(pool, connection, result);
    }

    return {
      connectionId,
      feature: 'contacts',
      success: true,
      syncedCount: result.syncedCount,
      createdCount: result.createdCount,
      updatedCount: result.updatedCount,
    };
  } catch (error) {
    const err = error as Error;

    // 5. Update sync_status with failure
    const currentFailures = contactStatus?.consecutiveFailures ?? 0;
    const newFailures = currentFailures + 1;

    const newStatus: FeatureSyncStatus = {
      lastSync: new Date().toISOString(),
      lastError: err.message,
      consecutiveFailures: newFailures,
      lastSuccess: contactStatus?.lastSuccess,
      cursor: contactStatus?.cursor,
    };

    await updateFeatureSyncStatus(pool, connectionId, 'contacts', newStatus);

    // 7. Notify after threshold
    if (newFailures >= MAX_CONSECUTIVE_FAILURES) {
      await fireSyncFailureHook(pool, connection, 'contacts', newFailures, err.message);
    }

    return {
      connectionId,
      feature: 'contacts',
      success: false,
      error: err.message,
    };
  }
}

/**
 * Update the sync_status JSONB field for a specific feature on a connection.
 */
export async function updateFeatureSyncStatus(
  pool: Pool,
  connectionId: string,
  feature: string,
  status: FeatureSyncStatus,
): Promise<void> {
  await pool.query(
    `UPDATE oauth_connection
     SET sync_status = jsonb_set(
       COALESCE(sync_status, '{}'::jsonb),
       $2::text[],
       $3::jsonb
     ),
     last_sync_at = now(),
     updated_at = now()
     WHERE id = $1`,
    [connectionId, [feature], JSON.stringify(status)],
  );
}

/**
 * Fire an OpenClaw hook when new contacts are synced.
 * Uses the webhook_outbox for reliable delivery.
 */
async function fireContactSyncHook(
  pool: Pool,
  connection: OAuthConnection,
  result: ContactSyncResult,
): Promise<void> {
  const destination = getWebhookDestination('contact_sync');
  const body: Record<string, unknown> = {
    event_type: 'contact_sync_completed',
    connection_id: connection.id,
    provider: connection.provider,
    user_email: connection.userEmail,
    label: connection.label,
    synced_count: result.syncedCount,
    created_count: result.createdCount,
    updated_count: result.updatedCount,
    timestamp: new Date().toISOString(),
  };

  const idempotencyKey = `contact_sync:${connection.id}:${new Date().toISOString().slice(0, 16)}`;

  await enqueueWebhook(pool, 'oauth.sync.contacts.completed', destination, body, {
    idempotencyKey,
  });
}

/**
 * Fire an OpenClaw hook when sync has failed repeatedly.
 */
async function fireSyncFailureHook(
  pool: Pool,
  connection: OAuthConnection,
  feature: string,
  consecutiveFailures: number,
  lastError: string,
): Promise<void> {
  const destination = getWebhookDestination('sync_failure');
  const body: Record<string, unknown> = {
    event_type: 'sync_failure_alert',
    connection_id: connection.id,
    provider: connection.provider,
    user_email: connection.userEmail,
    label: connection.label,
    feature,
    consecutive_failures: consecutiveFailures,
    last_error: lastError,
    timestamp: new Date().toISOString(),
  };

  const idempotencyKey = `sync_failure:${connection.id}:${feature}:${new Date().toISOString().slice(0, 13)}`;

  await enqueueWebhook(pool, 'oauth.sync.failure_alert', destination, body, {
    idempotencyKey,
  });
}

/**
 * Parse a PostgreSQL-style interval string to milliseconds.
 * Supports: "N hours", "N minutes", "N seconds"
 */
export function parseIntervalToMs(interval: string): number {
  const match = interval.trim().match(/^(\d+)\s+(hours?|minutes?|seconds?)$/i);
  if (!match) {
    // Default to 6 hours if unparseable
    return 6 * 60 * 60 * 1000;
  }

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  if (unit.startsWith('hour')) {
    return value * 60 * 60 * 1000;
  } else if (unit.startsWith('minute')) {
    return value * 60 * 1000;
  } else if (unit.startsWith('second')) {
    return value * 1000;
  }

  return 6 * 60 * 60 * 1000;
}

/**
 * Remove all pending sync jobs for a connection.
 * Called when a connection is deleted or deactivated.
 */
export async function removePendingSyncJobs(pool: Pool, connectionId: string): Promise<number> {
  const result = await pool.query(
    `DELETE FROM internal_job
     WHERE kind = $1
       AND completed_at IS NULL
       AND payload->>'connection_id' = $2`,
    [SYNC_JOB_KIND, connectionId],
  );

  return result.rowCount ?? 0;
}

/**
 * Get sync status for a connection (all features).
 */
export async function getSyncStatus(
  pool: Pool,
  connectionId: string,
): Promise<Record<string, FeatureSyncStatus> | null> {
  const result = await pool.query(
    `SELECT sync_status FROM oauth_connection WHERE id = $1`,
    [connectionId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return (result.rows[0] as { sync_status: Record<string, FeatureSyncStatus> }).sync_status;
}
