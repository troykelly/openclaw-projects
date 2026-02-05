/**
 * Lexical-based rich text editor for notes.
 * Part of Epic #338, Issues #629, #630, #631, #632, #633, #674
 *
 * Features:
 * - True WYSIWYG editing with Lexical
 * - Markdown import/export
 * - Formatting toolbar
 * - Keyboard shortcuts
 * - Link support
 * - Syntax-highlighted code blocks (#630)
 * - Editable tables (#631)
 * - Mermaid diagram support (#632)
 * - LaTeX math rendering (#633)
 *
 * Security: All HTML output is sanitized with DOMPurify to prevent XSS (#674).
 */

import React, { useCallback, useEffect, useState, useRef } from 'react';
import DOMPurify from 'dompurify';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin';
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  TRANSFORMERS,
} from '@lexical/markdown';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { ListNode, ListItemNode } from '@lexical/list';
import { LinkNode, AutoLinkNode } from '@lexical/link';
import {
  CodeNode,
  CodeHighlightNode,
  registerCodeHighlighting,
  $createCodeNode,
} from '@lexical/code';
import {
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  UNDO_COMMAND,
  REDO_COMMAND,
  EditorState,
} from 'lexical';
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
} from '@lexical/list';
import { $setBlocksType } from '@lexical/selection';
import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text';
import { TOGGLE_LINK_COMMAND } from '@lexical/link';
import {
  TableNode,
  TableRowNode,
  TableCellNode,
  INSERT_TABLE_COMMAND,
} from '@lexical/table';
import { TablePlugin } from '@lexical/react/LexicalTablePlugin';
// Mermaid is loaded dynamically to reduce initial bundle size (~1MB).
// See #685 for rationale: most users don't use diagrams, so we lazy load.
import type mermaidType from 'mermaid';
import katex from 'katex';
/**
 * KaTeX CSS (~25KB) is loaded globally when the editor component is first imported.
 * This is an acceptable trade-off for the following reasons (#687):
 *
 * 1. The editor component is only loaded on notes pages (route-level code splitting)
 * 2. Lazy loading CSS would cause layout shifts/FOUC when math content renders
 * 3. The size is small compared to other dependencies (e.g., Mermaid ~1MB)
 * 4. KaTeX styles are namespaced with .katex prefix, minimizing global CSS conflicts
 *
 * Alternative considered: Dynamic CSS injection when math is detected, but this
 * would cause visible layout shifts as equations re-render after styles load.
 */
import 'katex/dist/katex.min.css';
import hljs from 'highlight.js/lib/core';
// Import common languages for syntax highlighting
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';

// Register languages
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('go', go);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('css', css);

/**
 * Lazy-loaded Mermaid instance.
 * Mermaid.js is ~1MB and includes D3.js and many sub-dependencies.
 * Most users don't use diagrams, so we lazy load it only when needed (#685).
 * The promise is cached so subsequent calls return the same instance.
 */
let mermaidPromise: Promise<typeof mermaidType> | null = null;
let mermaidInitialized = false;

async function getMermaid(): Promise<typeof mermaidType> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => m.default);
  }
  const mermaid = await mermaidPromise;
  if (!mermaidInitialized) {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'default',
      securityLevel: 'strict', // Prevent XSS
      fontFamily: 'inherit',
    });
    mermaidInitialized = true;
  }
  return mermaid;
}

import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  Quote,
  Link,
  Heading1,
  Heading2,
  Heading3,
  Undo,
  Redo,
  Eye,
  Edit,
  Save,
  Loader2,
  Code,
  FileCode,
  Table,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/ui/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog';
import { Input } from '@/ui/components/ui/input';
import { Label } from '@/ui/components/ui/label';

export type EditorMode = 'wysiwyg' | 'markdown' | 'preview';

export interface LexicalEditorProps {
  initialContent?: string;
  onChange?: (content: string) => void;
  onSave?: (content: string) => Promise<void>;
  readOnly?: boolean;
  mode?: EditorMode;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  saving?: boolean;
}

interface ToolbarButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}

