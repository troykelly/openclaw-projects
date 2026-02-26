/**
 * Tests for encryption key validation at worker startup.
 * Issue #1859 — Validate encryption key at worker startup
 */

import { describe, it, expect } from 'vitest';
import { validateEncryptionKey } from '../../src/tmux-worker/config.ts';

describe('validateEncryptionKey', () => {
  it('accepts a valid 64-character hex string', () => {
    const validKey = 'a'.repeat(64);
    const result = validateEncryptionKey(validKey);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('accepts mixed-case hex characters', () => {
    const validKey = 'abcdefABCDEF0123456789aabbccddee00112233445566778899aabbccddeeff';
    expect(validKey.length).toBe(64);
    const result = validateEncryptionKey(validKey);
    expect(result.valid).toBe(true);
  });

  it('rejects an empty string', () => {
    const result = validateEncryptionKey('');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('64-character hex string');
  });

  it('rejects a string that is too short', () => {
    const result = validateEncryptionKey('abcdef');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('64-character hex string');
  });

  it('rejects a string that is too long', () => {
    const result = validateEncryptionKey('a'.repeat(65));
    expect(result.valid).toBe(false);
    expect(result.error).toContain('64-character hex string');
  });

  it('rejects non-hex characters', () => {
    const result = validateEncryptionKey('g'.repeat(64));
    expect(result.valid).toBe(false);
    expect(result.error).toContain('hexadecimal');
  });

  it('rejects strings with spaces', () => {
    const result = validateEncryptionKey(' '.repeat(64));
    expect(result.valid).toBe(false);
    expect(result.error).toContain('hexadecimal');
  });
});
