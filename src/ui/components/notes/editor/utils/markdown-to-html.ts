/**
 * Markdown to HTML conversion for preview mode.
 * Part of Epic #338, Issue #757
 *
 * Output is sanitized with DOMPurify before rendering (#674).
 */

import katex from 'katex';
import { highlightCode } from './highlight';

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
    const escapedLatex = latex.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<span class="math-error text-destructive bg-destructive/10 px-1 rounded" title="${errorMessage}">${escapedLatex}</span>`;
  }
}

/**
 * Simple markdown to HTML conversion for preview mode.
 * Output should be sanitized with DOMPurify before rendering (#674).
 */
export function markdownToHtml(markdown: string): string {
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
  html = normalizedHtml
    .replace(/(\|[^\n]+\|\n\|[-:\s|]+\|\n(?:\|[^\n]+\|(?:\n|$))+)/g, (tableContent) => {
      const lines = tableContent.trim().split('\n');
      if (lines.length < 2) return tableContent;

      // Check if second line is separator (|---|---|)
      const separatorLine = lines[1];
      if (!separatorLine.match(/^\|[-:\s|]+\|$/)) return tableContent;

      const placeholder = `__TABLE_${tableIndex++}__`;
      let tableHtml = '<table class="border-collapse border border-border my-4 w-full">';

      // Parse header row
      const headerCells = lines[0].split('|').filter((cell) => cell.trim() !== '');
      tableHtml += '<thead><tr class="border-b border-border">';
      for (const cell of headerCells) {
        tableHtml += `<th class="bg-muted font-semibold border border-border p-2 text-sm text-left">${cell.trim()}</th>`;
      }
      tableHtml += '</tr></thead>';

      // Parse data rows (skip separator line)
      tableHtml += '<tbody>';
      for (let i = 2; i < lines.length; i++) {
        const cells = lines[i].split('|').filter((cell) => cell.trim() !== '');
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
    })
    .trim();

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
  html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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
    const escapedCode = block.code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    html = html.replace(
      block.placeholder,
      `<div class="mermaid-diagram my-4" data-mermaid="${escapedCode}"><div class="mermaid-placeholder bg-muted p-4 rounded-md text-center text-muted-foreground">Loading diagram...</div></div>`,
    );
  }

  // Restore math blocks (already rendered by KaTeX)
  for (const block of mathBlocks) {
    html = html.replace(block.placeholder, block.html);
  }

  return html;
}
