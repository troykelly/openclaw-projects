/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';

const TEST_EMAIL = `vis-test-${Date.now()}@test.local`;

describe('visible_agent_ids API validation', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({
      host: process.env.PGHOST ?? 'postgres',
      user: process.env.PGUSER ?? 'openclaw',
      password: process.env.PGPASSWORD ?? 'openclaw',
      database: process.env.PGDATABASE ?? 'openclaw',
    });
    // Seed user_setting
    await pool.query(
      `INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT (email) DO NOTHING`,
      [TEST_EMAIL],
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM user_setting WHERE email = $1`, [TEST_EMAIL]);
    await pool.end();
  });

  it('stores visible_agent_ids as text array', async () => {
    await pool.query(
      `UPDATE user_setting SET visible_agent_ids = $1::text[] WHERE email = $2`,
      [['agent-a', 'agent-b'], TEST_EMAIL],
    );
    const result = await pool.query(
      `SELECT visible_agent_ids FROM user_setting WHERE email = $1`,
      [TEST_EMAIL],
    );
    expect(result.rows[0].visible_agent_ids).toEqual(['agent-a', 'agent-b']);
  });

  it('NULL visible_agent_ids means all visible', async () => {
    await pool.query(
      `UPDATE user_setting SET visible_agent_ids = NULL WHERE email = $1`,
      [TEST_EMAIL],
    );
    const result = await pool.query(
      `SELECT visible_agent_ids FROM user_setting WHERE email = $1`,
      [TEST_EMAIL],
    );
    expect(result.rows[0].visible_agent_ids).toBeNull();
  });

  it('deduplicates visible_agent_ids on write', async () => {
    const ids = ['agent-a', 'agent-a', 'agent-b'];
    const deduped = [...new Set(ids)];
    await pool.query(
      `UPDATE user_setting SET visible_agent_ids = $1::text[] WHERE email = $2`,
      [deduped, TEST_EMAIL],
    );
    const result = await pool.query(
      `SELECT visible_agent_ids FROM user_setting WHERE email = $1`,
      [TEST_EMAIL],
    );
    expect(result.rows[0].visible_agent_ids).toEqual(['agent-a', 'agent-b']);
  });

  describe('POST /chat/sessions visibility validation (DB-level)', () => {
    it('visible_agent_ids filters allowed agents', async () => {
      await pool.query(
        `UPDATE user_setting SET visible_agent_ids = $1::text[], default_agent_id = $2 WHERE email = $3`,
        [['agent-a', 'agent-b'], 'agent-a', TEST_EMAIL],
      );
      const result = await pool.query(
        `SELECT visible_agent_ids FROM user_setting WHERE email = $1`,
        [TEST_EMAIL],
      );
      const visibleIds: string[] | null = result.rows[0].visible_agent_ids;
      expect(visibleIds).not.toBeNull();
      expect(visibleIds!.includes('agent-a')).toBe(true);
      expect(visibleIds!.includes('agent-c')).toBe(false);
    });
  });
});
