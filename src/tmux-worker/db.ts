/**
 * Database connection pool for the tmux worker.
 */

import pg from 'pg';
import type { TmuxWorkerConfig } from './config.ts';

const { Pool } = pg;

let pool: pg.Pool | undefined;

/**
 * Get or create the database connection pool.
 */
export function getPool(config: TmuxWorkerConfig): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return pool;
}

/**
 * Close the database pool. Call during graceful shutdown.
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
