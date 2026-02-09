import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';

describe('Work item estimates, rollups, and next-actionable query', () => {
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

  it('enforces estimate/actual minute constraints', async () => {
    const ok = await pool.query(
      `INSERT INTO work_item (title, estimate_minutes, actual_minutes)
       VALUES ('Estimate ok', 120, 45)
       RETURNING estimate_minutes, actual_minutes`,
    );
    expect(ok.rows[0].estimate_minutes).toBe(120);
    expect(ok.rows[0].actual_minutes).toBe(45);

    await expect(
      pool.query(
        `INSERT INTO work_item (title, estimate_minutes)
         VALUES ('Estimate negative', -5)`,
      ),
    ).rejects.toThrow(/work_item/);

    await expect(
      pool.query(
        `INSERT INTO work_item (title, actual_minutes)
         VALUES ('Actual negative', -3)`,
      ),
    ).rejects.toThrow(/work_item/);

    await expect(
      pool.query(
        `INSERT INTO work_item (title, estimate_minutes)
         VALUES ('Estimate too big', 600000)`,
      ),
    ).rejects.toThrow(/work_item/);

    await expect(
      pool.query(
        `INSERT INTO work_item (title, actual_minutes)
         VALUES ('Actual too big', 600000)`,
      ),
    ).rejects.toThrow(/work_item/);
  });

  it('rolls up estimates/actuals across the hierarchy', async () => {
    const project = await pool.query(
      `INSERT INTO work_item (title, work_item_kind, estimate_minutes, actual_minutes)
       VALUES ('Project', 'project', 10, 5)
       RETURNING id`,
    );
    const initiative = await pool.query(
      `INSERT INTO work_item (title, work_item_kind, parent_work_item_id, estimate_minutes, actual_minutes)
       VALUES ('Initiative', 'initiative', $1, 20, NULL)
       RETURNING id`,
      [project.rows[0].id],
    );
    const epic = await pool.query(
      `INSERT INTO work_item (title, work_item_kind, parent_work_item_id, estimate_minutes, actual_minutes)
       VALUES ('Epic', 'epic', $1, 30, 12)
       RETURNING id`,
      [initiative.rows[0].id],
    );
    const issueA = await pool.query(
      `INSERT INTO work_item (title, work_item_kind, parent_work_item_id, estimate_minutes, actual_minutes)
       VALUES ('Issue A', 'issue', $1, 40, 40)
       RETURNING id`,
      [epic.rows[0].id],
    );
    const issueB = await pool.query(
      `INSERT INTO work_item (title, work_item_kind, parent_work_item_id, estimate_minutes, actual_minutes)
       VALUES ('Issue B', 'issue', $1, 5, 2)
       RETURNING id`,
      [epic.rows[0].id],
    );

    const projectRollup = await pool.query(
      `SELECT total_estimate_minutes, total_actual_minutes
         FROM work_item_rollup_project
        WHERE work_item_id = $1`,
      [project.rows[0].id],
    );
    expect(projectRollup.rows[0].total_estimate_minutes).toBe(105);
    expect(projectRollup.rows[0].total_actual_minutes).toBe(59);

    const initiativeRollup = await pool.query(
      `SELECT total_estimate_minutes, total_actual_minutes
         FROM work_item_rollup_initiative
        WHERE work_item_id = $1`,
      [initiative.rows[0].id],
    );
    expect(initiativeRollup.rows[0].total_estimate_minutes).toBe(95);
    expect(initiativeRollup.rows[0].total_actual_minutes).toBe(54);

    const epicRollup = await pool.query(
      `SELECT total_estimate_minutes, total_actual_minutes
         FROM work_item_rollup_epic
        WHERE work_item_id = $1`,
      [epic.rows[0].id],
    );
    expect(epicRollup.rows[0].total_estimate_minutes).toBe(75);
    expect(epicRollup.rows[0].total_actual_minutes).toBe(54);

    const issueRollup = await pool.query(
      `SELECT total_estimate_minutes, total_actual_minutes
         FROM work_item_rollup_issue
        WHERE work_item_id = $1`,
      [issueA.rows[0].id],
    );
    expect(issueRollup.rows[0].total_estimate_minutes).toBe(40);
    expect(issueRollup.rows[0].total_actual_minutes).toBe(40);

    const issueRollupB = await pool.query(
      `SELECT total_estimate_minutes, total_actual_minutes
         FROM work_item_rollup_issue
        WHERE work_item_id = $1`,
      [issueB.rows[0].id],
    );
    expect(issueRollupB.rows[0].total_estimate_minutes).toBe(5);
    expect(issueRollupB.rows[0].total_actual_minutes).toBe(2);
  });

  it('filters next-actionable items with deterministic ordering', async () => {
    const asOf = '2025-01-01 12:00:00+00';

    const done = await pool.query(
      `INSERT INTO work_item (title, status, priority)
       VALUES ('Done item', 'done', 'P1')
       RETURNING id`,
    );
    const blocked = await pool.query(
      `INSERT INTO work_item (title, status, priority)
       VALUES ('Blocked item', 'open', 'P0')
       RETURNING id`,
    );
    const blocker = await pool.query(
      `INSERT INTO work_item (title, status, priority)
       VALUES ('Blocker item', 'open', 'P2')
       RETURNING id`,
    );
    await pool.query(
      `INSERT INTO work_item_dependency (work_item_id, depends_on_work_item_id, kind)
       VALUES ($1, $2, 'depends_on')`,
      [blocked.rows[0].id, blocker.rows[0].id],
    );

    await pool.query(
      `INSERT INTO work_item (title, status, priority, not_before)
       VALUES ('Future item', 'open', 'P1', $1::timestamptz)`,
      ['2025-02-01 00:00:00+00'],
    );
    await pool.query(
      `INSERT INTO work_item (title, status, priority, not_after)
       VALUES ('Expired item', 'open', 'P1', $1::timestamptz)`,
      ['2024-12-31 00:00:00+00'],
    );

    const actionableA = await pool.query(
      `INSERT INTO work_item (title, status, priority, not_after)
       VALUES ('Actionable P0', 'open', 'P0', $1::timestamptz)
       RETURNING id`,
      ['2025-01-03 00:00:00+00'],
    );
    const actionableB = await pool.query(
      `INSERT INTO work_item (title, status, priority, not_after)
       VALUES ('Actionable P1', 'open', 'P1', $1::timestamptz)
       RETURNING id`,
      ['2025-01-02 00:00:00+00'],
    );
    const actionableC = await pool.query(
      `INSERT INTO work_item (title, status, priority, not_after)
       VALUES ('Actionable P1 later', 'open', 'P1', $1::timestamptz)
       RETURNING id`,
      ['2025-01-05 00:00:00+00'],
    );

    const result = await pool.query(
      `SELECT id::text as id, title, priority::text as priority
         FROM work_item_next_actionable_at($1::timestamptz)`,
      [asOf],
    );

    const ids = result.rows.map((row) => row.id);
    expect(ids).toEqual([actionableA.rows[0].id, actionableB.rows[0].id, actionableC.rows[0].id, blocker.rows[0].id]);

    const titles = result.rows.map((row) => row.title);
    expect(titles).toEqual(['Actionable P0', 'Actionable P1', 'Actionable P1 later', 'Blocker item']);

    // sanity checks for excluded items
    expect(ids).not.toContain(done.rows[0].id);
    expect(ids).not.toContain(blocked.rows[0].id);
  });
});
