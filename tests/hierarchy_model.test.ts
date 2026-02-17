import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

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
      payload: { title: 'Epic 1', kind: 'epic', parent_id: initiativeId },
    });
    expect(epic.statusCode).toBe(201);
    const epicId = (epic.json() as { id: string }).id;

    const issue = await app.inject({
      method: 'POST',
      url: '/api/work-items',
      payload: { title: 'Issue 1', kind: 'issue', parent_id: epicId },
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
      payload: { title: 'Bad issue', kind: 'issue', parent_id: initiativeId },
    });
    expect(badIssueParent.statusCode).toBe(400);
  });

  it('returns 400 when parent_id is not a UUID', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/work-items',
      payload: { title: 'Bad parent', kind: 'issue', parent_id: 'not-a-uuid' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('supports re-parenting via PATCH /api/work-items/:id/hierarchy', async () => {
    const initiative = await app.inject({
      method: 'POST',
      url: '/api/work-items',
      payload: { title: 'Initiative 1', kind: 'initiative' },
    });
    const initiativeId = (initiative.json() as { id: string }).id;

    const epicA = await app.inject({
      method: 'POST',
      url: '/api/work-items',
      payload: { title: 'Epic A', kind: 'epic', parent_id: initiativeId },
    });
    const epicAId = (epicA.json() as { id: string }).id;

    const epicB = await app.inject({
      method: 'POST',
      url: '/api/work-items',
      payload: { title: 'Epic B', kind: 'epic', parent_id: initiativeId },
    });
    const epicBId = (epicB.json() as { id: string }).id;

    const issue = await app.inject({
      method: 'POST',
      url: '/api/work-items',
      payload: { title: 'Issue 1', kind: 'issue', parent_id: epicAId },
    });
    expect(issue.statusCode).toBe(201);
    const issueId = (issue.json() as { id: string }).id;

    const moved = await app.inject({
      method: 'PATCH',
      url: `/api/work-items/${issueId}/hierarchy`,
      payload: { kind: 'issue', parent_id: epicBId },
    });
    expect(moved.statusCode).toBe(200);
    expect((moved.json() as { parent_id: string | null }).parent_id).toBe(epicBId);

    const badMove = await app.inject({
      method: 'PATCH',
      url: `/api/work-items/${issueId}/hierarchy`,
      payload: { kind: 'issue', parent_id: initiativeId },
    });
    expect(badMove.statusCode).toBe(400);
  });
});
