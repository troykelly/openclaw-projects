import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { buildServer } from '../src/api/server.ts';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';

describe('Backlog API: GET /api/backlog', () => {
  let pool: Pool;
  const app = buildServer({ logger: false });

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
  });

  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  it('returns all work items without filters', async () => {
    await pool.query(
      `INSERT INTO work_item (title, status, priority)
       VALUES ('Task A', 'open', 'P1'),
              ('Task B', 'closed', 'P2'),
              ('Task C', 'open', 'P0')`,
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/backlog',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toHaveLength(3);
  });

  it('filters by status', async () => {
    await pool.query(
      `INSERT INTO work_item (title, status, priority)
       VALUES ('Open task', 'open', 'P1'),
              ('Closed task', 'closed', 'P2'),
              ('Blocked task', 'blocked', 'P1')`,
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/backlog?status=open',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].status).toBe('open');
  });

  it('filters by multiple statuses', async () => {
    await pool.query(
      `INSERT INTO work_item (title, status, priority)
       VALUES ('Open task', 'open', 'P1'),
              ('Closed task', 'closed', 'P2'),
              ('Blocked task', 'blocked', 'P1')`,
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/backlog?status=open&status=blocked',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toHaveLength(2);
    expect(body.items.every((i: { status: string }) => i.status === 'open' || i.status === 'blocked')).toBe(true);
  });

  it('filters by priority', async () => {
    await pool.query(
      `INSERT INTO work_item (title, status, priority)
       VALUES ('P0 task', 'open', 'P0'),
              ('P1 task', 'open', 'P1'),
              ('P2 task', 'open', 'P2')`,
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/backlog?priority=P0',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].priority).toBe('P0');
  });

  it('filters by kind', async () => {
    await pool.query(
      `INSERT INTO work_item (title, status, work_item_kind)
       VALUES ('Project', 'open', 'project'),
              ('Epic task', 'open', 'epic'),
              ('Issue', 'open', 'issue')`,
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/backlog?kind=issue',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].kind).toBe('issue');
  });

  it('combines multiple filters', async () => {
    await pool.query(
      `INSERT INTO work_item (title, status, priority, work_item_kind)
       VALUES ('Match', 'open', 'P0', 'issue'),
              ('Wrong status', 'closed', 'P0', 'issue'),
              ('Wrong priority', 'open', 'P2', 'issue'),
              ('Wrong kind', 'open', 'P0', 'epic')`,
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/backlog?status=open&priority=P0&kind=issue',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].title).toBe('Match');
  });

  it('sorts by priority then by created_at', async () => {
    await pool.query(
      `INSERT INTO work_item (title, status, priority, created_at)
       VALUES ('P2 older', 'open', 'P2', '2025-01-01'),
              ('P0 task', 'open', 'P0', '2025-01-03'),
              ('P2 newer', 'open', 'P2', '2025-01-02')`,
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/backlog',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items[0].priority).toBe('P0'); // Highest priority first
    expect(body.items[1].title).toBe('P2 older'); // Same priority, oldest first
    expect(body.items[2].title).toBe('P2 newer');
  });
});

describe('Kanban API: PATCH /api/work-items/:id/status', () => {
  let pool: Pool;
  const app = buildServer({ logger: false });

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
  });

  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  it('updates status via PATCH', async () => {
    const inserted = await pool.query(
      `INSERT INTO work_item (title, status)
       VALUES ('Task', 'open')
       RETURNING id::text as id`,
    );

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/work-items/${inserted.rows[0].id}/status`,
      payload: { status: 'closed' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('closed');

    // Verify in database
    const check = await pool.query(`SELECT status FROM work_item WHERE id = $1`, [inserted.rows[0].id]);
    expect(check.rows[0].status).toBe('closed');
  });

  it('returns 400 for missing status', async () => {
    const inserted = await pool.query(
      `INSERT INTO work_item (title, status)
       VALUES ('Task', 'open')
       RETURNING id::text as id`,
    );

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/work-items/${inserted.rows[0].id}/status`,
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it('returns 404 for non-existent work item', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/work-items/00000000-0000-0000-0000-000000000000/status',
      payload: { status: 'closed' },
    });

    expect(response.statusCode).toBe(404);
  });
});
