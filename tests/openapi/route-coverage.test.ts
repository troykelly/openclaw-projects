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

  /**
   * Parse Fastify v5 printRoutes({ commonPrefix: false }) tree output.
   *
   * The output is a tree drawn with box-drawing characters. Each leaf node
   * shows its path segment relative to its nearest parent leaf. When the
   * root `/` is itself a route (e.g. a redirect), all descendants appear
   * at nesting level >= 1 with paths like `api/health` (no leading `/`).
   *
   * We reconstruct full paths by tracking a stack of path segments keyed
   * by nesting level. Level = position of the branch char (├ or └) / 4.
   */
  function parseRoutesFromTree(output: string): Set<string> {
    const routes = new Set<string>();
    const pathStack: string[] = [];

    for (const line of output.split('\n')) {
      if (!line.trim()) continue;

      // Find the branch character (├ or └) to determine nesting level
      let branchPos = -1;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '├' || line[i] === '└') {
          branchPos = i;
          break;
        }
      }
      if (branchPos < 0) continue;
      const level = branchPos / 4;

      // Skip past "├── " or "└── " (branch char + ── + space = 4 chars)
      const rest = line.substring(branchPos + 4);

      // Extract the path segment and methods: segment (METHOD1, METHOD2, ...)
      const match = rest.match(/^([^\s(]+)\s*\(([^)]+)\)/);
      if (!match) continue;

      const pathSegment = match[1];
      const methods = match[2].split(',').map((m: string) => m.trim().toLowerCase());

      // Update path stack at this level (truncate deeper entries)
      pathStack.length = level + 1;
      pathStack[level] = pathSegment;

      // Reconstruct full path by joining all segments from level 0..N
      const fullPath = normaliseRoute(pathStack.slice(0, level + 1).join(''));

      for (const method of methods) {
        if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
          routes.add(`${method}:${fullPath}`);
        }
      }
    }
    return routes;
  }

  it('documents at least 95% of registered API routes', async () => {
    const registeredRoutes = parseRoutesFromTree(
      app.printRoutes({ commonPrefix: false }),
    );
    // Keep only /api/ routes for coverage check
    const apiRoutes = new Set<string>();
    for (const route of registeredRoutes) {
      const path = route.split(':').slice(1).join(':');
      if (path.startsWith('/api/')) {
        apiRoutes.add(route);
      }
    }

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
    for (const route of apiRoutes) {
      const path = route.split(':').slice(1).join(':');
      const isExcluded = excludedPatterns.some((pat) => pat.test(path));
      if (!isExcluded && !specRoutes.has(route)) {
        undocumented.push(route);
      }
    }

    // Guard: parseRoutesFromTree must have found routes, otherwise parser is broken
    expect(apiRoutes.size).toBeGreaterThan(0);

    const total = apiRoutes.size;
    const documented = total - undocumented.length;
    const coverage = (documented / total) * 100;

    // Log for visibility
    if (undocumented.length > 0) {
      console.log(`\nUndocumented routes (${undocumented.length}):`);
      undocumented.sort().forEach((r) => console.log(`  - ${r}`));
    }
    console.log(`\nRoute coverage: ${documented}/${total} (${coverage.toFixed(1)}%)`);

    expect(coverage).toBeGreaterThanOrEqual(95);
  });
});
