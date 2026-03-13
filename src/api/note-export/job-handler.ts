/**
 * Worker job handler for export.generate jobs.
 * Part of Epic #2475, Issue #2477.
 *
 * Integrates with the existing internal_job processor.
 */

import type { Pool } from 'pg';
import type { InternalJob, JobProcessorResult } from '../jobs/types.ts';
import type { FileStorage } from '../file-storage/types.ts';
import { createS3StorageFromEnv } from '../file-storage/s3-storage.ts';
import { runExportJob } from './service.ts';

/** Lazily-initialized S3 storage instance for the worker process */
let storageInstance: FileStorage | null | undefined;

function getStorage(): FileStorage {
  if (storageInstance === undefined) {
    storageInstance = createS3StorageFromEnv();
  }
  if (!storageInstance) {
    throw new Error('S3 storage not configured — export generation requires S3_BUCKET, S3_REGION, S3_ACCESS_KEY, S3_SECRET_KEY');
  }
  return storageInstance;
}

/**
 * Handles an export.generate internal job.
 * Called by the job processor when it encounters this job kind.
 */
export async function handleExportJob(pool: Pool, job: InternalJob): Promise<JobProcessorResult> {
  const exportId = job.payload.export_id as string;

  if (!exportId) {
    return {
      success: false,
      error: 'Invalid job payload: missing export_id',
    };
  }

  try {
    const storage = getStorage();
    await runExportJob(pool, storage, exportId);
    return { success: true };
  } catch (error) {
    const err = error as Error;
    return {
      success: false,
      error: `Export generation failed for ${exportId}: ${err.message}`,
    };
  }
}

/**
 * Resets the storage instance (for testing).
 */
export function resetStorageInstance(): void {
  storageInstance = undefined;
}
