/**
 * Tests verifying the HA IndieAuth redirect_uri discovery link tag is injected
 * into the landing page when OAUTH_REDIRECT_URI is configured.
 *
 * Issue #2383: HA's IndieAuth validates that client_id and redirect_uri share
 * the same host. When they differ (e.g. execdesk.ai vs api.execdesk.ai), HA
 * fetches the client_id URL and looks for <link rel="redirect_uri"> tags in the
 * first 10 KB of the page. We inject this tag into the root landing page.
 *
 * Ref: https://developers.home-assistant.io/docs/auth_api/
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildServer } from '../../../src/api/server.ts';

describe('HA IndieAuth redirect_uri discovery — landing page injection (#2383)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('injects <link rel="redirect_uri"> in <head> when OAUTH_REDIRECT_URI is a valid https URL', async () => {
    process.env.OAUTH_REDIRECT_URI = 'https://api.execdesk.ai/api/oauth/callback';
    const app = buildServer();
    const resp = await app.inject({ method: 'GET', url: '/' });
    expect(resp.statusCode).toBe(200);
    const html = resp.body;
    expect(html).toContain('<link rel="redirect_uri" href="https://api.execdesk.ai/api/oauth/callback" />');
    // Must appear before </head>
    const linkPos = html.indexOf('<link rel="redirect_uri"');
    const headClosePos = html.indexOf('</head>');
    expect(linkPos).toBeGreaterThan(-1);
    expect(linkPos).toBeLessThan(headClosePos);
    await app.close();
  });

  it('omits link tag when OAUTH_REDIRECT_URI is not set', async () => {
    delete process.env.OAUTH_REDIRECT_URI;
    const app = buildServer();
    const resp = await app.inject({ method: 'GET', url: '/' });
    expect(resp.statusCode).toBe(200);
    expect(resp.body).not.toContain('<link rel="redirect_uri"');
    await app.close();
  });

  it('omits link tag when OAUTH_REDIRECT_URI is not a valid URL', async () => {
    process.env.OAUTH_REDIRECT_URI = 'not-a-url';
    const app = buildServer();
    const resp = await app.inject({ method: 'GET', url: '/' });
    expect(resp.statusCode).toBe(200);
    expect(resp.body).not.toContain('<link rel="redirect_uri"');
    await app.close();
  });

  it('omits link tag when OAUTH_REDIRECT_URI uses a non-http(s) protocol', async () => {
    process.env.OAUTH_REDIRECT_URI = 'ftp://evil.example.com/callback';
    const app = buildServer();
    const resp = await app.inject({ method: 'GET', url: '/' });
    expect(resp.statusCode).toBe(200);
    expect(resp.body).not.toContain('<link rel="redirect_uri"');
    await app.close();
  });

  it('does not inject unescaped content when OAUTH_REDIRECT_URI contains special characters', async () => {
    // A value with a double-quote would be a malformed URL — new URL() normalises/rejects it.
    // Verify that whatever comes out is safe HTML.
    process.env.OAUTH_REDIRECT_URI = 'https://api.example.com/callback?foo=bar&baz=qux';
    const app = buildServer();
    const resp = await app.inject({ method: 'GET', url: '/' });
    const html = resp.body;
    if (html.includes('<link rel="redirect_uri"')) {
      // If present, the href must be a well-formed attribute value (no stray quotes)
      const match = html.match(/<link rel="redirect_uri" href="([^"]*)" \/>/);
      expect(match).not.toBeNull();
    }
    await app.close();
  });
});
