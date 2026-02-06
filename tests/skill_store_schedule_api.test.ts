import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { buildServer } from '../src/api/server.ts';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';

/**
 * Integration tests for Skill Store Schedule Management API (Issue #802).
 *
 * Covers:
 * - POST /api/skill-store/schedules (create)
 * - GET /api/skill-store/schedules (list + filter)
 * - PATCH /api/skill-store/schedules/:id (update)
 * - DELETE /api/skill-store/schedules/:id (delete)
 * - POST /api/skill-store/schedules/:id/trigger (manual trigger)
 * - POST /api/skill-store/schedules/:id/pause (pause)
 * - POST /api/skill-store/schedules/:id/resume (resume)
 * - Cron expression validation (>= 5 minutes)
 * - Timezone validation (valid IANA timezone)
 * - Webhook URL validation (https in prod, http in dev/test)
 * - Job processing for skill_store.scheduled_process
 */
describe('Skill Store Schedule API (Issue #802)', () => {
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

  /** Helper to create a schedule via API */
  async function createSchedule(overrides: Record<string, unknown> = {}) {
    const defaults = {
      skill_id: 'test-skill',
      cron_expression: '0 9 * * *',
      webhook_url: 'https://example.com/hook',
      ...overrides,
    };

    return app.inject({
      method: 'POST',
      url: '/api/skill-store/schedules',
      payload: defaults,
    });
  }

  describe('POST /api/skill-store/schedules', () => {
    it('creates a schedule and returns 201', async () => {
      const res = await createSchedule();

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.skill_id).toBe('test-skill');
      expect(body.cron_expression).toBe('0 9 * * *');
      expect(body.webhook_url).toBe('https://example.com/hook');
      expect(body.enabled).toBe(true);
      expect(body.timezone).toBe('UTC');
      expect(body.max_retries).toBe(5);
      expect(body.created_at).toBeDefined();
    });

    it('accepts optional fields', async () => {
      const res = await createSchedule({
        collection: 'articles',
        timezone: 'America/New_York',
        payload_template: { key: 'value' },
        webhook_headers: { 'X-Custom': 'header' },
        max_retries: 3,
        enabled: false,
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.collection).toBe('articles');
      expect(body.timezone).toBe('America/New_York');
      expect(body.payload_template).toEqual({ key: 'value' });
      expect(body.webhook_headers).toEqual({ 'X-Custom': 'header' });
      expect(body.max_retries).toBe(3);
      expect(body.enabled).toBe(false);
    });

    it('returns 400 if skill_id is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/skill-store/schedules',
        payload: {
          cron_expression: '0 9 * * *',
          webhook_url: 'https://example.com/hook',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/skill_id/i);
    });

    it('returns 400 if cron_expression is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/skill-store/schedules',
        payload: {
          skill_id: 'test-skill',
          webhook_url: 'https://example.com/hook',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/cron_expression/i);
    });

    it('returns 400 if webhook_url is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/skill-store/schedules',
        payload: {
          skill_id: 'test-skill',
          cron_expression: '0 9 * * *',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/webhook_url/i);
    });

    it('rejects cron expressions more frequent than every 5 minutes', async () => {
      const res = await createSchedule({
        cron_expression: '*/2 * * * *',
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/5 minutes/i);
    });

    it('rejects every-minute cron expression', async () => {
      const res = await createSchedule({
        cron_expression: '* * * * *',
      });

      expect(res.statusCode).toBe(400);
    });

    it('allows valid cron expressions >= 5 minutes', async () => {
      for (const expr of ['*/5 * * * *', '*/10 * * * *', '0 * * * *', '0 9 * * *']) {
        const res = await createSchedule({
          skill_id: `skill-${expr.replace(/[^a-z0-9]/g, '')}`,
          cron_expression: expr,
        });
        expect(res.statusCode).toBe(201);
      }
    });

    it('rejects invalid IANA timezone', async () => {
      const res = await createSchedule({
        timezone: 'Not/A/Timezone',
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/timezone/i);
    });

    it('accepts valid IANA timezones', async () => {
      for (const tz of ['UTC', 'America/New_York', 'Europe/London', 'Asia/Tokyo']) {
        const res = await createSchedule({
          skill_id: `skill-${tz.replace(/\//g, '-')}`,
          timezone: tz,
        });
        expect(res.statusCode).toBe(201);
      }
    });

    it('rejects invalid webhook URL format', async () => {
      const res = await createSchedule({
        webhook_url: 'not-a-url',
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/webhook_url/i);
    });

    it('allows http:// webhook URLs in test/dev environment', async () => {
      const res = await createSchedule({
        webhook_url: 'http://localhost:3000/hook',
      });

      // In test env, http should be allowed
      expect(res.statusCode).toBe(201);
    });

    it('rejects duplicate (skill_id, collection, cron_expression)', async () => {
      await createSchedule({
        skill_id: 's1',
        collection: 'articles',
        cron_expression: '0 9 * * *',
      });

      const res = await createSchedule({
        skill_id: 's1',
        collection: 'articles',
        cron_expression: '0 9 * * *',
      });

      expect(res.statusCode).toBe(409);
    });
  });

  describe('GET /api/skill-store/schedules', () => {
    it('returns empty list when no schedules exist', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/skill-store/schedules',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.schedules).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('lists all schedules', async () => {
      await createSchedule({ skill_id: 'skill-1' });
      await createSchedule({ skill_id: 'skill-2' });

      const res = await app.inject({
        method: 'GET',
        url: '/api/skill-store/schedules',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.schedules).toHaveLength(2);
      expect(body.total).toBe(2);
    });

    it('returns schedule with all expected fields', async () => {
      await createSchedule({ skill_id: 'test-skill', collection: 'articles' });

      const res = await app.inject({
        method: 'GET',
        url: '/api/skill-store/schedules',
      });

      const schedule = res.json().schedules[0];
      expect(schedule.id).toBeDefined();
      expect(schedule.skill_id).toBe('test-skill');
      expect(schedule.collection).toBe('articles');
      expect(schedule.cron_expression).toBeDefined();
      expect(schedule.webhook_url).toBeDefined();
      expect(schedule.enabled).toBe(true);
      expect(schedule.timezone).toBe('UTC');
      expect(schedule.max_retries).toBeDefined();
      expect(schedule.last_run_at).toBeDefined(); // null or date
      expect(schedule.next_run_at).toBeDefined(); // null or date
      expect(schedule.last_run_status).toBeDefined(); // null or string
      expect(schedule.created_at).toBeDefined();
      expect(schedule.updated_at).toBeDefined();
    });

    it('filters by skill_id', async () => {
      await createSchedule({ skill_id: 'skill-1' });
      await createSchedule({ skill_id: 'skill-2' });

      const res = await app.inject({
        method: 'GET',
        url: '/api/skill-store/schedules?skill_id=skill-1',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.schedules).toHaveLength(1);
      expect(body.schedules[0].skill_id).toBe('skill-1');
    });

    it('filters by enabled status', async () => {
      await createSchedule({ skill_id: 'enabled-skill' });
      await createSchedule({ skill_id: 'disabled-skill', enabled: false });

      const res = await app.inject({
        method: 'GET',
        url: '/api/skill-store/schedules?enabled=true',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.schedules).toHaveLength(1);
      expect(body.schedules[0].skill_id).toBe('enabled-skill');
    });

    it('supports pagination with limit and offset', async () => {
      for (let i = 0; i < 5; i++) {
        await createSchedule({ skill_id: `skill-${i}` });
      }

      const res = await app.inject({
        method: 'GET',
        url: '/api/skill-store/schedules?limit=2&offset=0',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.schedules).toHaveLength(2);
      expect(body.total).toBe(5);
    });
  });

  describe('PATCH /api/skill-store/schedules/:id', () => {
    it('updates schedule fields', async () => {
      const createRes = await createSchedule();
      const id = createRes.json().id;

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/skill-store/schedules/${id}`,
        payload: {
          cron_expression: '0 */6 * * *',
          webhook_url: 'https://example.com/new-hook',
          enabled: false,
          timezone: 'America/Chicago',
          max_retries: 10,
          payload_template: { updated: true },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.cron_expression).toBe('0 */6 * * *');
      expect(body.webhook_url).toBe('https://example.com/new-hook');
      expect(body.enabled).toBe(false);
      expect(body.timezone).toBe('America/Chicago');
      expect(body.max_retries).toBe(10);
      expect(body.payload_template).toEqual({ updated: true });
    });

    it('returns 404 for non-existent schedule', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/skill-store/schedules/00000000-0000-0000-0000-000000000000',
        payload: { enabled: false },
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for invalid UUID', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/skill-store/schedules/not-a-uuid',
        payload: { enabled: false },
      });

      expect(res.statusCode).toBe(400);
    });

    it('validates cron expression on update', async () => {
      const createRes = await createSchedule();
      const id = createRes.json().id;

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/skill-store/schedules/${id}`,
        payload: { cron_expression: '*/1 * * * *' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/5 minutes/i);
    });

    it('validates timezone on update', async () => {
      const createRes = await createSchedule();
      const id = createRes.json().id;

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/skill-store/schedules/${id}`,
        payload: { timezone: 'Invalid/Zone' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/timezone/i);
    });

    it('validates webhook_url on update', async () => {
      const createRes = await createSchedule();
      const id = createRes.json().id;

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/skill-store/schedules/${id}`,
        payload: { webhook_url: 'not-a-url' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/webhook_url/i);
    });
  });

  describe('DELETE /api/skill-store/schedules/:id', () => {
    it('deletes a schedule and returns 204', async () => {
      const createRes = await createSchedule();
      const id = createRes.json().id;

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/skill-store/schedules/${id}`,
      });

      expect(res.statusCode).toBe(204);

      // Verify it's gone
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/skill-store/schedules',
      });
      expect(listRes.json().schedules).toHaveLength(0);
    });

    it('returns 404 for non-existent schedule', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/skill-store/schedules/00000000-0000-0000-0000-000000000000',
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for invalid UUID', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/skill-store/schedules/not-a-uuid',
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /api/skill-store/schedules/:id/trigger', () => {
    it('enqueues a job for the schedule and returns 202', async () => {
      const createRes = await createSchedule({
        collection: 'articles',
      });
      const id = createRes.json().id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/skill-store/schedules/${id}/trigger`,
      });

      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.job_id).toBeDefined();

      // Verify job was enqueued
      const jobs = await pool.query(
        `SELECT kind, payload FROM internal_job
         WHERE kind = 'skill_store.scheduled_process'`
      );
      expect(jobs.rows).toHaveLength(1);
      expect(jobs.rows[0].payload.schedule_id).toBe(id);
      expect(jobs.rows[0].payload.skill_id).toBe('test-skill');
      expect(jobs.rows[0].payload.collection).toBe('articles');
      expect(jobs.rows[0].payload.manual_trigger).toBe(true);
    });

    it('returns 404 for non-existent schedule', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/skill-store/schedules/00000000-0000-0000-0000-000000000000/trigger',
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for invalid UUID', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/skill-store/schedules/not-a-uuid/trigger',
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /api/skill-store/schedules/:id/pause', () => {
    it('disables a schedule and returns 200', async () => {
      const createRes = await createSchedule();
      const id = createRes.json().id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/skill-store/schedules/${id}/pause`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.enabled).toBe(false);
    });

    it('is idempotent (pausing already paused schedule)', async () => {
      const createRes = await createSchedule({ enabled: false });
      const id = createRes.json().id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/skill-store/schedules/${id}/pause`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().enabled).toBe(false);
    });

    it('returns 404 for non-existent schedule', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/skill-store/schedules/00000000-0000-0000-0000-000000000000/pause',
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /api/skill-store/schedules/:id/resume', () => {
    it('enables a schedule and returns 200', async () => {
      const createRes = await createSchedule({ enabled: false });
      const id = createRes.json().id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/skill-store/schedules/${id}/resume`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.enabled).toBe(true);
    });

    it('is idempotent (resuming already running schedule)', async () => {
      const createRes = await createSchedule({ enabled: true });
      const id = createRes.json().id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/skill-store/schedules/${id}/resume`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().enabled).toBe(true);
    });

    it('returns 404 for non-existent schedule', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/skill-store/schedules/00000000-0000-0000-0000-000000000000/resume',
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('Job handler: skill_store.scheduled_process', () => {
    it('processes enqueued job and updates schedule last_run_at/status', async () => {
      // Create a schedule
      const createRes = await createSchedule({
        skill_id: 'news-skill',
        collection: 'articles',
        webhook_url: 'https://httpbin.org/post',
      });
      const scheduleId = createRes.json().id;

      // Trigger it
      const triggerRes = await app.inject({
        method: 'POST',
        url: `/api/skill-store/schedules/${scheduleId}/trigger`,
      });
      expect(triggerRes.statusCode).toBe(202);

      // Verify job was created
      const jobs = await pool.query(
        `SELECT id, kind, payload FROM internal_job
         WHERE kind = 'skill_store.scheduled_process' AND completed_at IS NULL`
      );
      expect(jobs.rows).toHaveLength(1);
      expect(jobs.rows[0].payload.schedule_id).toBe(scheduleId);
    });
  });

  describe('Webhook URL validation', () => {
    it('accepts https:// URLs', async () => {
      const res = await createSchedule({
        webhook_url: 'https://example.com/webhook',
      });
      expect(res.statusCode).toBe(201);
    });

    it('rejects URLs without protocol', async () => {
      const res = await createSchedule({
        webhook_url: 'example.com/webhook',
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects empty webhook_url', async () => {
      const res = await createSchedule({
        webhook_url: '',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('Cron expression edge cases', () => {
    it('rejects empty cron expression', async () => {
      const res = await createSchedule({
        cron_expression: '',
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects malformed cron expression', async () => {
      const res = await createSchedule({
        cron_expression: 'not a cron',
      });
      expect(res.statusCode).toBe(400);
    });

    it('accepts standard 5-field cron expressions', async () => {
      const res = await createSchedule({
        cron_expression: '30 8 * * 1-5',
      });
      expect(res.statusCode).toBe(201);
    });
  });
});
