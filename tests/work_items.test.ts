import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.js';
import { createTestPool, truncateAllTables } from './helpers/db.js';

describe('Work items core model', () => {
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

  it('creates work_item table', async () => {
    const result = await pool.query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'work_item'
      ) as exists`
    );
    expect(result.rows[0].exists).toBe(true);
  });

  it('can create work item with server-generated UUIDv7', async () => {
    const inserted = await pool.query(
      `INSERT INTO work_item (title) VALUES ($1)
       RETURNING id::text as id, title`,
      ['Test item']
    );

    expect(inserted.rows[0].title).toBe('Test item');
    const uuid = inserted.rows[0].id as string;
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('supports participants with roles', async () => {
    const wi = await pool.query(`INSERT INTO work_item (title) VALUES ('With participant') RETURNING id`);
    const workItemId = wi.rows[0].id as string;

    await pool.query(
      `INSERT INTO work_item_participant (work_item_id, participant, role)
       VALUES ($1, $2, $3)`,
      [workItemId, 'troy', 'owner']
    );

    const rows = await pool.query(
      `SELECT participant, role FROM work_item_participant WHERE work_item_id = $1`,
      [workItemId]
    );
    expect(rows.rows).toEqual([{ participant: 'troy', role: 'owner' }]);
  });

  it('supports dependency edges and prevents self-dependency', async () => {
    const a = await pool.query(`INSERT INTO work_item (title) VALUES ('A') RETURNING id`);
    const b = await pool.query(`INSERT INTO work_item (title) VALUES ('B') RETURNING id`);

    const aId = a.rows[0].id as string;
    const bId = b.rows[0].id as string;

    await pool.query(
      `INSERT INTO work_item_dependency (work_item_id, depends_on_work_item_id, kind)
       VALUES ($1, $2, 'blocks')`,
      [bId, aId]
    );

    const deps = await pool.query(
      `SELECT kind FROM work_item_dependency WHERE work_item_id = $1 AND depends_on_work_item_id = $2`,
      [bId, aId]
    );
    expect(deps.rows.length).toBe(1);
    expect(deps.rows[0].kind).toBe('blocks');

    await expect(
      pool.query(
        `INSERT INTO work_item_dependency (work_item_id, depends_on_work_item_id, kind)
         VALUES ($1, $1, 'blocks')`,
        [aId]
      )
    ).rejects.toThrow(/work_item_dependency/);
  });
});
