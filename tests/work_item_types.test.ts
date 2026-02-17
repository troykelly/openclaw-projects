/**
 * Work Item Type Handling Tests
 * Issue #1135 - Work items have no project/task distinction
 *
 * Tests that:
 * 1. CREATE endpoint correctly maps client's 'type' to database 'kind'
 * 2. LIST endpoint filters by item_type query parameter
 * 3. Different kinds (project, epic, initiative, issue, task) are stored correctly
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';
import type { FastifyInstance } from 'fastify';

describe('Work Item Type Handling (Issue #1135)', () => {
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

  describe('CREATE endpoint', () => {
    it('should create a project when type=project is sent', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'Test Project',
          type: 'project',
        },
      });

      expect(response.statusCode).toBe(201);
      const data = response.json() as { kind: string };
      expect(data.kind).toBe('project');
    });

    it('should create a task when type=task is sent', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'Test Task',
          type: 'task',
        },
      });

      expect(response.statusCode).toBe(201);
      const data = response.json() as { kind: string };
      expect(data.kind).toBe('task');
    });

    it('should create an epic with initiative parent when type=epic', async () => {
      // First create a project
      const projectResponse = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'Parent Project',
          type: 'project',
        },
      });
      const project = projectResponse.json() as { id: string };

      // Then create an initiative under it
      const initiativeResponse = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'Parent Initiative',
          type: 'initiative',
          parent_id: project.id,
        },
      });
      const initiative = initiativeResponse.json() as { id: string };

      // Finally create an epic under the initiative
      const epicResponse = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'Test Epic',
          type: 'epic',
          parent_id: initiative.id,
        },
      });

      expect(epicResponse.statusCode).toBe(201);
      const epic = epicResponse.json() as { kind: string; parent_id: string };
      expect(epic.kind).toBe('epic');
      expect(epic.parent_id).toBe(initiative.id);
    });

    it('should still support kind parameter for backwards compatibility', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'Test Issue with kind',
          kind: 'issue',
        },
      });

      expect(response.statusCode).toBe(201);
      const data = response.json() as { kind: string };
      expect(data.kind).toBe('issue');
    });
  });

  describe('LIST endpoint with item_type filter', () => {
    let project_id: string;
    let taskId: string;
    let issueId: string;

    beforeEach(async () => {
      // Create a project
      const projectResponse = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'Filter Test Project',
          type: 'project',
        },
      });
      const project = projectResponse.json() as { id: string };
      project_id = project.id;

      // Create a task
      const taskResponse = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'Filter Test Task',
          type: 'task',
        },
      });
      const task = taskResponse.json() as { id: string };
      taskId = task.id;

      // Create an issue
      const issueResponse = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'Filter Test Issue',
          type: 'issue',
        },
      });
      const issue = issueResponse.json() as { id: string };
      issueId = issue.id;
    });

    it('should return only projects when item_type=project', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/work-items?item_type=project',
      });
      expect(response.statusCode).toBe(200);
      const data = response.json() as { items: Array<{ kind: string; id: string }> };

      expect(data.items).toBeInstanceOf(Array);
      expect(data.items.length).toBeGreaterThan(0);

      // All items should be projects
      for (const item of data.items) {
        expect(item.kind).toBe('project');
      }

      // Should include our test project
      const hasTestProject = data.items.some((item) => item.id === project_id);
      expect(hasTestProject).toBe(true);
    });

    it('should return only tasks when item_type=task', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/work-items?item_type=task',
      });
      expect(response.statusCode).toBe(200);
      const data = response.json() as { items: Array<{ kind: string; id: string }> };

      expect(data.items).toBeInstanceOf(Array);
      expect(data.items.length).toBeGreaterThan(0);

      // All items should be tasks
      for (const item of data.items) {
        expect(item.kind).toBe('task');
      }

      // Should include our test task
      const hasTestTask = data.items.some((item) => item.id === taskId);
      expect(hasTestTask).toBe(true);
    });

    it('should return only issues when item_type=issue', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/work-items?item_type=issue',
      });
      expect(response.statusCode).toBe(200);
      const data = response.json() as { items: Array<{ kind: string; id: string }> };

      expect(data.items).toBeInstanceOf(Array);

      // All items should be issues
      for (const item of data.items) {
        expect(item.kind).toBe('issue');
      }

      // Should include our test issue
      const hasTestIssue = data.items.some((item) => item.id === issueId);
      expect(hasTestIssue).toBe(true);
    });

    it('should return all items when no item_type filter is provided', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/work-items',
      });
      expect(response.statusCode).toBe(200);
      const data = response.json() as { items: Array<{ kind: string; id: string }> };

      expect(data.items).toBeInstanceOf(Array);
      expect(data.items.length).toBeGreaterThan(0);

      // Should have mixed kinds
      const kinds = new Set(data.items.map((item) => item.kind));
      expect(kinds.size).toBeGreaterThan(1);

      // Should include all our test items
      const ids = data.items.map((item) => item.id);
      expect(ids).toContain(project_id);
      expect(ids).toContain(taskId);
      expect(ids).toContain(issueId);
    });
  });

  describe('Type validation', () => {
    it('should reject invalid type values', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'Invalid Type',
          type: 'invalid-type',
        },
      });

      expect(response.statusCode).toBe(400);
      const data = response.json() as { error: string };
      expect(data.error).toBeDefined();
    });
  });
});
