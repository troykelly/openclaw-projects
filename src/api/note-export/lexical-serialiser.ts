/**
 * Lexical state serialisation for export.
 * Part of Epic #2475, Issue #2477.
 *
 * Converts stored Lexical JSON state to HTML or Markdown for document generation.
 * Falls back to treating content as plain markdown when it's not valid Lexical JSON.
 */

import { createHeadlessEditor } from '@lexical/headless';
import { $generateHtmlFromNodes } from '@lexical/html';
import {
  $convertToMarkdownString,
  TRANSFORMERS,
} from '@lexical/markdown';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { ListNode, ListItemNode } from '@lexical/list';
import { CodeNode, CodeHighlightNode } from '@lexical/code';
import { LinkNode, AutoLinkNode } from '@lexical/link';
import { TableNode, TableRowNode, TableCellNode } from '@lexical/table';
import { JSDOM } from 'jsdom';

/** Empty document placeholder HTML */
const EMPTY_HTML = '<p><em>Empty document</em></p>';

/** Empty document placeholder markdown */
const EMPTY_MARKDOWN = '*Empty document*';

/** Lexical node types used in this project */
const EDITOR_NODES = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  CodeNode,
  CodeHighlightNode,
  LinkNode,
  AutoLinkNode,
  TableNode,
  TableRowNode,
  TableCellNode,
];

/**
 * Creates a headless Lexical editor configured with the project's node types.
 */
function createEditor() {
  return createHeadlessEditor({
    nodes: EDITOR_NODES,
    onError: (error) => {
      throw error;
    },
  });
}

/**
 * Checks if a string is valid Lexical JSON state.
 */
function isLexicalState(content: string): boolean {
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' && 'root' in parsed;
  } catch {
    return false;
  }
}

/**
 * Serialises Lexical JSON state to HTML.
 *
 * If the content is not valid Lexical JSON, treats it as plain markdown
 * and wraps each line in a paragraph tag.
 *
 * @param lexicalState - Lexical JSON string or plain markdown
 * @returns HTML string
 */
export async function serialiseToHtml(lexicalState: string): Promise<string> {
  if (!lexicalState || lexicalState.trim() === '') {
    return EMPTY_HTML;
  }

  if (!isLexicalState(lexicalState)) {
    // Treat as plain markdown — simple conversion for fallback
    return markdownToSimpleHtml(lexicalState);
  }

  const editor = createEditor();

  // Set up jsdom for server-side HTML generation
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  // @ts-expect-error — Lexical requires global document for HTML generation
  global.document = dom.window.document;
  // @ts-expect-error — Lexical requires global window for HTML generation
  global.window = dom.window;

  try {
    const editorState = editor.parseEditorState(lexicalState);
    let html = '';

    editorState.read(() => {
      html = $generateHtmlFromNodes(editor);
    });

    return html || EMPTY_HTML;
  } catch {
    // If Lexical parsing fails, fall back to markdown treatment
    return markdownToSimpleHtml(lexicalState);
  } finally {
    // @ts-expect-error — Clean up globals
    delete global.document;
    // @ts-expect-error — Clean up globals
    delete global.window;
  }
}

/**
 * Serialises Lexical JSON state to Markdown.
 *
 * If the content is not valid Lexical JSON, returns it as-is (assumed markdown).
 *
 * @param lexicalState - Lexical JSON string or plain markdown
 * @returns Markdown string
 */
export async function serialiseToMarkdown(lexicalState: string): Promise<string> {
  if (!lexicalState || lexicalState.trim() === '') {
    return EMPTY_MARKDOWN;
  }

  if (!isLexicalState(lexicalState)) {
    // Already markdown, return as-is
    return lexicalState;
  }

  const editor = createEditor();

  try {
    const editorState = editor.parseEditorState(lexicalState);
    let markdown = '';

    editorState.read(() => {
      markdown = $convertToMarkdownString(TRANSFORMERS);
    });

    return markdown || EMPTY_MARKDOWN;
  } catch {
    // If Lexical parsing fails, return the raw content
    return lexicalState;
  }
}

/**
 * Simple markdown to HTML conversion for fallback cases.
 * Not a full markdown parser — handles basic elements.
 */
function markdownToSimpleHtml(markdown: string): string {
  const lines = markdown.split('\n');
  const htmlParts: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Headings
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      htmlParts.push(`<h${level}>${escapeHtml(headingMatch[2])}</h${level}>`);
      continue;
    }

    // Regular paragraph
    htmlParts.push(`<p>${escapeHtml(trimmed)}</p>`);
  }

  return htmlParts.join('\n') || EMPTY_HTML;
}

/** Escapes HTML special characters */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
