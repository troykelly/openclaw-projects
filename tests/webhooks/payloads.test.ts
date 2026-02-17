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
    process.env.OPENCLAW_API_TOKEN = 'test-token';
  });

  afterEach(() => {
    process.env = originalEnv;
    clearConfigCache();
  });

  describe('buildSmsReceivedPayload', () => {
    it('builds correct payload structure', () => {
      const payload = buildSmsReceivedPayload({
        contact_id: 'contact-123',
        contact_name: 'John Doe',
        endpoint_type: 'phone',
        endpoint_value: '+15551234567',
        thread_id: 'thread-456',
        message_id: 'msg-789',
        message_body: 'Hello, this is a test message.',
      });

      expect(payload.name).toBe('SMS Handler');
      expect(payload.wake_mode).toBe('now');
      expect(payload.deliver).toBe(true);
      expect(payload.channel).toBe('last');
      expect(payload.message).toContain('John Doe');
      expect(payload.message).toContain('Hello, this is a test message.');
      expect(payload.session_key).toBe('sms:contact:contact-123:thread:thread-456');
      expect(payload.context.event_type).toBe('sms_received');
      expect(payload.context.contact_id).toBe('contact-123');
      expect(payload.context.message_body).toBe('Hello, this is a test message.');
    });

    it('includes optional m365_contact_id', () => {
      const payload = buildSmsReceivedPayload({
        contact_id: 'contact-123',
        contact_name: 'John Doe',
        endpoint_type: 'phone',
        endpoint_value: '+15551234567',
        m365_contact_id: 'ms-contact-id',
        thread_id: 'thread-456',
        message_id: 'msg-789',
        message_body: 'Test',
      });

      expect(payload.context.m365_contact_id).toBe('ms-contact-id');
    });
  });

  describe('buildEmailReceivedPayload', () => {
    it('builds correct payload structure', () => {
      const payload = buildEmailReceivedPayload({
        contact_id: 'contact-123',
        contact_name: 'Jane Smith',
        from_email: 'jane@example.com',
        to_email: 'me@example.com',
        subject: 'Meeting tomorrow',
        thread_id: 'thread-456',
        message_id: 'msg-789',
        message_body: 'Hi, can we meet tomorrow at 3pm?',
      });

      expect(payload.name).toBe('Email Handler');
      expect(payload.wake_mode).toBe('now');
      expect(payload.message).toContain('Jane Smith');
      expect(payload.message).toContain('jane@example.com');
      expect(payload.message).toContain('Meeting tomorrow');
      expect(payload.session_key).toBe('email:contact:contact-123:thread:thread-456');
      expect(payload.context.event_type).toBe('email_received');
      expect(payload.context.from_email).toBe('jane@example.com');
      expect(payload.context.subject).toBe('Meeting tomorrow');
    });

    it('handles missing subject', () => {
      const payload = buildEmailReceivedPayload({
        contact_id: 'contact-123',
        contact_name: 'Jane Smith',
        from_email: 'jane@example.com',
        thread_id: 'thread-456',
        message_id: 'msg-789',
        message_body: 'Test',
      });

      expect(payload.message).toContain('(no subject)');
    });
  });

  describe('buildReminderDuePayload', () => {
    it('builds correct payload structure', () => {
      const not_before = new Date('2026-02-03T10:00:00Z');
      const payload = buildReminderDuePayload({
        work_item_id: 'work-item-123',
        work_item_title: 'Call mom',
        work_item_description: 'Wish her happy birthday',
        work_item_kind: 'issue',
        not_before,
      });

      expect(payload.name).toBe('Reminder Handler');
      expect(payload.message).toContain('Call mom');
      expect(payload.message).toContain('Wish her happy birthday');
      expect(payload.session_key).toBe('reminder:work_item:work-item-123');
      expect(payload.context.event_type).toBe('reminder_due');
      expect(payload.context.work_item_id).toBe('work-item-123');
      expect(payload.context.not_before).toBe('2026-02-03T10:00:00.000Z');
    });
  });

  describe('buildDeadlineApproachingPayload', () => {
    it('builds correct payload structure', () => {
      const not_after = new Date('2026-02-03T18:00:00Z');
      const payload = buildDeadlineApproachingPayload({
        work_item_id: 'work-item-123',
        work_item_title: 'Submit report',
        work_item_kind: 'issue',
        not_after,
        hours_remaining: 24,
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
