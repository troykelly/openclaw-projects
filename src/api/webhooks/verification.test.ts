/**
 * Tests for webhook signature verification.
 * Issue #1413: trustProxy not configured causes signature failures behind reverse proxy.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import formbody from '@fastify/formbody';

/** Encode params as application/x-www-form-urlencoded string. */
function toFormBody(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

describe('webhook verification behind proxy', () => {
  let app: FastifyInstance;
  const TWILIO_AUTH_TOKEN = 'test-auth-token-for-verification';

  beforeEach(() => {
    vi.stubEnv('TWILIO_AUTH_TOKEN', TWILIO_AUTH_TOKEN);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (app) {
      await app.close();
    }
  });

  /**
   * Build a minimal Fastify app that mirrors the real server's trustProxy
   * setting and uses the real verification module.
   */
  async function buildTestApp(trustProxy: boolean): Promise<FastifyInstance> {
    app = Fastify({ logger: false, trustProxy });

    // Register formbody parser (mirrors real server which uses @fastify/formbody)
    await app.register(formbody);

    // Dynamic import to get fresh module per test
    const { verifyTwilioSignature } = await import('./verification.js');

    app.post('/twilio/sms', async (request, reply) => {
      const valid = verifyTwilioSignature(request);
      if (!valid) {
        return reply.status(401).send({ error: 'Invalid signature' });
      }
      return reply.send({ ok: true });
    });

    await app.ready();
    return app;
  }

  /**
   * Compute Twilio's HMAC-SHA1 signature for a given URL and body params.
   * @see https://www.twilio.com/docs/usage/webhooks/webhooks-security
   */
  function computeTwilioSignature(url: string, params: Record<string, string>): string {
    const data =
      url +
      Object.keys(params)
        .sort()
        .reduce((acc, key) => acc + key + params[key], '');
    return createHmac('sha1', TWILIO_AUTH_TOKEN).update(Buffer.from(data, 'utf-8')).digest('base64');
  }

  it('should fail signature validation without trustProxy when proxy sends X-Forwarded-Proto', async () => {
    await buildTestApp(false);

    const publicUrl = 'https://api.execdesk.ai/twilio/sms';
    const body = { From: '+15551234567', Body: 'Hello' };

    // Twilio signs against the public HTTPS URL
    const signature = computeTwilioSignature(publicUrl, body);

    // But without trustProxy, Fastify sees protocol as 'http'
    const response = await app.inject({
      method: 'POST',
      url: '/twilio/sms',
      headers: {
        host: 'api.execdesk.ai',
        'x-forwarded-proto': 'https',
        'x-twilio-signature': signature,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: toFormBody(body),
    });

    // Without trustProxy, the signature check fails because protocol is 'http'
    expect(response.statusCode).toBe(401);
  });

  it('should pass signature validation with trustProxy when proxy sends X-Forwarded-Proto', async () => {
    await buildTestApp(true);

    const publicUrl = 'https://api.execdesk.ai/twilio/sms';
    const body = { From: '+15551234567', Body: 'Hello' };

    // Twilio signs against the public HTTPS URL
    const signature = computeTwilioSignature(publicUrl, body);

    const response = await app.inject({
      method: 'POST',
      url: '/twilio/sms',
      headers: {
        host: 'api.execdesk.ai',
        'x-forwarded-proto': 'https',
        'x-twilio-signature': signature,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: toFormBody(body),
    });

    // With trustProxy, Fastify uses X-Forwarded-Proto → protocol = 'https' → signature matches
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('should still work for direct connections (no proxy headers)', async () => {
    await buildTestApp(true);

    const body = { From: '+15559876543', Body: 'Test' };

    // Without proxy headers, inject() defaults to host=localhost:80, protocol=http
    const directUrl = 'http://localhost:80/twilio/sms';
    const signature = computeTwilioSignature(directUrl, body);

    const response = await app.inject({
      method: 'POST',
      url: '/twilio/sms',
      headers: {
        'x-twilio-signature': signature,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: toFormBody(body),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('should reject requests with invalid signatures', async () => {
    await buildTestApp(true);

    const response = await app.inject({
      method: 'POST',
      url: '/twilio/sms',
      headers: {
        host: 'api.execdesk.ai',
        'x-forwarded-proto': 'https',
        'x-twilio-signature': 'aW52YWxpZC1zaWduYXR1cmU=',
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: toFormBody({ From: '+15551234567', Body: 'Hello' }),
    });

    expect(response.statusCode).toBe(401);
  });

  it('should reject requests with no signature header', async () => {
    await buildTestApp(true);

    const response = await app.inject({
      method: 'POST',
      url: '/twilio/sms',
      headers: {
        host: 'api.execdesk.ai',
        'x-forwarded-proto': 'https',
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: toFormBody({ From: '+15551234567', Body: 'Hello' }),
    });

    expect(response.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Cloudflare email HMAC verification with rawBody (#2411, #2412)
// ---------------------------------------------------------------------------

describe('Cloudflare email HMAC verification', () => {
  let app: FastifyInstance;
  const CF_SECRET = 'test-cloudflare-hmac-secret';

  beforeEach(() => {
    vi.stubEnv('CLOUDFLARE_EMAIL_SECRET', CF_SECRET);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (app) await app.close();
  });

  async function buildCfApp(useRawBody: boolean): Promise<FastifyInstance> {
    app = Fastify({ logger: false });

    if (useRawBody) {
      await app.register(import('fastify-raw-body'), { global: false, runFirst: true });
    }

    const { verifyCloudflareEmailSecret } = await import('./verification.js');

    app.post('/cloudflare/email', {
      config: useRawBody ? { rawBody: true } : {},
    }, async (request, reply) => {
      const valid = verifyCloudflareEmailSecret(request);
      if (!valid) return reply.status(401).send({ error: 'Invalid signature' });
      return reply.send({ ok: true });
    });

    await app.ready();
    return app;
  }

  function computeHmacHex(secret: string, body: string): string {
    return createHmac('sha256', secret).update(body).digest('hex');
  }

  it('accepts valid HMAC signature with rawBody', async () => {
    await buildCfApp(true);

    const body = JSON.stringify({ from: 'alice@example.com', to: 'support@myapp.com', timestamp: new Date().toISOString() });
    const hmac = `sha256=${computeHmacHex(CF_SECRET, body)}`;

    const response = await app.inject({
      method: 'POST',
      url: '/cloudflare/email',
      headers: {
        'content-type': 'application/json',
        'x-cloudflare-email-signature': hmac,
      },
      payload: body,
    });
    expect(response.statusCode).toBe(200);
  });

  it('accepts HMAC signature without sha256= prefix', async () => {
    await buildCfApp(true);

    const body = JSON.stringify({ data: 'test' });
    const hmac = computeHmacHex(CF_SECRET, body);

    const response = await app.inject({
      method: 'POST',
      url: '/cloudflare/email',
      headers: {
        'content-type': 'application/json',
        'x-cloudflare-email-signature': hmac,
      },
      payload: body,
    });
    expect(response.statusCode).toBe(200);
  });

  it('rejects invalid HMAC signature', async () => {
    await buildCfApp(true);

    const body = JSON.stringify({ from: 'alice@example.com' });

    const response = await app.inject({
      method: 'POST',
      url: '/cloudflare/email',
      headers: {
        'content-type': 'application/json',
        'x-cloudflare-email-signature': 'sha256=0000000000000000000000000000000000000000000000000000000000000000',
      },
      payload: body,
    });
    expect(response.statusCode).toBe(401);
  });

  it('rawBody preserves exact bytes including whitespace differences', async () => {
    await buildCfApp(true);

    // Body with trailing whitespace and specific key order
    const body = '{"b":2,"a":1}  ';
    const hmac = `sha256=${computeHmacHex(CF_SECRET, body)}`;

    const response = await app.inject({
      method: 'POST',
      url: '/cloudflare/email',
      headers: {
        'content-type': 'application/json',
        'x-cloudflare-email-signature': hmac,
      },
      payload: body,
    });
    // Fastify's JSON parser may reject trailing whitespace in strict mode,
    // but rawBody captures the original. The HMAC should match the original bytes.
    // If Fastify parses the body, rawBody still has the original, so HMAC matches.
    expect(response.statusCode).toBe(200);
  });

  it('falls back to deprecated X-Cloudflare-Email-Secret header', async () => {
    await buildCfApp(true);

    const response = await app.inject({
      method: 'POST',
      url: '/cloudflare/email',
      headers: {
        'content-type': 'application/json',
        'x-cloudflare-email-secret': CF_SECRET,
      },
      payload: JSON.stringify({ data: 'test' }),
    });
    expect(response.statusCode).toBe(200);
  });

  it('returns 401 (not 500) for empty body with HMAC header', async () => {
    await buildCfApp(true);

    const response = await app.inject({
      method: 'POST',
      url: '/cloudflare/email',
      headers: {
        'content-type': 'application/json',
        'x-cloudflare-email-signature': 'sha256=0000000000000000000000000000000000000000000000000000000000000000',
      },
      payload: '',
    });
    // Should return 401 (invalid signature) or 400, not 500
    expect(response.statusCode).not.toBe(500);
  });

  it('rejects requests with no auth headers', async () => {
    await buildCfApp(true);

    const response = await app.inject({
      method: 'POST',
      url: '/cloudflare/email',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ data: 'test' }),
    });
    expect(response.statusCode).toBe(401);
  });

  it('works without rawBody plugin (fallback to re-serialized JSON)', async () => {
    await buildCfApp(false);

    const body = JSON.stringify({ from: 'bob@example.com' });
    const hmac = `sha256=${computeHmacHex(CF_SECRET, body)}`;

    const response = await app.inject({
      method: 'POST',
      url: '/cloudflare/email',
      headers: {
        'content-type': 'application/json',
        'x-cloudflare-email-signature': hmac,
      },
      payload: body,
    });
    expect(response.statusCode).toBe(200);
  });
});

describe('buildServer trustProxy configuration', () => {
  it('should have trustProxy enabled', async () => {
    // Dynamic import the buildServer to check its configuration
    const { buildServer } = await import('../server.js');

    // buildServer requires OAuth config — stub minimally
    vi.stubEnv('OPENCLAW_PROJECTS_AUTH_DISABLED', 'true');

    let server: FastifyInstance | undefined;
    try {
      server = buildServer({ logger: false });

      // Fastify stores trustProxy info internally.
      // We can verify by checking that the server respects X-Forwarded-Proto.
      server.get('/test-protocol', async (request) => {
        return { protocol: request.protocol, ip: request.ip };
      });

      await server.ready();

      const response = await server.inject({
        method: 'GET',
        url: '/test-protocol',
        headers: {
          'x-forwarded-proto': 'https',
          'x-forwarded-for': '203.0.113.50',
        },
      });

      const body = response.json();
      expect(body.protocol).toBe('https');
      expect(body.ip).toBe('203.0.113.50');
    } finally {
      vi.unstubAllEnvs();
      if (server) await server.close();
    }
  });
});
