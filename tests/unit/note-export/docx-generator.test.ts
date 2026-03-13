import { describe, it, expect } from 'vitest';
import { generateDocx } from '../../../src/api/note-export/generators/docx.ts';

describe('DOCX Generator', () => {
  it('generates a valid DOCX buffer from markdown', async () => {
    const buffer = await generateDocx({
      markdown: '# Hello\n\nThis is a test document.',
    });

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);

    // DOCX files are ZIP archives - they start with PK signature
    expect(buffer[0]).toBe(0x50); // 'P'
    expect(buffer[1]).toBe(0x4b); // 'K'
  });

  it('sets document metadata when provided', async () => {
    const buffer = await generateDocx({
      markdown: '# Test',
      metadata: {
        title: 'My Document',
        author: 'Test Author',
      },
    });

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('handles headings at different levels', async () => {
    const markdown = `# H1\n## H2\n### H3\n#### H4\n\nParagraph text.`;
    const buffer = await generateDocx({ markdown });
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('handles bold and italic text', async () => {
    const markdown = `This has **bold** and *italic* text.`;
    const buffer = await generateDocx({ markdown });
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('handles unordered lists', async () => {
    const markdown = `- Item 1\n- Item 2\n- Item 3`;
    const buffer = await generateDocx({ markdown });
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('handles ordered lists', async () => {
    const markdown = `1. First\n2. Second\n3. Third`;
    const buffer = await generateDocx({ markdown });
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('handles code blocks', async () => {
    const markdown = "```js\nconsole.log('hello');\n```";
    const buffer = await generateDocx({ markdown });
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('handles inline code', async () => {
    const markdown = 'Use `const` instead of `var`.';
    const buffer = await generateDocx({ markdown });
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('handles blockquotes', async () => {
    const markdown = '> This is a quote.\n> It has multiple lines.';
    const buffer = await generateDocx({ markdown });
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('handles horizontal rules', async () => {
    const markdown = 'Before\n\n---\n\nAfter';
    const buffer = await generateDocx({ markdown });
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('handles empty markdown', async () => {
    const buffer = await generateDocx({ markdown: '' });
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('handles tables', async () => {
    const markdown = '| Col 1 | Col 2 |\n| --- | --- |\n| A | B |\n| C | D |';
    const buffer = await generateDocx({ markdown });
    expect(buffer.length).toBeGreaterThan(0);
  });
});
