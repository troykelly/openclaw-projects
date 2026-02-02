/**
 * Tests for email utilities.
 * Part of Issue #203.
 */

import { describe, it, expect } from 'vitest';
import {
  parseEmailAddress,
  normalizeEmail,
  getHeader,
  getMessageId,
  getInReplyTo,
  getReferences,
  createEmailThreadKey,
  stripQuotedContent,
  htmlToPlainText,
  getBestPlainText,
} from '../../src/api/postmark/email-utils.ts';
import type { PostmarkHeader } from '../../src/api/postmark/types.ts';

describe('Email Utils', () => {
  describe('parseEmailAddress', () => {
    it('parses plain email address', () => {
      const result = parseEmailAddress('user@example.com');
      expect(result.email).toBe('user@example.com');
      expect(result.name).toBeNull();
    });

    it('parses "Name <email>" format', () => {
      const result = parseEmailAddress('John Doe <john@example.com>');
      expect(result.email).toBe('john@example.com');
      expect(result.name).toBe('John Doe');
    });

    it('parses "<email>" format', () => {
      const result = parseEmailAddress('<john@example.com>');
      expect(result.email).toBe('john@example.com');
      expect(result.name).toBeNull();
    });

    it('handles quoted names', () => {
      const result = parseEmailAddress('"Jane Doe" <jane@example.com>');
      expect(result.email).toBe('jane@example.com');
      expect(result.name).toBe('Jane Doe');
    });

    it('normalizes email to lowercase', () => {
      const result = parseEmailAddress('User@Example.COM');
      expect(result.email).toBe('user@example.com');
    });

    it('handles whitespace', () => {
      const result = parseEmailAddress('  John Doe  <john@example.com>  ');
      expect(result.email).toBe('john@example.com');
      expect(result.name).toBe('John Doe');
    });
  });

  describe('normalizeEmail', () => {
    it('converts to lowercase', () => {
      expect(normalizeEmail('User@Example.COM')).toBe('user@example.com');
    });

    it('trims whitespace', () => {
      expect(normalizeEmail('  user@example.com  ')).toBe('user@example.com');
    });
  });

  describe('getHeader', () => {
    const headers: PostmarkHeader[] = [
      { Name: 'Message-ID', Value: '<abc123@example.com>' },
      { Name: 'In-Reply-To', Value: '<def456@example.com>' },
      { Name: 'Content-Type', Value: 'text/plain' },
    ];

    it('finds header by name', () => {
      expect(getHeader(headers, 'Message-ID')).toBe('<abc123@example.com>');
    });

    it('is case-insensitive', () => {
      expect(getHeader(headers, 'message-id')).toBe('<abc123@example.com>');
      expect(getHeader(headers, 'MESSAGE-ID')).toBe('<abc123@example.com>');
    });

    it('returns null for missing header', () => {
      expect(getHeader(headers, 'X-Custom-Header')).toBeNull();
    });
  });

  describe('getMessageId', () => {
    it('extracts Message-ID without brackets', () => {
      const headers: PostmarkHeader[] = [
        { Name: 'Message-ID', Value: '<abc123@example.com>' },
      ];
      expect(getMessageId(headers)).toBe('abc123@example.com');
    });

    it('handles Message-Id variant', () => {
      const headers: PostmarkHeader[] = [
        { Name: 'Message-Id', Value: '<abc123@example.com>' },
      ];
      expect(getMessageId(headers)).toBe('abc123@example.com');
    });

    it('returns null when not present', () => {
      expect(getMessageId([])).toBeNull();
    });
  });

  describe('getInReplyTo', () => {
    it('extracts In-Reply-To without brackets', () => {
      const headers: PostmarkHeader[] = [
        { Name: 'In-Reply-To', Value: '<parent123@example.com>' },
      ];
      expect(getInReplyTo(headers)).toBe('parent123@example.com');
    });

    it('returns null when not present', () => {
      expect(getInReplyTo([])).toBeNull();
    });
  });

  describe('getReferences', () => {
    it('extracts space-separated references', () => {
      const headers: PostmarkHeader[] = [
        { Name: 'References', Value: '<ref1@example.com> <ref2@example.com>' },
      ];
      const refs = getReferences(headers);
      expect(refs).toEqual(['ref1@example.com', 'ref2@example.com']);
    });

    it('handles angle brackets in references', () => {
      const headers: PostmarkHeader[] = [
        { Name: 'References', Value: '<ref1@example.com>' },
      ];
      const refs = getReferences(headers);
      expect(refs).toEqual(['ref1@example.com']);
    });

    it('returns empty array when not present', () => {
      expect(getReferences([])).toEqual([]);
    });
  });

  describe('createEmailThreadKey', () => {
    it('uses first reference when available', () => {
      const key = createEmailThreadKey('msg1', 'parent1', ['root1', 'parent1']);
      expect(key).toBe('email:root1');
    });

    it('uses in-reply-to when no references', () => {
      const key = createEmailThreadKey('msg1', 'parent1', []);
      expect(key).toBe('email:parent1');
    });

    it('uses message-id for new thread', () => {
      const key = createEmailThreadKey('msg1', null, []);
      expect(key).toBe('email:msg1');
    });

    it('generates fallback key when no IDs', () => {
      const key = createEmailThreadKey(null, null, []);
      expect(key).toMatch(/^email:\d+-[a-z0-9]+$/);
    });
  });

  describe('stripQuotedContent', () => {
    it('strips "On ... wrote:" style quotes', () => {
      const text = `New content here.

On Mon, Jan 1, 2026 at 10:00 AM John Doe wrote:
> Previous message content`;
      const result = stripQuotedContent(text);
      expect(result).toBe('New content here.');
    });

    it('strips > prefixed lines', () => {
      const text = `New reply.
> Quoted line 1
> Quoted line 2`;
      const result = stripQuotedContent(text);
      expect(result).toBe('New reply.');
    });

    it('preserves non-quoted content', () => {
      const text = 'Just a simple message.';
      expect(stripQuotedContent(text)).toBe('Just a simple message.');
    });
  });

  describe('htmlToPlainText', () => {
    it('removes HTML tags', () => {
      const html = '<p>Hello <strong>World</strong></p>';
      expect(htmlToPlainText(html)).toContain('Hello');
      expect(htmlToPlainText(html)).toContain('World');
      expect(htmlToPlainText(html)).not.toContain('<');
    });

    it('converts br tags to newlines', () => {
      const html = 'Line 1<br>Line 2<br/>Line 3';
      expect(htmlToPlainText(html)).toContain('\n');
    });

    it('decodes HTML entities', () => {
      const html = '&lt;tag&gt; &amp; &quot;quoted&quot;';
      expect(htmlToPlainText(html)).toBe('<tag> & "quoted"');
    });

    it('removes style and script content', () => {
      const html = '<style>body { color: red; }</style><p>Visible</p><script>alert(1)</script>';
      const result = htmlToPlainText(html);
      expect(result).not.toContain('color');
      expect(result).not.toContain('alert');
      expect(result).toContain('Visible');
    });
  });

  describe('getBestPlainText', () => {
    it('prefers TextBody when available', () => {
      const result = getBestPlainText('Plain text', '<p>HTML text</p>');
      expect(result).toBe('Plain text');
    });

    it('falls back to HtmlBody when TextBody is empty', () => {
      const result = getBestPlainText('', '<p>HTML text</p>');
      expect(result).toContain('HTML text');
    });

    it('returns empty string when both are empty', () => {
      expect(getBestPlainText('', '')).toBe('');
      expect(getBestPlainText(undefined, undefined)).toBe('');
    });
  });
});
