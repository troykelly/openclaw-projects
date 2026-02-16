import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.ts';
import { runMigrate } from './helpers/migrate.ts';

/**
 * CSP (Content Security Policy) headers.
 *
 * Issue #1357: Add CSP headers to prevent XSS token extraction.
 * CSP tests don't mutate database state, so no truncation needed.
 */
describe('CSP headers', () => {
  beforeAll(async () => {
    await runMigrate('up');
  });

  /** Extract the CSP header value from a response */
  function getCsp(headers: Record<string, string | string[] | undefined>): string {
    const val = headers['content-security-policy'];
    return typeof val === 'string' ? val : '';
  }

  /** Extract nonce value from a CSP script-src directive */
  function extractNonceFromCsp(csp: string): string | null {
    const match = csp.match(/'nonce-([A-Za-z0-9+/=]+)'/);
    return match ? match[1] : null;
  }

  describe('unauthenticated pages', () => {
    const app = buildServer();

    beforeAll(async () => {
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    it('landing page includes CSP header with nonce-based script-src', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      expect(res.statusCode).toBe(200);
      const csp = getCsp(res.headers);
      expect(csp).toBeTruthy();
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain('script-src');
      expect(csp).toContain("'nonce-");
      expect(csp).toContain('style-src');
      expect(csp).toContain("frame-ancestors 'none'");
    });

    it('landing page includes nonce on inline style tag', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      expect(res.statusCode).toBe(200);
      const csp = getCsp(res.headers);
      const nonce = extractNonceFromCsp(csp);
      expect(nonce).toBeTruthy();
      expect(res.body).toContain(`nonce="${nonce}"`);
    });

    it('generates different nonces per request', async () => {
      const res1 = await app.inject({ method: 'GET', url: '/' });
      const res2 = await app.inject({ method: 'GET', url: '/' });

      const nonce1 = extractNonceFromCsp(getCsp(res1.headers));
      const nonce2 = extractNonceFromCsp(getCsp(res2.headers));

      expect(nonce1).toBeTruthy();
      expect(nonce2).toBeTruthy();
      expect(nonce1).not.toBe(nonce2);
    });

    it('nonce is base64-encoded and at least 16 bytes', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      const nonce = extractNonceFromCsp(getCsp(res.headers));
      expect(nonce).toBeTruthy();
      const decoded = Buffer.from(nonce!, 'base64');
      expect(decoded.length).toBeGreaterThanOrEqual(16);
    });

    it('has all required CSP directives on HTML pages', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      const csp = getCsp(res.headers);

      expect(csp).toContain("default-src 'self'");
      expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+'/);
      expect(csp).toContain('style-src');
      expect(csp).toContain("img-src 'self' data: https:");
      expect(csp).toContain("connect-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
    });

    it('does NOT include unsafe-eval in script-src', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      const csp = getCsp(res.headers);
      expect(csp).not.toContain('unsafe-eval');
    });

    it('API JSON responses do not include nonce-based CSP', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/health',
      });
      const csp = getCsp(res.headers);
      if (csp) {
        expect(csp).not.toContain("'nonce-");
      }
    });

    it('unauthenticated login page does not leak nonce in CSP to third parties', async () => {
      const res = await app.inject({ method: 'GET', url: '/app/work-items' });
      // Unauthenticated requests now render a login page (200) instead of 401
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('Sign in');
    });
  });

  describe('connect-src includes API subdomain when PUBLIC_BASE_URL is set', () => {
    const savedEnv: Record<string, string | undefined> = {};
    let app: ReturnType<typeof buildServer>;

    beforeAll(async () => {
      savedEnv.PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;
      savedEnv.OPENCLAW_PROJECTS_AUTH_DISABLED = process.env.OPENCLAW_PROJECTS_AUTH_DISABLED;
      process.env.PUBLIC_BASE_URL = 'https://myapp.example.com';
      process.env.OPENCLAW_PROJECTS_AUTH_DISABLED = 'true';

      app = buildServer();
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
      for (const key of Object.keys(savedEnv)) {
        if (savedEnv[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = savedEnv[key];
        }
      }
    });

    it('adds https and wss API origins to connect-src', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      const csp = getCsp(res.headers);
      expect(csp).toContain('https://api.myapp.example.com');
      expect(csp).toContain('wss://api.myapp.example.com');
    });
  });

  describe('authenticated pages (E2E bypass)', () => {
    const savedEnv: Record<string, string | undefined> = {};
    let app: ReturnType<typeof buildServer>;

    beforeAll(async () => {
      // Save and set E2E bypass env vars before building server
      savedEnv.OPENCLAW_PROJECTS_AUTH_DISABLED = process.env.OPENCLAW_PROJECTS_AUTH_DISABLED;
      savedEnv.OPENCLAW_E2E_SESSION_EMAIL = process.env.OPENCLAW_E2E_SESSION_EMAIL;
      process.env.OPENCLAW_PROJECTS_AUTH_DISABLED = 'true';
      process.env.OPENCLAW_E2E_SESSION_EMAIL = 'csp-test@example.com';

      app = buildServer();
      await app.ready();
    });

    afterAll(async () => {
      await app.close();

      // Restore env vars
      if (savedEnv.OPENCLAW_PROJECTS_AUTH_DISABLED === undefined) {
        delete process.env.OPENCLAW_PROJECTS_AUTH_DISABLED;
      } else {
        process.env.OPENCLAW_PROJECTS_AUTH_DISABLED = savedEnv.OPENCLAW_PROJECTS_AUTH_DISABLED;
      }
      if (savedEnv.OPENCLAW_E2E_SESSION_EMAIL === undefined) {
        delete process.env.OPENCLAW_E2E_SESSION_EMAIL;
      } else {
        process.env.OPENCLAW_E2E_SESSION_EMAIL = savedEnv.OPENCLAW_E2E_SESSION_EMAIL;
      }
    });

    it('includes CSP header on /app/work-items', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/app/work-items',
      });
      expect(res.statusCode).toBe(200);
      const csp = getCsp(res.headers);
      expect(csp).toBeTruthy();
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
    });

    it('includes nonce on bootstrap script tag', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/app/work-items',
      });
      expect(res.statusCode).toBe(200);
      const csp = getCsp(res.headers);
      const nonce = extractNonceFromCsp(csp);
      expect(nonce).toBeTruthy();
      expect(res.body).toContain(`nonce="${nonce}"`);
      expect(res.body).toContain('app-bootstrap');
    });

    it('CSP allows Google Fonts', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/app/work-items',
      });
      const csp = getCsp(res.headers);
      expect(csp).toContain('fonts.googleapis.com');
      expect(csp).toContain('fonts.gstatic.com');
    });
  });
});
