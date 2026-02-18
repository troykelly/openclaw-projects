/**
 * Tests for recurrence API endpoints.
 * Part of Issue #217.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Pool } from 'pg';
import { buildServer } from '../../src/api/server.ts';
import { createTestPool, truncateAllTables } from '../helpers/db.ts';

describe('Recurrence API Endpoints', () => {
  const originalEnv = process.env;
  let pool: Pool;
  let app: ReturnType<typeof buildServer>;

  beforeEach(async () => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.OPENCLAW_PROJECTS_AUTH_DISABLED = 'true';

    pool = createTestPool();
    await truncateAllTables(pool);
    app = buildServer({ logger: false });
  });

  afterEach(async () => {
    process.env = originalEnv;
    await pool.end();
  });

  describe('POST /api/work-items with recurrence', () => {
    it('creates a recurring work item with recurrence_rule', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'Daily Standup',
          recurrence_rule: 'RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.id).toBeDefined();
      expect(body.is_recurrence_template).toBe(true);
      expect(body.recurrence_rule).toBe('RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0');
    });

    it('creates a recurring work item with recurrence_natural', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'Morning Review',
          recurrence_natural: 'every weekday at 9am',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.is_recurrence_template).toBe(true);
      expect(body.recurrence_rule).toContain('FREQ=WEEKLY');
      expect(body.recurrence_rule).toContain('BYDAY=MO,TU,WE,TH,FR');
    });

    it('creates a non-recurring work item when recurrence_natural is not recurring', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'One-time Task',
          recurrence_natural: 'tomorrow',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.is_recurrence_template).toBe(false);
      expect(body.recurrence_rule).toBeNull();
    });

    it('creates a recurring work item with recurrence_end', async () => {
      const endDate = new Date();
      endDate.setMonth(endDate.getMonth() + 1);

      const response = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'Limited Recurrence',
          recurrence_rule: 'RRULE:FREQ=WEEKLY',
          recurrence_end: endDate.toISOString(),
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.recurrence_end).toBeDefined();
    });

    it('returns 400 for invalid recurrence_end', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'Bad End Date',
          recurrence_rule: 'RRULE:FREQ=DAILY',
          recurrence_end: 'not-a-date',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('Invalid recurrence_end');
    });
  });

  describe('GET /api/work-items/:id/recurrence', () => {
    it('returns recurrence info for a template', async () => {
      // Create a template
      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'Recurring Task',
          recurrence_rule: 'RRULE:FREQ=DAILY',
        },
      });
      const templateId = createResponse.json().id;

      const response = await app.inject({
        method: 'GET',
        url: `/api/work-items/${templateId}/recurrence`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.rule).toBe('RRULE:FREQ=DAILY');
      expect(body.rule_description).toContain('Every day');
      expect(body.is_template).toBe(true);
      expect(body.next_occurrence).toBeDefined();
    });

    it('returns 404 for non-recurring work item', async () => {
      // Create a non-recurring work item
      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Regular Task' },
      });
      const taskId = createResponse.json().id;

      const response = await app.inject({
        method: 'GET',
        url: `/api/work-items/${taskId}/recurrence`,
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 404 for non-existent work item', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/work-items/00000000-0000-0000-0000-000000000000/recurrence',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('PUT /api/work-items/:id/recurrence', () => {
    it('updates recurrence rule', async () => {
      // Create a template
      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'Recurring Task',
          recurrence_rule: 'RRULE:FREQ=DAILY',
        },
      });
      const templateId = createResponse.json().id;

      const response = await app.inject({
        method: 'PUT',
        url: `/api/work-items/${templateId}/recurrence`,
        payload: {
          recurrence_rule: 'RRULE:FREQ=WEEKLY',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.recurrence.rule).toBe('RRULE:FREQ=WEEKLY');
    });

    it('updates recurrence using natural language', async () => {
      // Create a template
      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'Recurring Task',
          recurrence_rule: 'RRULE:FREQ=DAILY',
        },
      });
      const templateId = createResponse.json().id;

      const response = await app.inject({
        method: 'PUT',
        url: `/api/work-items/${templateId}/recurrence`,
        payload: {
          recurrence_natural: 'every Monday at 10am',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.recurrence.rule).toContain('BYDAY=MO');
    });

    it('updates recurrence end date', async () => {
      // Create a template
      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'Recurring Task',
          recurrence_rule: 'RRULE:FREQ=DAILY',
        },
      });
      const templateId = createResponse.json().id;

      const endDate = new Date();
      endDate.setMonth(endDate.getMonth() + 2);

      const response = await app.inject({
        method: 'PUT',
        url: `/api/work-items/${templateId}/recurrence`,
        payload: {
          recurrence_end: endDate.toISOString(),
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.recurrence.end).toBeDefined();
    });

    it('returns 400 for invalid natural language', async () => {
      // Create a template
      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'Recurring Task',
          recurrence_rule: 'RRULE:FREQ=DAILY',
        },
      });
      const templateId = createResponse.json().id;

      const response = await app.inject({
        method: 'PUT',
        url: `/api/work-items/${templateId}/recurrence`,
        payload: {
          recurrence_natural: 'random gibberish',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('Could not parse');
    });
  });

  describe('DELETE /api/work-items/:id/recurrence', () => {
    it('stops recurrence for a template', async () => {
      // Create a template
      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'Recurring Task',
          recurrence_rule: 'RRULE:FREQ=DAILY',
        },
      });
      const templateId = createResponse.json().id;

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/work-items/${templateId}/recurrence`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);

      // Verify it's no longer a template
      const checkResponse = await app.inject({
        method: 'GET',
        url: `/api/work-items/${templateId}/recurrence`,
      });
      expect(checkResponse.statusCode).toBe(404);
    });

    it('returns 404 for non-existent work item', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/work-items/00000000-0000-0000-0000-000000000000/recurrence',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /api/work-items/:id/instances', () => {
    it('returns instances of a template', async () => {
      // Create a template
      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'Recurring Task',
          recurrence_rule: 'RRULE:FREQ=DAILY',
        },
      });
      const templateId = createResponse.json().id;

      // Generate instances
      await app.inject({
        method: 'POST',
        url: '/api/recurrence/generate',
        payload: { daysAhead: 3 },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/work-items/${templateId}/instances`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.instances).toBeDefined();
      expect(Array.isArray(body.instances)).toBe(true);
      expect(body.count).toBeDefined();
    });

    it('returns empty array for non-template', async () => {
      // Create a non-recurring work item
      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Regular Task' },
      });
      const taskId = createResponse.json().id;

      const response = await app.inject({
        method: 'GET',
        url: `/api/work-items/${taskId}/instances`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().instances).toHaveLength(0);
    });
  });

  describe('GET /api/recurrence/templates', () => {
    it('returns all recurrence templates', async () => {
      // Create some templates
      await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'Template 1',
          recurrence_rule: 'RRULE:FREQ=DAILY',
        },
      });
      await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'Template 2',
          recurrence_rule: 'RRULE:FREQ=WEEKLY',
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/recurrence/templates',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.templates).toHaveLength(2);
      expect(body.count).toBe(2);
    });

    it('supports pagination', async () => {
      // Create templates
      for (let i = 0; i < 5; i++) {
        await app.inject({
          method: 'POST',
          url: '/api/work-items',
          payload: {
            title: `Template ${i}`,
            recurrence_rule: 'RRULE:FREQ=DAILY',
          },
        });
      }

      const response = await app.inject({
        method: 'GET',
        url: '/api/recurrence/templates?limit=2&offset=0',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().templates).toHaveLength(2);
    });
  });

  describe('POST /api/recurrence/generate', () => {
    it('generates upcoming instances', async () => {
      // Create a template
      await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'Daily Task',
          recurrence_rule: 'RRULE:FREQ=DAILY',
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/recurrence/generate',
        payload: { daysAhead: 3 },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.generated).toBeGreaterThan(0);
      expect(body.errors).toHaveLength(0);
    });

    it('uses default daysAhead when not specified', async () => {
      // Create a template
      await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'Daily Task',
          recurrence_rule: 'RRULE:FREQ=DAILY',
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/recurrence/generate',
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);
    });
  });
});
