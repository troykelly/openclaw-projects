/**
 * Memory validation tests — Issue #2442
 * Tests confidence, tags, content length validation on create and update.
 */

import { describe, it, expect } from 'vitest';
import { validateMemoryFields, isValidMemoryType } from './service.ts';

describe('validateMemoryFields', () => {
  describe('confidence validation', () => {
    it('accepts confidence at 0', () => {
      expect(() => validateMemoryFields({ confidence: 0 })).not.toThrow();
    });

    it('accepts confidence at 1', () => {
      expect(() => validateMemoryFields({ confidence: 1 })).not.toThrow();
    });

    it('accepts confidence at 0.5', () => {
      expect(() => validateMemoryFields({ confidence: 0.5 })).not.toThrow();
    });

    it('rejects confidence below 0', () => {
      expect(() => validateMemoryFields({ confidence: -0.1 })).toThrow('Confidence must be between 0 and 1');
    });

    it('rejects confidence above 1', () => {
      expect(() => validateMemoryFields({ confidence: 1.1 })).toThrow('Confidence must be between 0 and 1');
    });

    it('skips validation when undefined', () => {
      expect(() => validateMemoryFields({})).not.toThrow();
    });
  });

  describe('content length validation', () => {
    it('accepts content within limit', () => {
      expect(() => validateMemoryFields({ content: 'short content' })).not.toThrow();
    });

    it('accepts content at exactly 100KB', () => {
      const content = 'a'.repeat(102400);
      expect(() => validateMemoryFields({ content })).not.toThrow();
    });

    it('rejects content over 100KB', () => {
      const content = 'a'.repeat(102401);
      expect(() => validateMemoryFields({ content })).toThrow('Content exceeds maximum length');
    });
  });

  describe('tag validation', () => {
    it('accepts valid tags', () => {
      expect(() => validateMemoryFields({ tags: ['music', 'food'] })).not.toThrow();
    });

    it('accepts 50 tags (at limit)', () => {
      const tags = Array.from({ length: 50 }, (_, i) => `tag${i}`);
      expect(() => validateMemoryFields({ tags })).not.toThrow();
    });

    it('rejects more than 50 tags', () => {
      const tags = Array.from({ length: 51 }, (_, i) => `tag${i}`);
      expect(() => validateMemoryFields({ tags })).toThrow('Too many tags');
    });

    it('accepts tags at 100 characters', () => {
      const tag = 'a'.repeat(100);
      expect(() => validateMemoryFields({ tags: [tag] })).not.toThrow();
    });

    it('rejects tags over 100 characters', () => {
      const tag = 'a'.repeat(101);
      expect(() => validateMemoryFields({ tags: [tag] })).toThrow('exceeds maximum length');
    });

    it('accepts empty tags array', () => {
      expect(() => validateMemoryFields({ tags: [] })).not.toThrow();
    });
  });
});

describe('isValidMemoryType', () => {
  it('accepts all canonical memory types', () => {
    const validTypes = ['preference', 'fact', 'note', 'decision', 'context', 'reference', 'entity', 'other'];
    for (const type of validTypes) {
      expect(isValidMemoryType(type)).toBe(true);
    }
  });

  it('rejects invalid memory types', () => {
    expect(isValidMemoryType('invalid')).toBe(false);
    expect(isValidMemoryType('')).toBe(false);
    expect(isValidMemoryType('PREFERENCE')).toBe(false);
  });
});
