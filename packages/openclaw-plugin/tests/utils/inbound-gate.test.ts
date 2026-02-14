/**
 * Tests for the inbound message gate.
 * Orchestrates spam filter + rate limiter + token budget
 * as a unified pre-processing gate for inbound messages.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  createInboundGate,
  type InboundGateConfig,
} from '../../src/utils/inbound-gate.js';
import type { InboundMessage } from '../../src/utils/spam-filter.js';
import type { Logger } from '../../src/logger.js';

describe('inbound-gate', () => {
  const mockLogger: Logger = {
    namespace: 'test',
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-14T12:00:00Z'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const baseConfig: InboundGateConfig = {
    spamFilter: {
      allowlist: [],
      blocklist: [],
      spamScoreThreshold: 5.0,
      bulkMailerPatterns: ['mailchimp', 'sendgrid', 'constantcontact', 'mailgun'],
      smsSpamPatterns: ['you have won', 'click here', 'free gift', 'act now', 'limited time'],
    },
    rateLimiter: {
      trustedSenderLimit: 100,
      knownSenderLimit: 50,
      unknownSenderLimit: 5,
      recipientGlobalLimit: 200,
      windowMs: 3_600_000, // 1 hour
    },
    tokenBudget: {
      enabled: false,
    },
  };

  describe('spam rejection', () => {
    it('should reject bulk email and log the decision', () => {
      const gate = createInboundGate(baseConfig, mockLogger);

      const msg: InboundMessage = {
        channel: 'email',
        sender: 'newsletter@marketing.com',
        recipient: 'me@example.com',
        body: 'Weekly deals!',
        headers: { 'precedence': 'bulk' },
      };

      const decision = gate.evaluate(msg, 'unknown');
      expect(decision.action).toBe('reject');
      expect(decision.reason).toContain('spam');
      expect(decision.skipEmbedding).toBe(true);
      expect(mockLogger.info).toHaveBeenCalled();
    });
  });

  describe('rate limiting', () => {
    it('should rate-limit after exceeding per-sender threshold', () => {
      const config: InboundGateConfig = {
        ...baseConfig,
        rateLimiter: {
          ...baseConfig.rateLimiter,
          unknownSenderLimit: 2,
        },
      };
      const gate = createInboundGate(config, mockLogger);

      const msg: InboundMessage = {
        channel: 'sms',
        sender: '+15551234567',
        recipient: '+15559876543',
        body: 'Hello',
      };

      // First 2 pass
      expect(gate.evaluate(msg, 'unknown').action).toBe('allow');
      expect(gate.evaluate(msg, 'unknown').action).toBe('allow');
      // 3rd is rate-limited
      const decision = gate.evaluate(msg, 'unknown');
      expect(decision.action).toBe('rate_limited');
      expect(decision.skipEmbedding).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should allow known contacts more messages than unknown', () => {
      const config: InboundGateConfig = {
        ...baseConfig,
        rateLimiter: {
          ...baseConfig.rateLimiter,
          knownSenderLimit: 5,
          unknownSenderLimit: 2,
        },
      };
      const gate = createInboundGate(config, mockLogger);

      const knownMsg: InboundMessage = {
        channel: 'email',
        sender: 'known@friend.com',
        recipient: 'me@example.com',
        body: 'Hi',
      };

      for (let i = 0; i < 5; i++) {
        expect(gate.evaluate(knownMsg, 'known').action).toBe('allow');
      }
      expect(gate.evaluate(knownMsg, 'known').action).toBe('rate_limited');
    });
  });

  describe('token budget enforcement', () => {
    it('should reject when token budget is exhausted', () => {
      const config: InboundGateConfig = {
        ...baseConfig,
        tokenBudget: {
          enabled: true,
          dailyTokenLimit: 1000,
        },
      };
      const gate = createInboundGate(config, mockLogger);

      const msg: InboundMessage = {
        channel: 'email',
        sender: 'user@example.com',
        recipient: 'me@example.com',
        body: 'Hello',
      };

      // Exhaust the budget via evaluate() (tryConsume records atomically)
      const first = gate.evaluate(msg, 'known', 1000);
      expect(first.action).toBe('allow');

      // Next message should be budget-exceeded
      const decision = gate.evaluate(msg, 'known', 500);
      expect(decision.action).toBe('budget_exceeded');
      expect(decision.skipEmbedding).toBe(true);
    });

    it('should allow messages when budget is available', () => {
      const config: InboundGateConfig = {
        ...baseConfig,
        tokenBudget: {
          enabled: true,
          dailyTokenLimit: 100_000,
        },
      };
      const gate = createInboundGate(config, mockLogger);

      const msg: InboundMessage = {
        channel: 'email',
        sender: 'user@example.com',
        recipient: 'me@example.com',
        body: 'Hello',
      };

      const decision = gate.evaluate(msg, 'known', 500);
      expect(decision.action).toBe('allow');
    });

    it('should not double-count tokens (evaluate consumes atomically)', () => {
      const config: InboundGateConfig = {
        ...baseConfig,
        tokenBudget: {
          enabled: true,
          dailyTokenLimit: 1000,
        },
      };
      const gate = createInboundGate(config, mockLogger);

      const msg: InboundMessage = {
        channel: 'email',
        sender: 'user@example.com',
        recipient: 'me@example.com',
        body: 'Hello',
      };

      // Consume 500 tokens via evaluate
      expect(gate.evaluate(msg, 'known', 500).action).toBe('allow');
      // Another 500 should still fit (exactly at limit)
      expect(gate.evaluate(msg, 'known', 500).action).toBe('allow');
      // Now at 1000/1000 — even 1 more should be denied
      expect(gate.evaluate(msg, 'known', 1).action).toBe('budget_exceeded');
    });
  });

  describe('decision ordering', () => {
    it('should check spam first, then rate limit, then token budget', () => {
      const config: InboundGateConfig = {
        ...baseConfig,
        rateLimiter: {
          ...baseConfig.rateLimiter,
          unknownSenderLimit: 0, // would also be rate-limited
        },
        tokenBudget: {
          enabled: true,
          dailyTokenLimit: 0, // would also be budget-exceeded
        },
      };
      const gate = createInboundGate(config, mockLogger);

      const msg: InboundMessage = {
        channel: 'email',
        sender: 'spammer@evil.com',
        recipient: 'me@example.com',
        body: 'Buy now!',
        headers: { 'precedence': 'bulk' },
      };

      // Spam check should win since it runs first
      const decision = gate.evaluate(msg, 'unknown');
      expect(decision.action).toBe('reject');
      expect(decision.reason).toContain('spam');
    });
  });

  describe('allow through', () => {
    it('should allow clean messages from known contacts', () => {
      const gate = createInboundGate(baseConfig, mockLogger);

      const msg: InboundMessage = {
        channel: 'email',
        sender: 'friend@example.com',
        recipient: 'me@example.com',
        body: 'Hey, let us catch up this weekend!',
      };

      const decision = gate.evaluate(msg, 'known');
      expect(decision.action).toBe('allow');
      expect(decision.skipEmbedding).toBe(false);
      expect(decision.reason).toBeNull();
    });
  });

  describe('deferred processing', () => {
    it('should mark messages from unknown senders as deferred when configured', () => {
      const config: InboundGateConfig = {
        ...baseConfig,
        deferUnknownSenders: true,
      };
      const gate = createInboundGate(config, mockLogger);

      const msg: InboundMessage = {
        channel: 'sms',
        sender: '+15551234567',
        recipient: '+15559876543',
        body: 'Hey, this is Bob',
      };

      const decision = gate.evaluate(msg, 'unknown');
      expect(decision.action).toBe('defer');
      expect(decision.skipEmbedding).toBe(true);
    });

    it('should not defer known contacts', () => {
      const config: InboundGateConfig = {
        ...baseConfig,
        deferUnknownSenders: true,
      };
      const gate = createInboundGate(config, mockLogger);

      const msg: InboundMessage = {
        channel: 'email',
        sender: 'friend@example.com',
        recipient: 'me@example.com',
        body: 'Hi!',
      };

      const decision = gate.evaluate(msg, 'known');
      expect(decision.action).toBe('allow');
    });
  });

  describe('logging', () => {
    it('should log spam rejections with details', () => {
      const gate = createInboundGate(baseConfig, mockLogger);

      const msg: InboundMessage = {
        channel: 'email',
        sender: 'spam@evil.com',
        recipient: 'me@example.com',
        body: 'Buy now!',
        headers: { 'list-unsubscribe': '<mailto:unsub@evil.com>' },
      };

      gate.evaluate(msg, 'unknown');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('spam'),
        expect.objectContaining({
          sender: 'spam@evil.com',
          channel: 'email',
        }),
      );
    });

    it('should log rate limit hits with sender info', () => {
      const config: InboundGateConfig = {
        ...baseConfig,
        rateLimiter: {
          ...baseConfig.rateLimiter,
          unknownSenderLimit: 1,
        },
      };
      const gate = createInboundGate(config, mockLogger);

      const msg: InboundMessage = {
        channel: 'sms',
        sender: '+15551234567',
        recipient: '+15559876543',
        body: 'Hello',
      };

      gate.evaluate(msg, 'unknown'); // allowed
      gate.evaluate(msg, 'unknown'); // rate-limited

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('rate'),
        expect.objectContaining({
          sender: '+15551234567',
        }),
      );
    });
  });

  describe('getStats', () => {
    it('should return aggregate statistics', () => {
      const gate = createInboundGate(baseConfig, mockLogger);

      const msg: InboundMessage = {
        channel: 'email',
        sender: 'user@example.com',
        recipient: 'me@example.com',
        body: 'Hello',
      };

      gate.evaluate(msg, 'known');

      const stats = gate.getStats();
      expect(stats.totalEvaluated).toBe(1);
      expect(stats.allowed).toBe(1);
      expect(stats.rejected).toBe(0);
      expect(stats.rateLimited).toBe(0);
    });
  });
});
