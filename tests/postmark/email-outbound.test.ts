import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from '../helpers/migrate.ts';
import { createTestPool, truncateAllTables } from '../helpers/db.ts';

describe('Postmark email outbound sending (#293)', () => {
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('Email sending service', () => {
    it('creates outbound email with pending status', async () => {
      const { enqueueEmailMessage } = await import('../../src/api/postmark/email-outbound.js');

      // Create prerequisite contact/endpoint/thread
      const contact = await pool.query(`INSERT INTO contact (display_name) VALUES ('Test Recipient') RETURNING id`);
      const endpoint = await pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value)
         VALUES ($1, 'email', 'test@example.com') RETURNING id`,
        [contact.rows[0].id],
      );
      const thread = await pool.query(
        `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
         VALUES ($1, 'email', 'email:test-thread-1') RETURNING id`,
        [endpoint.rows[0].id],
      );

      const result = await enqueueEmailMessage(pool, {
        to: 'test@example.com',
        subject: 'Test Subject',
        body: 'Hello from openclaw!',
        threadId: thread.rows[0].id,
      });

      expect(result.messageId).toBeDefined();
      expect(result.threadId).toBe(thread.rows[0].id);
      expect(result.status).toBe('queued');
      expect(result.idempotencyKey).toBeDefined();

      // Verify message was created in DB with pending status
      const msg = await pool.query(
        `SELECT direction::text as direction, delivery_status::text as status,
                body, subject
         FROM external_message WHERE id = $1`,
        [result.messageId],
      );
      expect(msg.rows[0].direction).toBe('outbound');
      expect(msg.rows[0].status).toBe('pending');
      expect(msg.rows[0].body).toBe('Hello from openclaw!');
      expect(msg.rows[0].subject).toBe('Test Subject');
    });

    it('creates new thread if threadId not provided', async () => {
      const { enqueueEmailMessage } = await import('../../src/api/postmark/email-outbound.js');

      // Create contact and endpoint but no thread
      const contact = await pool.query(`INSERT INTO contact (display_name) VALUES ('New Contact') RETURNING id`);
      await pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value)
         VALUES ($1, 'email', 'new@example.com') RETURNING id`,
        [contact.rows[0].id],
      );

      const result = await enqueueEmailMessage(pool, {
        to: 'new@example.com',
        subject: 'New Conversation',
        body: 'Starting a new thread!',
      });

      expect(result.messageId).toBeDefined();
      expect(result.threadId).toBeDefined();
      expect(result.status).toBe('queued');

      // Verify thread was created
      const thread = await pool.query(`SELECT id FROM external_thread WHERE id = $1`, [result.threadId]);
      expect(thread.rows.length).toBe(1);
    });

    it('creates contact if email not found', async () => {
      const { enqueueEmailMessage } = await import('../../src/api/postmark/email-outbound.js');

      const result = await enqueueEmailMessage(pool, {
        to: 'unknown@example.com',
        subject: 'Hello!',
        body: 'Nice to meet you!',
      });

      expect(result.messageId).toBeDefined();
      expect(result.threadId).toBeDefined();

      // Verify contact was created
      const contact = await pool.query(
        `SELECT c.display_name
         FROM contact c
         JOIN contact_endpoint ce ON ce.contact_id = c.id
         WHERE ce.endpoint_value = 'unknown@example.com'`,
      );
      expect(contact.rows.length).toBe(1);
    });

    it('enqueues internal job with idempotency key', async () => {
      const { enqueueEmailMessage } = await import('../../src/api/postmark/email-outbound.js');

      const result = await enqueueEmailMessage(pool, {
        to: 'job@example.com',
        subject: 'Job Test',
        body: 'Test message',
      });

      // Verify job was created
      const job = await pool.query(
        `SELECT kind, payload, idempotency_key
         FROM internal_job
         WHERE kind = 'message.send.email'`,
      );
      expect(job.rows.length).toBe(1);
      expect(job.rows[0].payload.message_id).toBe(result.messageId);
      expect(job.rows[0].idempotency_key).toBe(result.idempotencyKey);
    });

    it('is idempotent when using same idempotency key', async () => {
      const { enqueueEmailMessage } = await import('../../src/api/postmark/email-outbound.js');

      const idempotencyKey = 'test-idempotency-email-123';

      const result1 = await enqueueEmailMessage(pool, {
        to: 'idempotent@example.com',
        subject: 'Same Email',
        body: 'First send',
        idempotencyKey,
      });

      const result2 = await enqueueEmailMessage(pool, {
        to: 'idempotent@example.com',
        subject: 'Same Email',
        body: 'First send',
        idempotencyKey,
      });

      // Should return same message ID
      expect(result1.messageId).toBe(result2.messageId);
      expect(result1.idempotencyKey).toBe(result2.idempotencyKey);

      // Should only have one message and one job
      const messages = await pool.query(`SELECT COUNT(*) as count FROM external_message WHERE subject = 'Same Email'`);
      expect(messages.rows[0].count).toBe('1');

      const jobs = await pool.query(`SELECT COUNT(*) as count FROM internal_job WHERE kind = 'message.send.email'`);
      expect(jobs.rows[0].count).toBe('1');
    });

    it('validates email address format', async () => {
      const { enqueueEmailMessage } = await import('../../src/api/postmark/email-outbound.js');

      // Invalid email should throw
      await expect(
        enqueueEmailMessage(pool, {
          to: 'not-an-email',
          subject: 'Test',
          body: 'Test',
        }),
      ).rejects.toThrow(/invalid.*email/i);
    });

    it('validates subject is not empty', async () => {
      const { enqueueEmailMessage } = await import('../../src/api/postmark/email-outbound.js');

      await expect(
        enqueueEmailMessage(pool, {
          to: 'test@example.com',
          subject: '',
          body: 'Test',
        }),
      ).rejects.toThrow(/subject.*required|empty/i);
    });

    it('validates body is not empty', async () => {
      const { enqueueEmailMessage } = await import('../../src/api/postmark/email-outbound.js');

      await expect(
        enqueueEmailMessage(pool, {
          to: 'test@example.com',
          subject: 'Test',
          body: '',
        }),
      ).rejects.toThrow(/body.*required|empty/i);
    });

    it('supports HTML body', async () => {
      const { enqueueEmailMessage } = await import('../../src/api/postmark/email-outbound.js');

      const result = await enqueueEmailMessage(pool, {
        to: 'html@example.com',
        subject: 'HTML Email',
        body: 'Plain text version',
        htmlBody: '<h1>Hello</h1><p>HTML version</p>',
      });

      expect(result.messageId).toBeDefined();

      // Verify HTML body stored in raw
      const msg = await pool.query(`SELECT raw FROM external_message WHERE id = $1`, [result.messageId]);
      expect(msg.rows[0].raw.htmlBody).toBe('<h1>Hello</h1><p>HTML version</p>');
    });

    it('supports reply threading with replyToMessageId', async () => {
      const { enqueueEmailMessage } = await import('../../src/api/postmark/email-outbound.js');

      // Original message ID for threading
      const originalMessageId = '<original-123@example.com>';

      const result = await enqueueEmailMessage(pool, {
        to: 'reply@example.com',
        subject: 'Re: Original Subject',
        body: 'This is a reply',
        replyToMessageId: originalMessageId,
      });

      expect(result.messageId).toBeDefined();

      // Verify threading info stored in raw
      const msg = await pool.query(`SELECT raw FROM external_message WHERE id = $1`, [result.messageId]);
      expect(msg.rows[0].raw.replyToMessageId).toBe(originalMessageId);
    });
  });

  describe('Postmark configuration', () => {
    it('exports configuration validation function', async () => {
      const { isPostmarkConfigured, getPostmarkConfig } = await import('../../src/api/postmark/config.js');

      expect(typeof isPostmarkConfigured).toBe('function');
      expect(typeof getPostmarkConfig).toBe('function');
    });
  });
});
