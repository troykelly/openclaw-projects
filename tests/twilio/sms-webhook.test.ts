/**
 * Tests for Twilio SMS webhook endpoint.
 * Part of Issue #202.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'crypto';
import type { Pool } from 'pg';
import { buildServer } from '../../src/api/server.ts';
import { createTestPool, truncateAllTables } from '../helpers/db.ts';
import type { TwilioSmsWebhookPayload } from '../../src/api/twilio/types.ts';

/**
 * Convert an object to URL-encoded form data string.
 */
function toUrlEncoded(data: Record<string, string | undefined>): string {
  return Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v!)}`)
    .join('&');
}

describe('Twilio SMS Webhook', () => {
  const originalEnv = process.env;
  let pool: Pool;
  let app: ReturnType<typeof buildServer>;

  const authToken = 'test-twilio-auth-token-for-tests';

  // Create a valid Twilio signature
  function createTwilioSignature(url: string, params: Record<string, string>, token: string): string {
    const paramString = Object.keys(params)
      .sort()
      .reduce((acc, key) => acc + key + params[key], '');
    const data = url + paramString;
    return createHmac('sha1', token).update(Buffer.from(data, 'utf-8')).digest('base64');
  }

  function createTwilioPayload(overrides: Partial<TwilioSmsWebhookPayload> = {}): TwilioSmsWebhookPayload {
    return {
      MessageSid: `SM${Date.now()}${Math.random().toString(36).slice(2)}`,
      AccountSid: 'ACTEST00000000000000000000000000', // Test account ID (not a real Twilio SID)
      From: '+14155551234',
      To: '+14155556789',
      Body: 'Hello from test',
      FromCity: 'San Francisco',
      FromState: 'CA',
      FromCountry: 'US',
      ...overrides,
    };
  }

  beforeEach(async () => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.TWILIO_AUTH_TOKEN = authToken;
    process.env.OPENCLAW_PROJECTS_AUTH_DISABLED = 'true'; // Disable auth for testing

    pool = createTestPool();
    await truncateAllTables(pool);
    app = buildServer({ logger: false });
  });

  afterEach(async () => {
    process.env = originalEnv;
    await pool.end();
  });

  describe('POST /api/twilio/sms', () => {
    it('returns 400 for missing required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/twilio/sms',
        payload: toUrlEncoded({ Body: 'Hello' }), // Missing MessageSid, From, To
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('Missing required fields');
    });

    it('creates contact and message for new sender', async () => {
      const payload = createTwilioPayload();

      const response = await app.inject({
        method: 'POST',
        url: '/api/twilio/sms',
        payload: toUrlEncoded(payload as unknown as Record<string, string>),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('application/xml');
      expect(response.body).toContain('<Response>');

      // Verify contact was created
      const contactResult = await pool.query(
        `SELECT c.id, c.display_name, ce.endpoint_value
           FROM contact c
           JOIN contact_endpoint ce ON ce.contact_id = c.id
          WHERE ce.endpoint_type = 'phone'
            AND ce.normalized_value LIKE '%4155551234%'`,
      );
      expect(contactResult.rows.length).toBe(1);
      expect(contactResult.rows[0].display_name).toContain('+14155551234');
    });

    it('reuses existing contact for known phone number', async () => {
      // Create first message
      const payload1 = createTwilioPayload({
        MessageSid: 'SM0001',
        Body: 'First message',
      });

      await app.inject({
        method: 'POST',
        url: '/api/twilio/sms',
        payload: toUrlEncoded(payload1 as unknown as Record<string, string>),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });

      // Get contact count
      const count1 = await pool.query('SELECT COUNT(*) FROM contact');

      // Create second message from same number
      const payload2 = createTwilioPayload({
        MessageSid: 'SM0002',
        Body: 'Second message',
      });

      await app.inject({
        method: 'POST',
        url: '/api/twilio/sms',
        payload: toUrlEncoded(payload2 as unknown as Record<string, string>),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });

      // Verify contact count unchanged
      const count2 = await pool.query('SELECT COUNT(*) FROM contact');
      expect(count2.rows[0].count).toBe(count1.rows[0].count);

      // Verify both messages exist
      const messages = await pool.query('SELECT COUNT(*) FROM external_message');
      expect(parseInt(messages.rows[0].count, 10)).toBe(2);
    });

    it('creates thread for SMS conversation', async () => {
      const payload = createTwilioPayload();

      await app.inject({
        method: 'POST',
        url: '/api/twilio/sms',
        payload: toUrlEncoded(payload as unknown as Record<string, string>),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });

      const threadResult = await pool.query(`SELECT * FROM external_thread WHERE channel = 'phone'`);
      expect(threadResult.rows.length).toBe(1);
      expect(threadResult.rows[0].external_thread_key).toContain('sms:');
      expect(threadResult.rows[0].metadata).toEqual(
        expect.objectContaining({
          fromPhone: expect.any(String),
          toPhone: expect.any(String),
          source: 'twilio',
        }),
      );
    });

    it('stores full Twilio payload in raw field', async () => {
      const payload = createTwilioPayload({
        NumMedia: '1',
        MediaContentType0: 'image/jpeg',
        MediaUrl0: 'https://api.twilio.com/media/image.jpg',
      });

      await app.inject({
        method: 'POST',
        url: '/api/twilio/sms',
        payload: toUrlEncoded(payload as unknown as Record<string, string>),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });

      const messageResult = await pool.query(`SELECT raw FROM external_message WHERE external_message_key = $1`, [payload.MessageSid]);
      expect(messageResult.rows.length).toBe(1);
      expect(messageResult.rows[0].raw.MessageSid).toBe(payload.MessageSid);
      expect(messageResult.rows[0].raw.NumMedia).toBe('1');
      expect(messageResult.rows[0].raw.MediaUrl0).toBe('https://api.twilio.com/media/image.jpg');
    });

    it('normalizes phone numbers to E.164', async () => {
      const payload = createTwilioPayload({
        From: '4155551234', // Missing + and country code
      });

      await app.inject({
        method: 'POST',
        url: '/api/twilio/sms',
        payload: toUrlEncoded(payload as unknown as Record<string, string>),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });

      const endpointResult = await pool.query(`SELECT endpoint_value, normalized_value FROM contact_endpoint WHERE endpoint_type = 'phone'`);
      expect(endpointResult.rows.length).toBe(1);
      expect(endpointResult.rows[0].endpoint_value).toBe('+14155551234');
    });

    it('includes geographic info in contact metadata', async () => {
      const payload = createTwilioPayload({
        FromCity: 'San Francisco',
        FromState: 'CA',
        FromCountry: 'US',
      });

      await app.inject({
        method: 'POST',
        url: '/api/twilio/sms',
        payload: toUrlEncoded(payload as unknown as Record<string, string>),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });

      const endpointResult = await pool.query(`SELECT metadata FROM contact_endpoint WHERE endpoint_type = 'phone'`);
      expect(endpointResult.rows[0].metadata).toEqual(
        expect.objectContaining({
          source: 'twilio',
          fromCity: 'San Francisco',
          fromState: 'CA',
          fromCountry: 'US',
        }),
      );
    });

    it('returns empty TwiML response (no auto-reply)', async () => {
      const payload = createTwilioPayload();

      const response = await app.inject({
        method: 'POST',
        url: '/api/twilio/sms',
        payload: toUrlEncoded(payload as unknown as Record<string, string>),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    });

    it('handles duplicate message gracefully (idempotent)', async () => {
      const payload = createTwilioPayload();

      // Send same message twice
      await app.inject({
        method: 'POST',
        url: '/api/twilio/sms',
        payload: toUrlEncoded(payload as unknown as Record<string, string>),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/twilio/sms',
        payload: toUrlEncoded(payload as unknown as Record<string, string>), // Same MessageSid
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });

      expect(response.statusCode).toBe(200);

      // Should only have one message (ON CONFLICT updates)
      const count = await pool.query(`SELECT COUNT(*) FROM external_message WHERE external_message_key = $1`, [payload.MessageSid]);
      expect(parseInt(count.rows[0].count, 10)).toBe(1);
    });
  });

  describe('Signature Verification', () => {
    beforeEach(() => {
      // Enable signature verification
      delete process.env.OPENCLAW_PROJECTS_AUTH_DISABLED;
    });

    it('returns 401 for invalid signature', async () => {
      const payload = createTwilioPayload();

      const response = await app.inject({
        method: 'POST',
        url: '/api/twilio/sms',
        payload: toUrlEncoded(payload as unknown as Record<string, string>),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-twilio-signature': 'invalid-signature',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 401 when signature header is missing', async () => {
      const payload = createTwilioPayload();

      const response = await app.inject({
        method: 'POST',
        url: '/api/twilio/sms',
        payload: toUrlEncoded(payload as unknown as Record<string, string>),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          // No x-twilio-signature header
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('accepts request when auth is disabled (development mode)', async () => {
      // Re-enable auth disabled for this test
      process.env.OPENCLAW_PROJECTS_AUTH_DISABLED = 'true';

      const payload = createTwilioPayload();

      const response = await app.inject({
        method: 'POST',
        url: '/api/twilio/sms',
        payload: toUrlEncoded(payload as unknown as Record<string, string>),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          // No signature header - should work with auth disabled
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns 503 when TWILIO_AUTH_TOKEN not configured', async () => {
      delete process.env.TWILIO_AUTH_TOKEN;

      const payload = createTwilioPayload();

      const response = await app.inject({
        method: 'POST',
        url: '/api/twilio/sms',
        payload: toUrlEncoded(payload as unknown as Record<string, string>),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
        },
      });

      expect(response.statusCode).toBe(503);
      expect(response.json().error).toBe('Twilio webhook not configured');
    });
  });
});