function ToolbarButton({ icon, label, onClick, active, disabled }: ToolbarButtonProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant={active ? 'secondary' : 'ghost'}
            size="sm"
            onClick={onClick}
            disabled={disabled}
            className="h-8 w-8 p-0"
          >
            {icon}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function ToolbarSeparator() {
  return <div className="w-px h-6 bg-border mx-1" />;
}

/**
 * Allowed URL protocols for link insertion.
 * Only http, https, mailto, and tel are considered safe.
 */
const ALLOWED_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:'];

/**
 * Validate a URL for safe link insertion.
 * Returns an error message if invalid, or null if valid.
 */
function validateUrl(url: string): string | null {
  if (!url.trim()) {
    return 'Please enter a URL';
  }

  try {
    const parsedUrl = new URL(url);

    if (!ALLOWED_PROTOCOLS.includes(parsedUrl.protocol)) {
      return `Only ${ALLOWED_PROTOCOLS.map(p => p.replace(':', '')).join(', ')} links are allowed`;
    }

    return null;
  } catch {
    // If URL constructor fails, try adding https:// prefix
    try {
      const urlWithProtocol = `https://${url}`;
      const parsedUrl = new URL(urlWithProtocol);

      if (!ALLOWED_PROTOCOLS.includes(parsedUrl.protocol)) {
        return `Only ${ALLOWED_PROTOCOLS.map(p => p.replace(':', '')).join(', ')} links are allowed`;
      }

      return null;
    } catch {
      return 'Please enter a valid URL';
    }
  }
}

/**
 * Normalize a URL for insertion.
 * Adds https:// prefix if no protocol is provided.
 */
function normalizeUrl(url: string): string {
  const trimmed = url.trim();

  // Check if URL already has a protocol
  if (/^[a-z]+:/i.test(trimmed)) {
    return trimmed;
  }

  // Add https:// prefix for URLs without protocol
  return `https://${trimmed}`;
}

/**
 * Dialog for inserting links with URL validation.
 * Addresses issues #675 (replace prompt()) and #678 (URL validation).
 */
function LinkDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (url: string) => void;
}): React.JSX.Element {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when dialog opens
  useEffect(() => {
    if (open) {
      setUrl('');
      setError(null);
      // Small delay to ensure dialog is mounted
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const validationError = validateUrl(url);
    if (validationError) {
      setError(validationError);
      return;
    }

    const normalizedUrl = normalizeUrl(url);
    onSubmit(normalizedUrl);
    onOpenChange(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Insert Link</DialogTitle>
          <DialogDescription>
            Enter a URL to create a link. Supported protocols: http, https, mailto, tel.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="link-url">URL</Label>
              <Input
                id="link-url"
                ref={inputRef}
                type="text"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setError(null);
                }}
                onKeyDown={handleKeyDown}
                placeholder="https://example.com"
                aria-invalid={error ? 'true' : 'false'}
                aria-describedby={error ? 'link-url-error' : undefined}
              />
              {error && (
                <p id="link-url-error" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Insert Link</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Dialog for inserting tables with row/column input.
 * Addresses issue #683 (replace prompt() for table insertion).
 */
function TableDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (rows: number, columns: number) => void;
}): React.JSX.Element {
  const [rows, setRows] = useState('3');
  const [columns, setColumns] = useState('3');
  const [error, setError] = useState<string | null>(null);
  const rowsInputRef = useRef<HTMLInputElement>(null);

  // Focus input when dialog opens
  useEffect(() => {
    if (open) {
      setRows('3');
      setColumns('3');
      setError(null);
      setTimeout(() => rowsInputRef.current?.focus(), 50);
    }
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const rowCount = parseInt(rows, 10);
    const colCount = parseInt(columns, 10);

    if (isNaN(rowCount) || rowCount < 1 || rowCount > 50) {
      setError('Rows must be a number between 1 and 50');
      return;
    }

    if (isNaN(colCount) || colCount < 1 || colCount > 20) {
      setError('Columns must be a number between 1 and 20');
      return;
    }

    onSubmit(rowCount, colCount);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Insert Table</DialogTitle>
          <DialogDescription>
            Choose the number of rows and columns for your table.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="table-rows">Rows</Label>
                <Input
                  id="table-rows"
                  ref={rowsInputRef}
                  type="number"
                  min={1}
                  max={50}
                  value={rows}
                  onChange={(e) => {
                    setRows(e.target.value);
                    setError(null);
                  }}
                  placeholder="3"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="table-columns">Columns</Label>
                <Input
                  id="table-columns"
                  type="number"
                  min={1}
                  max={20}
                  value={columns}
                  onChange={(e) => {
                    setColumns(e.target.value);
                    setError(null);
                  }}
                  placeholder="3"
                />
              </div>
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            {/* Visual preview */}
            <div className="mt-2">
              <p className="text-sm text-muted-foreground mb-2">Preview:</p>
              <div
                className="grid gap-0.5 max-w-[200px]"
                style={{
                  gridTemplateColumns: `repeat(${Math.min(parseInt(columns) || 3, 10)}, 1fr)`
                }}
              >
                {Array.from({ length: Math.min((parseInt(rows) || 3) * (parseInt(columns) || 3), 100) }).map((_, i) => (
                  <div
                    key={i}
                    className={`h-4 border border-border ${i < (parseInt(columns) || 3) ? 'bg-muted' : ''}`}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Insert Table</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Render LaTeX math expression using KaTeX.
 * Returns HTML string or error message for invalid LaTeX.
 *
 * @param latex - The LaTeX expression to render
 * @param displayMode - true for block math ($$...$$), false for inline ($...$)
 */
function renderMath(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: false, // Prevent potentially dangerous commands
      output: 'html',
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Invalid LaTeX';
    const escapedLatex = latex
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<span class="math-error text-destructive bg-destructive/10 px-1 rounded" title="${errorMessage}">${escapedLatex}</span>`;
  }
}

/**
 * Highlight code using highlight.js.
 * Returns highlighted HTML or escaped plain text if language not supported.
 */
function highlightCode(code: string, language?: string): string {
  const trimmedCode = code.trim();
  const escapedCode = trimmedCode
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  if (!language) {
    // Try auto-detection
    try {
      const result = hljs.highlightAuto(trimmedCode);
      return result.value;
    } catch {
      return escapedCode;
    }
  }

  // Try highlighting with specified language
  try {
    const result = hljs.highlight(trimmedCode, { language: language.toLowerCase() });
    return result.value;
  } catch {
    // Language not supported, return escaped plain text
    return escapedCode;
  }
}

/**
 * DOMPurify configuration for sanitizing HTML output.
 * Allows safe HTML tags for markdown rendering while stripping dangerous content.
 * Issue #674: Prevents XSS attacks via dangerouslySetInnerHTML.
 */
const DOMPURIFY_CONFIG: DOMPurify.Config = {
  ALLOWED_TAGS: [
    // Text formatting
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'div',
    'strong', 'em', 'del', 'u', 'sub', 'sup',
    // Lists
    'ul', 'ol', 'li',
    // Code
    'pre', 'code',
    // Tables
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    // Other
    'blockquote', 'a', 'br', 'hr',
  ],
  ALLOWED_ATTR: [
    'href', 'class', 'id',
    // Table attributes
    'colspan', 'rowspan',
    // Accessibility attributes
    'role', 'aria-label', 'title',
    // Mermaid diagram data attribute (safe - stored as text, not executed as HTML)
    'data-mermaid',
  ],
  // Allow data-* attributes pattern for Mermaid and other safe data attributes
  ADD_ATTR: ['data-mermaid'],
  // Only allow safe URL protocols for links
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  // Explicitly forbid dangerous event handlers
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
  FORBID_TAGS: ['script', 'style', 'iframe', 'form', 'input', 'button', 'select', 'textarea', 'object', 'embed'],
};

/**
 * Sanitize HTML to prevent XSS attacks.
 * Uses DOMPurify with a strict configuration for markdown-rendered content.
 */
function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, DOMPURIFY_CONFIG);
}

/**
 * Simple markdown to HTML conversion for preview mode.
 * Output is sanitized with DOMPurify before rendering (#674).
 */
function markdownToHtml(markdown: string): string {
  // First, extract and process code blocks to prevent them from being escaped
  const codeBlocks: Array<{ placeholder: string; html: string }> = [];
  const mermaidBlocks: Array<{ placeholder: string; code: string }> = [];
  const mathBlocks: Array<{ placeholder: string; html: string }> = [];
  let blockIndex = 0;
  let mermaidIndex = 0;
  let mathBlockIndex = 0;
  let inlineMathIndex = 0;

  // Extract block math ($$...$$) first - must come before code block extraction
  // to prevent $$ inside code blocks from being processed
  let html = markdown.replace(/\$\$([\s\S]*?)\$\$/g, (_, latex) => {
    const placeholder = `__MATH_BLOCK_${mathBlockIndex++}__`;
    const renderedMath = renderMath(latex.trim(), true);
    mathBlocks.push({
      placeholder,
      html: `<div class="math-block my-4 flex justify-center" role="math" aria-label="mathematical equation">${renderedMath}</div>`,
    });
    return placeholder;
  });

  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
    // Handle Mermaid diagrams separately
    if (lang?.toLowerCase() === 'mermaid') {
      const placeholder = `__MERMAID_BLOCK_${mermaidIndex++}__`;
      mermaidBlocks.push({ placeholder, code: code.trim() });
      return placeholder;
    }

    const placeholder = `__CODE_BLOCK_${blockIndex++}__`;
    const highlightedCode = highlightCode(code, lang);
    const langLabel = lang ? `<span class="text-xs text-muted-foreground absolute top-2 right-2">${lang}</span>` : '';
    codeBlocks.push({
      placeholder,
      html: `<div class="relative group my-3"><pre class="bg-muted p-3 rounded-md overflow-x-auto"><code class="text-sm hljs">${highlightedCode}</code></pre>${langLabel}</div>`,
    });
    return placeholder;
  });

  // Extract and process markdown tables
  // Table format: | Header 1 | Header 2 | \n |---|---| \n | Cell 1 | Cell 2 |
  const tables: Array<{ placeholder: string; html: string }> = [];
  let tableIndex = 0;

  // Add a trailing newline to help with regex matching, will be trimmed later
  const normalizedHtml = html + '\n';
  html = normalizedHtml.replace(/(\|[^\n]+\|\n\|[-:\s|]+\|\n(?:\|[^\n]+\|(?:\n|$))+)/g, (tableContent) => {
    const lines = tableContent.trim().split('\n');
    if (lines.length < 2) return tableContent;

    // Check if second line is separator (|---|---|)
    const separatorLine = lines[1];
    if (!separatorLine.match(/^\|[-:\s|]+\|$/)) return tableContent;

    const placeholder = `__TABLE_${tableIndex++}__`;
    let tableHtml = '<table class="border-collapse border border-border my-4 w-full">';

    // Parse header row
    const headerCells = lines[0].split('|').filter(cell => cell.trim() !== '');
    tableHtml += '<thead><tr class="border-b border-border">';
    for (const cell of headerCells) {
      tableHtml += `<th class="bg-muted font-semibold border border-border p-2 text-sm text-left">${cell.trim()}</th>`;
    }
    tableHtml += '</tr></thead>';

    // Parse data rows (skip separator line)
    tableHtml += '<tbody>';
    for (let i = 2; i < lines.length; i++) {
      const cells = lines[i].split('|').filter(cell => cell.trim() !== '');
      if (cells.length > 0) {
        tableHtml += '<tr class="border-b border-border">';
        for (const cell of cells) {
          tableHtml += `<td class="border border-border p-2 text-sm">${cell.trim()}</td>`;
        }
        tableHtml += '</tr>';
      }
    }
    tableHtml += '</tbody></table>';

    tables.push({ placeholder, html: tableHtml });
    return '\n' + placeholder + '\n';
  }).trim();

  // Extract inline math ($...$) - must be after code blocks to avoid processing $ in code
  // Use a regex that matches single $ but not $$ (which is block math)
  // Also avoid matching $ at start/end of words that might be currency
  html = html.replace(/(?<!\$)\$(?!\$)([^$\n]+?)(?<!\$)\$(?!\$)/g, (_, latex) => {
    const placeholder = `__MATH_INLINE_${inlineMathIndex++}__`;
    const renderedMath = renderMath(latex.trim(), false);
    mathBlocks.push({
      placeholder,
      html: `<span class="math-inline" role="math" aria-label="mathematical equation">${renderedMath}</span>`,
    });
    return placeholder;
  });

  // Now escape remaining HTML
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Headers
  html = html.replace(/^### (.*$)/gm, '<h3 class="text-lg font-semibold mt-4 mb-2">$1</h3>');
  html = html.replace(/^## (.*$)/gm, '<h2 class="text-xl font-semibold mt-6 mb-2">$1</h2>');
  html = html.replace(/^# (.*$)/gm, '<h1 class="text-2xl font-bold mt-6 mb-3">$1</h1>');

  // Bold, Italic, Strikethrough
  html = html.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  html = html.replace(/~~(.*?)~~/g, '<del>$1</del>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="bg-muted px-1 py-0.5 rounded text-sm font-mono">$1</code>');

  // Blockquotes
  html = html.replace(/^&gt; (.*$)/gm, '<blockquote class="border-l-4 border-muted-foreground/30 pl-4 my-2 italic">$1</blockquote>');

  // Lists
  html = html.replace(/^\* (.*$)/gm, '<li class="ml-4">$1</li>');
  html = html.replace(/^\d+\. (.*$)/gm, '<li class="ml-4 list-decimal">$1</li>');

  // Paragraphs
  html = html.replace(/\n\n/g, '</p><p class="my-2">');
  html = `<p class="my-2">${html}</p>`;

  // Restore code blocks
  for (const block of codeBlocks) {
    html = html.replace(block.placeholder, block.html);
  }

  // Restore tables
  for (const table of tables) {
    html = html.replace(table.placeholder, table.html);
  }

  // Restore mermaid blocks with placeholder div for rendering
  // The actual rendering happens in MermaidRenderer component
  for (const block of mermaidBlocks) {
    const escapedCode = block.code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    html = html.replace(
      block.placeholder,
      `<div class="mermaid-diagram my-4" data-mermaid="${escapedCode}"><div class="mermaid-placeholder bg-muted p-4 rounded-md text-center text-muted-foreground">Loading diagram...</div></div>`
    );
  }

  // Restore math blocks (already rendered by KaTeX)
  for (const block of mathBlocks) {
    html = html.replace(block.placeholder, block.html);
  }

  return html;
}

/** Toolbar plugin that provides formatting controls. */
function ToolbarPlugin({
  onSave,
  saving,
}: {
  onSave?: () => void;
  saving?: boolean;
}): React.JSX.Element {
  const [editor] = useLexicalComposerContext();
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const [isStrikethrough, setIsStrikethrough] = useState(false);

  // Dialog state
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [tableDialogOpen, setTableDialogOpen] = useState(false);

  // Update toolbar state based on selection
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          setIsBold(selection.hasFormat('bold'));
          setIsItalic(selection.hasFormat('italic'));
          setIsUnderline(selection.hasFormat('underline'));
          setIsStrikethrough(selection.hasFormat('strikethrough'));
        }
      });
    });
  }, [editor]);

  const formatBold = () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold');
  const formatItalic = () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic');
  const formatUnderline = () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline');
  const formatStrikethrough = () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'strikethrough');

  const formatHeading = (level: 'h1' | 'h2' | 'h3') => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createHeadingNode(level));
      }
    });
  };

  const formatBulletList = () => {
    editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
  };

  const formatNumberedList = () => {
    editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
  };

  const formatQuote = () => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createQuoteNode());
      }
    });
  };

  const handleLinkSubmit = useCallback((url: string) => {
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
  }, [editor]);

  const insertCodeBlock = () => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createCodeNode('javascript'));
      }
    });
  };

  const handleTableSubmit = useCallback((rows: number, columns: number) => {
    editor.dispatchCommand(INSERT_TABLE_COMMAND, {
      rows: rows.toString(),
      columns: columns.toString(),
      includeHeaders: true,
    });
  }, [editor]);

  const undo = () => editor.dispatchCommand(UNDO_COMMAND, undefined);
  const redo = () => editor.dispatchCommand(REDO_COMMAND, undefined);

  return (
    <div className="flex items-center gap-1 p-2 border-b bg-muted/30 flex-wrap">
      <ToolbarButton
        icon={<Undo className="h-4 w-4" />}
        label="Undo (Ctrl+Z)"
        onClick={undo}
      />
      <ToolbarButton
        icon={<Redo className="h-4 w-4" />}
        label="Redo (Ctrl+Y)"
        onClick={redo}
      />

      <ToolbarSeparator />

      <ToolbarButton
        icon={<Bold className="h-4 w-4" />}
        label="Bold (Ctrl+B)"
        onClick={formatBold}
        active={isBold}
      />
      <ToolbarButton
        icon={<Italic className="h-4 w-4" />}
        label="Italic (Ctrl+I)"
        onClick={formatItalic}
        active={isItalic}
      />
      <ToolbarButton
        icon={<Underline className="h-4 w-4" />}
        label="Underline (Ctrl+U)"
        onClick={formatUnderline}
        active={isUnderline}
      />
      <ToolbarButton
        icon={<Strikethrough className="h-4 w-4" />}
        label="Strikethrough"
        onClick={formatStrikethrough}
        active={isStrikethrough}
      />

      <ToolbarSeparator />

      <ToolbarButton
        icon={<Heading1 className="h-4 w-4" />}
        label="Heading 1"
        onClick={() => formatHeading('h1')}
      />
      <ToolbarButton
        icon={<Heading2 className="h-4 w-4" />}
        label="Heading 2"
        onClick={() => formatHeading('h2')}
      />
      <ToolbarButton
        icon={<Heading3 className="h-4 w-4" />}
        label="Heading 3"
        onClick={() => formatHeading('h3')}
      />

      <ToolbarSeparator />

      <ToolbarButton
        icon={<List className="h-4 w-4" />}
        label="Bullet List"
        onClick={formatBulletList}
      />
      <ToolbarButton
        icon={<ListOrdered className="h-4 w-4" />}
        label="Numbered List"
        onClick={formatNumberedList}
      />
      <ToolbarButton
        icon={<Quote className="h-4 w-4" />}
        label="Quote"
        onClick={formatQuote}
      />
      <ToolbarButton
        icon={<Link className="h-4 w-4" />}
        label="Insert Link"
        onClick={() => setLinkDialogOpen(true)}
      />
      <ToolbarButton
        icon={<FileCode className="h-4 w-4" />}
        label="Code Block"
        onClick={insertCodeBlock}
      />
      <ToolbarButton
        icon={<Table className="h-4 w-4" />}
        label="Insert Table"
        onClick={() => setTableDialogOpen(true)}
      />

      <div className="flex-1" />

      {onSave && (
        <>
          <ToolbarSeparator />
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={onSave}
            disabled={saving}
            className="h-8"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-1" />
            )}
            Save
          </Button>
        </>
      )}

      {/* Dialogs */}
      <LinkDialog
        open={linkDialogOpen}
        onOpenChange={setLinkDialogOpen}
        onSubmit={handleLinkSubmit}
      />
      <TableDialog
        open={tableDialogOpen}
        onOpenChange={setTableDialogOpen}
        onSubmit={handleTableSubmit}
      />
    </div>
  );
}

/** Plugin to initialize editor with markdown content. */
function InitialContentPlugin({
  initialContent,
}: {
  initialContent: string;
}): null {
  const [editor] = useLexicalComposerContext();
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (initialized || !initialContent) return;

    editor.update(() => {
      $convertFromMarkdownString(initialContent, TRANSFORMERS);
    });
    setInitialized(true);
  }, [editor, initialContent, initialized]);

  return null;
}

/** Plugin to sync content changes and handle save shortcut. */
function ContentSyncPlugin({
  onChange,
  onSave,
}: {
  onChange?: (content: string) => void;
  onSave?: () => void;
}): React.JSX.Element {
  const [editor] = useLexicalComposerContext();

  // Handle Ctrl+S for save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        onSave?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onSave]);

  // Export to markdown on change
  const handleChange = useCallback(
    (editorState: EditorState) => {
      editorState.read(() => {
        const markdown = $convertToMarkdownString(TRANSFORMERS);
        onChange?.(markdown);
      });
    },
    [onChange]
  );

  return (
    <OnChangePlugin onChange={handleChange} ignoreSelectionChange />
  );
}

/** Plugin to auto-focus the editor. */
function AutoFocusPlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    editor.focus();
  }, [editor]);

  return null;
}

/** Plugin to enable code highlighting in code blocks. */
function CodeHighlightPlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return registerCodeHighlighting(editor);
  }, [editor]);

  return null;
}

/** Lexical theme for styling editor content. */
const theme = {
  ltr: 'text-left',
  rtl: 'text-right',
  paragraph: 'mb-2',
  quote: 'border-l-4 border-muted-foreground/30 pl-4 my-2 italic',
  heading: {
    h1: 'text-2xl font-bold mt-6 mb-3',
    h2: 'text-xl font-semibold mt-6 mb-2',
    h3: 'text-lg font-semibold mt-4 mb-2',
    h4: 'text-base font-semibold mt-4 mb-1',
    h5: 'text-sm font-semibold mt-3 mb-1',
    h6: 'text-sm font-semibold mt-3 mb-1',
  },
  list: {
    nested: {
      listitem: 'ml-4',
    },
    ol: 'list-decimal ml-4',
    ul: 'list-disc ml-4',
    listitem: 'my-1',
  },
  link: 'text-primary underline cursor-pointer hover:text-primary/80',
  text: {
    bold: 'font-bold',
    italic: 'italic',
    underline: 'underline',
    strikethrough: 'line-through',
    code: 'bg-muted px-1 py-0.5 rounded text-sm font-mono',
  },
  code: 'bg-muted p-3 rounded-md overflow-x-auto my-3 font-mono text-sm block',
  // Table styling
  table: 'border-collapse border border-border my-4 w-full',
  tableRow: 'border-b border-border',
  tableCell: 'border border-border p-2 text-sm',
  tableCellHeader: 'bg-muted font-semibold border border-border p-2 text-sm',
  // Code highlight token classes for Prism/Lexical syntax highlighting
  codeHighlight: {
    atrule: 'text-purple-600 dark:text-purple-400',
    attr: 'text-yellow-600 dark:text-yellow-400',
    boolean: 'text-purple-600 dark:text-purple-400',
    builtin: 'text-cyan-600 dark:text-cyan-400',
    cdata: 'text-gray-500 dark:text-gray-400',
    char: 'text-green-600 dark:text-green-400',
    class: 'text-yellow-600 dark:text-yellow-400',
    'class-name': 'text-yellow-600 dark:text-yellow-400',
    comment: 'text-gray-500 dark:text-gray-400 italic',
    constant: 'text-purple-600 dark:text-purple-400',
    deleted: 'text-red-600 dark:text-red-400',
    doctype: 'text-gray-500 dark:text-gray-400',
    entity: 'text-red-600 dark:text-red-400',
    function: 'text-blue-600 dark:text-blue-400',
    important: 'text-red-600 dark:text-red-400 font-bold',
    inserted: 'text-green-600 dark:text-green-400',
    keyword: 'text-purple-600 dark:text-purple-400',
    namespace: 'text-gray-600 dark:text-gray-400',
    number: 'text-orange-600 dark:text-orange-400',
    operator: 'text-pink-600 dark:text-pink-400',
    prolog: 'text-gray-500 dark:text-gray-400',
    property: 'text-blue-600 dark:text-blue-400',
    punctuation: 'text-gray-600 dark:text-gray-400',
    regex: 'text-orange-600 dark:text-orange-400',
    selector: 'text-green-600 dark:text-green-400',
    string: 'text-green-600 dark:text-green-400',
    symbol: 'text-purple-600 dark:text-purple-400',
    tag: 'text-red-600 dark:text-red-400',
    url: 'text-cyan-600 dark:text-cyan-400',
    variable: 'text-orange-600 dark:text-orange-400',
  },
};

function onError(error: Error): void {
  console.error('[LexicalEditor]', error);
}

/**
 * Escape HTML to prevent XSS when displaying error messages.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Component to render mermaid diagrams after the preview HTML is mounted.
 * Scans for elements with data-mermaid attribute and renders the diagrams.
 *
 * Mermaid is lazy-loaded (~1MB) only when diagrams are detected (#685).
 *
 * Security: Mermaid is configured with securityLevel: 'strict' which sanitizes
 * the SVG output. Error messages are escaped before display.
 */
function MermaidRenderer({ containerRef }: { containerRef: React.RefObject<HTMLDivElement | null> }): null {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const mermaidElements = container.querySelectorAll('[data-mermaid]');
    if (mermaidElements.length === 0) return;

    // Track if component is still mounted for async cleanup
    let isMounted = true;

    // Render each mermaid diagram
    const renderDiagrams = async () => {
      // Lazy load mermaid only when diagrams are present (#685)
      const mermaid = await getMermaid();

      mermaidElements.forEach(async (element, index) => {
        if (!isMounted) return;

        const code = element.getAttribute('data-mermaid');
        if (!code) return;

        // Decode HTML entities
        const decodedCode = code
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"');

        try {
          const id = `mermaid-diagram-${Date.now()}-${index}`;
          // mermaid.render returns sanitized SVG when securityLevel: 'strict' is set
          const { svg } = await mermaid.render(id, decodedCode);

          if (!isMounted) return;

          // Clear placeholder and insert SVG
          while (element.firstChild) {
            element.removeChild(element.firstChild);
          }
          // Create a container for the SVG and set its content
          // The SVG from mermaid.render is already sanitized with securityLevel: 'strict'
          const svgContainer = document.createElement('div');
          svgContainer.className = 'mermaid-svg-container';
          // Using DOMParser to safely parse the SVG
          const parser = new DOMParser();
          const svgDoc = parser.parseFromString(svg, 'image/svg+xml');
          const svgElement = svgDoc.documentElement;
          if (svgElement && svgElement.nodeName === 'svg') {
            svgContainer.appendChild(document.importNode(svgElement, true));
          }
          element.appendChild(svgContainer);
          element.classList.add('mermaid-rendered');
        } catch (error) {
          if (!isMounted) return;

          // Show error message in the placeholder (escaped for safety)
          console.error('[MermaidRenderer]', error);
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';

          // Clear placeholder
          while (element.firstChild) {
            element.removeChild(element.firstChild);
          }

          // Create error display using DOM methods (not innerHTML)
          const errorDiv = document.createElement('div');
          errorDiv.className = 'bg-destructive/10 text-destructive p-4 rounded-md text-sm';

          const strongEl = document.createElement('strong');
          strongEl.textContent = 'Mermaid diagram error:';
          errorDiv.appendChild(strongEl);

          const preEl = document.createElement('pre');
          preEl.className = 'mt-2 text-xs overflow-auto';
          preEl.textContent = errorMessage;
          errorDiv.appendChild(preEl);

          element.appendChild(errorDiv);
          element.classList.add('mermaid-error');
        }
      });
    };

    renderDiagrams();

    return () => {
      isMounted = false;
    };
  }, [containerRef]);

  return null;
}

export function LexicalNoteEditor({
  initialContent = '',
  onChange,
  onSave,
  readOnly = false,
  mode: initialMode = 'wysiwyg',
  placeholder = 'Start writing...',
  autoFocus = false,
  className,
  saving = false,
}: LexicalEditorProps): React.JSX.Element {
  const [mode, setMode] = useState<EditorMode>(initialMode);
  const [markdownContent, setMarkdownContent] = useState(initialContent);
  const previewContainerRef = useRef<HTMLDivElement>(null);

  // Handle markdown textarea changes
  const handleMarkdownChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newContent = e.target.value;
      setMarkdownContent(newContent);
      onChange?.(newContent);
    },
    [onChange]
  );

  // Handle content change from Lexical editor
  const handleLexicalChange = useCallback(
    (content: string) => {
      setMarkdownContent(content);
      onChange?.(content);
    },
    [onChange]
  );

  const handleSave = useCallback(async () => {
    if (onSave) {
      await onSave(markdownContent);
    }
  }, [onSave, markdownContent]);

  // Preview HTML - sanitized with DOMPurify to prevent XSS (#674)
  const previewHtml = mode === 'preview' || readOnly ? sanitizeHtml(markdownToHtml(markdownContent)) : '';

  // Character and word count
  const charCount = markdownContent.length;
  const wordCount = markdownContent.split(/\s+/).filter(Boolean).length;

  // Lexical editor config
  const initialConfig = {
    namespace: 'NoteEditor',
    theme,
    onError,
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, AutoLinkNode, CodeNode, CodeHighlightNode, TableNode, TableRowNode, TableCellNode],
    editable: !readOnly,
  };

  if (readOnly || mode === 'preview') {
    return (
      <div className={cn('flex flex-col border rounded-lg overflow-hidden', className)}>
        {/* HTML is sanitized with DOMPurify - see sanitizeHtml() (#674).
            Mermaid diagrams are rendered separately with securityLevel: 'strict'. */}
        <div
          ref={previewContainerRef}
          className="flex-1 min-h-[300px] p-4 prose prose-sm max-w-none overflow-auto"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
        <MermaidRenderer containerRef={previewContainerRef} />
        <div className="flex items-center justify-between px-4 py-2 border-t text-xs text-muted-foreground bg-muted/20">
          <span>{charCount} characters | {wordCount} words</span>
        </div>
      </div>
    );
  }

  if (mode === 'markdown') {
    return (
      <div className={cn('flex flex-col border rounded-lg overflow-hidden', className)}>
        {/* Simple toolbar for markdown mode */}
        <div className="flex items-center gap-1 p-2 border-b bg-muted/30 flex-wrap">
          <div className="flex items-center gap-1 border rounded-md p-0.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setMode('wysiwyg')}
              className="h-7 px-2 text-xs"
            >
              <Edit className="h-3 w-3 mr-1" />
              Edit
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-7 px-2 text-xs"
            >
              <Code className="h-3 w-3 mr-1" />
              Markdown
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setMode('preview')}
              className="h-7 px-2 text-xs"
            >
              <Eye className="h-3 w-3 mr-1" />
              Preview
            </Button>
          </div>

          <div className="flex-1" />

          {onSave && (
            <>
              <ToolbarSeparator />
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={handleSave}
                disabled={saving}
                className="h-8"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-1" />
                )}
                Save
              </Button>
            </>
          )}
        </div>

        <textarea
          value={markdownContent}
          onChange={handleMarkdownChange}
          placeholder={placeholder}
          className="flex-1 min-h-[300px] p-4 font-mono text-sm bg-background resize-none focus:outline-none"
          autoFocus={autoFocus}
        />

        <div className="flex items-center justify-between px-4 py-2 border-t text-xs text-muted-foreground bg-muted/20">
          <span>{charCount} characters | {wordCount} words</span>
          {saving && <span className="text-primary">Saving...</span>}
        </div>
      </div>
    );
  }

  // WYSIWYG mode with Lexical
  return (
    <div className={cn('flex flex-col border rounded-lg overflow-hidden', className)}>
      <LexicalComposer initialConfig={initialConfig}>
        <ToolbarPlugin onSave={handleSave} saving={saving} />

        {/* Mode switcher in toolbar */}
        <div className="flex items-center justify-end gap-1 px-2 py-1 border-b bg-muted/20">
          <div className="flex items-center gap-1 border rounded-md p-0.5">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-7 px-2 text-xs"
            >
              <Edit className="h-3 w-3 mr-1" />
              Edit
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setMode('markdown')}
              className="h-7 px-2 text-xs"
            >
              <Code className="h-3 w-3 mr-1" />
              Markdown
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setMode('preview')}
              className="h-7 px-2 text-xs"
            >
              <Eye className="h-3 w-3 mr-1" />
              Preview
            </Button>
          </div>
        </div>

        <div className="flex-1 min-h-[300px] overflow-auto relative">
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                className="min-h-[300px] p-4 outline-none prose prose-sm max-w-none"
                aria-placeholder={placeholder}
              />
            }
            placeholder={
              <div className="absolute top-4 left-4 text-muted-foreground pointer-events-none">
                {placeholder}
              </div>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
          <HistoryPlugin />
          <ListPlugin />
          <LinkPlugin />
          <TablePlugin />
          <CodeHighlightPlugin />
          <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
          <InitialContentPlugin initialContent={initialContent} />
          <ContentSyncPlugin onChange={handleLexicalChange} onSave={handleSave} />
          {autoFocus && <AutoFocusPlugin />}
        </div>

        <div className="flex items-center justify-between px-4 py-2 border-t text-xs text-muted-foreground bg-muted/20">
          <span>{charCount} characters | {wordCount} words</span>
          {saving && <span className="text-primary">Saving...</span>}
        </div>
      </LexicalComposer>
    </div>
  );
}
