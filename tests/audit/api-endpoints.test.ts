/**
 * Tests for audit log API endpoints.
 * Part of Issue #214.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Pool } from 'pg';
import { buildServer } from '../../src/api/server.ts';
import { createTestPool, truncateAllTables } from '../helpers/db.ts';

describe('Audit Log API Endpoints', () => {
  const originalEnv = process.env;
  let pool: Pool;
  let app: ReturnType<typeof buildServer>;

  beforeEach(async () => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.OPENCLAW_PROJECTS_AUTH_DISABLED = 'true';

    pool = createTestPool();
    await truncateAllTables(pool);
    // Clear the audit_log table after truncation
    await pool.query('TRUNCATE TABLE audit_log CASCADE');
    app = buildServer({ logger: false });
  });

  afterEach(async () => {
    process.env = originalEnv;
    await pool.end();
  });

  describe('GET /api/audit-log', () => {
    beforeEach(async () => {
      // Create some work items to generate audit entries via triggers
      await pool.query(`INSERT INTO work_item (title) VALUES ('Task 1')`);
      await pool.query(`INSERT INTO work_item (title) VALUES ('Task 2')`);
      await pool.query(`INSERT INTO contact (display_name) VALUES ('Contact 1')`);
    });

    it('returns all audit log entries', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/audit-log',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.entries).toBeDefined();
      expect(body.total).toBeDefined();
      expect(body.entries.length).toBeGreaterThanOrEqual(3);
    });

    it('filters by entity type', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/audit-log?entity_type=work_item',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.entries.every((e: { entity_type: string }) => e.entity_type === 'work_item')).toBe(true);
    });

    it('filters by action', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/audit-log?action=create',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.entries.every((e: { action: string }) => e.action === 'create')).toBe(true);
    });

    it('supports pagination', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/audit-log?limit=1&offset=0',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.entries.length).toBe(1);
      expect(body.limit).toBe(1);
      expect(body.offset).toBe(0);
    });

    it('filters by date range', async () => {
      // Get entries created in the last hour (the entries were created in beforeEach)
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

      const response = await app.inject({
        method: 'GET',
        url: `/api/audit-log?start_date=${hourAgo.toISOString()}&end_date=${tomorrow.toISOString()}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.entries.length).toBeGreaterThan(0);
    });

    it('returns 400 for invalid actor_type', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/audit-log?actor_type=invalid',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('Invalid actor_type');
    });

    it('returns 400 for invalid action', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/audit-log?action=invalid',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('Invalid action');
    });

    it('returns 400 for invalid date format', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/audit-log?start_date=not-a-date',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('Invalid start_date');
    });
  });

  describe('GET /api/audit-log/entity/:type/:id', () => {
    it('returns audit log for a specific entity', async () => {
      // Create a work item to generate audit entries
      const result = await pool.query(`INSERT INTO work_item (title) VALUES ('Audit Test Task') RETURNING id::text`);
      const work_item_id = result.rows[0].id;

      // Update the work item to create another audit entry
      await pool.query(`UPDATE work_item SET title = 'Updated Task' WHERE id = $1`, [work_item_id]);

      const response = await app.inject({
        method: 'GET',
        url: `/api/audit-log/entity/work_item/${work_item_id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.entity_type).toBe('work_item');
      expect(body.entity_id).toBe(work_item_id);
      expect(body.entries.length).toBe(2);
      expect(body.count).toBe(2);
    });

    it('returns empty array for non-existent entity', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/audit-log/entity/work_item/00000000-0000-0000-0000-000000000000',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.entries).toHaveLength(0);
    });

    it('supports pagination', async () => {
      const result = await pool.query(`INSERT INTO work_item (title) VALUES ('Pagination Test') RETURNING id::text`);
      const work_item_id = result.rows[0].id;

      // Create multiple updates
      for (let i = 0; i < 3; i++) {
        await pool.query(`UPDATE work_item SET title = $1 WHERE id = $2`, [`Title ${i}`, work_item_id]);
      }

      const response = await app.inject({
        method: 'GET',
        url: `/api/audit-log/entity/work_item/${work_item_id}?limit=2`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.entries.length).toBe(2);
    });
  });

  describe('POST /api/audit-log/purge', () => {
    it('purges old entries', async () => {
      // Create an entry
      await pool.query(`INSERT INTO work_item (title) VALUES ('Old Task')`);

      // Make it old
      await pool.query(`UPDATE audit_log SET timestamp = now() - INTERVAL '100 days'`);

      const response = await app.inject({
        method: 'POST',
        url: '/api/audit-log/purge',
        payload: { retention_days: 90 },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.purged).toBeGreaterThan(0);
    });

    it('uses default retention days', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/audit-log/purge',
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.retention_days).toBe(90);
    });

    it('accepts positive retention days in valid range', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/audit-log/purge',
        payload: { retention_days: 30 },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().retention_days).toBe(30);
    });

    it('returns 400 for retention days too large', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/audit-log/purge',
        payload: { retention_days: 5000 },
      });

      expect(response.statusCode).toBe(400);
    });
  });
});

describe('Audit Log Trigger Verification via API', () => {
  const originalEnv = process.env;
  let pool: Pool;
  let app: ReturnType<typeof buildServer>;

  beforeEach(async () => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.OPENCLAW_PROJECTS_AUTH_DISABLED = 'true';

    pool = createTestPool();
    await truncateAllTables(pool);
    await pool.query('TRUNCATE TABLE audit_log CASCADE');
    app = buildServer({ logger: false });
  });

  afterEach(async () => {
    process.env = originalEnv;
    await pool.end();
  });

  it('creates audit entry when work item is created via API', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/work-items',
      payload: { title: 'API Created Task' },
    });

    expect(createResponse.statusCode).toBe(201);
    const work_item_id = createResponse.json().id;

    const auditResponse = await app.inject({
      method: 'GET',
      url: `/api/audit-log/entity/work_item/${work_item_id}`,
    });

    expect(auditResponse.statusCode).toBe(200);
    const body = auditResponse.json();
    // Embedding hooks may trigger additional UPDATE audit entries after creation
    expect(body.entries.length).toBeGreaterThanOrEqual(1);
    const createEntry = body.entries.find((e: { action: string }) => e.action === 'create');
    expect(createEntry).toBeDefined();
  });

  it('creates audit entry when contact is created via API', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { display_name: 'API Created Contact' },
    });

    expect(createResponse.statusCode).toBe(201);
    const contact_id = createResponse.json().id;

    const auditResponse = await app.inject({
      method: 'GET',
      url: `/api/audit-log/entity/contact/${contact_id}`,
    });

    expect(auditResponse.statusCode).toBe(200);
    const body = auditResponse.json();
    expect(body.entries.length).toBe(1);
    expect(body.entries[0].action).toBe('create');
  });

  it('creates audit entry when memory is created directly', async () => {
    // Create memory directly in the database
    const result = await pool.query(
      `INSERT INTO memory (title, content, memory_type)
       VALUES ('Test Memory', 'Test content', 'note')
       RETURNING id::text`,
    );
    const memory_id = result.rows[0].id;

    const auditResponse = await app.inject({
      method: 'GET',
      url: `/api/audit-log/entity/memory/${memory_id}`,
    });

    expect(auditResponse.statusCode).toBe(200);
    const body = auditResponse.json();
    expect(body.entries.length).toBe(1);
    expect(body.entries[0].action).toBe('create');
  });
});
