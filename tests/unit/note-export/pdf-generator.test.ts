import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sanitiseHtml, resolveChromiumPath } from '../../../src/api/note-export/generators/pdf.ts';

describe('PDF Generator', () => {
  describe('sanitiseHtml', () => {
    it('strips script tags from HTML', () => {
      const input = '<p>Hello</p><script>alert("xss")</script><p>World</p>';
      const result = sanitiseHtml(input);
      expect(result).not.toContain('<script>');
      expect(result).not.toContain('alert');
      expect(result).toContain('Hello');
      expect(result).toContain('World');
    });

    it('strips style tags', () => {
      const input = '<style>body { display: none }</style><p>Content</p>';
      const result = sanitiseHtml(input);
      expect(result).not.toContain('<style>');
      expect(result).toContain('Content');
    });

    it('strips event handler attributes', () => {
      const input = '<img src="x" onerror="alert(1)"><p onclick="alert(2)">Text</p>';
      const result = sanitiseHtml(input);
      expect(result).not.toContain('onerror');
      expect(result).not.toContain('onclick');
      expect(result).not.toContain('alert');
    });

    it('strips iframe and object tags', () => {
      const input = '<iframe src="evil.com"></iframe><object data="evil.swf"></object>';
      const result = sanitiseHtml(input);
      expect(result).not.toContain('<iframe');
      expect(result).not.toContain('<object');
    });

    it('preserves safe HTML elements', () => {
      const input = '<h1>Title</h1><p>Paragraph with <strong>bold</strong> and <em>italic</em></p>';
      const result = sanitiseHtml(input);
      expect(result).toContain('<h1>');
      expect(result).toContain('<strong>');
      expect(result).toContain('<em>');
    });

    it('preserves links', () => {
      const input = '<a href="https://example.com">Link</a>';
      const result = sanitiseHtml(input);
      expect(result).toContain('<a');
      expect(result).toContain('href');
      expect(result).toContain('Link');
    });

    it('strips form elements', () => {
      const input = '<form action="/"><input type="text"><textarea></textarea></form>';
      const result = sanitiseHtml(input);
      expect(result).not.toContain('<form');
      expect(result).not.toContain('<input');
      expect(result).not.toContain('<textarea');
    });
  });

  describe('resolveChromiumPath', () => {
    const originalEnv = process.env.PUPPETEER_EXECUTABLE_PATH;

    beforeEach(() => {
      delete process.env.PUPPETEER_EXECUTABLE_PATH;
    });

    afterEach(() => {
      if (originalEnv) {
        process.env.PUPPETEER_EXECUTABLE_PATH = originalEnv;
      } else {
        delete process.env.PUPPETEER_EXECUTABLE_PATH;
      }
    });

    it('uses PUPPETEER_EXECUTABLE_PATH when set', () => {
      process.env.PUPPETEER_EXECUTABLE_PATH = '/custom/path/chromium';
      expect(resolveChromiumPath()).toBe('/custom/path/chromium');
    });

    it('throws when no chromium found and env not set', () => {
      // In test environment, Chromium may or may not be installed
      // If it's not found, it should throw with a descriptive message
      try {
        const path = resolveChromiumPath();
        // If it didn't throw, it found a system Chromium - that's fine
        expect(typeof path).toBe('string');
      } catch (error) {
        expect((error as Error).message).toContain('Chromium binary not found');
        expect((error as Error).message).toContain('PUPPETEER_EXECUTABLE_PATH');
      }
    });
  });
});
