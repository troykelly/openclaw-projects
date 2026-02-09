import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { createTestPool } from './helpers/db.ts';
import { runMigrate, migrationCount } from './helpers/migrate.ts';

describe('Migrations', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = createTestPool();

    // Reset migrations before tests (best-effort)
    try {
      await runMigrate('down', migrationCount());
    } catch {
      // Ignore if no migrations to rollback
    }
  });

  afterAll(async () => {
    // Re-apply migrations to leave database in a clean state for other tests
    // This is critical because the rollback test leaves the DB empty
    try {
      await runMigrate('up');
    } catch (error) {
      console.error('[migrations.test.ts] Failed to re-apply migrations in afterAll:', error);
    }
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
    // Truncate all data tables before rollback to avoid constraint violations
    // when other tests have inserted data
    await pool.query(`
      DO $$
      DECLARE
        r RECORD;
      BEGIN
        -- Disable triggers temporarily
        SET session_replication_role = 'replica';

        -- Truncate all tables except schema_migrations
        FOR r IN (
          SELECT tablename FROM pg_tables
          WHERE schemaname = 'public'
          AND tablename NOT IN ('schema_migrations', '_migration_smoke_test', 'spatial_ref_sys')
        ) LOOP
          EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;

        -- Re-enable triggers
        SET session_replication_role = 'origin';
      END $$;
    `);

    await runMigrate('down', migrationCount());

    // After dropping objects, reconnect to avoid any cached query plans
    // referencing now-dropped relations.
    await pool.end();
    pool = createTestPool();

    const result = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = '_migration_smoke_test'
      ) as exists
    `);
    expect(result.rows[0].exists).toBe(false);

    const fn = await pool.query("SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'new_uuid') as exists");
    expect(fn.rows[0].exists).toBe(false);
  });
});
