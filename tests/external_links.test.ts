import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';

describe('Work item external links', () => {
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

  it('creates a link for a work item', async () => {
    const wi = await pool.query(`INSERT INTO work_item (title) VALUES ('External link') RETURNING id`);
    const workItemId = wi.rows[0].id as string;

    const inserted = await pool.query(
      `INSERT INTO work_item_external_link
        (work_item_id, provider, url, external_id, github_owner, github_repo, github_kind, github_number, github_node_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id::text as id, provider, url, external_id, github_owner, github_repo, github_kind, github_number`,
      [workItemId, 'github', 'https://github.com/acme/tools/issues/123', 'github:acme/tools:issue:123', 'acme', 'tools', 'issue', 123, 'MDU6SXNzdWUxMjM='],
    );

    expect(inserted.rows[0].provider).toBe('github');
    expect(inserted.rows[0].url).toBe('https://github.com/acme/tools/issues/123');
    expect(inserted.rows[0].external_id).toBe('github:acme/tools:issue:123');
    expect(inserted.rows[0].github_owner).toBe('acme');
    expect(inserted.rows[0].github_repo).toBe('tools');
    expect(inserted.rows[0].github_kind).toBe('issue');
    expect(inserted.rows[0].github_number).toBe(123);
  });

  it('prevents duplicate external links for the same provider', async () => {
    const wiA = await pool.query(`INSERT INTO work_item (title) VALUES ('A') RETURNING id`);
    const wiB = await pool.query(`INSERT INTO work_item (title) VALUES ('B') RETURNING id`);
    const workItemA = wiA.rows[0].id as string;
    const workItemB = wiB.rows[0].id as string;

    await pool.query(
      `INSERT INTO work_item_external_link
        (work_item_id, provider, url, external_id, github_owner, github_repo, github_kind, github_number)
       VALUES ($1, 'github', 'https://github.com/acme/tools/pull/77', 'github:acme/tools:pr:77', 'acme', 'tools', 'pr', 77)`,
      [workItemA],
    );

    await expect(
      pool.query(
        `INSERT INTO work_item_external_link
          (work_item_id, provider, url, external_id, github_owner, github_repo, github_kind, github_number)
         VALUES ($1, 'github', 'https://github.com/acme/tools/pull/77', 'github:acme/tools:pr:77:copy', 'acme', 'tools', 'pr', 77)`,
        [workItemB],
      ),
    ).rejects.toThrow(/work_item_external_link/);

    await expect(
      pool.query(
        `INSERT INTO work_item_external_link
          (work_item_id, provider, url, external_id, github_owner, github_repo, github_kind, github_number)
         VALUES ($1, 'github', 'https://github.com/acme/tools/pull/78', 'github:acme/tools:pr:77', 'acme', 'tools', 'pr', 77)`,
        [workItemA],
      ),
    ).rejects.toThrow(/work_item_external_link/);
  });

  it('enforces work_item referential integrity', async () => {
    await expect(
      pool.query(
        `INSERT INTO work_item_external_link
          (work_item_id, provider, url, external_id, github_owner, github_repo, github_kind, github_number)
         VALUES ($1, 'github', 'https://github.com/acme/tools/issues/9', 'github:acme/tools:issue:9', 'acme', 'tools', 'issue', 9)`,
        ['00000000-0000-0000-0000-000000000000'],
      ),
    ).rejects.toThrow(/work_item_external_link/);
  });
});
