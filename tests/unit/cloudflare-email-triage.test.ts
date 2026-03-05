/**
 * Unit tests for synchronous email triage via gateway WebSocket.
 * Issue #2179 — Agent-driven email triage.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseTriageResponse,
  buildTriagePrompt,
  triageEmailViaGateway,
  type TriageDecision,
} from '../../src/api/cloudflare-email/triage.ts';

describe('parseTriageResponse', () => {
  it('parses REJECT: response and extracts reason', () => {
    const result = parseTriageResponse('REJECT: Spam from known bulk sender');
    expect(result).toEqual({
      action: 'reject',
      reject_reason: 'Spam from known bulk sender',
    });
  });

  it('parses REJECT: with leading/trailing whitespace', () => {
    const result = parseTriageResponse('  REJECT: Invalid recipient  ');
    expect(result).toEqual({
      action: 'reject',
      reject_reason: 'Invalid recipient',
    });
  });

  it('handles REJECT: with empty reason — uses default', () => {
    const result = parseTriageResponse('REJECT:');
    expect(result).toEqual({
      action: 'reject',
      reject_reason: 'Rejected by email triage',
    });
  });

  it('handles REJECT: with only whitespace after colon — uses default', () => {
    const result = parseTriageResponse('REJECT:   ');
    expect(result).toEqual({
      action: 'reject',
      reject_reason: 'Rejected by email triage',
    });
  });

  it('parses NO_REPLY response as accept', () => {
    const result = parseTriageResponse('NO_REPLY');
    expect(result).toEqual({ action: 'accept' });
  });

  it('parses NO_REPLY with whitespace', () => {
    const result = parseTriageResponse('  NO_REPLY  ');
    expect(result).toEqual({ action: 'accept' });
  });

  it('treats any other text as accept (agent escalated)', () => {
    const result = parseTriageResponse('Forwarding to troy for review');
    expect(result).toEqual({ action: 'accept' });
  });

  it('treats empty response as accept', () => {
    const result = parseTriageResponse('');
    expect(result).toEqual({ action: 'accept' });
  });

  it('handles multi-line response — uses first line for parsing', () => {
    const result = parseTriageResponse('REJECT: Fabricated recipient\nThis address does not exist.');
    expect(result).toEqual({
      action: 'reject',
      reject_reason: 'Fabricated recipient',
    });
  });

  it('is case-sensitive — lowercase reject is treated as accept', () => {
    const result = parseTriageResponse('reject: not valid');
    expect(result).toEqual({ action: 'accept' });
  });
});

describe('buildTriagePrompt', () => {
  const baseEmail = {
    from: 'sender@example.com',
    to: 'support@myapp.com',
    subject: 'Test Email',
    body: 'Hello, this is a test email body.',
    timestamp: '2026-03-05T12:00:00.000Z',
    messageId: 'abc123@example.com',
  };

  it('includes all email metadata in the prompt', () => {
    const prompt = buildTriagePrompt(baseEmail, null);
    expect(prompt).toContain('To: support@myapp.com');
    expect(prompt).toContain('From: sender@example.com');
    expect(prompt).toContain('Subject: Test Email');
    expect(prompt).toContain('Message-ID: abc123@example.com');
    expect(prompt).toContain('Hello, this is a test email body.');
  });

  it('truncates body to 2000 characters', () => {
    const longBody = 'x'.repeat(3000);
    const prompt = buildTriagePrompt({ ...baseEmail, body: longBody }, null);
    const bodyMatch = prompt.match(/Body:\n([\s\S]*?)\n---/);
    expect(bodyMatch).toBeTruthy();
    expect(bodyMatch![1].length).toBeLessThanOrEqual(2000);
  });

  it('uses promptContent as template prefix when provided', () => {
    const customPrompt = 'You are an email triage agent for myapp.com.';
    const prompt = buildTriagePrompt(baseEmail, customPrompt);
    expect(prompt.startsWith(customPrompt)).toBe(true);
    expect(prompt).toContain('From: sender@example.com');
  });

  it('includes response format instructions', () => {
    const prompt = buildTriagePrompt(baseEmail, null);
    expect(prompt).toContain('REJECT:');
    expect(prompt).toContain('NO_REPLY');
  });

  it('handles missing body gracefully', () => {
    const prompt = buildTriagePrompt({ ...baseEmail, body: '' }, null);
    expect(prompt).toContain('Body:\n');
  });
});

describe('triageEmailViaGateway', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.OPENCLAW_EMAIL_TRIAGE_SYNC = 'true';
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  const triageParams = {
    threadId: 'thread-uuid-123',
    agentId: 'email-triage',
    promptContent: null as string | null,
    email: {
      from: 'spam@bulk.example',
      to: 'support@myapp.com',
      subject: 'Buy cheap stuff',
      body: 'Click here for deals!',
      timestamp: '2026-03-05T12:00:00.000Z',
      messageId: 'spam-msg-id@bulk.example',
    },
  };

  it('returns null when OPENCLAW_EMAIL_TRIAGE_SYNC is false', async () => {
    process.env.OPENCLAW_EMAIL_TRIAGE_SYNC = 'false';

    const mockGw = { getStatus: () => ({ connected: true }), request: vi.fn() };
    const result = await triageEmailViaGateway(triageParams, mockGw as any);
    expect(result).toBeNull();
    expect(mockGw.request).not.toHaveBeenCalled();
  });

  it('returns null when gateway is not connected', async () => {
    const mockGw = { getStatus: () => ({ connected: false }), request: vi.fn() };
    const result = await triageEmailViaGateway(triageParams, mockGw as any);
    expect(result).toBeNull();
    expect(mockGw.request).not.toHaveBeenCalled();
  });

  it('sends triage request via gateway WS and returns reject decision', async () => {
    const mockGw = {
      getStatus: () => ({ connected: true }),
      request: vi.fn().mockResolvedValue({ message: 'REJECT: Fabricated address' }),
    };

    const result = await triageEmailViaGateway(triageParams, mockGw as any);

    expect(result).toEqual({
      action: 'reject',
      reject_reason: 'Fabricated address',
    });

    expect(mockGw.request).toHaveBeenCalledWith(
      'chat.send',
      expect.objectContaining({
        sessionKey: 'agent:email-triage:email_triage:thread-uuid-123',
        deliver: true,
      }),
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
  });

  it('sends triage request and returns accept for NO_REPLY', async () => {
    const mockGw = {
      getStatus: () => ({ connected: true }),
      request: vi.fn().mockResolvedValue({ message: 'NO_REPLY' }),
    };

    const result = await triageEmailViaGateway(triageParams, mockGw as any);
    expect(result).toEqual({ action: 'accept' });
  });

  it('sends triage request and returns accept for escalation', async () => {
    const mockGw = {
      getStatus: () => ({ connected: true }),
      request: vi.fn().mockResolvedValue({ message: 'Forwarding to troy' }),
    };

    const result = await triageEmailViaGateway(triageParams, mockGw as any);
    expect(result).toEqual({ action: 'accept' });
  });

  it('uses email thread_id in session key', async () => {
    const mockGw = {
      getStatus: () => ({ connected: true }),
      request: vi.fn().mockResolvedValue({ message: 'NO_REPLY' }),
    };

    await triageEmailViaGateway(
      { ...triageParams, threadId: 'my-thread-42' },
      mockGw as any,
    );

    expect(mockGw.request).toHaveBeenCalledWith(
      'chat.send',
      expect.objectContaining({
        sessionKey: 'agent:email-triage:email_triage:my-thread-42',
      }),
      expect.anything(),
    );
  });

  it('includes email metadata in triage prompt', async () => {
    const mockGw = {
      getStatus: () => ({ connected: true }),
      request: vi.fn().mockResolvedValue({ message: 'NO_REPLY' }),
    };

    await triageEmailViaGateway(triageParams, mockGw as any);

    const sentMessage = mockGw.request.mock.calls[0][1].message as string;
    expect(sentMessage).toContain('From: spam@bulk.example');
    expect(sentMessage).toContain('Subject: Buy cheap stuff');
  });

  it('fails open on triage timeout — returns null', async () => {
    process.env.OPENCLAW_EMAIL_TRIAGE_TIMEOUT_MS = '100';
    const mockGw = {
      getStatus: () => ({ connected: true }),
      request: vi.fn().mockRejectedValue(new Error('request timed out')),
    };

    const result = await triageEmailViaGateway(triageParams, mockGw as any);
    expect(result).toBeNull();
  });

  it('fails open on agent error — returns null', async () => {
    const mockGw = {
      getStatus: () => ({ connected: true }),
      request: vi.fn().mockRejectedValue(new Error('agent crashed')),
    };

    const result = await triageEmailViaGateway(triageParams, mockGw as any);
    expect(result).toBeNull();
  });

  it('uses custom timeout from OPENCLAW_EMAIL_TRIAGE_TIMEOUT_MS', async () => {
    process.env.OPENCLAW_EMAIL_TRIAGE_TIMEOUT_MS = '5000';
    const mockGw = {
      getStatus: () => ({ connected: true }),
      request: vi.fn().mockResolvedValue({ message: 'NO_REPLY' }),
    };

    await triageEmailViaGateway(triageParams, mockGw as any);

    expect(mockGw.request).toHaveBeenCalledWith(
      'chat.send',
      expect.anything(),
      expect.objectContaining({ timeoutMs: 5000 }),
    );
  });

  it('uses default 25s timeout when env var not set', async () => {
    delete process.env.OPENCLAW_EMAIL_TRIAGE_TIMEOUT_MS;
    const mockGw = {
      getStatus: () => ({ connected: true }),
      request: vi.fn().mockResolvedValue({ message: 'NO_REPLY' }),
    };

    await triageEmailViaGateway(triageParams, mockGw as any);

    expect(mockGw.request).toHaveBeenCalledWith(
      'chat.send',
      expect.anything(),
      expect.objectContaining({ timeoutMs: 25000 }),
    );
  });

  it('uses promptContent in triage prompt when provided', async () => {
    const mockGw = {
      getStatus: () => ({ connected: true }),
      request: vi.fn().mockResolvedValue({ message: 'NO_REPLY' }),
    };

    await triageEmailViaGateway(
      { ...triageParams, promptContent: 'Custom triage rules here.' },
      mockGw as any,
    );

    const sentMessage = mockGw.request.mock.calls[0][1].message as string;
    expect(sentMessage).toMatch(/^Custom triage rules here\./);
  });

  it('uses idempotencyKey from messageId', async () => {
    const mockGw = {
      getStatus: () => ({ connected: true }),
      request: vi.fn().mockResolvedValue({ message: 'NO_REPLY' }),
    };

    await triageEmailViaGateway(triageParams, mockGw as any);

    expect(mockGw.request).toHaveBeenCalledWith(
      'chat.send',
      expect.objectContaining({
        idempotencyKey: 'spam-msg-id@bulk.example',
      }),
      expect.anything(),
    );
  });
});
