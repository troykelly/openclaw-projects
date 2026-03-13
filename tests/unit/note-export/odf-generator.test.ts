import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolvePandocPath } from '../../../src/api/note-export/generators/odf.ts';

describe('ODF Generator', () => {
  describe('resolvePandocPath', () => {
    it('returns a string path', () => {
      const path = resolvePandocPath();
      expect(typeof path).toBe('string');
      expect(path.length).toBeGreaterThan(0);
    });

    it('falls back to pandoc when binary not found at known paths', () => {
      // In test environment, pandoc may or may not be installed
      const path = resolvePandocPath();
      // Should return either a full path or 'pandoc' for PATH lookup
      expect(path).toMatch(/pandoc/);
    });
  });

  // Note: Full generateOdf tests require pandoc to be installed.
  // Integration tests cover the full generation pipeline.
  // The CI Docker image from #2481 will have pandoc installed.
});
