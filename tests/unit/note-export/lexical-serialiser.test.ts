import { describe, it, expect } from 'vitest';
import { serialiseToHtml, serialiseToMarkdown } from '../../../src/api/note-export/lexical-serialiser.ts';

describe('Lexical Serialiser', () => {
  describe('serialiseToHtml', () => {
    it('returns empty placeholder for null/empty content', async () => {
      expect(await serialiseToHtml('')).toContain('Empty document');
      expect(await serialiseToHtml('   ')).toContain('Empty document');
    });

    it('converts plain markdown to simple HTML (fallback)', async () => {
      const markdown = '# Hello\n\nThis is text.';
      const html = await serialiseToHtml(markdown);
      expect(html).toContain('<h1>');
      expect(html).toContain('Hello');
      expect(html).toContain('<p>');
    });

    it('escapes HTML in markdown fallback', async () => {
      const markdown = 'This has <script>alert("xss")</script>';
      const html = await serialiseToHtml(markdown);
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('handles valid Lexical JSON state', async () => {
      // Minimal valid Lexical state
      const lexicalState = JSON.stringify({
        root: {
          children: [
            {
              children: [
                {
                  detail: 0,
                  format: 0,
                  mode: 'normal',
                  style: '',
                  text: 'Hello World',
                  type: 'text',
                  version: 1,
                },
              ],
              direction: 'ltr',
              format: '',
              indent: 0,
              type: 'paragraph',
              version: 1,
              textFormat: 0,
              textStyle: '',
            },
          ],
          direction: 'ltr',
          format: '',
          indent: 0,
          type: 'root',
          version: 1,
        },
      });

      const html = await serialiseToHtml(lexicalState);
      expect(html).toContain('Hello World');
    });

    it('falls back gracefully on invalid Lexical JSON', async () => {
      const invalid = JSON.stringify({ root: { invalid: true } });
      const html = await serialiseToHtml(invalid);
      // Should not throw, should return something
      expect(typeof html).toBe('string');
    });
  });

  describe('serialiseToMarkdown', () => {
    it('returns empty placeholder for null/empty content', async () => {
      expect(await serialiseToMarkdown('')).toContain('Empty document');
      expect(await serialiseToMarkdown('   ')).toContain('Empty document');
    });

    it('returns plain markdown as-is (non-Lexical content)', async () => {
      const markdown = '# Hello\n\nThis is text.';
      const result = await serialiseToMarkdown(markdown);
      expect(result).toBe(markdown);
    });

    it('handles valid Lexical JSON state', async () => {
      const lexicalState = JSON.stringify({
        root: {
          children: [
            {
              children: [
                {
                  detail: 0,
                  format: 0,
                  mode: 'normal',
                  style: '',
                  text: 'Hello World',
                  type: 'text',
                  version: 1,
                },
              ],
              direction: 'ltr',
              format: '',
              indent: 0,
              type: 'paragraph',
              version: 1,
              textFormat: 0,
              textStyle: '',
            },
          ],
          direction: 'ltr',
          format: '',
          indent: 0,
          type: 'root',
          version: 1,
        },
      });

      const md = await serialiseToMarkdown(lexicalState);
      expect(md).toContain('Hello World');
    });
  });
});
