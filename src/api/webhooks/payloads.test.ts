/**
 * Tests for webhook payload builders — agentId support.
 * Issue #1195: Webhook payloads must include agentId for multi-agent routing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildSmsReceivedPayload,
  buildEmailReceivedPayload,
  buildReminderDuePayload,
  buildDeadlineApproachingPayload,
} from './payloads.ts';

describe('webhook payloads — agentId', () => {
  beforeEach(() => {
    vi.stubEnv('OPENCLAW_GATEWAY_URL', 'https://gateway.test');
    vi.stubEnv('OPENCLAW_HOOK_TOKEN', 'test-token');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    // Clear the cached config between tests
    vi.resetModules();
  });

  describe('buildSmsReceivedPayload', () => {
    const baseParams = {
      contactId: 'contact-1',
      contactName: 'Alice',
      endpointType: 'phone',
      endpointValue: '+61400000000',
      threadId: 'thread-1',
      messageId: 'msg-1',
      messageBody: 'Hello',
    };

    it('includes agentId at top level when provided', () => {
      const payload = buildSmsReceivedPayload({ ...baseParams, agentId: 'agent@example.com' });
      expect(payload.agentId).toBe('agent@example.com');
    });

    it('includes agent_id in context when agentId is provided', () => {
      const payload = buildSmsReceivedPayload({ ...baseParams, agentId: 'agent@example.com' });
      expect(payload.context.agent_id).toBe('agent@example.com');
    });

    it('omits agentId from top level when not provided', () => {
      const payload = buildSmsReceivedPayload(baseParams);
      expect(payload.agentId).toBeUndefined();
    });

    it('omits agent_id from context when not provided', () => {
      const payload = buildSmsReceivedPayload(baseParams);
      expect(payload.context.agent_id).toBeUndefined();
    });
  });

  describe('buildEmailReceivedPayload', () => {
    const baseParams = {
      contactId: 'contact-2',
      contactName: 'Bob',
      fromEmail: 'bob@example.com',
      threadId: 'thread-2',
      messageId: 'msg-2',
      messageBody: 'Hi there',
    };

    it('includes agentId at top level when provided', () => {
      const payload = buildEmailReceivedPayload({ ...baseParams, agentId: 'agent@example.com' });
      expect(payload.agentId).toBe('agent@example.com');
    });

    it('includes agent_id in context when agentId is provided', () => {
      const payload = buildEmailReceivedPayload({ ...baseParams, agentId: 'agent@example.com' });
      expect(payload.context.agent_id).toBe('agent@example.com');
    });

    it('omits agentId when not provided', () => {
      const payload = buildEmailReceivedPayload(baseParams);
      expect(payload.agentId).toBeUndefined();
    });
  });

  describe('buildReminderDuePayload', () => {
    const baseParams = {
      workItemId: 'wi-1',
      workItemTitle: 'Buy groceries',
      workItemKind: 'task',
      notBefore: new Date('2026-02-14T10:00:00Z'),
    };

    it('includes agentId at top level when provided', () => {
      const payload = buildReminderDuePayload({ ...baseParams, agentId: 'agent@example.com' });
      expect(payload.agentId).toBe('agent@example.com');
    });

    it('includes agent_id in context when agentId is provided', () => {
      const payload = buildReminderDuePayload({ ...baseParams, agentId: 'agent@example.com' });
      expect(payload.context.agent_id).toBe('agent@example.com');
    });

    it('omits agentId when not provided', () => {
      const payload = buildReminderDuePayload(baseParams);
      expect(payload.agentId).toBeUndefined();
    });
  });

  describe('buildDeadlineApproachingPayload', () => {
    const baseParams = {
      workItemId: 'wi-2',
      workItemTitle: 'Submit report',
      workItemKind: 'task',
      notAfter: new Date('2026-02-15T10:00:00Z'),
      hoursRemaining: 24,
    };

    it('includes agentId at top level when provided', () => {
      const payload = buildDeadlineApproachingPayload({ ...baseParams, agentId: 'agent@example.com' });
      expect(payload.agentId).toBe('agent@example.com');
    });

    it('omits agentId when not provided', () => {
      const payload = buildDeadlineApproachingPayload(baseParams);
      expect(payload.agentId).toBeUndefined();
    });
  });

});
