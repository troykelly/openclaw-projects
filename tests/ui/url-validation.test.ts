/**
 * Tests for URL parameter validation utilities.
 * Issue #666: URL parameters used without validation
 */
import { describe, it, expect } from 'vitest';
import { isValidUUID, validateUrlParam } from '@/ui/lib/utils';

describe('isValidUUID', () => {
  it('returns true for valid UUID v4', () => {
    expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isValidUUID('6ba7b810-9dad-41d2-80b4-00c04fd430c8')).toBe(true);
    expect(isValidUUID('f47ac10b-58cc-4372-a567-0e02b2c3d479')).toBe(true);
  });

  it('returns true for uppercase UUIDs', () => {
    expect(isValidUUID('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
    expect(isValidUUID('F47AC10B-58CC-4372-A567-0E02B2C3D479')).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(isValidUUID('')).toBe(false);
  });

  it('returns false for non-UUID strings', () => {
    expect(isValidUUID('not-a-uuid')).toBe(false);
    expect(isValidUUID('hello-world')).toBe(false);
    expect(isValidUUID('12345')).toBe(false);
  });

  it('returns false for path traversal attempts', () => {
    expect(isValidUUID('../../admin')).toBe(false);
    expect(isValidUUID('../etc/passwd')).toBe(false);
  });

  it('returns false for script injection attempts', () => {
    expect(isValidUUID('<script>alert(1)</script>')).toBe(false);
    expect(isValidUUID('javascript:alert(1)')).toBe(false);
  });

  it('returns false for UUID-like strings with wrong version', () => {
    // Version 1 UUID (should fail - we only accept v4)
    expect(isValidUUID('550e8400-e29b-11d4-a716-446655440000')).toBe(false);
    // Version 5 UUID (should fail)
    expect(isValidUUID('550e8400-e29b-51d4-a716-446655440000')).toBe(false);
  });

  it('returns false for UUID with wrong variant', () => {
    // Invalid variant (c instead of 8,9,a,b)
    expect(isValidUUID('550e8400-e29b-41d4-c716-446655440000')).toBe(false);
  });

  it('returns false for UUID without dashes', () => {
    expect(isValidUUID('550e8400e29b41d4a716446655440000')).toBe(false);
  });

  it('returns false for partial UUIDs', () => {
    expect(isValidUUID('550e8400-e29b')).toBe(false);
    expect(isValidUUID('550e8400-e29b-41d4-a716')).toBe(false);
  });
});

describe('validateUrlParam', () => {
  it('returns the value for valid UUIDs', () => {
    const validUUID = '550e8400-e29b-41d4-a716-446655440000';
    expect(validateUrlParam(validUUID)).toBe(validUUID);
  });

  it('returns undefined for undefined input', () => {
    expect(validateUrlParam(undefined)).toBeUndefined();
  });

  it('returns undefined for invalid UUIDs', () => {
    expect(validateUrlParam('not-a-uuid')).toBeUndefined();
    expect(validateUrlParam('../../admin')).toBeUndefined();
    expect(validateUrlParam('<script>')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(validateUrlParam('')).toBeUndefined();
  });
});
