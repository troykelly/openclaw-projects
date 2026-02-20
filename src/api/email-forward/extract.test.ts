import { describe, it, expect } from 'vitest';
import { extractOriginalRecipient } from './extract.ts';

const INBOUND = 'quasar@execdesk.ai';

describe('extractOriginalRecipient', () => {
  describe('header extraction', () => {
    it('extracts from X-Forwarded-To', () => {
      const result = extractOriginalRecipient(
        { 'X-Forwarded-To': 'user@example.com' },
        '',
        INBOUND,
      );
      expect(result).toBe('user@example.com');
    });

    it('extracts from X-Original-To', () => {
      const result = extractOriginalRecipient(
        { 'X-Original-To': 'user@example.com' },
        '',
        INBOUND,
      );
      expect(result).toBe('user@example.com');
    });

    it('extracts from Delivered-To when different from inbound', () => {
      const result = extractOriginalRecipient(
        { 'Delivered-To': 'user@example.com' },
        '',
        INBOUND,
      );
      expect(result).toBe('user@example.com');
    });

    it('skips Delivered-To when same as inbound', () => {
      const result = extractOriginalRecipient(
        { 'Delivered-To': INBOUND },
        '',
        INBOUND,
      );
      expect(result).toBeNull();
    });

    it('extracts from Resent-To', () => {
      const result = extractOriginalRecipient(
        { 'Resent-To': 'user@example.com' },
        '',
        INBOUND,
      );
      expect(result).toBe('user@example.com');
    });

    it('extracts from To header when different from inbound', () => {
      const result = extractOriginalRecipient(
        { 'To': 'user@example.com' },
        '',
        INBOUND,
      );
      expect(result).toBe('user@example.com');
    });

    it('skips To when same as inbound', () => {
      const result = extractOriginalRecipient(
        { 'To': INBOUND },
        '',
        INBOUND,
      );
      expect(result).toBeNull();
    });

    it('handles angle bracket format', () => {
      const result = extractOriginalRecipient(
        { 'X-Forwarded-To': 'User Name <user@example.com>' },
        '',
        INBOUND,
      );
      expect(result).toBe('user@example.com');
    });

    it('normalizes header keys case-insensitively', () => {
      const result = extractOriginalRecipient(
        { 'x-forwarded-to': 'user@example.com' },
        '',
        INBOUND,
      );
      expect(result).toBe('user@example.com');
    });

    it('lowercases extracted email', () => {
      const result = extractOriginalRecipient(
        { 'X-Forwarded-To': 'User@EXAMPLE.COM' },
        '',
        INBOUND,
      );
      expect(result).toBe('user@example.com');
    });

    it('follows priority order: X-Forwarded-To > X-Original-To', () => {
      const result = extractOriginalRecipient(
        {
          'X-Forwarded-To': 'first@example.com',
          'X-Original-To': 'second@example.com',
        },
        '',
        INBOUND,
      );
      expect(result).toBe('first@example.com');
    });

    it('skips to next header if first matches inbound', () => {
      const result = extractOriginalRecipient(
        {
          'X-Forwarded-To': INBOUND,
          'X-Original-To': 'user@example.com',
        },
        '',
        INBOUND,
      );
      expect(result).toBe('user@example.com');
    });
  });

  describe('body extraction', () => {
    it('extracts from Gmail forwarded pattern', () => {
      const body = `Hey, check this out.

---------- Forwarded message ----------
From: Sender <sender@example.com>
Date: Mon, Jan 1, 2026
Subject: Test
To: user@example.com

The original message content.`;

      const result = extractOriginalRecipient({}, body, INBOUND);
      expect(result).toBe('user@example.com');
    });

    it('extracts from Outlook forwarded pattern', () => {
      const body = `FYI

-----Original Message-----
From: Sender
Sent: Monday, January 1, 2026
To: user@example.com
Subject: Test

Original content.`;

      const result = extractOriginalRecipient({}, body, INBOUND);
      expect(result).toBe('user@example.com');
    });

    it('extracts from generic To: line near top', () => {
      const body = `From: sender@example.com
To: user@example.com
Subject: Test

Content here.`;

      const result = extractOriginalRecipient({}, body, INBOUND);
      expect(result).toBe('user@example.com');
    });

    it('skips body email that matches inbound', () => {
      const body = `---------- Forwarded message ----------
From: someone@example.com
To: ${INBOUND}

Content.`;

      const result = extractOriginalRecipient({}, body, INBOUND);
      expect(result).toBeNull();
    });

    it('returns null when body has no forwarding patterns', () => {
      const result = extractOriginalRecipient(
        {},
        'Just a plain email body with no forwarding headers.',
        INBOUND,
      );
      expect(result).toBeNull();
    });

    it('returns null for empty body', () => {
      const result = extractOriginalRecipient({}, '', INBOUND);
      expect(result).toBeNull();
    });
  });

  describe('combined', () => {
    it('prefers headers over body', () => {
      const body = `---------- Forwarded message ----------
From: someone@example.com
To: body-user@example.com

Content.`;

      const result = extractOriginalRecipient(
        { 'X-Forwarded-To': 'header-user@example.com' },
        body,
        INBOUND,
      );
      expect(result).toBe('header-user@example.com');
    });

    it('falls through to body when all headers match inbound', () => {
      const body = `---------- Forwarded message ----------
From: someone@example.com
To: body-user@example.com

Content.`;

      const result = extractOriginalRecipient(
        { 'To': INBOUND, 'Delivered-To': INBOUND },
        body,
        INBOUND,
      );
      expect(result).toBe('body-user@example.com');
    });

    it('returns null when nothing matches', () => {
      const result = extractOriginalRecipient(
        { 'To': INBOUND },
        'No forwarding info here.',
        INBOUND,
      );
      expect(result).toBeNull();
    });
  });
});
