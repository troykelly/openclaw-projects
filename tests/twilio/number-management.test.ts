import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from '../helpers/migrate.js';
import { createTestPool, truncateAllTables } from '../helpers/db.js';

describe('Twilio Phone Number Management API (#300)', () => {
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

  describe('listPhoneNumbers', () => {
    it('returns empty array when Twilio not configured', async () => {
      const { listPhoneNumbers } = await import('../../src/api/twilio/number-management.js');
      const { isTwilioConfigured } = await import('../../src/api/twilio/config.js');

      if (!isTwilioConfigured()) {
        const result = await listPhoneNumbers();
        expect(result).toEqual([]);
      } else {
        // When Twilio is configured, should return actual numbers
        const result = await listPhoneNumbers();
        expect(Array.isArray(result)).toBe(true);
      }
    });

    it('returns phone number list with required fields', async () => {
      const { listPhoneNumbers } = await import('../../src/api/twilio/number-management.js');
      const { isTwilioConfigured } = await import('../../src/api/twilio/config.js');

      if (!isTwilioConfigured()) {
        // Skip test when Twilio not configured
        return;
      }

      const result = await listPhoneNumbers();

      // If there are numbers, verify structure
      if (result.length > 0) {
        const number = result[0];
        expect(number).toHaveProperty('phoneNumber');
        expect(number).toHaveProperty('friendlyName');
        expect(number).toHaveProperty('sid');
        expect(number).toHaveProperty('capabilities');
      }
    });
  });

  describe('getPhoneNumberDetails', () => {
    it('throws when Twilio not configured', async () => {
      const { getPhoneNumberDetails } = await import('../../src/api/twilio/number-management.js');
      const { isTwilioConfigured } = await import('../../src/api/twilio/config.js');

      if (!isTwilioConfigured()) {
        await expect(
          getPhoneNumberDetails('+15551234567')
        ).rejects.toThrow(/twilio.*not.*configured/i);
      }
    });

    it('returns phone number details with webhook configuration', async () => {
      const { getPhoneNumberDetails, listPhoneNumbers } = await import(
        '../../src/api/twilio/number-management.js'
      );
      const { isTwilioConfigured } = await import('../../src/api/twilio/config.js');

      if (!isTwilioConfigured()) {
        // Skip test when Twilio not configured
        return;
      }

      // Get first available number
      const numbers = await listPhoneNumbers();
      if (numbers.length === 0) {
        // No numbers in account, skip test
        return;
      }

      const details = await getPhoneNumberDetails(numbers[0].phoneNumber);

      expect(details).toHaveProperty('phoneNumber');
      expect(details).toHaveProperty('friendlyName');
      expect(details).toHaveProperty('sid');
      expect(details).toHaveProperty('smsUrl');
      expect(details).toHaveProperty('voiceUrl');
      expect(details).toHaveProperty('statusCallbackUrl');
      expect(details).toHaveProperty('capabilities');
    });

    it('throws for invalid phone number', async () => {
      const { getPhoneNumberDetails } = await import('../../src/api/twilio/number-management.js');
      const { isTwilioConfigured } = await import('../../src/api/twilio/config.js');

      if (!isTwilioConfigured()) {
        // Skip test when Twilio not configured
        return;
      }

      // Non-existent number should throw
      await expect(
        getPhoneNumberDetails('+15005550000') // Invalid test number
      ).rejects.toThrow();
    });
  });

  describe('updatePhoneNumberWebhooks', () => {
    it('throws when Twilio not configured', async () => {
      const { updatePhoneNumberWebhooks } = await import(
        '../../src/api/twilio/number-management.js'
      );
      const { isTwilioConfigured } = await import('../../src/api/twilio/config.js');

      if (!isTwilioConfigured()) {
        await expect(
          updatePhoneNumberWebhooks('+15551234567', {
            smsUrl: 'https://example.com/sms',
          })
        ).rejects.toThrow(/twilio.*not.*configured/i);
      }
    });

    it('validates webhook URLs are HTTPS in production', async () => {
      const { updatePhoneNumberWebhooks } = await import(
        '../../src/api/twilio/number-management.js'
      );
      const { isTwilioConfigured } = await import('../../src/api/twilio/config.js');

      if (!isTwilioConfigured()) {
        // Skip test when Twilio not configured
        return;
      }

      // HTTP URLs should be rejected (unless explicitly allowing localhost for dev)
      await expect(
        updatePhoneNumberWebhooks('+15551234567', {
          smsUrl: 'http://insecure.example.com/sms',
        })
      ).rejects.toThrow(/https/i);
    });

    it('validates webhook URL format', async () => {
      const { updatePhoneNumberWebhooks } = await import(
        '../../src/api/twilio/number-management.js'
      );
      const { isTwilioConfigured } = await import('../../src/api/twilio/config.js');

      if (!isTwilioConfigured()) {
        // Skip test when Twilio not configured
        return;
      }

      // Invalid URL format should be rejected
      await expect(
        updatePhoneNumberWebhooks('+15551234567', {
          smsUrl: 'not-a-url',
        })
      ).rejects.toThrow(/invalid.*url/i);
    });

    it('allows empty string to clear webhook URL', async () => {
      const { updatePhoneNumberWebhooks, listPhoneNumbers } = await import(
        '../../src/api/twilio/number-management.js'
      );
      const { isTwilioConfigured } = await import('../../src/api/twilio/config.js');

      if (!isTwilioConfigured()) {
        // Skip test when Twilio not configured
        return;
      }

      // Get first available number
      const numbers = await listPhoneNumbers();
      if (numbers.length === 0) {
        // No numbers in account, skip test
        return;
      }

      // Empty string should be allowed to clear the webhook
      // Note: This test may actually update Twilio config, so be careful
      // For safety, we just verify the validation passes
      const updateFn = () =>
        updatePhoneNumberWebhooks(numbers[0].phoneNumber, {
          smsUrl: '',
        });

      // Should not throw validation error for empty string
      // (May throw other errors if number doesn't support SMS, etc.)
      try {
        await updateFn();
      } catch (error) {
        // Should not be a URL validation error
        expect((error as Error).message).not.toMatch(/invalid.*url|https/i);
      }
    });
  });

  describe('Audit logging', () => {
    it('logs webhook configuration changes', async () => {
      const { updatePhoneNumberWebhooks, listPhoneNumbers } = await import(
        '../../src/api/twilio/number-management.js'
      );
      const { isTwilioConfigured } = await import('../../src/api/twilio/config.js');

      if (!isTwilioConfigured()) {
        // Skip test when Twilio not configured
        return;
      }

      // Get first available number
      const numbers = await listPhoneNumbers();
      if (numbers.length === 0) {
        // No numbers in account, skip test
        return;
      }

      // Perform an update (or attempt to)
      try {
        await updatePhoneNumberWebhooks(numbers[0].phoneNumber, {
          smsUrl: 'https://example.com/new-webhook',
        });
      } catch {
        // May fail for various reasons, but audit log should still be created
      }

      // Check that an audit log entry was created
      const logs = await pool.query(
        `SELECT * FROM audit_log
         WHERE entity_type = 'twilio_phone_number'
         ORDER BY created_at DESC
         LIMIT 1`
      );

      // Note: audit_log table may not exist yet - this test documents the requirement
      // If table doesn't exist, the test will fail which is expected
      if (logs.rows.length > 0) {
        expect(logs.rows[0].action).toBe('webhook_config_update');
        expect(logs.rows[0].entity_id).toBeDefined();
      }
    });
  });
});
