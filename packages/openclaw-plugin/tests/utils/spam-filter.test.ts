/**
 * Tests for spam filtering utility.
 * Covers email bulk header detection, SMS spam signals,
 * and configurable allowlist/blocklist.
 */

import { describe, expect, it } from 'vitest';
import {
  isSpam,
  normalizeSender,
  type SpamFilterConfig,
  type InboundMessage,
  DEFAULT_SPAM_FILTER_CONFIG,
} from '../../src/utils/spam-filter.js';

describe('spam-filter', () => {
  const baseEmailMessage: InboundMessage = {
    channel: 'email',
    sender: 'user@example.com',
    recipient: 'me@example.com',
    body: 'Hello, how are you?',
    headers: {},
  };

  const baseSmsMessage: InboundMessage = {
    channel: 'sms',
    sender: '+15551234567',
    recipient: '+15559876543',
    body: 'Hey there!',
  };

  describe('email bulk header detection', () => {
    it('should flag emails with Precedence: bulk', () => {
      const msg: InboundMessage = {
        ...baseEmailMessage,
        headers: { 'precedence': 'bulk' },
      };
      const result = isSpam(msg);
      expect(result.isSpam).toBe(true);
      expect(result.reason).toContain('bulk');
    });

    it('should flag emails with Precedence: list', () => {
      const msg: InboundMessage = {
        ...baseEmailMessage,
        headers: { 'precedence': 'list' },
      };
      const result = isSpam(msg);
      expect(result.isSpam).toBe(true);
      expect(result.reason).toContain('bulk');
    });

    it('should flag emails with List-Unsubscribe header', () => {
      const msg: InboundMessage = {
        ...baseEmailMessage,
        headers: { 'list-unsubscribe': '<mailto:unsub@example.com>' },
      };
      const result = isSpam(msg);
      expect(result.isSpam).toBe(true);
      expect(result.reason).toContain('unsubscribe');
    });

    it('should flag emails with high X-Spam-Score', () => {
      const msg: InboundMessage = {
        ...baseEmailMessage,
        headers: { 'x-spam-score': '8.5' },
      };
      const result = isSpam(msg);
      expect(result.isSpam).toBe(true);
      expect(result.reason).toContain('spam score');
    });

    it('should not flag emails with low X-Spam-Score', () => {
      const msg: InboundMessage = {
        ...baseEmailMessage,
        headers: { 'x-spam-score': '1.2' },
      };
      const result = isSpam(msg);
      expect(result.isSpam).toBe(false);
    });

    it('should flag emails with X-Mailer indicating bulk sender', () => {
      const msg: InboundMessage = {
        ...baseEmailMessage,
        headers: { 'x-mailer': 'Mailchimp' },
      };
      const result = isSpam(msg);
      expect(result.isSpam).toBe(true);
      expect(result.reason).toContain('bulk mailer');
    });

    it('should flag emails with X-Mailer indicating SendGrid', () => {
      const msg: InboundMessage = {
        ...baseEmailMessage,
        headers: { 'x-mailer': 'SendGrid' },
      };
      const result = isSpam(msg);
      expect(result.isSpam).toBe(true);
    });

    it('should not flag normal personal emails', () => {
      const result = isSpam(baseEmailMessage);
      expect(result.isSpam).toBe(false);
    });

    it('should handle case-insensitive header keys', () => {
      const msg: InboundMessage = {
        ...baseEmailMessage,
        headers: { 'PRECEDENCE': 'BULK' },
      };
      const result = isSpam(msg);
      expect(result.isSpam).toBe(true);
    });

    it('should handle missing headers gracefully', () => {
      const msg: InboundMessage = {
        ...baseEmailMessage,
        headers: undefined,
      };
      const result = isSpam(msg);
      expect(result.isSpam).toBe(false);
    });
  });

  describe('SMS spam signals', () => {
    it('should flag messages from short codes (5 digits or fewer)', () => {
      const msg: InboundMessage = {
        ...baseSmsMessage,
        sender: '12345',
      };
      const result = isSpam(msg);
      expect(result.isSpam).toBe(true);
      expect(result.reason).toContain('short code');
    });

    it('should flag messages with opt-out keywords', () => {
      const cases = [
        'Reply STOP to unsubscribe',
        'Text UNSUBSCRIBE to opt out',
        'Reply OPT-OUT to stop receiving',
        'Txt STOP to cancel',
      ];
      for (const body of cases) {
        const msg: InboundMessage = { ...baseSmsMessage, body };
        const result = isSpam(msg);
        expect(result.isSpam).toBe(true);
        expect(result.reason).toContain('opt-out');
      }
    });

    it('should not flag normal SMS from full phone numbers', () => {
      const result = isSpam(baseSmsMessage);
      expect(result.isSpam).toBe(false);
    });

    it('should flag messages with common SMS spam patterns', () => {
      const spamBodies = [
        'Congratulations! You have won a free iPhone! Click here: http://spam.xyz',
        'URGENT: Your account has been compromised. Verify now: http://phish.net',
        'You have been selected for a $1000 gift card. Reply YES to claim.',
      ];
      for (const body of spamBodies) {
        const msg: InboundMessage = { ...baseSmsMessage, body };
        const result = isSpam(msg);
        expect(result.isSpam).toBe(true);
      }
    });
  });

  describe('allowlist/blocklist', () => {
    it('should always allow senders on the allowlist', () => {
      const config: SpamFilterConfig = {
        ...DEFAULT_SPAM_FILTER_CONFIG,
        allowlist: ['trusted@example.com'],
      };
      const msg: InboundMessage = {
        ...baseEmailMessage,
        sender: 'trusted@example.com',
        headers: { 'precedence': 'bulk' }, // would normally be flagged
      };
      const result = isSpam(msg, config);
      expect(result.isSpam).toBe(false);
      expect(result.reason).toContain('allowlist');
    });

    it('should always block senders on the blocklist', () => {
      const config: SpamFilterConfig = {
        ...DEFAULT_SPAM_FILTER_CONFIG,
        blocklist: ['spammer@evil.com'],
      };
      const msg: InboundMessage = {
        ...baseEmailMessage,
        sender: 'spammer@evil.com',
      };
      const result = isSpam(msg, config);
      expect(result.isSpam).toBe(true);
      expect(result.reason).toContain('blocklist');
    });

    it('should support phone number blocklist for SMS', () => {
      const config: SpamFilterConfig = {
        ...DEFAULT_SPAM_FILTER_CONFIG,
        blocklist: ['+15551111111'],
      };
      const msg: InboundMessage = {
        ...baseSmsMessage,
        sender: '+15551111111',
      };
      const result = isSpam(msg, config);
      expect(result.isSpam).toBe(true);
      expect(result.reason).toContain('blocklist');
    });

    it('should process allowlist before blocklist (allowlist wins)', () => {
      const config: SpamFilterConfig = {
        ...DEFAULT_SPAM_FILTER_CONFIG,
        allowlist: ['both@example.com'],
        blocklist: ['both@example.com'],
      };
      const msg: InboundMessage = {
        ...baseEmailMessage,
        sender: 'both@example.com',
      };
      const result = isSpam(msg, config);
      expect(result.isSpam).toBe(false);
    });
  });

  describe('configurable spam score threshold', () => {
    it('should respect custom spam score threshold', () => {
      const config: SpamFilterConfig = {
        ...DEFAULT_SPAM_FILTER_CONFIG,
        spamScoreThreshold: 3.0,
      };
      const msg: InboundMessage = {
        ...baseEmailMessage,
        headers: { 'x-spam-score': '3.5' },
      };
      const result = isSpam(msg, config);
      expect(result.isSpam).toBe(true);
    });

    it('should not flag below custom threshold', () => {
      const config: SpamFilterConfig = {
        ...DEFAULT_SPAM_FILTER_CONFIG,
        spamScoreThreshold: 10.0,
      };
      const msg: InboundMessage = {
        ...baseEmailMessage,
        headers: { 'x-spam-score': '8.0' },
      };
      const result = isSpam(msg, config);
      expect(result.isSpam).toBe(false);
    });
  });

  describe('sender normalization', () => {
    describe('email normalization', () => {
      it('should strip + alias tags from email addresses', () => {
        expect(normalizeSender('user+tag@example.com', 'email')).toBe('user@example.com');
      });

      it('should lowercase email addresses', () => {
        expect(normalizeSender('User@Example.COM', 'email')).toBe('user@example.com');
      });

      it('should handle emails without + aliases', () => {
        expect(normalizeSender('user@example.com', 'email')).toBe('user@example.com');
      });

      it('should handle emails without @ gracefully', () => {
        expect(normalizeSender('notanemail', 'email')).toBe('notanemail');
      });
    });

    describe('phone normalization', () => {
      it('should normalize +1XXXXXXXXXX format', () => {
        expect(normalizeSender('+15551234567', 'sms')).toBe('+15551234567');
      });

      it('should normalize 1XXXXXXXXXX to +1XXXXXXXXXX', () => {
        expect(normalizeSender('15551234567', 'sms')).toBe('+15551234567');
      });

      it('should normalize 10-digit US numbers to +1XXXXXXXXXX', () => {
        expect(normalizeSender('5551234567', 'sms')).toBe('+15551234567');
      });

      it('should strip formatting characters from phone numbers', () => {
        expect(normalizeSender('+1 (555) 123-4567', 'sms')).toBe('+15551234567');
      });

      it('should handle international numbers with +', () => {
        expect(normalizeSender('+44 20 7946 0958', 'sms')).toBe('+442079460958');
      });
    });

    describe('normalized allowlist/blocklist matching', () => {
      it('should block email with + alias when base is blocklisted', () => {
        const config: SpamFilterConfig = {
          ...DEFAULT_SPAM_FILTER_CONFIG,
          blocklist: ['spammer@evil.com'],
        };
        const msg: InboundMessage = {
          ...baseEmailMessage,
          sender: 'spammer+tag@evil.com',
        };
        const result = isSpam(msg, config);
        expect(result.isSpam).toBe(true);
        expect(result.reason).toContain('blocklist');
      });

      it('should allow email with + alias when base is allowlisted', () => {
        const config: SpamFilterConfig = {
          ...DEFAULT_SPAM_FILTER_CONFIG,
          allowlist: ['trusted@example.com'],
        };
        const msg: InboundMessage = {
          ...baseEmailMessage,
          sender: 'trusted+newsletter@example.com',
          headers: { 'precedence': 'bulk' }, // would normally be flagged
        };
        const result = isSpam(msg, config);
        expect(result.isSpam).toBe(false);
      });

      it('should match phone number variants in blocklist', () => {
        const config: SpamFilterConfig = {
          ...DEFAULT_SPAM_FILTER_CONFIG,
          blocklist: ['+15551111111'],
        };
        const msg: InboundMessage = {
          ...baseSmsMessage,
          sender: '15551111111', // without + prefix
        };
        const result = isSpam(msg, config);
        expect(result.isSpam).toBe(true);
      });

      it('should match 10-digit phone number against +1 blocklist entry', () => {
        const config: SpamFilterConfig = {
          ...DEFAULT_SPAM_FILTER_CONFIG,
          blocklist: ['+15551111111'],
        };
        const msg: InboundMessage = {
          ...baseSmsMessage,
          sender: '5551111111', // 10-digit format
        };
        const result = isSpam(msg, config);
        expect(result.isSpam).toBe(true);
      });
    });
  });

  describe('SpamFilterResult metadata', () => {
    it('should include channel in the result', () => {
      const result = isSpam(baseEmailMessage);
      expect(result.channel).toBe('email');
    });

    it('should include sender in the result', () => {
      const result = isSpam(baseEmailMessage);
      expect(result.sender).toBe('user@example.com');
    });

    it('should set reason to null for non-spam', () => {
      const result = isSpam(baseEmailMessage);
      expect(result.reason).toBeNull();
    });
  });
});
