import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildSmsReceivedPayload,
  buildEmailReceivedPayload,
  buildReminderDuePayload,
  buildDeadlineApproachingPayload,
  getWebhookDestination,
} from '../../src/api/webhooks/payloads.ts';
import { clearConfigCache } from '../../src/api/webhooks/config.ts';

describe('Webhook Payloads', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    clearConfigCache();
    process.env = { ...originalEnv };
    process.env.OPENCLAW_GATEWAY_URL = 'http://localhost:18789';
    process.env.OPENCLAW_HOOK_TOKEN = 'test-token';
  });

  afterEach(() => {
    process.env = originalEnv;
    clearConfigCache();
  });

  describe('buildSmsReceivedPayload', () => {
    it('builds correct payload structure', () => {
      const payload = buildSmsReceivedPayload({
        contactId: 'contact-123',
        contactName: 'John Doe',
        endpointType: 'phone',
        endpointValue: '+15551234567',
        threadId: 'thread-456',
        messageId: 'msg-789',
        messageBody: 'Hello, this is a test message.',
      });

      expect(payload.name).toBe('SMS Handler');
      expect(payload.wakeMode).toBe('now');
      expect(payload.deliver).toBe(true);
      expect(payload.channel).toBe('last');
      expect(payload.message).toContain('John Doe');
      expect(payload.message).toContain('Hello, this is a test message.');
      expect(payload.sessionKey).toBe('sms:contact:contact-123:thread:thread-456');
      expect(payload.context.event_type).toBe('sms_received');
      expect(payload.context.contact_id).toBe('contact-123');
      expect(payload.context.message_body).toBe('Hello, this is a test message.');
    });

    it('includes optional m365_contact_id', () => {
      const payload = buildSmsReceivedPayload({
        contactId: 'contact-123',
        contactName: 'John Doe',
        endpointType: 'phone',
        endpointValue: '+15551234567',
        m365ContactId: 'ms-contact-id',
        threadId: 'thread-456',
        messageId: 'msg-789',
        messageBody: 'Test',
      });

      expect(payload.context.m365_contact_id).toBe('ms-contact-id');
    });
  });

  describe('buildEmailReceivedPayload', () => {
    it('builds correct payload structure', () => {
      const payload = buildEmailReceivedPayload({
        contactId: 'contact-123',
        contactName: 'Jane Smith',
        fromEmail: 'jane@example.com',
        toEmail: 'me@example.com',
        subject: 'Meeting tomorrow',
        threadId: 'thread-456',
        messageId: 'msg-789',
        messageBody: 'Hi, can we meet tomorrow at 3pm?',
      });

      expect(payload.name).toBe('Email Handler');
      expect(payload.wakeMode).toBe('now');
      expect(payload.message).toContain('Jane Smith');
      expect(payload.message).toContain('jane@example.com');
      expect(payload.message).toContain('Meeting tomorrow');
      expect(payload.sessionKey).toBe('email:contact:contact-123:thread:thread-456');
      expect(payload.context.event_type).toBe('email_received');
      expect(payload.context.from_email).toBe('jane@example.com');
      expect(payload.context.subject).toBe('Meeting tomorrow');
    });

    it('handles missing subject', () => {
      const payload = buildEmailReceivedPayload({
        contactId: 'contact-123',
        contactName: 'Jane Smith',
        fromEmail: 'jane@example.com',
        threadId: 'thread-456',
        messageId: 'msg-789',
        messageBody: 'Test',
      });

      expect(payload.message).toContain('(no subject)');
    });
  });

  describe('buildReminderDuePayload', () => {
    it('builds correct payload structure', () => {
      const notBefore = new Date('2026-02-03T10:00:00Z');
      const payload = buildReminderDuePayload({
        workItemId: 'work-item-123',
        workItemTitle: 'Call mom',
        workItemDescription: 'Wish her happy birthday',
        workItemKind: 'issue',
        notBefore,
      });

      expect(payload.name).toBe('Reminder Handler');
      expect(payload.message).toContain('Call mom');
      expect(payload.message).toContain('Wish her happy birthday');
      expect(payload.sessionKey).toBe('reminder:work_item:work-item-123');
      expect(payload.context.event_type).toBe('reminder_due');
      expect(payload.context.work_item_id).toBe('work-item-123');
      expect(payload.context.not_before).toBe('2026-02-03T10:00:00.000Z');
    });
  });

  describe('buildDeadlineApproachingPayload', () => {
    it('builds correct payload structure', () => {
      const notAfter = new Date('2026-02-03T18:00:00Z');
      const payload = buildDeadlineApproachingPayload({
        workItemId: 'work-item-123',
        workItemTitle: 'Submit report',
        workItemKind: 'issue',
        notAfter,
        hoursRemaining: 24,
      });

      expect(payload.text).toContain('Submit report');
      expect(payload.text).toContain('24 hours');
      expect(payload.text).toContain('issue');
      expect(payload.mode).toBe('now');
    });
  });

  describe('getWebhookDestination', () => {
    it('returns /hooks/wake for deadline_approaching', () => {
      expect(getWebhookDestination('deadline_approaching')).toBe('/hooks/wake');
    });

    it('returns /hooks/agent for sms_received', () => {
      expect(getWebhookDestination('sms_received')).toBe('/hooks/agent');
    });

    it('returns /hooks/agent for email_received', () => {
      expect(getWebhookDestination('email_received')).toBe('/hooks/agent');
    });

    it('returns /hooks/agent for reminder_due', () => {
      expect(getWebhookDestination('reminder_due')).toBe('/hooks/agent');
    });

    it('returns /hooks/agent for spawn_agent', () => {
      expect(getWebhookDestination('spawn_agent')).toBe('/hooks/agent');
    });

    it('returns /hooks/agent for unknown event types', () => {
      expect(getWebhookDestination('unknown_event')).toBe('/hooks/agent');
    });
  });
});
