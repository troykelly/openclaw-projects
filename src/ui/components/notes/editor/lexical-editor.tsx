/**
 * Lexical-based rich text editor for notes.
 * Part of Epic #338, Issue #629
 *
 * Features:
 * - True WYSIWYG editing with Lexical
 * - Markdown import/export
 * - Formatting toolbar
 * - Keyboard shortcuts
 * - Link support
 *
 * Security: Preview mode uses simple markdown-to-HTML conversion.
 * For production, sanitize HTML with DOMPurify to prevent XSS.
 */

import React, { useCallback, useEffect, useState } from 'react';
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
import { CodeNode } from '@lexical/code';
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
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/ui/components/ui/tooltip';

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
 * Simple markdown to HTML conversion for preview mode.
 * NOTE: In production, sanitize output with DOMPurify before rendering.
 */
function markdownToHtml(markdown: string): string {
  let html = markdown
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

  // Code blocks
  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, _lang, code) => {
    return `<pre class="bg-muted p-3 rounded-md overflow-x-auto my-3"><code class="text-sm">${code.trim()}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="bg-muted px-1 py-0.5 rounded text-sm">$1</code>');

  // Blockquotes
  html = html.replace(/^&gt; (.*$)/gm, '<blockquote class="border-l-4 border-muted-foreground/30 pl-4 my-2 italic">$1</blockquote>');

  // Lists
  html = html.replace(/^\* (.*$)/gm, '<li class="ml-4">$1</li>');
  html = html.replace(/^\d+\. (.*$)/gm, '<li class="ml-4 list-decimal">$1</li>');

  // Paragraphs
  html = html.replace(/\n\n/g, '</p><p class="my-2">');
  html = `<p class="my-2">${html}</p>`;

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

  const insertLink = () => {
    const url = prompt('Enter URL:');
    if (url) {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
    }
  };

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
        onClick={insertLink}
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
};

function onError(error: Error): void {
  console.error('[LexicalEditor]', error);
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

  // Preview HTML
  // NOTE: In production, sanitize this output with DOMPurify before rendering
  const previewHtml = mode === 'preview' || readOnly ? markdownToHtml(markdownContent) : '';

  // Character and word count
  const charCount = markdownContent.length;
  const wordCount = markdownContent.split(/\s+/).filter(Boolean).length;

  // Lexical editor config
  const initialConfig = {
    namespace: 'NoteEditor',
    theme,
    onError,
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, AutoLinkNode, CodeNode],
    editable: !readOnly,
  };

  if (readOnly || mode === 'preview') {
    return (
      <div className={cn('flex flex-col border rounded-lg overflow-hidden', className)}>
        {/* NOTE: In production, sanitize previewHtml with DOMPurify */}
        {/* eslint-disable-next-line react/no-danger */}
        <div
          className="flex-1 min-h-[300px] p-4 prose prose-sm max-w-none overflow-auto"
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
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
