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

/**
 * Tests for webhook payload structure — AgentHookPayload compliance.
 * Issue #2280: Webhook payloads must include 'message' field for /hooks/agent endpoint.
 */
describe('webhook payloads — AgentHookPayload structure (#2280)', () => {
  beforeEach(() => {
    vi.stubEnv('OPENCLAW_GATEWAY_URL', 'https://gateway.test');
    vi.stubEnv('OPENCLAW_API_TOKEN', 'test-token');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  describe('buildSmsReceivedPayload', () => {
    const params = {
      contact_id: 'contact-1',
      contact_name: 'Alice',
      endpoint_type: 'phone',
      endpoint_value: '+61400000000',
      thread_id: 'thread-1',
      message_id: 'msg-1',
      message_body: 'Hello from SMS',
      agent_id: 'agent@example.com',
    };

    it('includes required "message" field', () => {
      const payload = buildSmsReceivedPayload(params);
      expect(payload.message).toBeDefined();
      expect(typeof payload.message).toBe('string');
      expect(payload.message.length).toBeGreaterThan(0);
    });

    it('includes "name" field', () => {
      const payload = buildSmsReceivedPayload(params);
      expect(payload.name).toBeDefined();
      expect(typeof payload.name).toBe('string');
    });

    it('includes "session_key" field', () => {
      const payload = buildSmsReceivedPayload(params);
      expect(payload.session_key).toBeDefined();
      expect(typeof payload.session_key).toBe('string');
    });

    it('includes "wake_mode" field', () => {
      const payload = buildSmsReceivedPayload(params);
      expect(payload.wake_mode).toBe('now');
    });

    it('includes "deliver" field', () => {
      const payload = buildSmsReceivedPayload(params);
      expect(payload.deliver).toBe(true);
    });

    it('includes message body in "message" field', () => {
      const payload = buildSmsReceivedPayload(params);
      expect(payload.message).toContain('Hello from SMS');
    });

    it('includes contact name in "message" field', () => {
      const payload = buildSmsReceivedPayload(params);
      expect(payload.message).toContain('Alice');
    });

    it('includes context with event_type', () => {
      const payload = buildSmsReceivedPayload(params);
      expect(payload.context.event_type).toBe('sms_received');
    });

    it('includes context with contact and thread info', () => {
      const payload = buildSmsReceivedPayload(params);
      expect(payload.context.contact_id).toBe('contact-1');
      expect(payload.context.thread_id).toBe('thread-1');
      expect(payload.context.message_id).toBe('msg-1');
    });
  });

  describe('buildEmailReceivedPayload', () => {
    const params = {
      contact_id: 'contact-2',
      contact_name: 'Bob',
      from_email: 'bob@example.com',
      to_email: 'agent@myapp.com',
      subject: 'Test Subject',
      thread_id: 'thread-2',
      message_id: 'msg-2',
      message_body: 'Hello from email',
      agent_id: 'agent@example.com',
    };

    it('includes required "message" field', () => {
      const payload = buildEmailReceivedPayload(params);
      expect(payload.message).toBeDefined();
      expect(typeof payload.message).toBe('string');
      expect(payload.message.length).toBeGreaterThan(0);
    });

    it('includes "name" field', () => {
      const payload = buildEmailReceivedPayload(params);
      expect(payload.name).toBeDefined();
      expect(typeof payload.name).toBe('string');
    });

    it('includes "session_key" field', () => {
      const payload = buildEmailReceivedPayload(params);
      expect(payload.session_key).toBeDefined();
      expect(typeof payload.session_key).toBe('string');
    });

    it('includes "wake_mode" field', () => {
      const payload = buildEmailReceivedPayload(params);
      expect(payload.wake_mode).toBe('now');
    });

    it('includes "deliver" field', () => {
      const payload = buildEmailReceivedPayload(params);
      expect(payload.deliver).toBe(true);
    });

    it('includes subject in "message" field', () => {
      const payload = buildEmailReceivedPayload(params);
      expect(payload.message).toContain('Test Subject');
    });

    it('includes from email in "message" field', () => {
      const payload = buildEmailReceivedPayload(params);
      expect(payload.message).toContain('bob@example.com');
    });

    it('includes message body in "message" field', () => {
      const payload = buildEmailReceivedPayload(params);
      expect(payload.message).toContain('Hello from email');
    });

    it('includes context with event_type', () => {
      const payload = buildEmailReceivedPayload(params);
      expect(payload.context.event_type).toBe('email_received');
    });

    it('includes context with contact and thread info', () => {
      const payload = buildEmailReceivedPayload(params);
      expect(payload.context.contact_id).toBe('contact-2');
      expect(payload.context.thread_id).toBe('thread-2');
      expect(payload.context.message_id).toBe('msg-2');
    });

    it('includes context with email-specific fields', () => {
      const payload = buildEmailReceivedPayload(params);
      expect(payload.context.from_email).toBe('bob@example.com');
      expect(payload.context.subject).toBe('Test Subject');
    });
  });
});

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
