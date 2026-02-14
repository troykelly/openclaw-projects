/**
 * Test for Issue #1141: Route path collisions
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import type { Pool } from 'pg';
import { buildServer } from '../src/api/server.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { runMigrate } from './helpers/migrate.ts';

describe('Issue #1141 - Route Path Collisions', () => {
  const originalEnv = process.env;
  let pool: Pool;
  let app: ReturnType<typeof buildServer>;

  beforeAll(async () => {
    await runMigrate('up');
  });

  beforeEach(async () => {
    process.env = { ...originalEnv };
    process.env.OPENCLAW_PROJECTS_AUTH_DISABLED = 'true';

    pool = createTestPool();
    await truncateAllTables(pool);
    app = buildServer({ logger: false });
  });

  afterEach(async () => {
    process.env = originalEnv;
    await pool.end();
    await app.close();
  });

  it('GET /api/memories/search should not be treated as /:id route', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/memories/search?q=test',
    });

    // Should not get UUID parsing error
    expect(response.statusCode).not.toBe(500);
    if (response.statusCode === 500) {
      const body = response.json();
      expect(body.message).not.toContain('invalid input syntax for type uuid');
    }

    // Should get either 200 (success) or 400 (validation error)
    expect([200, 400]).toContain(response.statusCode);
  });

  it('GET /api/contacts/search should not be treated as /:id route', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/contacts/search?q=test',
    });

    console.log('Response status:', response.statusCode);
    console.log('Response body:', response.body);

    // Should not get UUID parsing error
    expect(response.statusCode).not.toBe(500);
    if (response.statusCode === 500) {
      const body = response.json();
      expect(body.message).not.toContain('invalid input syntax for type uuid');
    }

    // Should get either 200 (success), 301 (redirect), or 400 (validation error)
    expect([200, 301, 400]).toContain(response.statusCode);
  });

  it('GET /api/files/share should not be treated as /:id route', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/files/share?token=test',
    });

    // Should not get UUID parsing error
    expect(response.statusCode).not.toBe(500);
    if (response.statusCode === 500) {
      const body = response.json();
      expect(body.message).not.toContain('invalid input syntax for type uuid');
    }

    // Should get either 200 (success), 400 (validation), or 404 (not found)
    expect([200, 400, 404]).toContain(response.statusCode);
  });
});
