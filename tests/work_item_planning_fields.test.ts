import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';

describe('Work item planning fields (priority/type/scheduling)', () => {
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('adds priority and type columns with defaults', async () => {
    const inserted = await pool.query(
      `INSERT INTO work_item (title) VALUES ('Planning fields')
       RETURNING priority::text as priority, task_type::text as task_type`,
    );

    expect(inserted.rows[0].priority).toMatch(/^P[0-4]$/);
    expect(typeof inserted.rows[0].task_type).toBe('string');
    expect(inserted.rows[0].task_type.length).toBeGreaterThan(0);
  });

  it('allows scheduling constraints and rejects impossible windows', async () => {
    const ok = await pool.query(
      `INSERT INTO work_item (title, not_before, not_after)
       VALUES ('Window ok', now(), now() + interval '1 hour')
       RETURNING id`,
    );
    expect(ok.rows.length).toBe(1);

    await expect(
      pool.query(
        `INSERT INTO work_item (title, not_before, not_after)
         VALUES ('Window bad', now() + interval '2 hour', now() + interval '1 hour')`,
      ),
    ).rejects.toThrow(/work_item/);
  });
});
