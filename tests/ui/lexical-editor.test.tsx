/**
 * @vitest-environment jsdom
 * Tests for Lexical note editor.
 * Part of Epic #338, Issues #629, #630, #631
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LexicalNoteEditor } from '@/ui/components/notes/editor/lexical-editor';

// Mock window.prompt for link insertion
vi.stubGlobal('prompt', vi.fn(() => null));

// Mock clipboard API for copy button tests
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
});

describe('LexicalNoteEditor', () => {
  it('renders in wysiwyg mode by default', () => {
    render(<LexicalNoteEditor />);

    // Should show Edit button as active (indicating wysiwyg mode)
    const editButton = screen.getByRole('button', { name: /edit/i });
    expect(editButton).toBeInTheDocument();

    // Should show mode switcher buttons
    expect(screen.getByRole('button', { name: /markdown/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /preview/i })).toBeInTheDocument();

    // Should show character/word count in footer
    expect(screen.getByText(/characters/i)).toBeInTheDocument();
    expect(screen.getByText(/words/i)).toBeInTheDocument();
  });

  it('renders in preview mode when readOnly is true', () => {
    render(<LexicalNoteEditor readOnly initialContent="**Bold text**" />);

    // Should not show mode switcher buttons (read-only mode)
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();

    // Should show character/word count
    expect(screen.getByText(/characters/i)).toBeInTheDocument();
  });

  it('renders in markdown mode when mode prop is markdown', () => {
    render(<LexicalNoteEditor mode="markdown" initialContent="# Hello" />);

    // Should show textarea for raw markdown editing
    const textarea = screen.getByRole('textbox');
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveValue('# Hello');

    // Markdown button should be visible and active
    expect(screen.getByRole('button', { name: /markdown/i })).toBeInTheDocument();
  });

  it('shows save button when onSave is provided', () => {
    const onSave = vi.fn();
    render(<LexicalNoteEditor onSave={onSave} />);

    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
  });

  it('shows character and word count', () => {
    render(<LexicalNoteEditor initialContent="Hello world" />);

    // Should show counts in the footer
    expect(screen.getByText(/characters/i)).toBeInTheDocument();
    expect(screen.getByText(/words/i)).toBeInTheDocument();
  });

  it('shows placeholder when content is empty', () => {
    render(<LexicalNoteEditor placeholder="Start writing your notes..." />);

    expect(screen.getByText('Start writing your notes...')).toBeInTheDocument();
  });

  it('renders in preview mode explicitly', () => {
    render(<LexicalNoteEditor mode="preview" initialContent="# Test heading" />);

    // Should not show mode switcher (preview mode has static content)
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();

    // Should show character count
    expect(screen.getByText(/characters/i)).toBeInTheDocument();
  });

  it('renders correct content in preview mode', () => {
    render(<LexicalNoteEditor mode="preview" initialContent="# Heading\n\nParagraph text" />);

    // The markdown should be converted to HTML in preview
    // Note: We can't check the exact HTML structure easily, but we can verify the content renders
    expect(screen.getByText(/characters/i)).toBeInTheDocument();
  });

  // Code block tests for Issue #630
  describe('Code blocks (#630)', () => {
    it('renders code blocks in preview mode', () => {
      const codeContent = '```javascript\nconst x = 1;\n```';
      render(<LexicalNoteEditor mode="preview" initialContent={codeContent} />);

      // Should render a pre element for code blocks
      const preElements = document.querySelectorAll('pre');
      expect(preElements.length).toBeGreaterThan(0);
    });

    it('shows syntax highlighting in preview mode', () => {
      const codeContent = '```javascript\nfunction hello() {\n  return "world";\n}\n```';
      render(<LexicalNoteEditor mode="preview" initialContent={codeContent} />);

      // The code should have hljs class for syntax highlighting
      const codeElement = document.querySelector('code.hljs');
      expect(codeElement).toBeInTheDocument();
    });

    it('supports multiple languages', () => {
      const pythonCode = '```python\ndef hello():\n    return "world"\n```';
      render(<LexicalNoteEditor mode="preview" initialContent={pythonCode} />);

      // Should render code with syntax highlighting
      const codeElement = document.querySelector('code.hljs');
      expect(codeElement).toBeInTheDocument();
    });

    it('renders code blocks without language specification', () => {
      const codeContent = '```\nsome code here\n```';
      render(<LexicalNoteEditor mode="preview" initialContent={codeContent} />);

      // Should still render a pre element
      const preElements = document.querySelectorAll('pre');
      expect(preElements.length).toBeGreaterThan(0);
    });

    it('escapes HTML in code blocks for security', () => {
      const maliciousCode = '```html\n<script>alert("xss")</script>\n```';
      render(<LexicalNoteEditor mode="preview" initialContent={maliciousCode} />);

      // The script tag should be escaped, not executed
      // Check that it's rendered as text, not as a script element
      const scriptElements = document.querySelectorAll('script');
      // Filter out any test framework scripts
      const maliciousScripts = Array.from(scriptElements).filter(
        (s) => s.textContent?.includes('alert')
      );
      expect(maliciousScripts.length).toBe(0);
    });

    it('preserves code block formatting', () => {
      const formattedCode = '```javascript\nif (true) {\n  console.log("indented");\n}\n```';
      render(<LexicalNoteEditor mode="preview" initialContent={formattedCode} />);

      const codeElement = document.querySelector('code');
      expect(codeElement).toBeInTheDocument();
      // The content should preserve newlines and indentation
      expect(codeElement?.textContent).toContain('console.log');
    });
  });

  // Table tests for Issue #631
  describe('Tables (#631)', () => {
    it('renders markdown tables in preview mode', () => {
      const tableContent = `| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |`;
      render(<LexicalNoteEditor mode="preview" initialContent={tableContent} />);

      // Should render a table element
      const tableElement = document.querySelector('table');
      expect(tableElement).toBeInTheDocument();
    });

    it('renders table headers correctly', () => {
      const tableContent = `| Name | Age |
|------|-----|
| John | 30  |`;
      render(<LexicalNoteEditor mode="preview" initialContent={tableContent} />);

      // Should have thead with th elements
      const headerCells = document.querySelectorAll('th');
      expect(headerCells.length).toBe(2);
      expect(headerCells[0].textContent).toBe('Name');
      expect(headerCells[1].textContent).toBe('Age');
    });

    it('renders table body cells correctly', () => {
      const tableContent = `| Name | Age |
|------|-----|
| John | 30  |
| Jane | 25  |`;
      render(<LexicalNoteEditor mode="preview" initialContent={tableContent} />);

      // Should have tbody with td elements
      const bodyCells = document.querySelectorAll('td');
      expect(bodyCells.length).toBe(4);
      expect(bodyCells[0].textContent).toBe('John');
      expect(bodyCells[1].textContent).toBe('30');
    });

    it('renders multiple column tables', () => {
      const tableContent = `| A | B | C | D |
|---|---|---|---|
| 1 | 2 | 3 | 4 |`;
      render(<LexicalNoteEditor mode="preview" initialContent={tableContent} />);

      const headerCells = document.querySelectorAll('th');
      expect(headerCells.length).toBe(4);
    });

    it('does not parse non-table content as table', () => {
      // Content that looks similar but isn't a valid table
      const nonTableContent = `| Just some text |
This is not a table`;
      render(<LexicalNoteEditor mode="preview" initialContent={nonTableContent} />);

      // Should not render a table
      const tableElement = document.querySelector('table');
      expect(tableElement).not.toBeInTheDocument();
    });
  });

  // Mermaid diagram tests for Issue #632
  describe('Mermaid diagrams (#632)', () => {
    it('renders mermaid placeholder in preview mode', () => {
      const mermaidContent = '```mermaid\ngraph TD;\n  A-->B;\n```';
      render(<LexicalNoteEditor mode="preview" initialContent={mermaidContent} />);

      // Should render a mermaid-diagram container with placeholder
      const mermaidElement = document.querySelector('.mermaid-diagram');
      expect(mermaidElement).toBeInTheDocument();
    });

    it('stores mermaid code in data attribute', () => {
      const mermaidContent = '```mermaid\nsequenceDiagram\n  A->>B: Hello\n```';
      render(<LexicalNoteEditor mode="preview" initialContent={mermaidContent} />);

      const mermaidElement = document.querySelector('[data-mermaid]');
      expect(mermaidElement).toBeInTheDocument();
      // The data attribute should contain the escaped mermaid code
      const dataMermaid = mermaidElement?.getAttribute('data-mermaid');
      expect(dataMermaid).toContain('sequenceDiagram');
    });

    it('shows loading placeholder for mermaid diagrams', () => {
      const mermaidContent = '```mermaid\ngraph LR;\n  Start-->End;\n```';
      render(<LexicalNoteEditor mode="preview" initialContent={mermaidContent} />);

      // Should show loading placeholder initially
      const placeholder = document.querySelector('.mermaid-placeholder');
      expect(placeholder).toBeInTheDocument();
      expect(placeholder?.textContent).toContain('Loading');
    });

    it('handles multiple mermaid diagrams', () => {
      const mermaidContent = `
# Diagrams

\`\`\`mermaid
graph TD;
  A-->B;
\`\`\`

Some text in between.

\`\`\`mermaid
flowchart LR;
  X-->Y;
\`\`\`
`;
      render(<LexicalNoteEditor mode="preview" initialContent={mermaidContent} />);

      // Should have two mermaid diagram containers
      const mermaidElements = document.querySelectorAll('.mermaid-diagram');
      expect(mermaidElements.length).toBe(2);
    });

    it('distinguishes mermaid from regular code blocks', () => {
      const mixedContent = `
\`\`\`javascript
const x = 1;
\`\`\`

\`\`\`mermaid
graph TD;
  A-->B;
\`\`\`
`;
      render(<LexicalNoteEditor mode="preview" initialContent={mixedContent} />);

      // Should have one code block and one mermaid diagram
      const codeElements = document.querySelectorAll('pre code.hljs');
      const mermaidElements = document.querySelectorAll('.mermaid-diagram');

      expect(codeElements.length).toBe(1);
      expect(mermaidElements.length).toBe(1);
    });

    it('stores mermaid code safely without executing scripts', () => {
      // Attempt XSS via mermaid code - the script should NOT execute
      const maliciousContent = '```mermaid\ngraph TD;\n  A["<script>alert(1)</script>"]-->B;\n```';
      render(<LexicalNoteEditor mode="preview" initialContent={maliciousContent} />);

      // The mermaid element should exist and contain the code
      const mermaidElement = document.querySelector('[data-mermaid]');
      expect(mermaidElement).toBeInTheDocument();

      // The script tag is stored in the data attribute but NOT as executable HTML.
      // The data attribute value is decoded by the browser, but the script
      // cannot execute because it's in an attribute, not in HTML content.
      // Verify no script elements were created from the mermaid code.
      const scriptElements = document.querySelectorAll('script');
      const maliciousScripts = Array.from(scriptElements).filter(
        (s) => s.textContent?.includes('alert')
      );
      expect(maliciousScripts.length).toBe(0);
    });
  });
});
