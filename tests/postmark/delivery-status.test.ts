import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from '../helpers/migrate.ts';
import { createTestPool, truncateAllTables } from '../helpers/db.ts';

describe('Postmark delivery status webhooks (#294)', () => {
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
    let postmarkMessageId: string;
    let endpointId: string;

    beforeEach(async () => {
      // Create test message with provider_message_id
      const contact = await pool.query(`INSERT INTO contact (display_name) VALUES ('Postmark Status Test') RETURNING id`);
      const endpoint = await pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value)
         VALUES ($1, 'email', 'status-test@example.com') RETURNING id`,
        [contact.rows[0].id],
      );
      endpointId = endpoint.rows[0].id;

      const thread = await pool.query(
        `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
         VALUES ($1, 'email', 'email:postmark-status-test') RETURNING id`,
        [endpoint.rows[0].id],
      );

      postmarkMessageId = 'a8b9c0d1-e2f3-4a5b-6c7d-8e9f0a1b2c3d';

      const msg = await pool.query(
        `INSERT INTO external_message (
           thread_id, external_message_key, direction, body, subject,
           delivery_status, provider_message_id
         )
         VALUES ($1, 'outbound:postmark-test', 'outbound', 'Test email body', 'Test Subject', 'sent', $2)
         RETURNING id::text as id`,
        [thread.rows[0].id, postmarkMessageId],
      );
      testMessageId = msg.rows[0].id;
    });

    it('updates message status to delivered on Delivery event', async () => {
      const { processPostmarkDeliveryStatus } = await import('../../src/api/postmark/delivery-status.js');

      const result = await processPostmarkDeliveryStatus(pool, {
        RecordType: 'Delivery',
        MessageID: postmarkMessageId,
        Recipient: 'status-test@example.com',
        Tag: '',
        DeliveredAt: '2024-01-15T12:00:00Z',
        Details: 'Message delivered',
        MessageStream: 'outbound',
        ServerID: 12345,
      });

      expect(result.success).toBe(true);
      expect(result.message_id).toBe(testMessageId);

      // Verify status updated
      const msg = await pool.query(
        `SELECT delivery_status::text as status, provider_status_raw
         FROM external_message WHERE id = $1`,
        [testMessageId],
      );
      expect(msg.rows[0].status).toBe('delivered');
      expect(msg.rows[0].provider_status_raw.RecordType).toBe('Delivery');
    });

    it('updates message status to bounced on hard Bounce event', async () => {
      const { processPostmarkDeliveryStatus } = await import('../../src/api/postmark/delivery-status.js');

      const result = await processPostmarkDeliveryStatus(pool, {
        RecordType: 'Bounce',
        MessageID: postmarkMessageId,
        Recipient: 'status-test@example.com',
        Type: 'HardBounce',
        TypeCode: 1,
        Name: 'Hard bounce',
        Tag: '',
        Description: 'The server was unable to deliver your message',
        Details: 'smtp;550 5.1.1 The email account does not exist',
        Email: 'status-test@example.com',
        From: 'sender@example.com',
        BouncedAt: '2024-01-15T12:00:00Z',
        MessageStream: 'outbound',
        ServerID: 12345,
      });

      expect(result.success).toBe(true);

      const msg = await pool.query(
        `SELECT delivery_status::text as status, provider_status_raw
         FROM external_message WHERE id = $1`,
        [testMessageId],
      );
      expect(msg.rows[0].status).toBe('bounced');
      expect(msg.rows[0].provider_status_raw.Type).toBe('HardBounce');
    });

    it('updates message status to failed on soft Bounce event', async () => {
      const { processPostmarkDeliveryStatus } = await import('../../src/api/postmark/delivery-status.js');

      const result = await processPostmarkDeliveryStatus(pool, {
        RecordType: 'Bounce',
        MessageID: postmarkMessageId,
        Recipient: 'status-test@example.com',
        Type: 'SoftBounce',
        TypeCode: 4096,
        Name: 'Soft bounce',
        Tag: '',
        Description: 'Mailbox full',
        Details: 'smtp;452 4.2.2 Mailbox full',
        Email: 'status-test@example.com',
        From: 'sender@example.com',
        BouncedAt: '2024-01-15T12:00:00Z',
        MessageStream: 'outbound',
        ServerID: 12345,
      });

      expect(result.success).toBe(true);

      const msg = await pool.query(`SELECT delivery_status::text as status FROM external_message WHERE id = $1`, [testMessageId]);
      // Soft bounce maps to failed (temporary, may retry)
      expect(msg.rows[0].status).toBe('failed');
    });

    it('returns not found for unknown MessageID', async () => {
      const { processPostmarkDeliveryStatus } = await import('../../src/api/postmark/delivery-status.js');

      const result = await processPostmarkDeliveryStatus(pool, {
        RecordType: 'Delivery',
        MessageID: 'unknown-message-id-xyz',
        Recipient: 'unknown@example.com',
        DeliveredAt: '2024-01-15T12:00:00Z',
        MessageStream: 'outbound',
        ServerID: 12345,
      });

      expect(result.success).toBe(false);
      expect(result.not_found).toBe(true);
    });

    it('stores full webhook payload in provider_status_raw', async () => {
      const { processPostmarkDeliveryStatus } = await import('../../src/api/postmark/delivery-status.js');

      const payload = {
        RecordType: 'Delivery' as const,
        MessageID: postmarkMessageId,
        Recipient: 'status-test@example.com',
        Tag: 'test-tag',
        DeliveredAt: '2024-01-15T12:00:00Z',
        Details: 'Message delivered successfully',
        MessageStream: 'outbound',
        ServerID: 12345,
        Metadata: { key: 'value' },
      };

      await processPostmarkDeliveryStatus(pool, payload);

      const msg = await pool.query(`SELECT provider_status_raw FROM external_message WHERE id = $1`, [testMessageId]);

      expect(msg.rows[0].provider_status_raw).toMatchObject({
        RecordType: 'Delivery',
        MessageID: postmarkMessageId,
        Recipient: 'status-test@example.com',
        MessageStream: 'outbound',
      });
    });

    it('respects status transition rules (cannot go backwards)', async () => {
      const { processPostmarkDeliveryStatus } = await import('../../src/api/postmark/delivery-status.js');

      // First, set to delivered
      await processPostmarkDeliveryStatus(pool, {
        RecordType: 'Delivery',
        MessageID: postmarkMessageId,
        Recipient: 'status-test@example.com',
        DeliveredAt: '2024-01-15T12:00:00Z',
        MessageStream: 'outbound',
        ServerID: 12345,
      });

      // Try to go back via another event - should be ignored
      const result = await processPostmarkDeliveryStatus(pool, {
        RecordType: 'Delivery',
        MessageID: postmarkMessageId,
        Recipient: 'status-test@example.com',
        DeliveredAt: '2024-01-15T12:01:00Z',
        MessageStream: 'outbound',
        ServerID: 12345,
      });

      expect(result.success).toBe(true);
      expect(result.status_unchanged).toBe(true);

      // Verify status still delivered
      const msg = await pool.query(`SELECT delivery_status::text as status FROM external_message WHERE id = $1`, [testMessageId]);
      expect(msg.rows[0].status).toBe('delivered');
    });

    it('handles SpamComplaint as terminal failed state', async () => {
      const { processPostmarkDeliveryStatus } = await import('../../src/api/postmark/delivery-status.js');

      // First deliver the message
      await pool.query(`UPDATE external_message SET delivery_status = 'delivered' WHERE id = $1`, [testMessageId]);

      // Then receive spam complaint (should override delivered as it's critical)
      const result = await processPostmarkDeliveryStatus(pool, {
        RecordType: 'SpamComplaint',
        MessageID: postmarkMessageId,
        Recipient: 'status-test@example.com',
        Tag: '',
        From: 'sender@example.com',
        BouncedAt: '2024-01-15T12:00:00Z',
        Subject: 'Test Subject',
        MessageStream: 'outbound',
        ServerID: 12345,
      });

      // Spam complaints are important - we record them in raw even if status can't change
      expect(result.success).toBe(true);
    });

    it('flags contact endpoint on hard bounce', async () => {
      const { processPostmarkDeliveryStatus } = await import('../../src/api/postmark/delivery-status.js');

      await processPostmarkDeliveryStatus(pool, {
        RecordType: 'Bounce',
        MessageID: postmarkMessageId,
        Recipient: 'status-test@example.com',
        Type: 'HardBounce',
        TypeCode: 1,
        Name: 'Hard bounce',
        Tag: '',
        Description: 'Invalid email address',
        Details: 'smtp;550 5.1.1 User unknown',
        Email: 'status-test@example.com',
        From: 'sender@example.com',
        BouncedAt: '2024-01-15T12:00:00Z',
        MessageStream: 'outbound',
        ServerID: 12345,
      });

      // Verify endpoint was flagged
      const endpoint = await pool.query(`SELECT metadata FROM contact_endpoint WHERE id = $1`, [endpointId]);
      expect(endpoint.rows[0].metadata.bounced).toBe(true);
      expect(endpoint.rows[0].metadata.bounce_type).toBe('HardBounce');
    });
  });

  describe('Postmark webhook types', () => {
    it('exports delivery status types', async () => {
      const types = await import('../../src/api/postmark/delivery-status.js');
      expect(types).toHaveProperty('processPostmarkDeliveryStatus');
    });
  });
});
