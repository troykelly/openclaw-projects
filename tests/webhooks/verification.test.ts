/**
 * Tests for webhook signature verification.
 * Part of Issue #224.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'crypto';
import type { FastifyRequest } from 'fastify';
import {
  verifyTwilioSignature,
  verifyPostmarkAuth,
  verifyCloudflareEmailSecret,
  verifyHmacSha256,
  verifyWebhook,
  isWebhookVerificationConfigured,
  type WebhookProvider,
} from '../../src/api/webhooks/verification.ts';

/**
 * Create a mock Fastify request for testing.
 */
function createMockRequest(options: {
  headers?: Record<string, string | undefined>;
  body?: unknown;
  url?: string;
  protocol?: string;
  hostname?: string;
}): FastifyRequest {
  return {
    headers: options.headers || {},
    body: options.body,
    url: options.url || '/api/webhooks/test',
    protocol: options.protocol || 'https',
    hostname: options.hostname || 'example.com',
  } as unknown as FastifyRequest;
}

describe('Webhook Verification', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    // Reset auth disabled
    delete process.env.CLAWDBOT_AUTH_DISABLED;
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('verifyTwilioSignature', () => {
    const authToken = 'test-twilio-auth-token';

    /**
     * Calculate Twilio signature for testing.
     * Twilio uses HMAC-SHA1 of URL + sorted POST params.
     */
    function calculateTwilioSignature(
      url: string,
      params: Record<string, string>,
      token: string
    ): string {
      const paramString = Object.keys(params)
        .sort()
        .reduce((acc, key) => acc + key + params[key], '');
      const data = url + paramString;
      return createHmac('sha1', token)
        .update(Buffer.from(data, 'utf-8'))
        .digest('base64');
    }

    it('returns false when TWILIO_AUTH_TOKEN is not configured', () => {
      delete process.env.TWILIO_AUTH_TOKEN;

      const request = createMockRequest({
        headers: { 'x-twilio-signature': 'some-signature' },
      });

      expect(verifyTwilioSignature(request)).toBe(false);
    });

    it('returns false when signature header is missing', () => {
      process.env.TWILIO_AUTH_TOKEN = authToken;

      const request = createMockRequest({
        headers: {},
      });

      expect(verifyTwilioSignature(request)).toBe(false);
    });

    it('returns true for valid signature', () => {
      process.env.TWILIO_AUTH_TOKEN = authToken;

      const body = { From: '+1234567890', Body: 'Hello' };
      const url = 'https://example.com/api/webhooks/twilio';
      const signature = calculateTwilioSignature(url, body, authToken);

      const request = createMockRequest({
        headers: {
          'x-twilio-signature': signature,
          host: 'example.com',
        },
        body,
        url: '/api/webhooks/twilio',
        protocol: 'https',
      });

      expect(verifyTwilioSignature(request)).toBe(true);
    });

    it('returns false for invalid signature', () => {
      process.env.TWILIO_AUTH_TOKEN = authToken;

      const body = { From: '+1234567890', Body: 'Hello' };

      const request = createMockRequest({
        headers: {
          'x-twilio-signature': 'invalid-signature',
          host: 'example.com',
        },
        body,
        url: '/api/webhooks/twilio',
      });

      expect(verifyTwilioSignature(request)).toBe(false);
    });

    it('returns false when signature differs (tampered body)', () => {
      process.env.TWILIO_AUTH_TOKEN = authToken;

      const originalBody = { From: '+1234567890', Body: 'Hello' };
      const url = 'https://example.com/api/webhooks/twilio';
      const signature = calculateTwilioSignature(url, originalBody, authToken);

      // Tamper with the body
      const tamperedBody = { From: '+1234567890', Body: 'Tampered' };

      const request = createMockRequest({
        headers: {
          'x-twilio-signature': signature,
          host: 'example.com',
        },
        body: tamperedBody,
        url: '/api/webhooks/twilio',
        protocol: 'https',
      });

      expect(verifyTwilioSignature(request)).toBe(false);
    });

    it('handles empty body', () => {
      process.env.TWILIO_AUTH_TOKEN = authToken;

      const body = {};
      const url = 'https://example.com/api/webhooks/twilio';
      const signature = calculateTwilioSignature(url, body, authToken);

      const request = createMockRequest({
        headers: {
          'x-twilio-signature': signature,
          host: 'example.com',
        },
        body,
        url: '/api/webhooks/twilio',
        protocol: 'https',
      });

      expect(verifyTwilioSignature(request)).toBe(true);
    });
  });

  describe('verifyPostmarkAuth', () => {
    const username = 'postmark-user';
    const password = 'postmark-secret';

    function encodeBasicAuth(user: string, pass: string): string {
      return Buffer.from(`${user}:${pass}`).toString('base64');
    }

    it('returns false in production when credentials not configured', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.POSTMARK_WEBHOOK_USERNAME;
      delete process.env.POSTMARK_WEBHOOK_PASSWORD;

      const request = createMockRequest({});

      expect(verifyPostmarkAuth(request)).toBe(false);
    });

    it('returns true in development when credentials not configured', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.POSTMARK_WEBHOOK_USERNAME;
      delete process.env.POSTMARK_WEBHOOK_PASSWORD;

      const request = createMockRequest({});

      expect(verifyPostmarkAuth(request)).toBe(true);
    });

    it('returns true when auth disabled', () => {
      process.env.CLAWDBOT_AUTH_DISABLED = 'true';
      delete process.env.POSTMARK_WEBHOOK_USERNAME;
      delete process.env.POSTMARK_WEBHOOK_PASSWORD;

      const request = createMockRequest({});

      expect(verifyPostmarkAuth(request)).toBe(true);
    });

    it('returns false when authorization header is missing', () => {
      process.env.POSTMARK_WEBHOOK_USERNAME = username;
      process.env.POSTMARK_WEBHOOK_PASSWORD = password;

      const request = createMockRequest({
        headers: {},
      });

      expect(verifyPostmarkAuth(request)).toBe(false);
    });

    it('returns false when authorization is not Basic auth', () => {
      process.env.POSTMARK_WEBHOOK_USERNAME = username;
      process.env.POSTMARK_WEBHOOK_PASSWORD = password;

      const request = createMockRequest({
        headers: { authorization: 'Bearer some-token' },
      });

      expect(verifyPostmarkAuth(request)).toBe(false);
    });

    it('returns true for valid credentials', () => {
      process.env.POSTMARK_WEBHOOK_USERNAME = username;
      process.env.POSTMARK_WEBHOOK_PASSWORD = password;

      const request = createMockRequest({
        headers: {
          authorization: `Basic ${encodeBasicAuth(username, password)}`,
        },
      });

      expect(verifyPostmarkAuth(request)).toBe(true);
    });

    it('returns false for invalid username', () => {
      process.env.POSTMARK_WEBHOOK_USERNAME = username;
      process.env.POSTMARK_WEBHOOK_PASSWORD = password;

      const request = createMockRequest({
        headers: {
          authorization: `Basic ${encodeBasicAuth('wrong-user', password)}`,
        },
      });

      expect(verifyPostmarkAuth(request)).toBe(false);
    });

    it('returns false for invalid password', () => {
      process.env.POSTMARK_WEBHOOK_USERNAME = username;
      process.env.POSTMARK_WEBHOOK_PASSWORD = password;

      const request = createMockRequest({
        headers: {
          authorization: `Basic ${encodeBasicAuth(username, 'wrong-password')}`,
        },
      });

      expect(verifyPostmarkAuth(request)).toBe(false);
    });

    it('returns false for malformed base64', () => {
      process.env.POSTMARK_WEBHOOK_USERNAME = username;
      process.env.POSTMARK_WEBHOOK_PASSWORD = password;

      const request = createMockRequest({
        headers: {
          authorization: 'Basic !!!invalid-base64!!!',
        },
      });

      expect(verifyPostmarkAuth(request)).toBe(false);
    });
  });

  describe('verifyCloudflareEmailSecret', () => {
    const secret = 'cloudflare-email-secret-123';

    it('returns false in production when secret not configured', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.CLOUDFLARE_EMAIL_SECRET;

      const request = createMockRequest({
        headers: { 'x-cloudflare-email-secret': 'some-secret' },
      });

      expect(verifyCloudflareEmailSecret(request)).toBe(false);
    });

    it('returns true in development when secret not configured', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.CLOUDFLARE_EMAIL_SECRET;

      const request = createMockRequest({});

      expect(verifyCloudflareEmailSecret(request)).toBe(true);
    });

    it('returns false when secret header is missing', () => {
      process.env.CLOUDFLARE_EMAIL_SECRET = secret;

      const request = createMockRequest({
        headers: {},
      });

      expect(verifyCloudflareEmailSecret(request)).toBe(false);
    });

    it('returns true for valid secret', () => {
      process.env.CLOUDFLARE_EMAIL_SECRET = secret;

      const request = createMockRequest({
        headers: { 'x-cloudflare-email-secret': secret },
      });

      expect(verifyCloudflareEmailSecret(request)).toBe(true);
    });

    it('returns false for invalid secret', () => {
      process.env.CLOUDFLARE_EMAIL_SECRET = secret;

      const request = createMockRequest({
        headers: { 'x-cloudflare-email-secret': 'wrong-secret' },
      });

      expect(verifyCloudflareEmailSecret(request)).toBe(false);
    });

    it('handles timing-safe comparison for different length secrets', () => {
      process.env.CLOUDFLARE_EMAIL_SECRET = secret;

      const request = createMockRequest({
        headers: { 'x-cloudflare-email-secret': 'short' },
      });

      // Should return false without throwing
      expect(verifyCloudflareEmailSecret(request)).toBe(false);
    });
  });

  describe('verifyHmacSha256', () => {
    const secretEnvVar = 'TEST_WEBHOOK_SECRET';
    const secret = 'my-hmac-secret-key';

    function calculateHmacSha256(body: string, key: string): string {
      return createHmac('sha256', key)
        .update(Buffer.from(body, 'utf-8'))
        .digest('hex');
    }

    it('returns false when secret env var is not configured', () => {
      delete process.env[secretEnvVar];

      const request = createMockRequest({
        headers: { 'x-signature': 'some-signature' },
        body: '{"test": true}',
      });

      expect(verifyHmacSha256(request, secretEnvVar)).toBe(false);
    });

    it('returns false when signature header is missing', () => {
      process.env[secretEnvVar] = secret;

      const request = createMockRequest({
        headers: {},
        body: '{"test": true}',
      });

      expect(verifyHmacSha256(request, secretEnvVar)).toBe(false);
    });

    it('returns true for valid signature (string body)', () => {
      process.env[secretEnvVar] = secret;

      const body = '{"test": true}';
      const signature = calculateHmacSha256(body, secret);

      const request = createMockRequest({
        headers: { 'x-signature': signature },
        body,
      });

      expect(verifyHmacSha256(request, secretEnvVar)).toBe(true);
    });

    it('returns true for valid signature (object body)', () => {
      process.env[secretEnvVar] = secret;

      const body = { test: true };
      const bodyString = JSON.stringify(body);
      const signature = calculateHmacSha256(bodyString, secret);

      const request = createMockRequest({
        headers: { 'x-signature': signature },
        body,
      });

      expect(verifyHmacSha256(request, secretEnvVar)).toBe(true);
    });

    it('returns true for signature with sha256= prefix', () => {
      process.env[secretEnvVar] = secret;

      const body = '{"test": true}';
      const signature = `sha256=${calculateHmacSha256(body, secret)}`;

      const request = createMockRequest({
        headers: { 'x-signature': signature },
        body,
      });

      expect(verifyHmacSha256(request, secretEnvVar)).toBe(true);
    });

    it('returns false for invalid signature', () => {
      process.env[secretEnvVar] = secret;

      const request = createMockRequest({
        headers: { 'x-signature': 'invalid-hex-signature' },
        body: '{"test": true}',
      });

      expect(verifyHmacSha256(request, secretEnvVar)).toBe(false);
    });

    it('uses custom signature header when specified', () => {
      process.env[secretEnvVar] = secret;

      const body = '{"test": true}';
      const signature = calculateHmacSha256(body, secret);

      const request = createMockRequest({
        headers: { 'x-custom-sig': signature },
        body,
      });

      expect(verifyHmacSha256(request, secretEnvVar, 'X-Custom-Sig')).toBe(true);
    });

    it('returns false when body is tampered', () => {
      process.env[secretEnvVar] = secret;

      const originalBody = '{"test": true}';
      const signature = calculateHmacSha256(originalBody, secret);

      const request = createMockRequest({
        headers: { 'x-signature': signature },
        body: '{"test": false}', // Tampered
      });

      expect(verifyHmacSha256(request, secretEnvVar)).toBe(false);
    });
  });

  describe('verifyWebhook', () => {
    it('delegates to verifyTwilioSignature for twilio provider', () => {
      process.env.TWILIO_AUTH_TOKEN = 'test-token';

      const request = createMockRequest({
        headers: { 'x-twilio-signature': 'invalid' },
      });

      // Should return false (invalid signature)
      expect(verifyWebhook(request, 'twilio')).toBe(false);
    });

    it('delegates to verifyPostmarkAuth for postmark provider', () => {
      process.env.POSTMARK_WEBHOOK_USERNAME = 'user';
      process.env.POSTMARK_WEBHOOK_PASSWORD = 'pass';

      const request = createMockRequest({
        headers: {},
      });

      // Should return false (no auth header)
      expect(verifyWebhook(request, 'postmark')).toBe(false);
    });

    it('delegates to verifyCloudflareEmailSecret for cloudflare provider', () => {
      process.env.CLOUDFLARE_EMAIL_SECRET = 'secret';

      const request = createMockRequest({
        headers: {},
      });

      // Should return false (no secret header)
      expect(verifyWebhook(request, 'cloudflare')).toBe(false);
    });

    it('delegates to verifyHmacSha256 for generic provider', () => {
      delete process.env.GENERIC_WEBHOOK_SECRET;

      const request = createMockRequest({});

      // Should return false (not configured)
      expect(verifyWebhook(request, 'generic')).toBe(false);
    });

    it('returns false for unknown provider', () => {
      const request = createMockRequest({});

      expect(verifyWebhook(request, 'unknown' as WebhookProvider)).toBe(false);
    });
  });

  describe('isWebhookVerificationConfigured', () => {
    it('returns true for twilio when configured', () => {
      process.env.TWILIO_AUTH_TOKEN = 'test-token';
      expect(isWebhookVerificationConfigured('twilio')).toBe(true);
    });

    it('returns false for twilio when not configured', () => {
      delete process.env.TWILIO_AUTH_TOKEN;
      expect(isWebhookVerificationConfigured('twilio')).toBe(false);
    });

    it('returns true for postmark when both credentials configured', () => {
      process.env.POSTMARK_WEBHOOK_USERNAME = 'user';
      process.env.POSTMARK_WEBHOOK_PASSWORD = 'pass';
      expect(isWebhookVerificationConfigured('postmark')).toBe(true);
    });

    it('returns false for postmark when only username configured', () => {
      process.env.POSTMARK_WEBHOOK_USERNAME = 'user';
      delete process.env.POSTMARK_WEBHOOK_PASSWORD;
      expect(isWebhookVerificationConfigured('postmark')).toBe(false);
    });

    it('returns false for postmark when only password configured', () => {
      delete process.env.POSTMARK_WEBHOOK_USERNAME;
      process.env.POSTMARK_WEBHOOK_PASSWORD = 'pass';
      expect(isWebhookVerificationConfigured('postmark')).toBe(false);
    });

    it('returns true for cloudflare when configured', () => {
      process.env.CLOUDFLARE_EMAIL_SECRET = 'secret';
      expect(isWebhookVerificationConfigured('cloudflare')).toBe(true);
    });

    it('returns false for cloudflare when not configured', () => {
      delete process.env.CLOUDFLARE_EMAIL_SECRET;
      expect(isWebhookVerificationConfigured('cloudflare')).toBe(false);
    });

    it('returns true for generic when configured', () => {
      process.env.GENERIC_WEBHOOK_SECRET = 'secret';
      expect(isWebhookVerificationConfigured('generic')).toBe(true);
    });

    it('returns false for generic when not configured', () => {
      delete process.env.GENERIC_WEBHOOK_SECRET;
      expect(isWebhookVerificationConfigured('generic')).toBe(false);
    });

    it('returns false for unknown provider', () => {
      expect(isWebhookVerificationConfigured('unknown' as WebhookProvider)).toBe(false);
    });
  });
});
