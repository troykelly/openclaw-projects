/**
 * Tests for Postmark inbound email webhook endpoint.
 * Part of Issue #203.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Pool } from 'pg';
import { buildServer } from '../../src/api/server.ts';
import { createTestPool, truncateAllTables } from '../helpers/db.ts';
import type { PostmarkInboundPayload, PostmarkAddress, PostmarkHeader } from '../../src/api/postmark/types.ts';

describe('Postmark Inbound Webhook', () => {
  const originalEnv = process.env;
  let pool: Pool;
  let app: ReturnType<typeof buildServer>;

  const webhookUsername = 'postmark-webhook-user';
  const webhookPassword = 'postmark-webhook-secret';

  function createBasicAuth(user: string, pass: string): string {
    return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
  }

  function createPostmarkAddress(email: string, name: string = ''): PostmarkAddress {
    return { Email: email, Name: name };
  }

  function createPostmarkPayload(overrides: Partial<PostmarkInboundPayload> = {}): PostmarkInboundPayload {
    const messageId = `${Date.now()}.${Math.random().toString(36).slice(2)}@postmark.test`;
    return {
      MessageID: messageId,
      From: 'sender@example.com',
      FromFull: createPostmarkAddress('sender@example.com', 'Test Sender'),
      To: 'recipient@example.com',
      ToFull: [createPostmarkAddress('recipient@example.com', 'Test Recipient')],
      Subject: 'Test Email Subject',
      TextBody: 'This is the plain text body.',
      HtmlBody: '<p>This is the <strong>HTML</strong> body.</p>',
      Headers: [{ Name: 'Message-ID', Value: `<${messageId}>` }],
      Date: new Date().toISOString(),
      ...overrides,
    };
  }

  beforeEach(async () => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.POSTMARK_WEBHOOK_USERNAME = webhookUsername;
    process.env.POSTMARK_WEBHOOK_PASSWORD = webhookPassword;
    process.env.OPENCLAW_PROJECTS_AUTH_DISABLED = 'true'; // Disable auth for most tests

    pool = createTestPool();
    await truncateAllTables(pool);
    app = buildServer({ logger: false });
  });

  afterEach(async () => {
    process.env = originalEnv;
    await pool.end();
  });

  describe('POST /api/postmark/inbound', () => {
    it('returns 400 for missing required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/postmark/inbound',
        payload: { Subject: 'Test' }, // Missing MessageID and FromFull
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('Missing required fields');
    });

    it('creates contact and message for new sender', async () => {
      const payload = createPostmarkPayload();

      const response = await app.inject({
        method: 'POST',
        url: '/api/postmark/inbound',
        payload,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);
      expect(response.json().contactId).toBeDefined();
      expect(response.json().messageId).toBeDefined();

      // Verify contact was created
      const contactResult = await pool.query(
        `SELECT c.id, c.display_name, ce.endpoint_value
           FROM contact c
           JOIN contact_endpoint ce ON ce.contact_id = c.id
          WHERE ce.endpoint_type = 'email'
            AND ce.normalized_value LIKE '%sender@example.com%'`,
      );
      expect(contactResult.rows.length).toBe(1);
      expect(contactResult.rows[0].display_name).toBe('Test Sender');
    });

    it('reuses existing contact for known email', async () => {
      // Create first message
      const payload1 = createPostmarkPayload({
        MessageID: 'msg1@test.com',
        Subject: 'First Email',
        Headers: [{ Name: 'Message-ID', Value: '<msg1@test.com>' }],
      });

      const response1 = await app.inject({
        method: 'POST',
        url: '/api/postmark/inbound',
        payload: payload1,
      });
      expect(response1.statusCode).toBe(200);

      // Get contact count
      const count1 = await pool.query('SELECT COUNT(*) FROM contact');

      // Create second message from same sender (different thread)
      const payload2 = createPostmarkPayload({
        MessageID: 'msg2@test.com',
        Subject: 'Second Email',
        Headers: [{ Name: 'Message-ID', Value: '<msg2@test.com>' }],
      });

      const response2 = await app.inject({
        method: 'POST',
        url: '/api/postmark/inbound',
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
      const payload = createPostmarkPayload({
        MessageID: 'unique-msg-id@test.com',
      });

      await app.inject({
        method: 'POST',
        url: '/api/postmark/inbound',
        payload,
      });

      const threadResult = await pool.query(`SELECT * FROM external_thread WHERE channel = 'email'`);
      expect(threadResult.rows.length).toBe(1);
      expect(threadResult.rows[0].external_thread_key).toContain('email:');
      expect(threadResult.rows[0].metadata).toEqual(
        expect.objectContaining({
          source: 'postmark',
          subject: payload.Subject,
        }),
      );
    });

    it('threads replies using In-Reply-To header', async () => {
      // Create original email
      const originalPayload = createPostmarkPayload({
        MessageID: 'original@test.com',
        Subject: 'Original Email',
        Headers: [{ Name: 'Message-ID', Value: '<original@test.com>' }],
      });

      const response1 = await app.inject({
        method: 'POST',
        url: '/api/postmark/inbound',
        payload: originalPayload,
      });
      const originalThreadId = response1.json().threadId;

      // Create reply with In-Reply-To header
      const replyPayload = createPostmarkPayload({
        MessageID: 'reply@test.com',
        Subject: 'Re: Original Email',
        Headers: [
          { Name: 'Message-ID', Value: '<reply@test.com>' },
          { Name: 'In-Reply-To', Value: '<original@test.com>' },
        ],
      });

      const response2 = await app.inject({
        method: 'POST',
        url: '/api/postmark/inbound',
        payload: replyPayload,
      });
      const replyThreadId = response2.json().threadId;

      // Both should be in the same thread
      expect(replyThreadId).toBe(originalThreadId);

      // Verify two messages in same thread
      const messages = await pool.query(`SELECT COUNT(*) FROM external_message WHERE thread_id = $1`, [originalThreadId]);
      expect(parseInt(messages.rows[0].count, 10)).toBe(2);
    });

    it('stores email fields correctly', async () => {
      const payload = createPostmarkPayload({
        Subject: 'Important Subject',
        FromFull: createPostmarkAddress('sender@test.com', 'The Sender'),
        ToFull: [createPostmarkAddress('to1@test.com', 'To 1'), createPostmarkAddress('to2@test.com', 'To 2')],
        CcFull: [createPostmarkAddress('cc@test.com', 'CC Person')],
        TextBody: 'Plain text content',
        HtmlBody: '<p>HTML content</p>',
      });

      await app.inject({
        method: 'POST',
        url: '/api/postmark/inbound',
        payload,
      });

      const messageResult = await pool.query(
        `SELECT subject, from_address, to_addresses, cc_addresses, body
           FROM external_message
          LIMIT 1`,
      );
      expect(messageResult.rows.length).toBe(1);
      expect(messageResult.rows[0].subject).toBe('Important Subject');
      expect(messageResult.rows[0].from_address).toBe('sender@test.com');
      expect(messageResult.rows[0].to_addresses).toContain('to1@test.com');
      expect(messageResult.rows[0].to_addresses).toContain('to2@test.com');
      expect(messageResult.rows[0].cc_addresses).toContain('cc@test.com');
      expect(messageResult.rows[0].body).toBe('Plain text content');
    });

    it('stores attachment metadata', async () => {
      const payload = createPostmarkPayload({
        Attachments: [
          {
            Name: 'document.pdf',
            Content: 'base64content==',
            ContentType: 'application/pdf',
            ContentLength: 12345,
          },
          {
            Name: 'image.png',
            Content: 'base64imagedata==',
            ContentType: 'image/png',
            ContentLength: 67890,
            ContentID: 'cid:image1',
          },
        ],
      });

      await app.inject({
        method: 'POST',
        url: '/api/postmark/inbound',
        payload,
      });

      const messageResult = await pool.query(`SELECT attachments FROM external_message LIMIT 1`);
      expect(messageResult.rows.length).toBe(1);
      const attachments = messageResult.rows[0].attachments;
      expect(attachments).toHaveLength(2);
      expect(attachments[0]).toEqual({
        name: 'document.pdf',
        contentType: 'application/pdf',
        size: 12345,
      });
      expect(attachments[1]).toEqual({
        name: 'image.png',
        contentType: 'image/png',
        size: 67890,
        contentId: 'cid:image1',
      });
    });

    it('stores full Postmark payload in raw field', async () => {
      const payload = createPostmarkPayload({
        MailboxHash: 'test-hash',
        Tag: 'test-tag',
      });

      await app.inject({
        method: 'POST',
        url: '/api/postmark/inbound',
        payload,
      });

      const messageResult = await pool.query(`SELECT raw FROM external_message LIMIT 1`);
      expect(messageResult.rows.length).toBe(1);
      expect(messageResult.rows[0].raw.MessageID).toBe(payload.MessageID);
      expect(messageResult.rows[0].raw.MailboxHash).toBe('test-hash');
      expect(messageResult.rows[0].raw.Tag).toBe('test-tag');
    });

    it('falls back to HTML body when TextBody is empty', async () => {
      const payload = createPostmarkPayload({
        TextBody: '',
        HtmlBody: '<p>HTML only content</p>',
      });

      await app.inject({
        method: 'POST',
        url: '/api/postmark/inbound',
        payload,
      });

      const messageResult = await pool.query(`SELECT body FROM external_message LIMIT 1`);
      expect(messageResult.rows[0].body).toContain('HTML only content');
    });

    it('handles duplicate message gracefully (idempotent)', async () => {
      const payload = createPostmarkPayload();

      // Send same message twice
      await app.inject({
        method: 'POST',
        url: '/api/postmark/inbound',
        payload,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/postmark/inbound',
        payload, // Same MessageID
      });

      expect(response.statusCode).toBe(200);

      // Should only have one message (ON CONFLICT updates)
      const count = await pool.query('SELECT COUNT(*) FROM external_message');
      expect(parseInt(count.rows[0].count, 10)).toBe(1);
    });
  });

  describe('Authentication', () => {
    beforeEach(() => {
      // Enable authentication
      delete process.env.OPENCLAW_PROJECTS_AUTH_DISABLED;
    });

    it('returns 401 when credentials missing', async () => {
      const payload = createPostmarkPayload();

      const response = await app.inject({
        method: 'POST',
        url: '/api/postmark/inbound',
        payload,
        headers: {
          // No Authorization header
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 401 for invalid credentials', async () => {
      const payload = createPostmarkPayload();

      const response = await app.inject({
        method: 'POST',
        url: '/api/postmark/inbound',
        payload,
        headers: {
          authorization: createBasicAuth('wrong-user', 'wrong-pass'),
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('accepts request with valid credentials', async () => {
      const payload = createPostmarkPayload();

      const response = await app.inject({
        method: 'POST',
        url: '/api/postmark/inbound',
        payload,
        headers: {
          authorization: createBasicAuth(webhookUsername, webhookPassword),
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('accepts request when auth is disabled', async () => {
      process.env.OPENCLAW_PROJECTS_AUTH_DISABLED = 'true';
      const payload = createPostmarkPayload();

      const response = await app.inject({
        method: 'POST',
        url: '/api/postmark/inbound',
        payload,
        // No Authorization header
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
