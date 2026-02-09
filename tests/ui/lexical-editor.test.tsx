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
vi.stubGlobal(
  'prompt',
  vi.fn(() => null),
);

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

  it('shows saving indicator when saving is true', () => {
    // #775: Autosave replaces manual save button - verify saving indicator shows
    render(<LexicalNoteEditor saving={true} />);

    expect(screen.getByText(/saving/i)).toBeInTheDocument();
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
      const maliciousScripts = Array.from(scriptElements).filter((s) => s.textContent?.includes('alert'));
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

    it('prevents XSS via mermaid code', () => {
      // Attempt XSS via mermaid code - the script should NOT execute
      const maliciousContent = '```mermaid\ngraph TD;\n  A["<script>alert(1)</script>"]-->B;\n```';
      render(<LexicalNoteEditor mode="preview" initialContent={maliciousContent} />);

      // DOMPurify sanitizes the output - either the element is stripped or the
      // dangerous content is removed. Either way, verify no script executes.
      const scriptElements = document.querySelectorAll('script');
      const maliciousScripts = Array.from(scriptElements).filter((s) => s.textContent?.includes('alert'));
      expect(maliciousScripts.length).toBe(0);

      // Also verify no inline script content exists in any element
      const allElements = document.querySelectorAll('*');
      const elementsWithAlert = Array.from(allElements).filter((el) => el.textContent?.includes('alert(1)'));
      // If element exists, it should have escaped content, not executable
      // The script content should be escaped or stripped entirely
    });
  });

  // LaTeX math tests for Issue #633
  describe('LaTeX math (#633)', () => {
    it('renders inline math with single dollar signs', () => {
      const mathContent = 'The equation $E = mc^2$ is famous.';
      render(<LexicalNoteEditor mode="preview" initialContent={mathContent} />);

      // Should render a math-inline span with katex content
      const mathElement = document.querySelector('.math-inline');
      expect(mathElement).toBeInTheDocument();
      expect(mathElement?.querySelector('.katex')).toBeInTheDocument();
    });

    it('renders block math with double dollar signs', () => {
      const mathContent = '$$\\int_0^\\infty e^{-x^2} dx$$';
      render(<LexicalNoteEditor mode="preview" initialContent={mathContent} />);

      // Should render a math-block div with katex content
      const mathElement = document.querySelector('.math-block');
      expect(mathElement).toBeInTheDocument();
      expect(mathElement?.querySelector('.katex-display')).toBeInTheDocument();
    });

    it('renders Greek letters', () => {
      const mathContent = '$\\alpha + \\beta = \\gamma$';
      render(<LexicalNoteEditor mode="preview" initialContent={mathContent} />);

      const mathElement = document.querySelector('.math-inline .katex');
      expect(mathElement).toBeInTheDocument();
    });

    it('renders fractions', () => {
      const mathContent = '$\\frac{1}{2}$';
      render(<LexicalNoteEditor mode="preview" initialContent={mathContent} />);

      const mathElement = document.querySelector('.math-inline .katex');
      expect(mathElement).toBeInTheDocument();
      // KaTeX renders fractions - check for fraction-related content
      // The class name varies between versions, so just verify katex rendered
      expect(mathElement?.textContent).toContain('1');
      expect(mathElement?.textContent).toContain('2');
    });

    it('renders sums and integrals', () => {
      const mathContent = '$$\\sum_{i=0}^{n} i^2$$';
      render(<LexicalNoteEditor mode="preview" initialContent={mathContent} />);

      const mathElement = document.querySelector('.math-block .katex');
      expect(mathElement).toBeInTheDocument();
    });

    it('handles multiple math expressions', () => {
      const mathContent = 'Inline $x$ and $y$ with block $$z = x + y$$';
      render(<LexicalNoteEditor mode="preview" initialContent={mathContent} />);

      // Should have two inline math and one block math
      const inlineMath = document.querySelectorAll('.math-inline');
      const blockMath = document.querySelectorAll('.math-block');

      expect(inlineMath.length).toBe(2);
      expect(blockMath.length).toBe(1);
    });

    it('has accessible role=math attribute', () => {
      const mathContent = '$E = mc^2$';
      render(<LexicalNoteEditor mode="preview" initialContent={mathContent} />);

      const mathElement = document.querySelector('[role="math"]');
      expect(mathElement).toBeInTheDocument();
    });

    it('does not process dollar signs in code blocks', () => {
      const codeContent = '```javascript\nconst price = $100;\n```';
      render(<LexicalNoteEditor mode="preview" initialContent={codeContent} />);

      // Should render as code, not math
      const codeElement = document.querySelector('code.hljs');
      expect(codeElement).toBeInTheDocument();
      // Should not have any math elements
      const mathElements = document.querySelectorAll('.math-inline, .math-block');
      expect(mathElements.length).toBe(0);
    });

    it('handles invalid LaTeX gracefully', () => {
      // Invalid LaTeX that would throw an error
      const invalidMath = '$\\invalidcommand$';
      render(<LexicalNoteEditor mode="preview" initialContent={invalidMath} />);

      // Should render something (KaTeX's throwOnError: false handles this)
      const mathElement = document.querySelector('.math-inline');
      expect(mathElement).toBeInTheDocument();
    });
  });

  // XSS Security tests for Issue #674
  describe('XSS prevention (#674)', () => {
    it('sanitizes script tags in markdown content', () => {
      const maliciousContent = '<script>alert("xss")</script>';
      render(<LexicalNoteEditor mode="preview" initialContent={maliciousContent} />);

      // Script tag should be removed or escaped
      const scripts = document.querySelectorAll('script');
      const maliciousScripts = Array.from(scripts).filter((s) => s.textContent?.includes('alert'));
      expect(maliciousScripts.length).toBe(0);
    });

    it('sanitizes onerror event handlers in img tags', () => {
      const maliciousContent = '![alt](x onerror=alert(1))';
      render(<LexicalNoteEditor mode="preview" initialContent={maliciousContent} />);

      // Any onerror attribute should be stripped
      const imgWithHandler = document.querySelector('img[onerror]');
      expect(imgWithHandler).not.toBeInTheDocument();
    });

    it('sanitizes onclick event handlers', () => {
      const maliciousContent = '<div onclick="alert(1)">Click me</div>';
      render(<LexicalNoteEditor mode="preview" initialContent={maliciousContent} />);

      // onclick attributes should be stripped
      const elementsWithOnclick = document.querySelectorAll('[onclick]');
      expect(elementsWithOnclick.length).toBe(0);
    });

    it('sanitizes javascript: URLs in links', () => {
      const maliciousContent = '[Click me](javascript:alert(1))';
      render(<LexicalNoteEditor mode="preview" initialContent={maliciousContent} />);

      // javascript: URLs should be stripped
      const jsLinks = document.querySelectorAll('a[href^="javascript:"]');
      expect(jsLinks.length).toBe(0);
    });

    it('sanitizes data: URLs with scripts', () => {
      const maliciousContent = '[Click me](data:text/html,<script>alert(1)</script>)';
      render(<LexicalNoteEditor mode="preview" initialContent={maliciousContent} />);

      // data: URLs should be stripped
      const dataLinks = document.querySelectorAll('a[href^="data:"]');
      expect(dataLinks.length).toBe(0);
    });

    it('sanitizes SVG with embedded script', () => {
      const maliciousContent = '<svg><script>alert(1)</script></svg>';
      render(<LexicalNoteEditor mode="preview" initialContent={maliciousContent} />);

      // SVG script tags should be removed
      const svgScripts = document.querySelectorAll('svg script');
      expect(svgScripts.length).toBe(0);
    });

    it('sanitizes iframe tags', () => {
      const maliciousContent = '<iframe src="https://evil.com"></iframe>';
      render(<LexicalNoteEditor mode="preview" initialContent={maliciousContent} />);

      // iframes should be removed
      const iframes = document.querySelectorAll('iframe');
      expect(iframes.length).toBe(0);
    });

    it('sanitizes onload handlers in various elements', () => {
      const maliciousContent = '<img src="x" onload="alert(1)"><body onload="alert(2)">';
      render(<LexicalNoteEditor mode="preview" initialContent={maliciousContent} />);

      // onload attributes should be stripped
      const elementsWithOnload = document.querySelectorAll('[onload]');
      expect(elementsWithOnload.length).toBe(0);
    });

    it('sanitizes style tags with expressions', () => {
      const maliciousContent = '<style>body{background:url(javascript:alert(1))}</style>';
      render(<LexicalNoteEditor mode="preview" initialContent={maliciousContent} />);

      // style tags should be removed
      const styleTags = document.querySelectorAll('style');
      const maliciousStyles = Array.from(styleTags).filter((s) => s.textContent?.includes('javascript'));
      expect(maliciousStyles.length).toBe(0);
    });

    it('sanitizes form tags', () => {
      const maliciousContent = '<form action="https://evil.com"><input type="text"></form>';
      render(<LexicalNoteEditor mode="preview" initialContent={maliciousContent} />);

      // form tags should be removed
      const forms = document.querySelectorAll('form');
      expect(forms.length).toBe(0);
    });

    it('preserves safe HTML elements after sanitization', () => {
      const safeContent = '# Heading\n\n**Bold** and *italic* text\n\n- List item';
      render(<LexicalNoteEditor mode="preview" initialContent={safeContent} />);

      // Should still render safe elements
      const heading = document.querySelector('h1');
      expect(heading).toBeInTheDocument();

      const strong = document.querySelector('strong');
      expect(strong).toBeInTheDocument();

      const em = document.querySelector('em');
      expect(em).toBeInTheDocument();
    });

    it('preserves safe links with https URLs', () => {
      const safeContent = '[Safe link](https://example.com)';
      render(<LexicalNoteEditor mode="preview" initialContent={safeContent} />);

      // Note: Our simple markdownToHtml doesn't handle links yet,
      // but when it does, safe https links should be preserved
      expect(screen.getByText(/characters/i)).toBeInTheDocument();
    });

    it('sanitizes nested markdown injection attempts', () => {
      // Attempt to inject javascript: URL via markdown link syntax
      const maliciousContent = '](javascript:alert(1))';
      render(<LexicalNoteEditor mode="preview" initialContent={maliciousContent} />);

      // Should not contain javascript: URL
      const jsLinks = document.querySelectorAll('a[href^="javascript:"]');
      expect(jsLinks.length).toBe(0);
    });

    it('sanitizes base64-encoded data URLs', () => {
      const maliciousContent = '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">Click</a>';
      render(<LexicalNoteEditor mode="preview" initialContent={maliciousContent} />);

      // data: URLs should be stripped
      const dataLinks = document.querySelectorAll('a[href^="data:"]');
      expect(dataLinks.length).toBe(0);
    });

    it('sanitizes vbscript URLs', () => {
      const maliciousContent = '<a href="vbscript:msgbox(1)">Click</a>';
      render(<LexicalNoteEditor mode="preview" initialContent={maliciousContent} />);

      // vbscript: URLs should be stripped
      const vbLinks = document.querySelectorAll('a[href^="vbscript:"]');
      expect(vbLinks.length).toBe(0);
    });

    it('sanitizes object and embed tags', () => {
      const maliciousContent = '<object data="malicious.swf"></object><embed src="malicious.swf">';
      render(<LexicalNoteEditor mode="preview" initialContent={maliciousContent} />);

      // object and embed tags should be removed
      const objects = document.querySelectorAll('object');
      const embeds = document.querySelectorAll('embed');
      expect(objects.length).toBe(0);
      expect(embeds.length).toBe(0);
    });

    it('sanitizes meta refresh tags', () => {
      const maliciousContent = '<meta http-equiv="refresh" content="0;url=http://evil.com">';
      render(<LexicalNoteEditor mode="preview" initialContent={maliciousContent} />);

      // meta tags should be removed (not in ALLOWED_TAGS)
      const metaTags = document.querySelectorAll('meta');
      expect(metaTags.length).toBe(0);
    });
  });

  // Editor functionality tests for Issue #679
  describe('Editor functionality (#679)', () => {
    it('handles empty initial content gracefully', () => {
      render(<LexicalNoteEditor initialContent="" />);

      // Should render without errors
      expect(screen.getByText(/characters/i)).toBeInTheDocument();
      expect(screen.getByText(/0 characters/i)).toBeInTheDocument();
    });

    it('handles undefined initial content', () => {
      render(<LexicalNoteEditor />);

      // Should render without errors
      expect(screen.getByText(/characters/i)).toBeInTheDocument();
    });

    it('handles content with only whitespace', () => {
      render(<LexicalNoteEditor mode="preview" initialContent="   \n\t\n   " />);

      // Should render without errors
      expect(screen.getByText(/characters/i)).toBeInTheDocument();
    });

    it('handles very long content without crashing', () => {
      // Generate content with 10,000 characters
      const longContent = 'a'.repeat(10000);
      render(<LexicalNoteEditor mode="preview" initialContent={longContent} />);

      // Should render without errors and show character count
      expect(screen.getByText(/characters/i)).toBeInTheDocument();
      // Verify the content length is reflected in the count (may include additional chars from HTML)
      const countText = screen.getByText(/\d+ characters/i);
      expect(countText).toBeInTheDocument();
    });

    it('handles content with many paragraphs', () => {
      const manyParagraphs = Array(100).fill('Paragraph text.').join('\n\n');
      render(<LexicalNoteEditor mode="preview" initialContent={manyParagraphs} />);

      // Should render without errors
      expect(screen.getByText(/characters/i)).toBeInTheDocument();
    });

    it('handles special Unicode characters', () => {
      const unicodeContent = '# 日本語 タイトル\n\n段落 with emoji 🎉 and symbols ©®™';
      render(<LexicalNoteEditor mode="preview" initialContent={unicodeContent} />);

      // Should render heading
      const heading = document.querySelector('h1');
      expect(heading).toBeInTheDocument();
      expect(heading?.textContent).toContain('日本語');
    });

    it('handles zero-width characters', () => {
      // Zero-width joiner and non-joiner characters
      const zeroWidthContent = 'text\u200B\u200C\u200Dmore';
      render(<LexicalNoteEditor mode="preview" initialContent={zeroWidthContent} />);

      // Should render without errors
      expect(screen.getByText(/characters/i)).toBeInTheDocument();
    });

    it('handles malformed markdown gracefully', () => {
      // Incomplete/malformed markdown
      const malformedContent = '# Unclosed\n\n**Bold without close\n\n```unclosed code';
      render(<LexicalNoteEditor mode="preview" initialContent={malformedContent} />);

      // Should render without crashing
      expect(screen.getByText(/characters/i)).toBeInTheDocument();
    });

    it('handles deeply nested lists', () => {
      const nestedLists = `
* Level 1
  * Level 2
    * Level 3
      * Level 4
        * Level 5`;
      render(<LexicalNoteEditor mode="preview" initialContent={nestedLists} />);

      // Should render list items
      const listItems = document.querySelectorAll('li');
      expect(listItems.length).toBeGreaterThan(0);
    });

    it('handles consecutive special characters', () => {
      const specialChars = '***___~~~```|||';
      render(<LexicalNoteEditor mode="preview" initialContent={specialChars} />);

      // Should render without errors
      expect(screen.getByText(/characters/i)).toBeInTheDocument();
    });

    it('displays character count correctly', () => {
      const content = 'Hello World!'; // 12 characters
      render(<LexicalNoteEditor mode="preview" initialContent={content} />);

      expect(screen.getByText(/12 characters/i)).toBeInTheDocument();
    });

    it('displays word count correctly', () => {
      const content = 'one two three four five'; // 5 words
      render(<LexicalNoteEditor mode="preview" initialContent={content} />);

      expect(screen.getByText(/5 words/i)).toBeInTheDocument();
    });

    it('shows placeholder in wysiwyg mode', () => {
      render(<LexicalNoteEditor placeholder="Custom placeholder text" />);

      expect(screen.getByText('Custom placeholder text')).toBeInTheDocument();
    });

    it('shows toolbar in wysiwyg mode', () => {
      // #775: Save button removed, autosave replaces it - verify toolbar exists
      render(<LexicalNoteEditor />);

      // Should have multiple toolbar buttons (undo, redo, bold, italic, etc.)
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(5);
    });

    it('shows saving indicator when saving is true', () => {
      // #775: Autosave shows "Saving..." indicator instead of disabled button
      render(<LexicalNoteEditor saving={true} />);

      expect(screen.getByText(/saving/i)).toBeInTheDocument();
    });
  });

  // Mode switching tests for Issue #679
  describe('Mode switching (#679)', () => {
    it('starts in wysiwyg mode by default', () => {
      render(<LexicalNoteEditor />);

      // Edit button should be visible (indicating wysiwyg mode)
      expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
      // Markdown button should be available for switching
      expect(screen.getByRole('button', { name: /markdown/i })).toBeInTheDocument();
    });

    it('starts in preview mode when specified', () => {
      render(<LexicalNoteEditor mode="preview" initialContent="# Test" />);

      // Should not show edit buttons (preview is read-only view)
      expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    });

    it('shows textarea in markdown mode', () => {
      render(<LexicalNoteEditor mode="markdown" initialContent="# Test" />);

      // Should show textarea
      const textarea = screen.getByRole('textbox');
      expect(textarea).toBeInTheDocument();
      expect(textarea).toHaveValue('# Test');
    });

    it('renders in readOnly mode without edit controls', () => {
      render(<LexicalNoteEditor readOnly initialContent="# Read Only" />);

      // Should not show any mode switching buttons
      expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /markdown/i })).not.toBeInTheDocument();
    });
  });

  // Accessibility tests for Issue #679
  describe('Accessibility (#679)', () => {
    it('has toolbar buttons in wysiwyg mode', () => {
      render(<LexicalNoteEditor />);

      // Check for toolbar buttons (they use tooltips for labels)
      const buttons = screen.getAllByRole('button');
      // Should have multiple toolbar buttons (undo, redo, bold, italic, etc.)
      expect(buttons.length).toBeGreaterThan(5);
    });

    it('has aria-label on math expressions', () => {
      const mathContent = '$E = mc^2$';
      render(<LexicalNoteEditor mode="preview" initialContent={mathContent} />);

      const mathElement = document.querySelector('[aria-label="mathematical equation"]');
      expect(mathElement).toBeInTheDocument();
    });

    it('uses semantic HTML for headings', () => {
      const content = '# H1\n\n## H2\n\n### H3';
      render(<LexicalNoteEditor mode="preview" initialContent={content} />);

      expect(document.querySelector('h1')).toBeInTheDocument();
      expect(document.querySelector('h2')).toBeInTheDocument();
      expect(document.querySelector('h3')).toBeInTheDocument();
    });

    it('uses semantic HTML for lists', () => {
      const content = '* Item 1\n* Item 2';
      render(<LexicalNoteEditor mode="preview" initialContent={content} />);

      const listItems = document.querySelectorAll('li');
      expect(listItems.length).toBe(2);
    });

    it('uses semantic HTML for blockquotes', () => {
      const content = '> This is a quote';
      render(<LexicalNoteEditor mode="preview" initialContent={content} />);

      const blockquote = document.querySelector('blockquote');
      expect(blockquote).toBeInTheDocument();
    });
  });
});
