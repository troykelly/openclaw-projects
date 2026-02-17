/**
 * Tests for geo location retention cleanup wrapper.
 * Issue #1252
 */

import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { runRetentionCleanup } from './retention.ts';

function mockPool(rows: Record<string, unknown>[]): Pool {
  return {
    query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }),
  } as unknown as Pool;
}

describe('runRetentionCleanup', () => {
  it('returns stats from the PL/pgSQL function', async () => {
    const pool = mockPool([{ users_processed: 3, records_downsampled: '42', records_expired: '100' }]);

    const result = await runRetentionCleanup(pool);

    expect(result).toEqual({
      users_processed: 3,
      records_downsampled: 42,
      records_expired: 100,
    });
    expect(pool.query).toHaveBeenCalledWith('SELECT * FROM geo_retention_cleanup()');
  });

  it('returns zeroes when the function returns no rows', async () => {
    const pool = mockPool([]);

    const result = await runRetentionCleanup(pool);

    expect(result).toEqual({
      users_processed: 0,
      records_downsampled: 0,
      records_expired: 0,
    });
  });

  it('handles zero-value results', async () => {
    const pool = mockPool([{ users_processed: 0, records_downsampled: '0', records_expired: '0' }]);

    const result = await runRetentionCleanup(pool);

    expect(result).toEqual({
      users_processed: 0,
      records_downsampled: 0,
      records_expired: 0,
    });
  });

  it('converts bigint string values to numbers', async () => {
    const pool = mockPool([
      {
        users_processed: 1,
        records_downsampled: '9999999999',
        records_expired: '1234567890',
      },
    ]);

    const result = await runRetentionCleanup(pool);

    expect(result.records_downsampled).toBe(9999999999);
    expect(result.records_expired).toBe(1234567890);
  });

  it('propagates database errors', async () => {
    const pool = {
      query: vi.fn().mockRejectedValue(new Error('connection refused')),
    } as unknown as Pool;

    await expect(runRetentionCleanup(pool)).rejects.toThrow('connection refused');
  });
});
