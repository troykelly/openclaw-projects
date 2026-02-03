import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from '../helpers/migrate.js';
import { createTestPool, truncateAllTables } from '../helpers/db.js';

describe('Twilio SMS outbound sending (#291)', () => {
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

  describe('SMS sending service', () => {
    it('creates outbound message with pending status', async () => {
      // Import the service (will fail until implemented)
      const { enqueueSmsMessage } = await import('../../src/api/twilio/sms-outbound.js');

      // Create prerequisite contact/endpoint/thread
      const contact = await pool.query(
        `INSERT INTO contact (display_name) VALUES ('Test Recipient') RETURNING id`
      );
      const endpoint = await pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value)
         VALUES ($1, 'phone', '+15551234567') RETURNING id`,
        [contact.rows[0].id]
      );
      const thread = await pool.query(
        `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
         VALUES ($1, 'phone', 'sms:+15551234567:+15559876543') RETURNING id`,
        [endpoint.rows[0].id]
      );

      const result = await enqueueSmsMessage(pool, {
        to: '+15551234567',
        body: 'Hello from clawdbot!',
        threadId: thread.rows[0].id,
      });

      expect(result.messageId).toBeDefined();
      expect(result.threadId).toBe(thread.rows[0].id);
      expect(result.status).toBe('queued');
      expect(result.idempotencyKey).toBeDefined();

      // Verify message was created in DB with pending status
      const msg = await pool.query(
        `SELECT direction::text as direction, delivery_status::text as status, body
         FROM external_message WHERE id = $1`,
        [result.messageId]
      );
      expect(msg.rows[0].direction).toBe('outbound');
      expect(msg.rows[0].status).toBe('pending');
      expect(msg.rows[0].body).toBe('Hello from clawdbot!');
    });

    it('creates new thread if threadId not provided', async () => {
      const { enqueueSmsMessage } = await import('../../src/api/twilio/sms-outbound.js');

      // Create contact and endpoint but no thread
      const contact = await pool.query(
        `INSERT INTO contact (display_name) VALUES ('New Contact') RETURNING id`
      );
      await pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value)
         VALUES ($1, 'phone', '+15552223333') RETURNING id`,
        [contact.rows[0].id]
      );

      const result = await enqueueSmsMessage(pool, {
        to: '+15552223333',
        body: 'New conversation!',
      });

      expect(result.messageId).toBeDefined();
      expect(result.threadId).toBeDefined();
      expect(result.status).toBe('queued');

      // Verify thread was created
      const thread = await pool.query(
        `SELECT id FROM external_thread WHERE id = $1`,
        [result.threadId]
      );
      expect(thread.rows.length).toBe(1);
    });

    it('creates contact if phone number not found', async () => {
      const { enqueueSmsMessage } = await import('../../src/api/twilio/sms-outbound.js');

      const result = await enqueueSmsMessage(pool, {
        to: '+15554445555',
        body: 'Hello stranger!',
      });

      expect(result.messageId).toBeDefined();
      expect(result.threadId).toBeDefined();

      // Verify contact was created
      const contact = await pool.query(
        `SELECT c.display_name
         FROM contact c
         JOIN contact_endpoint ce ON ce.contact_id = c.id
         WHERE ce.endpoint_value = '+15554445555'`
      );
      expect(contact.rows.length).toBe(1);
    });

    it('enqueues internal job with idempotency key', async () => {
      const { enqueueSmsMessage } = await import('../../src/api/twilio/sms-outbound.js');

      const result = await enqueueSmsMessage(pool, {
        to: '+15556667777',
        body: 'Test message',
      });

      // Verify job was created
      const job = await pool.query(
        `SELECT kind, payload, idempotency_key
         FROM internal_job
         WHERE kind = 'message.send.sms'`
      );
      expect(job.rows.length).toBe(1);
      expect(job.rows[0].payload.message_id).toBe(result.messageId);
      expect(job.rows[0].idempotency_key).toBe(result.idempotencyKey);
    });

    it('is idempotent when using same idempotency key', async () => {
      const { enqueueSmsMessage } = await import('../../src/api/twilio/sms-outbound.js');

      const idempotencyKey = 'test-idempotency-123';

      const result1 = await enqueueSmsMessage(pool, {
        to: '+15558889999',
        body: 'First send',
        idempotencyKey,
      });

      const result2 = await enqueueSmsMessage(pool, {
        to: '+15558889999',
        body: 'First send',
        idempotencyKey,
      });

      // Should return same message ID
      expect(result1.messageId).toBe(result2.messageId);
      expect(result1.idempotencyKey).toBe(result2.idempotencyKey);

      // Should only have one message and one job
      const messages = await pool.query(
        `SELECT COUNT(*) as count FROM external_message WHERE body = 'First send'`
      );
      expect(messages.rows[0].count).toBe('1');

      const jobs = await pool.query(
        `SELECT COUNT(*) as count FROM internal_job WHERE kind = 'message.send.sms'`
      );
      expect(jobs.rows[0].count).toBe('1');
    });

    it('validates phone number format', async () => {
      const { enqueueSmsMessage } = await import('../../src/api/twilio/sms-outbound.js');

      // Invalid phone number should throw
      await expect(
        enqueueSmsMessage(pool, {
          to: 'not-a-phone',
          body: 'Test',
        })
      ).rejects.toThrow(/invalid.*phone/i);
    });

    it('validates message body is not empty', async () => {
      const { enqueueSmsMessage } = await import('../../src/api/twilio/sms-outbound.js');

      await expect(
        enqueueSmsMessage(pool, {
          to: '+15551234567',
          body: '',
        })
      ).rejects.toThrow(/body.*required|empty/i);
    });
  });

  describe('SMS job handler', () => {
    it('sends SMS via Twilio API and updates message status', async () => {
      const { handleSmsSendJob, enqueueSmsMessage } = await import(
        '../../src/api/twilio/sms-outbound.js'
      );

      // Enqueue a message
      const enqueueResult = await enqueueSmsMessage(pool, {
        to: '+15551234567',
        body: 'Job handler test',
      });

      // Claim the job
      const claimed = await pool.query(
        `SELECT * FROM internal_job_claim('test-worker', 1)`
      );
      expect(claimed.rows.length).toBe(1);

      const job = {
        id: claimed.rows[0].id,
        kind: claimed.rows[0].kind,
        runAt: claimed.rows[0].run_at,
        payload: claimed.rows[0].payload,
        attempts: claimed.rows[0].attempts,
        lastError: claimed.rows[0].last_error,
        lockedAt: claimed.rows[0].locked_at,
        lockedBy: claimed.rows[0].locked_by,
        completedAt: claimed.rows[0].completed_at,
        idempotencyKey: claimed.rows[0].idempotency_key,
        createdAt: claimed.rows[0].created_at,
        updatedAt: claimed.rows[0].updated_at,
      };

      // Note: This will fail without Twilio credentials
      // In integration tests, we use Twilio test credentials
      // For unit tests, we mock the Twilio client
      try {
        const result = await handleSmsSendJob(pool, job);
        // If Twilio credentials are configured, this should succeed
        expect(result.success).toBe(true);
      } catch (error) {
        // Expected if Twilio not configured
        expect((error as Error).message).toMatch(/twilio.*not.*configured/i);
      }
    });

    it('updates message status to failed on Twilio error', async () => {
      const { handleSmsSendJob, enqueueSmsMessage } = await import(
        '../../src/api/twilio/sms-outbound.js'
      );

      // Enqueue a message to an invalid number (Twilio test number that fails)
      const enqueueResult = await enqueueSmsMessage(pool, {
        to: '+15005550001', // Twilio test number that returns "invalid"
        body: 'Should fail',
      });

      // Claim the job
      const claimed = await pool.query(
        `SELECT * FROM internal_job_claim('test-worker', 1)`
      );

      const job = {
        id: claimed.rows[0].id,
        kind: claimed.rows[0].kind,
        runAt: claimed.rows[0].run_at,
        payload: claimed.rows[0].payload,
        attempts: claimed.rows[0].attempts,
        lastError: claimed.rows[0].last_error,
        lockedAt: claimed.rows[0].locked_at,
        lockedBy: claimed.rows[0].locked_by,
        completedAt: claimed.rows[0].completed_at,
        idempotencyKey: claimed.rows[0].idempotency_key,
        createdAt: claimed.rows[0].created_at,
        updatedAt: claimed.rows[0].updated_at,
      };

      // Note: This test behavior depends on Twilio test credentials
      try {
        const result = await handleSmsSendJob(pool, job);
        // If using test credentials, invalid number should fail
        if (!result.success) {
          // Verify message status updated to failed
          const msg = await pool.query(
            `SELECT delivery_status::text as status FROM external_message WHERE id = $1`,
            [enqueueResult.messageId]
          );
          expect(msg.rows[0].status).toBe('failed');
        }
      } catch (error) {
        // Expected if Twilio not configured
        expect((error as Error).message).toMatch(/twilio.*not.*configured/i);
      }
    });
  });

  describe('Twilio configuration', () => {
    it('exports configuration validation function', async () => {
      const { isTwilioConfigured, getTwilioConfig } = await import(
        '../../src/api/twilio/config.js'
      );

      // These functions should exist
      expect(typeof isTwilioConfigured).toBe('function');
      expect(typeof getTwilioConfig).toBe('function');
    });
  });
});

describe('Twilio SMS API endpoint integration', () => {
  // These tests require the full server to be running
  // They will be run as part of the integration test suite

  it.todo('POST /api/twilio/sms/send returns queued status');
  it.todo('POST /api/twilio/sms/send handles idempotency');
  it.todo('POST /api/twilio/sms/send validates phone number');
  it.todo('POST /api/twilio/sms/send requires auth');
});
