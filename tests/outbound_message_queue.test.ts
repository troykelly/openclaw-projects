import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';

describe('Outbound message queue infrastructure (#290)', () => {
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

  describe('Schema changes to external_message', () => {
    it('has delivery_status column with correct enum values', async () => {
      // Verify the enum exists
      const enumValues = await pool.query(
        `SELECT unnest(enum_range(NULL::message_delivery_status))::text as value`
      );

      expect(enumValues.rows.map((r) => r.value)).toEqual([
        'pending',
        'queued',
        'sending',
        'sent',
        'delivered',
        'failed',
        'bounced',
        'undelivered',
      ]);
    });

    it('has delivery_status column defaulting to pending for outbound messages', async () => {
      // Create prerequisite data
      const contact = await pool.query(
        `INSERT INTO contact (display_name) VALUES ('Test Contact') RETURNING id`
      );
      const endpoint = await pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value)
         VALUES ($1, 'phone', '+15551234567') RETURNING id`,
        [contact.rows[0].id]
      );
      const thread = await pool.query(
        `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
         VALUES ($1, 'phone', 'test-thread-1') RETURNING id`,
        [endpoint.rows[0].id]
      );

      // Insert outbound message without specifying delivery_status
      const msg = await pool.query(
        `INSERT INTO external_message (thread_id, external_message_key, direction, body)
         VALUES ($1, 'msg-1', 'outbound', 'Hello!')
         RETURNING delivery_status::text as delivery_status`,
        [thread.rows[0].id]
      );

      expect(msg.rows[0].delivery_status).toBe('pending');
    });

    it('has provider_message_id column', async () => {
      const column = await pool.query(
        `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_name = 'external_message' AND column_name = 'provider_message_id'`
      );

      expect(column.rows.length).toBe(1);
      expect(column.rows[0].data_type).toBe('text');
      expect(column.rows[0].is_nullable).toBe('YES');
    });

    it('has provider_status_raw JSONB column', async () => {
      const column = await pool.query(
        `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_name = 'external_message' AND column_name = 'provider_status_raw'`
      );

      expect(column.rows.length).toBe(1);
      expect(column.rows[0].data_type).toBe('jsonb');
    });

    it('has status_updated_at timestamp column', async () => {
      const column = await pool.query(
        `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_name = 'external_message' AND column_name = 'status_updated_at'`
      );

      expect(column.rows.length).toBe(1);
      expect(column.rows[0].data_type).toBe('timestamp with time zone');
    });

    it('has index on delivery_status for monitoring', async () => {
      const index = await pool.query(
        `SELECT indexname FROM pg_indexes
         WHERE tablename = 'external_message'
         AND indexname LIKE '%delivery_status%'`
      );

      expect(index.rows.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Status transition validation', () => {
    let threadId: string;

    beforeEach(async () => {
      // Create prerequisite data for status tests
      const contact = await pool.query(
        `INSERT INTO contact (display_name) VALUES ('Status Test') RETURNING id`
      );
      const endpoint = await pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value)
         VALUES ($1, 'phone', '+15559999999') RETURNING id`,
        [contact.rows[0].id]
      );
      const thread = await pool.query(
        `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
         VALUES ($1, 'phone', 'status-test-thread') RETURNING id`,
        [endpoint.rows[0].id]
      );
      threadId = thread.rows[0].id;
    });

    it('allows valid forward transitions (pending -> queued -> sending -> sent -> delivered)', async () => {
      const msg = await pool.query(
        `INSERT INTO external_message (thread_id, external_message_key, direction, body, delivery_status)
         VALUES ($1, 'status-msg-1', 'outbound', 'Test', 'pending')
         RETURNING id`,
        [threadId]
      );
      const msgId = msg.rows[0].id;

      // pending -> queued
      await pool.query(`UPDATE external_message SET delivery_status = 'queued' WHERE id = $1`, [msgId]);

      // queued -> sending
      await pool.query(`UPDATE external_message SET delivery_status = 'sending' WHERE id = $1`, [msgId]);

      // sending -> sent
      await pool.query(`UPDATE external_message SET delivery_status = 'sent' WHERE id = $1`, [msgId]);

      // sent -> delivered
      await pool.query(`UPDATE external_message SET delivery_status = 'delivered' WHERE id = $1`, [msgId]);

      const final = await pool.query(
        `SELECT delivery_status::text as status FROM external_message WHERE id = $1`,
        [msgId]
      );
      expect(final.rows[0].status).toBe('delivered');
    });

    it('allows transition to failed from any non-terminal state', async () => {
      const msg = await pool.query(
        `INSERT INTO external_message (thread_id, external_message_key, direction, body, delivery_status)
         VALUES ($1, 'status-msg-2', 'outbound', 'Test', 'sending')
         RETURNING id`,
        [threadId]
      );
      const msgId = msg.rows[0].id;

      // sending -> failed is allowed
      await pool.query(`UPDATE external_message SET delivery_status = 'failed' WHERE id = $1`, [msgId]);

      const result = await pool.query(
        `SELECT delivery_status::text as status FROM external_message WHERE id = $1`,
        [msgId]
      );
      expect(result.rows[0].status).toBe('failed');
    });

    it('prevents backward transitions (delivered -> sending should fail)', async () => {
      const msg = await pool.query(
        `INSERT INTO external_message (thread_id, external_message_key, direction, body, delivery_status)
         VALUES ($1, 'status-msg-3', 'outbound', 'Test', 'delivered')
         RETURNING id`,
        [threadId]
      );
      const msgId = msg.rows[0].id;

      // delivered -> sending should fail
      await expect(
        pool.query(`UPDATE external_message SET delivery_status = 'sending' WHERE id = $1`, [msgId])
      ).rejects.toThrow(/invalid.*status.*transition|cannot.*transition/i);
    });

    it('prevents transitions from terminal states (failed -> queued should fail)', async () => {
      const msg = await pool.query(
        `INSERT INTO external_message (thread_id, external_message_key, direction, body, delivery_status)
         VALUES ($1, 'status-msg-4', 'outbound', 'Test', 'failed')
         RETURNING id`,
        [threadId]
      );
      const msgId = msg.rows[0].id;

      // failed -> queued should fail
      await expect(
        pool.query(`UPDATE external_message SET delivery_status = 'queued' WHERE id = $1`, [msgId])
      ).rejects.toThrow(/invalid.*status.*transition|cannot.*transition/i);
    });

    it('updates status_updated_at when delivery_status changes', async () => {
      const msg = await pool.query(
        `INSERT INTO external_message (thread_id, external_message_key, direction, body, delivery_status)
         VALUES ($1, 'status-msg-5', 'outbound', 'Test', 'pending')
         RETURNING id, status_updated_at`,
        [threadId]
      );
      const msgId = msg.rows[0].id;
      const initialTimestamp = msg.rows[0].status_updated_at;

      // Small delay to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      await pool.query(`UPDATE external_message SET delivery_status = 'queued' WHERE id = $1`, [msgId]);

      const updated = await pool.query(`SELECT status_updated_at FROM external_message WHERE id = $1`, [
        msgId,
      ]);
      expect(updated.rows[0].status_updated_at).not.toEqual(initialTimestamp);
    });
  });

  describe('Message sending job types', () => {
    it('can enqueue message.send.sms job with idempotency', async () => {
      const messageId = '550e8400-e29b-41d4-a716-446655440000';
      const idempotencyKey = `sms:${messageId}`;

      // Enqueue twice - second should be no-op
      const first = await pool.query(
        `SELECT internal_job_enqueue($1, now(), $2, $3) as id`,
        ['message.send.sms', JSON.stringify({ message_id: messageId, to: '+15551234567' }), idempotencyKey]
      );

      const second = await pool.query(
        `SELECT internal_job_enqueue($1, now(), $2, $3) as id`,
        ['message.send.sms', JSON.stringify({ message_id: messageId, to: '+15551234567' }), idempotencyKey]
      );

      expect(first.rows[0].id).not.toBeNull();
      expect(second.rows[0].id).toBeNull(); // Idempotent - returns null on duplicate

      // Verify only one job exists
      const jobs = await pool.query(
        `SELECT COUNT(*) as count FROM internal_job WHERE kind = 'message.send.sms'`
      );
      expect(jobs.rows[0].count).toBe('1');
    });

    it('can enqueue message.send.email job with idempotency', async () => {
      const messageId = '550e8400-e29b-41d4-a716-446655440001';
      const idempotencyKey = `email:${messageId}`;

      // Enqueue twice - second should be no-op
      const first = await pool.query(
        `SELECT internal_job_enqueue($1, now(), $2, $3) as id`,
        [
          'message.send.email',
          JSON.stringify({ message_id: messageId, to: 'test@example.com' }),
          idempotencyKey,
        ]
      );

      const second = await pool.query(
        `SELECT internal_job_enqueue($1, now(), $2, $3) as id`,
        [
          'message.send.email',
          JSON.stringify({ message_id: messageId, to: 'test@example.com' }),
          idempotencyKey,
        ]
      );

      expect(first.rows[0].id).not.toBeNull();
      expect(second.rows[0].id).toBeNull(); // Idempotent - returns null on duplicate

      // Verify only one job exists
      const jobs = await pool.query(
        `SELECT COUNT(*) as count FROM internal_job WHERE kind = 'message.send.email'`
      );
      expect(jobs.rows[0].count).toBe('1');
    });

    it('allows different message IDs even for same job kind', async () => {
      const msg1 = '550e8400-e29b-41d4-a716-446655440002';
      const msg2 = '550e8400-e29b-41d4-a716-446655440003';

      await pool.query(`SELECT internal_job_enqueue($1, now(), $2, $3)`, [
        'message.send.sms',
        JSON.stringify({ message_id: msg1 }),
        `sms:${msg1}`,
      ]);

      await pool.query(`SELECT internal_job_enqueue($1, now(), $2, $3)`, [
        'message.send.sms',
        JSON.stringify({ message_id: msg2 }),
        `sms:${msg2}`,
      ]);

      const jobs = await pool.query(
        `SELECT COUNT(*) as count FROM internal_job WHERE kind = 'message.send.sms'`
      );
      expect(jobs.rows[0].count).toBe('2');
    });

    it('message jobs can be claimed and completed', async () => {
      const messageId = '550e8400-e29b-41d4-a716-446655440004';

      await pool.query(`SELECT internal_job_enqueue($1, now(), $2, $3)`, [
        'message.send.sms',
        JSON.stringify({ message_id: messageId, to: '+15557654321' }),
        `sms:${messageId}`,
      ]);

      // Claim the job
      const claimed = await pool.query(`SELECT * FROM internal_job_claim('test-worker', 1)`);
      expect(claimed.rows.length).toBe(1);
      expect(claimed.rows[0].kind).toBe('message.send.sms');

      const payload = claimed.rows[0].payload;
      expect(payload.message_id).toBe(messageId);
      expect(payload.to).toBe('+15557654321');

      // Complete the job
      await pool.query(`SELECT internal_job_complete($1)`, [claimed.rows[0].id]);

      // Verify completed
      const completed = await pool.query(
        `SELECT completed_at FROM internal_job WHERE id = $1`,
        [claimed.rows[0].id]
      );
      expect(completed.rows[0].completed_at).not.toBeNull();
    });
  });

  describe('Provider message ID handling', () => {
    let threadId: string;

    beforeEach(async () => {
      const contact = await pool.query(
        `INSERT INTO contact (display_name) VALUES ('Provider Test') RETURNING id`
      );
      const endpoint = await pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value)
         VALUES ($1, 'phone', '+15558888888') RETURNING id`,
        [contact.rows[0].id]
      );
      const thread = await pool.query(
        `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
         VALUES ($1, 'phone', 'provider-test-thread') RETURNING id`,
        [endpoint.rows[0].id]
      );
      threadId = thread.rows[0].id;
    });

    it('can store Twilio MessageSid as provider_message_id', async () => {
      const twilioSid = 'SM1234567890abcdef1234567890abcdef';

      const msg = await pool.query(
        `INSERT INTO external_message (thread_id, external_message_key, direction, body, provider_message_id)
         VALUES ($1, 'twilio-msg', 'outbound', 'Hello', $2)
         RETURNING provider_message_id`,
        [threadId, twilioSid]
      );

      expect(msg.rows[0].provider_message_id).toBe(twilioSid);
    });

    it('can store Postmark MessageID as provider_message_id', async () => {
      const postmarkId = 'a8b9c0d1-e2f3-4a5b-6c7d-8e9f0a1b2c3d';

      const msg = await pool.query(
        `INSERT INTO external_message (thread_id, external_message_key, direction, body, provider_message_id)
         VALUES ($1, 'postmark-msg', 'outbound', 'Hello', $2)
         RETURNING provider_message_id`,
        [threadId, postmarkId]
      );

      expect(msg.rows[0].provider_message_id).toBe(postmarkId);
    });

    it('can store raw provider status payload', async () => {
      const rawStatus = {
        AccountSid: 'AC123',
        MessageSid: 'SM456',
        MessageStatus: 'delivered',
        To: '+15551234567',
        From: '+15559876543',
        Timestamp: '2024-01-15T12:00:00Z',
      };

      const msg = await pool.query(
        `INSERT INTO external_message (thread_id, external_message_key, direction, body, provider_status_raw)
         VALUES ($1, 'raw-status-msg', 'outbound', 'Hello', $2)
         RETURNING provider_status_raw`,
        [threadId, JSON.stringify(rawStatus)]
      );

      expect(msg.rows[0].provider_status_raw).toEqual(rawStatus);
    });
  });
});
