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

    app.post('/api/twilio/sms', async (request, reply) => {
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

    const publicUrl = 'https://api.execdesk.ai/api/twilio/sms';
    const body = { From: '+15551234567', Body: 'Hello' };

    // Twilio signs against the public HTTPS URL
    const signature = computeTwilioSignature(publicUrl, body);

    // But without trustProxy, Fastify sees protocol as 'http'
    const response = await app.inject({
      method: 'POST',
      url: '/api/twilio/sms',
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

    const publicUrl = 'https://api.execdesk.ai/api/twilio/sms';
    const body = { From: '+15551234567', Body: 'Hello' };

    // Twilio signs against the public HTTPS URL
    const signature = computeTwilioSignature(publicUrl, body);

    const response = await app.inject({
      method: 'POST',
      url: '/api/twilio/sms',
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
    const directUrl = 'http://localhost:80/api/twilio/sms';
    const signature = computeTwilioSignature(directUrl, body);

    const response = await app.inject({
      method: 'POST',
      url: '/api/twilio/sms',
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
      url: '/api/twilio/sms',
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
      url: '/api/twilio/sms',
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
