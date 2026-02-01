import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { buildServer } from '../src/api/server.js';
import { runMigrate } from './helpers/migrate.js';
import { createTestPool, truncateAllTables } from './helpers/db.js';

describe('Effort API: estimate_minutes and actual_minutes', () => {
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

  describe('GET /api/work-items/:id', () => {
    it('returns estimate_minutes and actual_minutes fields', async () => {
      const inserted = await pool.query(
        `INSERT INTO work_item (title, estimate_minutes, actual_minutes)
         VALUES ('Test task', 120, 90)
         RETURNING id::text as id`
      );
      const id = inserted.rows[0].id;

      const response = await app.inject({
        method: 'GET',
        url: `/api/work-items/${id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.estimate_minutes).toBe(120);
      expect(body.actual_minutes).toBe(90);
    });

    it('returns null for estimate/actual when not set', async () => {
      const inserted = await pool.query(
        `INSERT INTO work_item (title)
         VALUES ('No estimates')
         RETURNING id::text as id`
      );
      const id = inserted.rows[0].id;

      const response = await app.inject({
        method: 'GET',
        url: `/api/work-items/${id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.estimate_minutes).toBeNull();
      expect(body.actual_minutes).toBeNull();
    });
  });

  describe('GET /api/work-items (list)', () => {
    it('returns estimate_minutes and actual_minutes in list items', async () => {
      await pool.query(
        `INSERT INTO work_item (title, estimate_minutes, actual_minutes)
         VALUES ('Task A', 60, 45)`
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/work-items',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items.length).toBeGreaterThan(0);
      expect(body.items[0]).toHaveProperty('estimate_minutes');
      expect(body.items[0]).toHaveProperty('actual_minutes');
    });
  });

  describe('POST /api/work-items', () => {
    it('accepts estimateMinutes and actualMinutes in create', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'New task with estimates',
          estimateMinutes: 180,
          actualMinutes: 120,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.estimate_minutes).toBe(180);
      expect(body.actual_minutes).toBe(120);
    });

    it('rejects negative estimateMinutes', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'Invalid estimate',
          estimateMinutes: -10,
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toMatch(/estimate/i);
    });

    it('rejects estimateMinutes exceeding 525600', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'Too big estimate',
          estimateMinutes: 600000,
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toMatch(/estimate/i);
    });
  });

  describe('PUT /api/work-items/:id', () => {
    it('updates estimateMinutes and actualMinutes', async () => {
      const inserted = await pool.query(
        `INSERT INTO work_item (title, estimate_minutes, actual_minutes)
         VALUES ('Original task', 60, 30)
         RETURNING id::text as id`
      );
      const id = inserted.rows[0].id;

      const response = await app.inject({
        method: 'PUT',
        url: `/api/work-items/${id}`,
        payload: {
          title: 'Updated task',
          estimateMinutes: 120,
          actualMinutes: 90,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.estimate_minutes).toBe(120);
      expect(body.actual_minutes).toBe(90);
    });

    it('can clear estimate/actual by setting to null', async () => {
      const inserted = await pool.query(
        `INSERT INTO work_item (title, estimate_minutes, actual_minutes)
         VALUES ('Task with estimates', 60, 30)
         RETURNING id::text as id`
      );
      const id = inserted.rows[0].id;

      const response = await app.inject({
        method: 'PUT',
        url: `/api/work-items/${id}`,
        payload: {
          title: 'Clear estimates',
          estimateMinutes: null,
          actualMinutes: null,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.estimate_minutes).toBeNull();
      expect(body.actual_minutes).toBeNull();
    });

    it('preserves estimate/actual when fields not provided in update', async () => {
      const inserted = await pool.query(
        `INSERT INTO work_item (title, estimate_minutes, actual_minutes)
         VALUES ('Preserve estimates', 60, 30)
         RETURNING id::text as id`
      );
      const id = inserted.rows[0].id;

      const response = await app.inject({
        method: 'PUT',
        url: `/api/work-items/${id}`,
        payload: {
          title: 'Only title changed',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.estimate_minutes).toBe(60);
      expect(body.actual_minutes).toBe(30);
    });

    it('rejects invalid estimate values', async () => {
      const inserted = await pool.query(
        `INSERT INTO work_item (title)
         VALUES ('Test')
         RETURNING id::text as id`
      );
      const id = inserted.rows[0].id;

      const negativeResponse = await app.inject({
        method: 'PUT',
        url: `/api/work-items/${id}`,
        payload: {
          title: 'Test',
          estimateMinutes: -5,
        },
      });
      expect(negativeResponse.statusCode).toBe(400);

      const tooBigResponse = await app.inject({
        method: 'PUT',
        url: `/api/work-items/${id}`,
        payload: {
          title: 'Test',
          actualMinutes: 600000,
        },
      });
      expect(tooBigResponse.statusCode).toBe(400);
    });
  });
});

describe('Effort rollups in API', () => {
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

  it('GET /api/work-items/:id/rollup returns aggregated estimates for hierarchy', async () => {
    // Create hierarchy: project -> initiative -> epic -> issues
    const project = await pool.query(
      `INSERT INTO work_item (title, work_item_kind, estimate_minutes, actual_minutes)
       VALUES ('Project', 'project', 10, 5)
       RETURNING id::text as id`
    );

    const initiative = await pool.query(
      `INSERT INTO work_item (title, work_item_kind, parent_work_item_id, estimate_minutes, actual_minutes)
       VALUES ('Initiative', 'initiative', $1, 20, 10)
       RETURNING id::text as id`,
      [project.rows[0].id]
    );

    const epic = await pool.query(
      `INSERT INTO work_item (title, work_item_kind, parent_work_item_id, estimate_minutes, actual_minutes)
       VALUES ('Epic', 'epic', $1, 30, 15)
       RETURNING id::text as id`,
      [initiative.rows[0].id]
    );

    await pool.query(
      `INSERT INTO work_item (title, work_item_kind, parent_work_item_id, estimate_minutes, actual_minutes)
       VALUES ('Issue A', 'issue', $1, 40, 20)`,
      [epic.rows[0].id]
    );

    await pool.query(
      `INSERT INTO work_item (title, work_item_kind, parent_work_item_id, estimate_minutes, actual_minutes)
       VALUES ('Issue B', 'issue', $1, 50, 25)`,
      [epic.rows[0].id]
    );

    // Test project rollup
    const projectResponse = await app.inject({
      method: 'GET',
      url: `/api/work-items/${project.rows[0].id}/rollup`,
    });

    expect(projectResponse.statusCode).toBe(200);
    const projectRollup = projectResponse.json();
    expect(projectRollup.total_estimate_minutes).toBe(150); // 10 + 20 + 30 + 40 + 50
    expect(projectRollup.total_actual_minutes).toBe(75);    // 5 + 10 + 15 + 20 + 25

    // Test epic rollup
    const epicResponse = await app.inject({
      method: 'GET',
      url: `/api/work-items/${epic.rows[0].id}/rollup`,
    });

    expect(epicResponse.statusCode).toBe(200);
    const epicRollup = epicResponse.json();
    expect(epicRollup.total_estimate_minutes).toBe(120); // 30 + 40 + 50
    expect(epicRollup.total_actual_minutes).toBe(60);    // 15 + 20 + 25
  });

  it('returns 404 for rollup of non-existent work item', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/work-items/00000000-0000-0000-0000-000000000000/rollup',
    });

    expect(response.statusCode).toBe(404);
  });
});
