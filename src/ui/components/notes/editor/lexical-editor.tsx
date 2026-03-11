/**
 * Lexical-based rich text editor for notes.
 * Part of Epic #338, Issues #629, #630, #631, #632, #633, #674, #757, #2256, #2343
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
 * - Yjs collaborative editing (#2256)
 * - Markdown/preview mode switching during Yjs collaboration (#2343)
 *
 * Security: All HTML output is sanitized with DOMPurify to prevent XSS (#674).
 *
 * Issue #757: Refactored into smaller modules for maintainability.
 * Issue #2256: When yjsEnabled, CollaborationPlugin replaces HistoryPlugin and InitialContentPlugin.
 * Issue #2343: LexicalComposer stays mounted (hidden via CSS) during mode switches so Yjs
 *   connection is preserved. ContentSyncPlugin runs alongside CollaborationPlugin to keep
 *   markdownContent in sync for char/word count and mode switching.
 */

import React, { useCallback, useMemo, useState, useRef } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { CollaborationPlugin } from '@lexical/react/LexicalCollaborationPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin';
import { $convertFromMarkdownString, $convertToMarkdownString, TRANSFORMERS } from '@lexical/markdown';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { ListNode, ListItemNode } from '@lexical/list';
import { LinkNode, AutoLinkNode } from '@lexical/link';
import { CodeNode, CodeHighlightNode } from '@lexical/code';
import { TableNode, TableRowNode, TableCellNode } from '@lexical/table';
import { TablePlugin } from '@lexical/react/LexicalTablePlugin';
import type { LexicalEditor } from 'lexical';
import type { Provider } from '@lexical/yjs';
import type { Doc } from 'yjs';
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
import { Code, Eye, Edit, WifiOff } from 'lucide-react';

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
import { EditorRefPlugin } from './plugins/editor-ref-plugin';
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
  yjsDoc,
  yjsProvider,
  yjsEnabled = false,
  currentUser,
}: LexicalEditorProps): React.JSX.Element {
  const [mode, setMode] = useState<EditorMode>(initialMode);
  const [markdownContent, setMarkdownContent] = useState(initialContent);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const cursorsContainerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<LexicalEditor | null>(null);
  // Use dark mode state for Mermaid theme (#686)
  const { isDark } = useDarkMode();

  // Handle markdown textarea changes
  const handleMarkdownChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newContent = e.target.value;
      setMarkdownContent(newContent);
      onChange?.(newContent);
    },
    [onChange],
  );

  // Handle content change from Lexical editor
  const handleLexicalChange = useCallback(
    (content: string) => {
      setMarkdownContent(content);
      onChange?.(content);
    },
    [onChange],
  );

  /** Switch to markdown mode, extracting current editor content (#2343) */
  const handleSwitchToMarkdown = useCallback(() => {
    if (editorRef.current) {
      const md = editorRef.current.getEditorState().read(() => $convertToMarkdownString(TRANSFORMERS));
      setMarkdownContent(md);
    }
    setMode('markdown');
  }, []);

  /** Switch from WYSIWYG to preview — snapshot editor state as markdown (#2343) */
  const handleWysiwygToPreview = useCallback(() => {
    if (editorRef.current) {
      const md = editorRef.current.getEditorState().read(() => $convertToMarkdownString(TRANSFORMERS));
      setMarkdownContent(md);
    }
    setMode('preview');
  }, []);

  /** Switch from markdown to preview — write textarea content back to Lexical/Yjs first (#2343) */
  const handleMarkdownToPreview = useCallback(() => {
    if (editorRef.current) {
      const content = markdownContent;
      editorRef.current.update(() => {
        $convertFromMarkdownString(content, TRANSFORMERS);
      });
    }
    setMode('preview');
  }, [markdownContent]);

  /** Switch from markdown textarea back to WYSIWYG, applying edits to Lexical (#2343) */
  const handleSwitchFromMarkdownToWysiwyg = useCallback(() => {
    if (editorRef.current) {
      const content = markdownContent;
      editorRef.current.update(() => {
        $convertFromMarkdownString(content, TRANSFORMERS);
      });
    }
    setMode('wysiwyg');
  }, [markdownContent]);

  // Preview HTML - sanitized with DOMPurify to prevent XSS (#674)
  const previewHtml = mode === 'preview' || readOnly ? sanitizeHtml(markdownToHtml(markdownContent)) : '';

  // Character and word count
  const charCount = markdownContent.length;
  const wordCount = markdownContent.split(/\s+/).filter(Boolean).length;

  // Memoize CollaborationPlugin callbacks to prevent React effect re-runs (#2416).
  // Inline functions create new references every render, causing the plugin's
  // useEffect cleanup to call provider.disconnect() and kill the WebSocket.
  const providerFactory = useCallback(
    (_id: string, yjsDocMap: Map<string, Doc>) => {
      if (yjsDoc) yjsDocMap.set(_id, yjsDoc);
      return yjsProvider as unknown as Provider;
    },
    [yjsDoc, yjsProvider],
  );

  const initialEditorStateFn = useMemo(
    () =>
      initialContent
        ? (editor: LexicalEditor) => {
            editor.update(() => {
              $convertFromMarkdownString(initialContent, TRANSFORMERS);
            });
          }
        : undefined,
    [initialContent],
  );

  // Lexical editor config
  const initialConfig = {
    namespace: 'NoteEditor',
    theme,
    onError,
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, AutoLinkNode, CodeNode, CodeHighlightNode, TableNode, TableRowNode, TableCellNode],
    editable: !readOnly,
  };

  if (readOnly) {
    // NOTE: previewHtml is sanitized via DOMPurify in sanitizeHtml() (#674)
    return (
      <div className={cn('flex flex-col border rounded-lg overflow-hidden', className)}>
        <div
          ref={previewContainerRef}
          className="flex-1 min-h-[300px] p-4 prose prose-sm max-w-none overflow-auto"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
        <MermaidRenderer containerRef={previewContainerRef} isDark={isDark} />
        <div className="flex items-center justify-between px-4 py-2 border-t text-xs text-muted-foreground bg-muted/20">
          <span>
            {charCount} characters | {wordCount} words
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col border rounded-lg overflow-hidden', className)}>
      {/* Markdown editing pane (#2343) */}
      {mode === 'markdown' && (
        <div className="flex flex-col h-full">
          <div className="flex items-center gap-1 p-2 border-b bg-muted/30 flex-wrap">
            <div className="flex items-center gap-1 border rounded-md p-0.5">
              <Button type="button" variant="ghost" size="sm" onClick={handleSwitchFromMarkdownToWysiwyg} className="h-7 px-2 text-xs">
                <Edit className="h-3 w-3 mr-1" />
                Edit
              </Button>
              <Button type="button" variant="secondary" size="sm" className="h-7 px-2 text-xs">
                <Code className="h-3 w-3 mr-1" />
                Markdown
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={handleMarkdownToPreview} className="h-7 px-2 text-xs">
                <Eye className="h-3 w-3 mr-1" />
                Preview
              </Button>
            </div>
          </div>
          {yjsEnabled && (
            <div className="px-3 py-1.5 text-xs text-muted-foreground bg-amber-50 dark:bg-amber-950/20 border-b flex items-center gap-1.5">
              <WifiOff className="h-3 w-3" />
              Your changes will sync when you switch to Edit or Preview mode.
            </div>
          )}
          <textarea
            value={markdownContent}
            onChange={handleMarkdownChange}
            placeholder={placeholder}
            className="flex-1 min-h-[300px] p-4 font-mono text-sm bg-background resize-none focus:outline-none"
            autoFocus={autoFocus}
          />
          <div className="flex items-center justify-between px-4 py-2 border-t text-xs text-muted-foreground bg-muted/20">
            <span>
              {charCount} characters | {wordCount} words
            </span>
            {saving && <span className="text-primary">Saving...</span>}
          </div>
        </div>
      )}

      {/* Preview pane (#2343) */}
      {mode === 'preview' && (
        <div className="flex flex-col h-full">
          <div className="flex items-center gap-1 p-2 border-b bg-muted/30 flex-wrap">
            <div className="flex items-center gap-1 border rounded-md p-0.5">
              <Button type="button" variant="ghost" size="sm" onClick={() => setMode('wysiwyg')} className="h-7 px-2 text-xs">
                <Edit className="h-3 w-3 mr-1" />
                Edit
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={handleSwitchToMarkdown} className="h-7 px-2 text-xs">
                <Code className="h-3 w-3 mr-1" />
                Markdown
              </Button>
              <Button type="button" variant="secondary" size="sm" className="h-7 px-2 text-xs">
                <Eye className="h-3 w-3 mr-1" />
                Preview
              </Button>
            </div>
          </div>
          <div
            ref={previewContainerRef}
            className="flex-1 min-h-[300px] p-4 prose prose-sm max-w-none overflow-auto"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
          <MermaidRenderer containerRef={previewContainerRef} isDark={isDark} />
          <div className="flex items-center justify-between px-4 py-2 border-t text-xs text-muted-foreground bg-muted/20">
            <span>
              {charCount} characters | {wordCount} words
            </span>
          </div>
        </div>
      )}

      {/* WYSIWYG pane — always mounted so Yjs stays connected (#2343) */}
      <div className={cn('flex flex-col h-full', { hidden: mode !== 'wysiwyg' })}>
        <LexicalComposer initialConfig={initialConfig}>
          <EditorRefPlugin editorRef={editorRef} />
          <ToolbarPlugin />

          <div className="flex items-center justify-end gap-1 px-2 py-1 border-b bg-muted/20">
            <div className="flex items-center gap-1 border rounded-md p-0.5">
              <Button type="button" variant="secondary" size="sm" className="h-7 px-2 text-xs">
                <Edit className="h-3 w-3 mr-1" />
                Edit
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={handleSwitchToMarkdown} className="h-7 px-2 text-xs">
                <Code className="h-3 w-3 mr-1" />
                Markdown
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={handleWysiwygToPreview} className="h-7 px-2 text-xs">
                <Eye className="h-3 w-3 mr-1" />
                Preview
              </Button>
            </div>
          </div>

          <div ref={cursorsContainerRef} className="flex-1 min-h-[300px] overflow-auto relative">
            <RichTextPlugin
              contentEditable={<ContentEditable className="min-h-[300px] p-4 outline-none prose prose-sm max-w-none" aria-placeholder={placeholder} />}
              placeholder={<div className="absolute top-4 left-4 text-muted-foreground pointer-events-none">{placeholder}</div>}
              ErrorBoundary={LexicalErrorBoundary}
            />
            {/* When Yjs is enabled, CollaborationPlugin replaces History and InitialContent (#2256).
                ContentSyncPlugin runs alongside to keep markdownContent in sync (#2343). */}
            {yjsEnabled && yjsDoc && yjsProvider ? (
              <>
                <CollaborationPlugin
                  id={yjsDoc.clientID.toString()}
                  providerFactory={providerFactory}
                  shouldBootstrap={false}
                  username={currentUser?.name ?? 'Anonymous'}
                  cursorColor={currentUser?.color ?? '#3b82f6'}
                  cursorsContainerRef={cursorsContainerRef}
                  initialEditorState={initialEditorStateFn}
                />
                <ContentSyncPlugin onChange={handleLexicalChange} />
              </>
            ) : (
              <>
                <HistoryPlugin />
                <InitialContentPlugin initialContent={initialContent} />
                <ContentSyncPlugin onChange={handleLexicalChange} />
              </>
            )}
            <ListPlugin />
            <LinkPlugin />
            <TablePlugin />
            <CodeHighlightPlugin />
            <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
            {autoFocus && <AutoFocusPlugin />}
          </div>

          <div className="flex items-center justify-between px-4 py-2 border-t text-xs text-muted-foreground bg-muted/20">
            <span>
              {charCount} characters | {wordCount} words
            </span>
            {saving && <span className="text-primary">Saving...</span>}
          </div>
        </LexicalComposer>
      </div>
    </div>
  );
}
