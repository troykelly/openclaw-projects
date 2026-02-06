import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { createTestPool } from './helpers/db.ts';

describe('Database connection', () => {
  let pool: Pool | undefined;

  beforeAll(() => {
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('connects to Postgres and can query', async () => {
    const result = await pool!.query('SELECT 1 as value');
    expect(result.rows[0].value).toBe(1);
  });

  it('has Postgres version 18', async () => {
    const result = await pool!.query('SHOW server_version');
    const version = result.rows[0].server_version;
    expect(version).toMatch(/^18\./);
  });

  it('supports UUIDv7 generation', async () => {
    const result = await pool!.query('SELECT uuidv7()::text as id');
    const uuid = result.rows[0].id as string;
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});
