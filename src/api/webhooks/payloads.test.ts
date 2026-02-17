/**
 * Tests for webhook payload builders — agent_id support.
 * Issue #1195: Webhook payloads must include agent_id for multi-agent routing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildSmsReceivedPayload,
  buildEmailReceivedPayload,
  buildReminderDuePayload,
  buildDeadlineApproachingPayload,
} from './payloads.ts';

describe('webhook payloads — agent_id', () => {
  beforeEach(() => {
    vi.stubEnv('OPENCLAW_GATEWAY_URL', 'https://gateway.test');
    vi.stubEnv('OPENCLAW_API_TOKEN', 'test-token');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    // Clear the cached config between tests
    vi.resetModules();
  });

  describe('buildSmsReceivedPayload', () => {
    const baseParams = {
      contact_id: 'contact-1',
      contact_name: 'Alice',
      endpoint_type: 'phone',
      endpoint_value: '+61400000000',
      thread_id: 'thread-1',
      message_id: 'msg-1',
      message_body: 'Hello',
    };

    it('includes agent_id at top level when provided', () => {
      const payload = buildSmsReceivedPayload({ ...baseParams, agent_id: 'agent@example.com' });
      expect(payload.agent_id).toBe('agent@example.com');
    });

    it('includes agent_id in context when agent_id is provided', () => {
      const payload = buildSmsReceivedPayload({ ...baseParams, agent_id: 'agent@example.com' });
      expect(payload.context.agent_id).toBe('agent@example.com');
    });

    it('omits agent_id from top level when not provided', () => {
      const payload = buildSmsReceivedPayload(baseParams);
      expect(payload.agent_id).toBeUndefined();
    });

    it('omits agent_id from context when not provided', () => {
      const payload = buildSmsReceivedPayload(baseParams);
      expect(payload.context.agent_id).toBeUndefined();
    });
  });

  describe('buildEmailReceivedPayload', () => {
    const baseParams = {
      contact_id: 'contact-2',
      contact_name: 'Bob',
      from_email: 'bob@example.com',
      thread_id: 'thread-2',
      message_id: 'msg-2',
      message_body: 'Hi there',
    };

    it('includes agent_id at top level when provided', () => {
      const payload = buildEmailReceivedPayload({ ...baseParams, agent_id: 'agent@example.com' });
      expect(payload.agent_id).toBe('agent@example.com');
    });

    it('includes agent_id in context when agent_id is provided', () => {
      const payload = buildEmailReceivedPayload({ ...baseParams, agent_id: 'agent@example.com' });
      expect(payload.context.agent_id).toBe('agent@example.com');
    });

    it('omits agent_id when not provided', () => {
      const payload = buildEmailReceivedPayload(baseParams);
      expect(payload.agent_id).toBeUndefined();
    });
  });

  describe('buildReminderDuePayload', () => {
    const baseParams = {
      work_item_id: 'wi-1',
      work_item_title: 'Buy groceries',
      work_item_kind: 'task',
      not_before: new Date('2026-02-14T10:00:00Z'),
    };

    it('includes agent_id at top level when provided', () => {
      const payload = buildReminderDuePayload({ ...baseParams, agent_id: 'agent@example.com' });
      expect(payload.agent_id).toBe('agent@example.com');
    });

    it('includes agent_id in context when agent_id is provided', () => {
      const payload = buildReminderDuePayload({ ...baseParams, agent_id: 'agent@example.com' });
      expect(payload.context.agent_id).toBe('agent@example.com');
    });

    it('omits agent_id when not provided', () => {
      const payload = buildReminderDuePayload(baseParams);
      expect(payload.agent_id).toBeUndefined();
    });
  });

  describe('buildDeadlineApproachingPayload', () => {
    const baseParams = {
      work_item_id: 'wi-2',
      work_item_title: 'Submit report',
      work_item_kind: 'task',
      not_after: new Date('2026-02-15T10:00:00Z'),
      hours_remaining: 24,
    };

    it('includes agent_id at top level when provided', () => {
      const payload = buildDeadlineApproachingPayload({ ...baseParams, agent_id: 'agent@example.com' });
      expect(payload.agent_id).toBe('agent@example.com');
    });

    it('omits agent_id when not provided', () => {
      const payload = buildDeadlineApproachingPayload(baseParams);
      expect(payload.agent_id).toBeUndefined();
    });
  });

});
