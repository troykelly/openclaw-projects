/**
 * HTTP route-level integration tests for Issues #2590 and #2591.
 *
 * Tests namespace alias acceptance and error response format.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../server.js';
import type { FastifyInstance } from 'fastify';

describe('Route-level: digest and bulk-supersede (#2590, #2591)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv('OPENCLAW_PROJECTS_AUTH_DISABLED', 'true');
    app = buildServer({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    if (app) await app.close();
  });

  it('POST /memories/digest accepts body.namespace (#2590)', async () => {
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

    const res = await app.inject({
      method: 'POST',
      url: '/memories/digest',
      headers: {
        'content-type': 'application/json',
        'x-namespace': 'test-ns',
      },
      payload: {
        namespace: 'test-ns',
        since: twoDaysAgo.toISOString(),
        before: now.toISOString(),
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('total_memories');
    expect(body).toHaveProperty('clusters');
  });

  it('POST /memories/digest still accepts body.namespace_id (#2590)', async () => {
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

    const res = await app.inject({
      method: 'POST',
      url: '/memories/digest',
      headers: {
        'content-type': 'application/json',
        'x-namespace': 'test-ns',
      },
      payload: {
        namespace_id: 'test-ns',
        since: twoDaysAgo.toISOString(),
        before: now.toISOString(),
      },
    });

    expect(res.statusCode).toBe(200);
  });

  it('POST /memories/bulk-supersede returns { error } with descriptive message (#2591)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/memories/bulk-supersede',
      headers: {
        'content-type': 'application/json',
        'x-namespace': 'default',
      },
      payload: {
        target_id: '00000000-0000-0000-0000-000000000001',
        source_ids: ['00000000-0000-0000-0000-000000000002'],
      },
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toBeDefined();
    expect(body.error).toContain('not found');
  });
});
