/**
 * Tests for Content-Disposition header filename sanitization.
 * Part of Issue #612 - Content-Disposition header injection vulnerability.
 *
 * Ensures filenames are properly sanitized before being used in
 * Content-Disposition headers to prevent header injection attacks.
 */

import { describe, it, expect } from 'vitest';
import { sanitizeFilenameForHeader } from '../../src/api/file-storage/sharing.ts';

describe('sanitizeFilenameForHeader', () => {
  describe('quote handling', () => {
    it('escapes double quotes in filename', () => {
      const input = 'file"name.txt';
      const result = sanitizeFilenameForHeader(input);
      expect(result).toBe('file\\"name.txt');
    });

    it('escapes multiple double quotes', () => {
      const input = '"file"name".txt';
      const result = sanitizeFilenameForHeader(input);
      expect(result).toBe('\\"file\\"name\\".txt');
    });

    it('escapes backslashes', () => {
      const input = 'file\\name.txt';
      const result = sanitizeFilenameForHeader(input);
      expect(result).toBe('file\\\\name.txt');
    });

    it('escapes both quotes and backslashes', () => {
      const input = 'file\\"name.txt';
      const result = sanitizeFilenameForHeader(input);
      expect(result).toBe('file\\\\\\"name.txt');
    });
  });

  describe('control character removal', () => {
    it('strips carriage return characters', () => {
      const input = 'file\rname.txt';
      const result = sanitizeFilenameForHeader(input);
      expect(result).toBe('filename.txt');
    });

    it('strips newline characters', () => {
      const input = 'file\nname.txt';
      const result = sanitizeFilenameForHeader(input);
      expect(result).toBe('filename.txt');
    });

    it('strips CRLF sequences', () => {
      const input = 'file\r\nname.txt';
      const result = sanitizeFilenameForHeader(input);
      expect(result).toBe('filename.txt');
    });

    it('strips null bytes', () => {
      const input = 'file\x00name.txt';
      const result = sanitizeFilenameForHeader(input);
      expect(result).toBe('filename.txt');
    });

    it('strips ASCII control characters 0x01-0x1f', () => {
      const input = 'file\x01\x02\x03\x1fname.txt';
      const result = sanitizeFilenameForHeader(input);
      expect(result).toBe('filename.txt');
    });

    it('strips DEL character (0x7f)', () => {
      const input = 'file\x7fname.txt';
      const result = sanitizeFilenameForHeader(input);
      expect(result).toBe('filename.txt');
    });
  });

  describe('header injection prevention', () => {
    it('prevents header injection via CRLF followed by header', () => {
      // Attacker tries to inject a new header
      const input = 'malicious.txt\r\nX-Injected-Header: pwned';
      const result = sanitizeFilenameForHeader(input);
      // Should strip CRLF, leaving the injected header name as part of filename
      expect(result).toBe('malicious.txtX-Injected-Header: pwned');
      expect(result).not.toContain('\r');
      expect(result).not.toContain('\n');
    });

    it('prevents header injection via quote escape', () => {
      // Attacker tries to break out of quoted string
      const input = '"; X-Injected: pwned; filename="safe.txt';
      const result = sanitizeFilenameForHeader(input);
      expect(result).toBe('\\"; X-Injected: pwned; filename=\\"safe.txt');
    });
  });

  describe('normal filenames', () => {
    it('leaves normal filenames unchanged', () => {
      const input = 'document.pdf';
      const result = sanitizeFilenameForHeader(input);
      expect(result).toBe('document.pdf');
    });

    it('preserves spaces in filenames', () => {
      const input = 'my document file.pdf';
      const result = sanitizeFilenameForHeader(input);
      expect(result).toBe('my document file.pdf');
    });

    it('preserves Unicode characters', () => {
      const input = 'documento-espanol-nino.pdf';
      const result = sanitizeFilenameForHeader(input);
      expect(result).toBe('documento-espanol-nino.pdf');
    });

    it('preserves dashes and underscores', () => {
      const input = 'my-file_2024.pdf';
      const result = sanitizeFilenameForHeader(input);
      expect(result).toBe('my-file_2024.pdf');
    });

    it('handles empty string', () => {
      const input = '';
      const result = sanitizeFilenameForHeader(input);
      expect(result).toBe('');
    });
  });

  describe('combined scenarios', () => {
    it('handles multiple issues in same filename', () => {
      // Quotes, backslash, and control characters all present
      const input = 'file"\\\r\nname.txt';
      const result = sanitizeFilenameForHeader(input);
      expect(result).toBe('file\\"\\\\name.txt');
    });
  });
});
