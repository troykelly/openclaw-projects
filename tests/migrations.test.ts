import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { existsSync } from 'fs';
import { runMigrate, migrationCount } from './helpers/migrate.js';

describe('Migrations', () => {
  let pool: Pool;

  beforeAll(async () => {
    const defaultHost = existsSync('/.dockerenv') ? 'postgres' : 'localhost';
    const host = process.env.PGHOST || defaultHost;

    pool = new Pool({
      host,
      port: parseInt(process.env.PGPORT || '5432', 10),
      user: process.env.PGUSER || 'clawdbot',
      password: process.env.PGPASSWORD || 'clawdbot',
      database: process.env.PGDATABASE || 'clawdbot',
    });

    // Reset migrations before tests (best-effort)
    try {
      await runMigrate('down', migrationCount());
    } catch {
      // Ignore if no migrations to rollback
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it('applies migration and creates smoke test table', async () => {
    await runMigrate('up');

    const result = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = '_migration_smoke_test'
      ) as exists
    `);
    expect(result.rows[0].exists).toBe(true);
  });

  it('smoke test table has UUIDv7 row', async () => {
    const result = await pool.query('SELECT id::text as id FROM _migration_smoke_test');
    expect(result.rows.length).toBe(1);

    const uuid = result.rows[0].id as string;
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('creates stable new_uuid() helper', async () => {
    const result = await pool.query('SELECT new_uuid()::text as id');
    const uuid = result.rows[0].id as string;
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('rolls back migrations and removes table + helpers', async () => {
    await runMigrate('down', migrationCount());

    // After dropping objects, reconnect to avoid any cached query plans
    // referencing now-dropped relations.
    await pool.end();
    const defaultHost = existsSync('/.dockerenv') ? 'postgres' : 'localhost';
    const host = process.env.PGHOST || defaultHost;
    pool = new Pool({
      host,
      port: parseInt(process.env.PGPORT || '5432', 10),
      user: process.env.PGUSER || 'clawdbot',
      password: process.env.PGPASSWORD || 'clawdbot',
      database: process.env.PGDATABASE || 'clawdbot',
    });

    const result = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = '_migration_smoke_test'
      ) as exists
    `);
    expect(result.rows[0].exists).toBe(false);

    const fn = await pool.query(
      "SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'new_uuid') as exists"
    );
    expect(fn.rows[0].exists).toBe(false);
  });
});
