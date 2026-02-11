/**
 * Job handler for OAuth contact sync jobs.
 * Bridges the internal_job processor with the OAuth sync service.
 * Part of Issue #1055.
 */

import type { Pool } from 'pg';
import type { InternalJob, JobProcessorResult } from './types.ts';
import { executeContactSync } from '../oauth/sync.ts';

/**
 * Handle oauth.sync.contacts job.
 * Extracts connection_id from the job payload and delegates to executeContactSync.
 */
export async function handleContactSyncJob(pool: Pool, job: InternalJob): Promise<JobProcessorResult> {
  const connectionId = job.payload.connection_id as string;

  if (!connectionId) {
    return {
      success: false,
      error: 'Invalid job payload: missing connection_id',
    };
  }

  const result = await executeContactSync(pool, connectionId);

  if (result.success) {
    if (result.syncedCount !== undefined) {
      console.log(
        `[OAuthSync] Contact sync completed for connection ${connectionId}: ` +
        `${result.syncedCount} synced, ${result.createdCount} created, ${result.updatedCount} updated`,
      );
    }
    return { success: true };
  }

  return {
    success: false,
    error: result.error || 'Unknown sync error',
  };
}
