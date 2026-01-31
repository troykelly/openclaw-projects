import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.js';
import { createTestPool, truncateAllTables } from './helpers/db.js';
import { buildServer } from '../src/api/server.js';

/**
 * Issue #53: canonical hierarchy semantics.
 */
describe('hierarchy model (Initiative/Epic/Issue)', () => {
  const app = buildServer();
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('allows initiative -> epic -> issue nesting, and rejects invalid nesting', async () => {
    const initiative = await app.inject({
      method: 'POST',
      url: '/api/work-items',
      payload: { title: 'Initiative 1', kind: 'initiative' },
    });
    expect(initiative.statusCode).toBe(201);
    const initiativeId = (initiative.json() as { id: string }).id;

    const epic = await app.inject({
      method: 'POST',
      url: '/api/work-items',
      payload: { title: 'Epic 1', kind: 'epic', parentId: initiativeId },
    });
    expect(epic.statusCode).toBe(201);
    const epicId = (epic.json() as { id: string }).id;

    const issue = await app.inject({
      method: 'POST',
      url: '/api/work-items',
      payload: { title: 'Issue 1', kind: 'issue', parentId: epicId },
    });
    expect(issue.statusCode).toBe(201);

    const badEpic = await app.inject({
      method: 'POST',
      url: '/api/work-items',
      payload: { title: 'Bad epic', kind: 'epic' },
    });
    expect(badEpic.statusCode).toBe(400);

    const badIssueParent = await app.inject({
      method: 'POST',
      url: '/api/work-items',
      payload: { title: 'Bad issue', kind: 'issue', parentId: initiativeId },
    });
    expect(badIssueParent.statusCode).toBe(400);
  });

  it('returns 400 when parentId is not a UUID', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/work-items',
      payload: { title: 'Bad parent', kind: 'issue', parentId: 'not-a-uuid' },
    });

    expect(res.statusCode).toBe(400);
  });
});
