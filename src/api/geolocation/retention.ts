/**
 * Geo location retention cleanup wrapper.
 * Calls the geo_retention_cleanup() PL/pgSQL function for manual triggering.
 *
 * Issue #1252
 */

import type { Pool } from 'pg';

export interface RetentionResult {
  usersProcessed: number;
  recordsDownsampled: number;
  recordsExpired: number;
}

/**
 * Run the geo location retention cleanup.
 * Delegates to the `geo_retention_cleanup()` PL/pgSQL function which:
 * - Iterates per-user settings from `user_setting`
 * - Deletes all geo_location records beyond the general retention window
 * - Downsamples high-res data to best-accuracy-per-hour beyond the high-res window
 *
 * Only touches geo_location — never memories or embeddings.
 */
export async function runRetentionCleanup(pool: Pool): Promise<RetentionResult> {
  const { rows } = await pool.query<{
    users_processed: number;
    records_downsampled: string;
    records_expired: string;
  }>('SELECT * FROM geo_retention_cleanup()');

  const row = rows[0];
  if (!row) {
    return { usersProcessed: 0, recordsDownsampled: 0, recordsExpired: 0 };
  }

  return {
    usersProcessed: row.users_processed,
    recordsDownsampled: Number(row.records_downsampled),
    recordsExpired: Number(row.records_expired),
  };
}
