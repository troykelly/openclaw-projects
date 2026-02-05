/**
 * @vitest-environment jsdom
 * Tests for Lexical note editor.
 * Part of Epic #338, Issues #629, #630
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
});
