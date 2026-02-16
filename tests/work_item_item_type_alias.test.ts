/**
 * Tests for issue #1347: Plugin sends item_type which POST /api/work-items silently ignores.
 *
 * Verifies:
 * - POST /api/work-items accepts `item_type` as alias for `kind`/`type`
 * - `item_type` is respected when `type` and `kind` are absent
 * - `type` still takes precedence over `item_type` when both are present
 * - `kind` takes precedence over `item_type` when `type` is absent
 * - Invalid `item_type` values are rejected
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

describe('POST /api/work-items — item_type alias (Issue #1347)', () => {
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

  it('accepts item_type as work_item_kind', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/work-items',
      payload: {
        title: 'My project via item_type',
        item_type: 'project',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; kind: string };
    expect(body.id).toBeDefined();
    // Verify work_item_kind in DB
    const row = await pool.query(
      'SELECT work_item_kind FROM work_item WHERE id = $1',
      [body.id],
    );
    expect(row.rows.length).toBe(1);
    expect(row.rows[0].work_item_kind).toBe('project');
  });

  it('uses item_type: task correctly', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/work-items',
      payload: {
        title: 'A task via item_type',
        item_type: 'task',
      },
    });

    expect(res.statusCode).toBe(201);
    const row = await pool.query(
      'SELECT work_item_kind FROM work_item WHERE id = $1',
      [res.json<{ id: string }>().id],
    );
    expect(row.rows[0].work_item_kind).toBe('task');
  });

  it('type takes precedence over item_type', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/work-items',
      payload: {
        title: 'Precedence test',
        type: 'task',
        item_type: 'project',
      },
    });

    expect(res.statusCode).toBe(201);
    const row = await pool.query(
      'SELECT work_item_kind FROM work_item WHERE id = $1',
      [res.json<{ id: string }>().id],
    );
    expect(row.rows[0].work_item_kind).toBe('task');
  });

  it('kind takes precedence over item_type when type is absent', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/work-items',
      payload: {
        title: 'Kind precedence test',
        kind: 'task',
        item_type: 'project',
      },
    });

    expect(res.statusCode).toBe(201);
    const row = await pool.query(
      'SELECT work_item_kind FROM work_item WHERE id = $1',
      [res.json<{ id: string }>().id],
    );
    expect(row.rows[0].work_item_kind).toBe('task');
  });

  it('defaults to issue when no type/kind/item_type provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/work-items',
      payload: {
        title: 'Default kind test',
      },
    });

    expect(res.statusCode).toBe(201);
    const row = await pool.query(
      'SELECT work_item_kind FROM work_item WHERE id = $1',
      [res.json<{ id: string }>().id],
    );
    expect(row.rows[0].work_item_kind).toBe('issue');
  });

  it('rejects invalid item_type value', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/work-items',
      payload: {
        title: 'Invalid item_type',
        item_type: 'banana',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string };
    expect(body.error).toContain('must be one of');
  });
});
