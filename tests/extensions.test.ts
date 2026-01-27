import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { existsSync } from 'fs';
import { runMigrate } from './helpers/migrate.js';

describe('Required Postgres extensions', () => {
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');

    const defaultHost = existsSync('/.dockerenv') ? 'postgres' : 'localhost';

    pool = new Pool({
      host: process.env.PGHOST || defaultHost,
      port: parseInt(process.env.PGPORT || '5432', 10),
      user: process.env.PGUSER || 'clawdbot',
      password: process.env.PGPASSWORD || 'clawdbot',
      database: process.env.PGDATABASE || 'clawdbot',
    });
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
