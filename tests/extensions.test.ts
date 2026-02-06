import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { createTestPool } from './helpers/db.ts';
import { runMigrate } from './helpers/migrate.ts';

describe('Required Postgres extensions', () => {
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('has timescaledb, postgis, pg_cron, and pgvector installed', async () => {
    const result = await pool.query(
      `SELECT extname FROM pg_extension WHERE extname = ANY($1::text[]) ORDER BY extname`,
      [['timescaledb', 'postgis', 'pg_cron', 'vector']]
    );

    expect(result.rows.map((r) => r.extname)).toEqual([
      'pg_cron',
      'postgis',
      'timescaledb',
      'vector',
    ]);
  });
});
