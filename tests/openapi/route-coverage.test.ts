/**
 * Route coverage test — compares the OpenAPI spec paths against
 * the actually registered Fastify routes.
 *
 * This test requires a database connection (uses buildServer).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runMigrate } from '../helpers/migrate.ts';
import { buildServer } from '../../src/api/server.ts';
import { assembleSpec } from '../../src/api/openapi/index.ts';

describe('OpenAPI Route Coverage', () => {
  const app = buildServer();

  beforeAll(async () => {
    await runMigrate('up');
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  /** Normalise Fastify route param syntax (:id) to OpenAPI ({id}) */
  function normaliseRoute(route: string): string {
    return route.replace(/:([a-zA-Z_]+)/g, '{$1}');
  }

  /** Known routes that are intentionally undocumented (internal, debug, or static) */
  const excludedPatterns = [
    /^\/api\/openapi\.json$/, // Self-reference
    /^\/api\/capabilities$/, // Discovery endpoint, not a CRUD API
    /^\/app/, // Frontend HTML routes
    /^\/$/, // Root redirect
    /^\/health$/, // Legacy top-level health (documented as /api/health)
    /^\/assets/, // Static assets
    /^\/favicon/, // Favicon
    /^\/manifest/, // PWA manifest
    /^\/sw\.js/, // Service worker
    /\*$/, // Wildcard routes
  ];

  it('GET /api/openapi.json returns the spec from assembleSpec()', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/openapi.json',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.openapi).toBe('3.0.3');
    expect(Object.keys(body.paths).length).toBeGreaterThanOrEqual(200);
  });

  it('documents at least 95% of registered API routes', async () => {
    // Get all registered Fastify routes
    const registeredRoutes = new Set<string>();
    // Fastify provides printRoutes() but not a programmatic list.
    // We use the internal routing tree via app.routeList or similar.
    // Fastify v4/v5: iterate via app[Symbol.iterator]
    const routesOutput: string[] = [];
    app.printRoutes({ commonPrefix: false }).split('\n').forEach((line: string) => {
      // Extract route paths from printRoutes output
      // Format varies but typically: "METHOD  /path (handler)"
      const match = line.match(/(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/\S+)/);
      if (match) {
        const method = match[1].toLowerCase();
        const path = normaliseRoute(match[2]);
        if (path.startsWith('/api/')) {
          const key = `${method}:${path}`;
          registeredRoutes.add(key);
          routesOutput.push(key);
        }
      }
    });

    // Get spec paths
    const spec = assembleSpec() as {
      paths: Record<string, Record<string, unknown>>;
    };
    const specRoutes = new Set<string>();
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const method of Object.keys(methods)) {
        if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
          specRoutes.add(`${method}:${path}`);
        }
      }
    }

    // Find undocumented routes
    const undocumented: string[] = [];
    for (const route of registeredRoutes) {
      const [, path] = route.split(':');
      const isExcluded = excludedPatterns.some((pat) => pat.test(path));
      if (!isExcluded && !specRoutes.has(route)) {
        undocumented.push(route);
      }
    }

    const total = registeredRoutes.size;
    const documented = total - undocumented.length;
    const coverage = total > 0 ? (documented / total) * 100 : 100;

    // Log for visibility
    if (undocumented.length > 0) {
      console.log(`\nUndocumented routes (${undocumented.length}):`);
      undocumented.sort().forEach((r) => console.log(`  - ${r}`));
    }
    console.log(`\nRoute coverage: ${documented}/${total} (${coverage.toFixed(1)}%)`);

    expect(coverage).toBeGreaterThanOrEqual(95);
  });
});
