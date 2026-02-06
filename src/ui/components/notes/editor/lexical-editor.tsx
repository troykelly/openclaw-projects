/**
 * Lexical-based rich text editor for notes.
 * Part of Epic #338, Issues #629, #630, #631, #632, #633, #674, #757
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
 *
 * Issue #757: Refactored into smaller modules for maintainability.
 */

import React, { useCallback, useState, useRef } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin';
import { TRANSFORMERS } from '@lexical/markdown';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { ListNode, ListItemNode } from '@lexical/list';
import { LinkNode, AutoLinkNode } from '@lexical/link';
import { CodeNode, CodeHighlightNode } from '@lexical/code';
import { TableNode, TableRowNode, TableCellNode } from '@lexical/table';
import { TablePlugin } from '@lexical/react/LexicalTablePlugin';
/**
 * KaTeX CSS (~25KB) is loaded globally when the editor component is first imported.
 * This is an acceptable trade-off for the following reasons (#687):
 *
 * 1. The editor component is only loaded on notes pages (route-level code splitting)
 * 2. Lazy loading CSS would cause layout shifts/FOUC when math content renders
 * 3. The size is small compared to other dependencies (e.g., Mermaid ~1MB)
 * 4. KaTeX styles are namespaced with .katex prefix, minimizing global CSS conflicts
 */
import 'katex/dist/katex.min.css';

import { cn } from '@/ui/lib/utils';
import { useDarkMode } from '@/ui/hooks/use-dark-mode';
import { Button } from '@/ui/components/ui/button';
import { Code, Eye, Edit } from 'lucide-react';

// Import modular components
import { theme, onError } from './config/theme';
import { sanitizeHtml } from './utils/sanitize';
import { markdownToHtml } from './utils/markdown-to-html';
import { MermaidRenderer } from './components/mermaid-renderer';
import { ToolbarPlugin } from './plugins/toolbar-plugin';
import { InitialContentPlugin } from './plugins/initial-content-plugin';
import { ContentSyncPlugin } from './plugins/content-sync-plugin';
import { AutoFocusPlugin } from './plugins/auto-focus-plugin';
import { CodeHighlightPlugin } from './plugins/code-highlight-plugin';
import type { LexicalEditorProps, EditorMode } from './types';

// Re-export types for backward compatibility
export type { LexicalEditorProps, EditorMode };

export function LexicalNoteEditor({
  initialContent = '',
  onChange,
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
  // Use dark mode state for Mermaid theme (#686)
  const { isDark } = useDarkMode();

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
        <MermaidRenderer containerRef={previewContainerRef} isDark={isDark} />
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
        <ToolbarPlugin />

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
          <ContentSyncPlugin onChange={handleLexicalChange} />
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
