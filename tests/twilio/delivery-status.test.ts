import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from '../helpers/migrate.ts';
import { createTestPool, truncateAllTables } from '../helpers/db.ts';

describe('Twilio delivery status webhooks (#292)', () => {
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

  describe('Delivery status service', () => {
    let testMessageId: string;
    let twilioSid: string;

    beforeEach(async () => {
      // Create test message with provider_message_id
      const contact = await pool.query(`INSERT INTO contact (display_name) VALUES ('Status Test') RETURNING id`);
      const endpoint = await pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value)
         VALUES ($1, 'phone', '+15551234567') RETURNING id`,
        [contact.rows[0].id],
      );
      const thread = await pool.query(
        `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
         VALUES ($1, 'phone', 'sms:test:thread') RETURNING id`,
        [endpoint.rows[0].id],
      );

      twilioSid = 'SM' + 'a'.repeat(32);

      const msg = await pool.query(
        `INSERT INTO external_message (
           thread_id, external_message_key, direction, body,
           delivery_status, provider_message_id
         )
         VALUES ($1, 'outbound:test', 'outbound', 'Test message', 'sent', $2)
         RETURNING id::text as id`,
        [thread.rows[0].id, twilioSid],
      );
      testMessageId = msg.rows[0].id;
    });

    it('updates message status from Twilio callback', async () => {
      const { processDeliveryStatus } = await import('../../src/api/twilio/delivery-status.js');

      const result = await processDeliveryStatus(pool, {
        MessageSid: twilioSid,
        MessageStatus: 'delivered',
        AccountSid: 'AC123',
        To: '+15551234567',
        From: '+15559876543',
        ApiVersion: '2010-04-01',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe(testMessageId);

      // Verify status updated
      const msg = await pool.query(
        `SELECT delivery_status::text as status, provider_status_raw
         FROM external_message WHERE id = $1`,
        [testMessageId],
      );
      expect(msg.rows[0].status).toBe('delivered');
      expect(msg.rows[0].provider_status_raw.MessageStatus).toBe('delivered');
    });

    it('maps Twilio statuses to our status enum', async () => {
      const { processDeliveryStatus } = await import('../../src/api/twilio/delivery-status.js');

      // Test 'sent' status
      const msg1 = await createTestMessage(pool, 'SM' + 'b'.repeat(32), 'queued');
      await processDeliveryStatus(pool, {
        MessageSid: 'SM' + 'b'.repeat(32),
        MessageStatus: 'sent',
        AccountSid: 'AC123',
        To: '+15551111111',
        From: '+15552222222',
      });

      let status = await pool.query(`SELECT delivery_status::text as status FROM external_message WHERE id = $1`, [msg1]);
      expect(status.rows[0].status).toBe('sent');

      // Test 'failed' status
      const msg2 = await createTestMessage(pool, 'SM' + 'c'.repeat(32), 'sending');
      await processDeliveryStatus(pool, {
        MessageSid: 'SM' + 'c'.repeat(32),
        MessageStatus: 'failed',
        ErrorCode: '30003',
        AccountSid: 'AC123',
        To: '+15553333333',
        From: '+15554444444',
      });

      status = await pool.query(
        `SELECT delivery_status::text as status, provider_status_raw
         FROM external_message WHERE id = $1`,
        [msg2],
      );
      expect(status.rows[0].status).toBe('failed');
      expect(status.rows[0].provider_status_raw.ErrorCode).toBe('30003');

      // Test 'undelivered' status
      const msg3 = await createTestMessage(pool, 'SM' + 'd'.repeat(32), 'sent');
      await processDeliveryStatus(pool, {
        MessageSid: 'SM' + 'd'.repeat(32),
        MessageStatus: 'undelivered',
        ErrorCode: '30005',
        AccountSid: 'AC123',
        To: '+15555555555',
        From: '+15556666666',
      });

      status = await pool.query(`SELECT delivery_status::text as status FROM external_message WHERE id = $1`, [msg3]);
      expect(status.rows[0].status).toBe('undelivered');
    });

    it('returns not found for unknown MessageSid', async () => {
      const { processDeliveryStatus } = await import('../../src/api/twilio/delivery-status.js');

      const result = await processDeliveryStatus(pool, {
        MessageSid: 'SM' + 'x'.repeat(32),
        MessageStatus: 'delivered',
        AccountSid: 'AC123',
        To: '+15551234567',
        From: '+15559876543',
      });

      expect(result.success).toBe(false);
      expect(result.notFound).toBe(true);
    });

    it('stores full callback payload in provider_status_raw', async () => {
      const { processDeliveryStatus } = await import('../../src/api/twilio/delivery-status.js');

      const payload = {
        MessageSid: twilioSid,
        MessageStatus: 'delivered',
        AccountSid: 'AC123',
        To: '+15551234567',
        From: '+15559876543',
        ApiVersion: '2010-04-01',
        SmsStatus: 'delivered',
        SmsSid: twilioSid,
      };

      await processDeliveryStatus(pool, payload);

      const msg = await pool.query(`SELECT provider_status_raw FROM external_message WHERE id = $1`, [testMessageId]);

      expect(msg.rows[0].provider_status_raw).toMatchObject({
        MessageSid: twilioSid,
        MessageStatus: 'delivered',
        AccountSid: 'AC123',
        To: '+15551234567',
        From: '+15559876543',
      });
    });

    it('respects status transition rules (cannot go backwards)', async () => {
      const { processDeliveryStatus } = await import('../../src/api/twilio/delivery-status.js');

      // First, set to delivered
      await processDeliveryStatus(pool, {
        MessageSid: twilioSid,
        MessageStatus: 'delivered',
        AccountSid: 'AC123',
        To: '+15551234567',
        From: '+15559876543',
      });

      // Try to go back to 'sent' - should be ignored (no error, just no update)
      const result = await processDeliveryStatus(pool, {
        MessageSid: twilioSid,
        MessageStatus: 'sent',
        AccountSid: 'AC123',
        To: '+15551234567',
        From: '+15559876543',
      });

      // Should succeed (webhook processed) but status unchanged
      expect(result.success).toBe(true);
      expect(result.statusUnchanged).toBe(true);

      // Verify status still delivered
      const msg = await pool.query(`SELECT delivery_status::text as status FROM external_message WHERE id = $1`, [testMessageId]);
      expect(msg.rows[0].status).toBe('delivered');
    });

    it('handles duplicate callbacks idempotently', async () => {
      const { processDeliveryStatus } = await import('../../src/api/twilio/delivery-status.js');

      const payload = {
        MessageSid: twilioSid,
        MessageStatus: 'delivered',
        AccountSid: 'AC123',
        To: '+15551234567',
        From: '+15559876543',
      };

      // Process same callback twice
      const result1 = await processDeliveryStatus(pool, payload);
      const result2 = await processDeliveryStatus(pool, payload);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result2.statusUnchanged).toBe(true);
    });
  });

  describe('Delivery status types', () => {
    it('exports TwilioStatusCallback type', async () => {
      const types = await import('../../src/api/twilio/delivery-status.js');
      expect(types).toHaveProperty('processDeliveryStatus');
    });
  });
});

// Helper to create test messages
async function createTestMessage(pool: Pool, twilioSid: string, status: string): Promise<string> {
  const contact = await pool.query(`INSERT INTO contact (display_name) VALUES ('Test') RETURNING id`);
  const endpoint = await pool.query(
    `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value)
     VALUES ($1, 'phone', '+1555' || floor(random() * 9000000 + 1000000)::text) RETURNING id`,
    [contact.rows[0].id],
  );
  const thread = await pool.query(
    `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
     VALUES ($1, 'phone', 'sms:test:' || $2) RETURNING id`,
    [endpoint.rows[0].id, twilioSid],
  );
  const msg = await pool.query(
    `INSERT INTO external_message (
       thread_id, external_message_key, direction, body,
       delivery_status, provider_message_id
     )
     VALUES ($1, 'outbound:' || $2, 'outbound', 'Test', $3::message_delivery_status, $2)
     RETURNING id::text as id`,
    [thread.rows[0].id, twilioSid, status],
  );
  return msg.rows[0].id;
}
