/**
 * Tests that verify frontend assets are correctly served.
 * Part of Issue #779 - Catches stale index.html after rebuild.
 * Updated for JWT auth migration (Issue #1325).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { runMigrate } from './helpers/migrate.ts';
import { buildServer } from '../src/api/server.ts';
import { createHash, randomBytes } from 'node:crypto';
import { createPool } from '../src/db.ts';

// JWT signing requires a secret.
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-bytes-long!!';

const frontendIndexPath = new URL('../src/api/static/app/index.html', import.meta.url).pathname;
const hasFrontendBuild =
  existsSync(frontendIndexPath) && /index-\w+\.js/.test(readFileSync(frontendIndexPath, 'utf-8'));

describe.skipIf(!hasFrontendBuild)('Frontend Assets (Issue #779)', () => {
  const app = buildServer();

  beforeAll(async () => {
    await runMigrate('up');
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('index.html references assets that exist and return 200', async () => {
    // Get the index.html content
    const indexResponse = await app.inject({
      method: 'GET',
      url: '/static/app/index.html',
    });

    expect(indexResponse.statusCode).toBe(200);
    const html = indexResponse.body;

    // Extract all asset references from the HTML
    const scriptMatches = html.matchAll(/src="([^"]+)"/g);
    const linkMatches = html.matchAll(/href="([^"]+\.css[^"]*)"/g);

    const assetUrls: string[] = [];
    for (const match of scriptMatches) {
      if (match[1].startsWith('/static/')) {
        assetUrls.push(match[1]);
      }
    }
    for (const match of linkMatches) {
      if (match[1].startsWith('/static/')) {
        assetUrls.push(match[1]);
      }
    }

    expect(assetUrls.length).toBeGreaterThan(0);

    // Verify each asset returns 200
    for (const url of assetUrls) {
      const assetResponse = await app.inject({
        method: 'GET',
        url,
      });

      expect(assetResponse.statusCode, `Asset ${url} should return 200 but got ${assetResponse.statusCode}`).toBe(200);
    }
  });

  it('app shell serves consistent index.html with same assets', async () => {
    // Get a JWT access token
    const rawToken = randomBytes(32).toString('base64url');
    const tokenSha = createHash('sha256').update(rawToken).digest('hex');
    const pool = createPool({ max: 1 });
    await pool.query(
      `INSERT INTO auth_magic_link (email, token_sha256, expires_at)
       VALUES ($1, $2, now() + interval '15 minutes')`,
      ['asset-test@example.com', tokenSha],
    );
    await pool.end();

    const consume = await app.inject({
      method: 'POST',
      url: '/api/auth/consume',
      payload: { token: rawToken },
    });
    expect(consume.statusCode).toBe(200);
    const { accessToken } = consume.json() as { accessToken: string };

    // Get app shell HTML
    const appResponse = await app.inject({
      method: 'GET',
      url: '/app/work-items',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(appResponse.statusCode).toBe(200);
    const appHtml = appResponse.body;

    // Get static index.html
    const staticResponse = await app.inject({
      method: 'GET',
      url: '/static/app/index.html',
    });
    const staticHtml = staticResponse.body;

    // Extract JS asset URL from both - they should reference the same file
    const appJsMatch = appHtml.match(/src="([^"]*index-[^"]*\.js)"/);
    const staticJsMatch = staticHtml.match(/src="([^"]*index-[^"]*\.js)"/);

    expect(appJsMatch).toBeTruthy();
    expect(staticJsMatch).toBeTruthy();
    expect(appJsMatch![1]).toBe(staticJsMatch![1]);
  });
});
