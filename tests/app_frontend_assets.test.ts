/**
 * Tests that verify frontend assets are correctly served.
 * Part of Issue #779 - Catches stale index.html after rebuild.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runMigrate } from './helpers/migrate.ts';
import { buildServer } from '../src/api/server.ts';

describe('Frontend Assets (Issue #779)', () => {
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

      expect(
        assetResponse.statusCode,
        `Asset ${url} should return 200 but got ${assetResponse.statusCode}`
      ).toBe(200);
    }
  });

  it('app shell serves consistent index.html with same assets', async () => {
    // Create a session for authenticated access
    const requestLink = await app.inject({
      method: 'POST',
      url: '/api/auth/request-link',
      payload: { email: 'asset-test@example.com' },
    });
    expect(requestLink.statusCode).toBe(201);

    const { loginUrl } = requestLink.json() as { loginUrl: string };
    const token = new URL(loginUrl).searchParams.get('token');

    const consume = await app.inject({
      method: 'GET',
      url: `/api/auth/consume?token=${token}`,
      headers: { accept: 'application/json' },
    });
    expect(consume.statusCode).toBe(200);

    const setCookie = consume.headers['set-cookie'];
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const sessionCookie = cookieHeader.split(';')[0];

    // Get app shell HTML
    const appResponse = await app.inject({
      method: 'GET',
      url: '/app/work-items',
      headers: { cookie: sessionCookie },
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
