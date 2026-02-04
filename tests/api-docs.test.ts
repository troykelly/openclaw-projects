import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runMigrate } from './helpers/migrate.ts';
import { buildServer } from '../src/api/server.ts';

/**
 * Tests for API documentation endpoints (Issue #207)
 */
describe('API Documentation Endpoints', () => {
  const app = buildServer();

  beforeAll(async () => {
    await runMigrate('up');
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/capabilities', () => {
    it('returns a list of available capabilities', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/capabilities',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body).toHaveProperty('name');
      expect(body).toHaveProperty('version');
      expect(body).toHaveProperty('capabilities');
      expect(Array.isArray(body.capabilities)).toBe(true);
    });

    it('includes work items capability', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/capabilities',
      });

      const body = res.json();
      const workItems = body.capabilities.find((c: { name: string }) => c.name === 'work_items');

      expect(workItems).toBeDefined();
      expect(workItems.description).toBeDefined();
      expect(workItems.endpoints).toBeDefined();
      expect(Array.isArray(workItems.endpoints)).toBe(true);
    });

    it('includes memory capability', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/capabilities',
      });

      const body = res.json();
      const memory = body.capabilities.find((c: { name: string }) => c.name === 'memory');

      expect(memory).toBeDefined();
      expect(memory.description).toBeDefined();
    });

    it('includes contacts capability', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/capabilities',
      });

      const body = res.json();
      const contacts = body.capabilities.find((c: { name: string }) => c.name === 'contacts');

      expect(contacts).toBeDefined();
    });

    it('includes common workflows', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/capabilities',
      });

      const body = res.json();

      expect(body).toHaveProperty('workflows');
      expect(Array.isArray(body.workflows)).toBe(true);
      expect(body.workflows.length).toBeGreaterThan(0);
    });

    it('includes authentication info', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/capabilities',
      });

      const body = res.json();

      expect(body).toHaveProperty('authentication');
      expect(body.authentication).toHaveProperty('type');
      expect(body.authentication.type).toBe('bearer');
    });
  });

  describe('GET /api/openapi.json', () => {
    it('returns valid OpenAPI spec', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/openapi.json',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      // OpenAPI 3.x required fields
      expect(body).toHaveProperty('openapi');
      expect(body.openapi).toMatch(/^3\.\d+\.\d+$/);
      expect(body).toHaveProperty('info');
      expect(body.info).toHaveProperty('title');
      expect(body.info).toHaveProperty('version');
      expect(body).toHaveProperty('paths');
    });

    it('includes work items paths', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/openapi.json',
      });

      const body = res.json();

      expect(body.paths).toHaveProperty('/api/work-items');
      expect(body.paths['/api/work-items']).toHaveProperty('get');
      expect(body.paths['/api/work-items']).toHaveProperty('post');
    });

    it('includes memory paths', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/openapi.json',
      });

      const body = res.json();

      expect(body.paths).toHaveProperty('/api/memory');
    });

    it('includes contacts paths', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/openapi.json',
      });

      const body = res.json();

      expect(body.paths).toHaveProperty('/api/contacts');
    });

    it('includes security scheme', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/openapi.json',
      });

      const body = res.json();

      expect(body).toHaveProperty('components');
      expect(body.components).toHaveProperty('securitySchemes');
      expect(body.components.securitySchemes).toHaveProperty('bearerAuth');
    });

    it('includes server URL', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/openapi.json',
      });

      const body = res.json();

      expect(body).toHaveProperty('servers');
      expect(Array.isArray(body.servers)).toBe(true);
    });
  });
});
