/**
 * Tests for Cloudflare Email Workers inbound webhook endpoint.
 * Part of Issue #210.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Pool } from 'pg';
import { buildServer } from '../../src/api/server.ts';
import { createTestPool, truncateAllTables } from '../helpers/db.ts';
import type { CloudflareEmailPayload } from '../../src/api/cloudflare-email/types.ts';

describe('Cloudflare Email Inbound Webhook', () => {
  const originalEnv = process.env;
  let pool: Pool;
  let app: ReturnType<typeof buildServer>;

  const webhookSecret = 'cloudflare-email-secret-for-tests';

  function createCloudflarePayload(
    overrides: Partial<CloudflareEmailPayload> = {}
  ): CloudflareEmailPayload {
    const messageId = `${Date.now()}.${Math.random().toString(36).slice(2)}@cloudflare.test`;
    return {
      from: 'sender@example.com',
      to: 'support@myapp.com',
      subject: 'Test Email Subject',
      text_body: 'This is the plain text body.',
      html_body: '<p>This is the <strong>HTML</strong> body.</p>',
      headers: {
        'message-id': `<${messageId}>`,
      },
      timestamp: new Date().toISOString(),
      ...overrides,
    };
  }

  beforeEach(async () => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.CLOUDFLARE_EMAIL_SECRET = webhookSecret;
    process.env.CLAWDBOT_AUTH_DISABLED = 'true'; // Disable auth for most tests

    pool = createTestPool();
    await truncateAllTables(pool);
    app = buildServer({ logger: false });
  });

  afterEach(async () => {
    process.env = originalEnv;
    await pool.end();
  });

  describe('POST /api/cloudflare/email', () => {
    it('returns 400 for missing required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/cloudflare/email',
        payload: { subject: 'Test' }, // Missing from, to, timestamp
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('Missing required fields');
    });

    it('returns 400 for stale timestamp', async () => {
      const staleTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes ago
      const payload = createCloudflarePayload({ timestamp: staleTimestamp });

      const response = await app.inject({
        method: 'POST',
        url: '/api/cloudflare/email',
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('stale timestamp');
    });

    it('returns 400 for invalid timestamp format', async () => {
      const payload = createCloudflarePayload({ timestamp: 'not-a-date' });

      const response = await app.inject({
        method: 'POST',
        url: '/api/cloudflare/email',
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('Invalid or stale timestamp');
    });

    it('creates contact and message for new sender', async () => {
      const payload = createCloudflarePayload();

      const response = await app.inject({
        method: 'POST',
        url: '/api/cloudflare/email',
        payload,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);
      expect(response.json().receiptId).toBeDefined();
      expect(response.json().contactId).toBeDefined();
      expect(response.json().messageId).toBeDefined();

      // Verify contact was created
      const contactResult = await pool.query(
        `SELECT c.id, c.display_name, ce.endpoint_value
           FROM contact c
           JOIN contact_endpoint ce ON ce.contact_id = c.id
          WHERE ce.endpoint_type = 'email'
            AND ce.normalized_value LIKE '%sender@example.com%'`
      );
      expect(contactResult.rows.length).toBe(1);
      expect(contactResult.rows[0].display_name).toBe('sender@example.com');
    });

    it('reuses existing contact for known email', async () => {
      // Create first message
      const payload1 = createCloudflarePayload({
        headers: { 'message-id': '<msg1@cloudflare.test>' },
      });

      const response1 = await app.inject({
        method: 'POST',
        url: '/api/cloudflare/email',
        payload: payload1,
      });
      expect(response1.statusCode).toBe(200);

      // Get contact count
      const count1 = await pool.query('SELECT COUNT(*) FROM contact');

      // Create second message from same sender (different thread)
      const payload2 = createCloudflarePayload({
        subject: 'Second Email',
        headers: { 'message-id': '<msg2@cloudflare.test>' },
      });

      const response2 = await app.inject({
        method: 'POST',
        url: '/api/cloudflare/email',
        payload: payload2,
      });
      expect(response2.statusCode).toBe(200);

      // Verify contact count unchanged
      const count2 = await pool.query('SELECT COUNT(*) FROM contact');
      expect(count2.rows[0].count).toBe(count1.rows[0].count);

      // Verify both messages exist
      const messages = await pool.query('SELECT COUNT(*) FROM external_message');
      expect(parseInt(messages.rows[0].count, 10)).toBe(2);
    });

    it('creates thread for email using Message-ID', async () => {
      const payload = createCloudflarePayload({
        headers: { 'message-id': '<unique-msg@cloudflare.test>' },
      });

      await app.inject({
        method: 'POST',
        url: '/api/cloudflare/email',
        payload,
      });

      const threadResult = await pool.query(
        `SELECT * FROM external_thread WHERE channel = 'email'`
      );
      expect(threadResult.rows.length).toBe(1);
      expect(threadResult.rows[0].external_thread_key).toContain('email:');
      expect(threadResult.rows[0].metadata).toEqual(
        expect.objectContaining({
          source: 'cloudflare-email',
          subject: payload.subject,
        })
      );
    });

    it('threads replies using In-Reply-To header', async () => {
      // Create original email
      const originalPayload = createCloudflarePayload({
        subject: 'Original Email',
        headers: {
          'message-id': '<original@cloudflare.test>',
        },
      });

      const response1 = await app.inject({
        method: 'POST',
        url: '/api/cloudflare/email',
        payload: originalPayload,
      });
      expect(response1.statusCode).toBe(200);
      const originalThreadId = response1.json().threadId;

      // Create reply with In-Reply-To header
      const replyPayload = createCloudflarePayload({
        subject: 'Re: Original Email',
        headers: {
          'message-id': '<reply@cloudflare.test>',
          'in-reply-to': '<original@cloudflare.test>',
        },
      });

      const response2 = await app.inject({
        method: 'POST',
        url: '/api/cloudflare/email',
        payload: replyPayload,
      });
      expect(response2.statusCode).toBe(200);
      const replyThreadId = response2.json().threadId;

      // Both should be in the same thread
      expect(replyThreadId).toBe(originalThreadId);

      // Verify two messages in same thread
      const messages = await pool.query(
        `SELECT COUNT(*) FROM external_message WHERE thread_id = $1`,
        [originalThreadId]
      );
      expect(parseInt(messages.rows[0].count, 10)).toBe(2);
    });

    it('stores email fields correctly', async () => {
      const payload = createCloudflarePayload({
        from: 'sender@test.com',
        to: 'support@myapp.com',
        subject: 'Important Subject',
        text_body: 'Plain text content',
        html_body: '<p>HTML content</p>',
      });

      await app.inject({
        method: 'POST',
        url: '/api/cloudflare/email',
        payload,
      });

      const messageResult = await pool.query(
        `SELECT subject, from_address, to_addresses, body
           FROM external_message
          LIMIT 1`
      );
      expect(messageResult.rows.length).toBe(1);
      expect(messageResult.rows[0].subject).toBe('Important Subject');
      expect(messageResult.rows[0].from_address).toBe('sender@test.com');
      expect(messageResult.rows[0].to_addresses).toContain('support@myapp.com');
      expect(messageResult.rows[0].body).toBe('Plain text content');
    });

    it('falls back to HTML body when text_body is empty', async () => {
      const payload = createCloudflarePayload({
        text_body: '',
        html_body: '<p>HTML only content</p>',
      });

      await app.inject({
        method: 'POST',
        url: '/api/cloudflare/email',
        payload,
      });

      const messageResult = await pool.query(
        `SELECT body FROM external_message LIMIT 1`
      );
      expect(messageResult.rows[0].body).toContain('HTML only content');
    });

    it('stores full payload in raw field', async () => {
      const payload = createCloudflarePayload({
        raw: 'Full MIME message here',
      });

      await app.inject({
        method: 'POST',
        url: '/api/cloudflare/email',
        payload,
      });

      const messageResult = await pool.query(
        `SELECT raw FROM external_message LIMIT 1`
      );
      expect(messageResult.rows.length).toBe(1);
      expect(messageResult.rows[0].raw.from).toBe(payload.from);
      expect(messageResult.rows[0].raw.raw).toBe('Full MIME message here');
    });

    it('handles duplicate message gracefully (idempotent)', async () => {
      const payload = createCloudflarePayload({
        headers: { 'message-id': '<duplicate@cloudflare.test>' },
      });

      // Send same message twice
      await app.inject({
        method: 'POST',
        url: '/api/cloudflare/email',
        payload,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/cloudflare/email',
        payload, // Same message-id
      });

      expect(response.statusCode).toBe(200);

      // Should only have one message (ON CONFLICT updates)
      const count = await pool.query('SELECT COUNT(*) FROM external_message');
      expect(parseInt(count.rows[0].count, 10)).toBe(1);
    });
  });

  describe('Secret Header Authentication', () => {
    beforeEach(() => {
      // Enable authentication
      delete process.env.CLAWDBOT_AUTH_DISABLED;
    });

    it('returns 401 when signature is missing', async () => {
      const payload = createCloudflarePayload();

      const response = await app.inject({
        method: 'POST',
        url: '/api/cloudflare/email',
        payload,
        headers: {
          // No X-Webhook-Signature header
        },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error).toContain('Invalid signature');
    });

    it('returns 401 for invalid secret', async () => {
      const payload = createCloudflarePayload();

      const response = await app.inject({
        method: 'POST',
        url: '/api/cloudflare/email',
        payload,
        headers: {
          'x-cloudflare-email-secret': 'wrong-secret',
        },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error).toContain('Invalid signature');
    });

    it('accepts request with valid secret header', async () => {
      const payload = createCloudflarePayload();

      const response = await app.inject({
        method: 'POST',
        url: '/api/cloudflare/email',
        payload,
        headers: {
          'x-cloudflare-email-secret': webhookSecret,
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('accepts request when auth is disabled', async () => {
      process.env.CLAWDBOT_AUTH_DISABLED = 'true';
      const payload = createCloudflarePayload();

      const response = await app.inject({
        method: 'POST',
        url: '/api/cloudflare/email',
        payload,
        // No Authorization header
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
