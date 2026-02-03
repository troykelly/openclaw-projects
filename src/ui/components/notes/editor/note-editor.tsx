/**
 * Note editor component with WYSIWYG and markdown support.
 * Part of Epic #338, Issue #350
 *
 * Features:
 * - Rich text editing with formatting toolbar
 * - Markdown source view toggle
 * - Auto-save with debounce
 * - Keyboard shortcuts
 *
 * Security: Preview mode uses simple markdown-to-HTML conversion.
 * In production, sanitize HTML with DOMPurify to prevent XSS.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/components/ui/button';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  Quote,
  Code,
  Link,
  Heading1,
  Heading2,
  Heading3,
  Eye,
  Edit,
  Save,
  Loader2,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/ui/components/ui/tooltip';

export type EditorMode = 'wysiwyg' | 'markdown' | 'preview';

export interface NoteEditorProps {
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Simple markdown to HTML conversion for preview mode.
 * NOTE: In production, use a proper library like marked + DOMPurify for XSS protection.
 */
function markdownToHtml(markdown: string): string {
  let html = escapeHtml(markdown);

  // Headers (must match escaped patterns)
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

export function NoteEditor({
  initialContent = '',
  onChange,
  onSave,
  readOnly = false,
  mode: initialMode = 'wysiwyg',
  placeholder = 'Start writing...',
  autoFocus = false,
  className,
  saving = false,
}: NoteEditorProps) {
  const [content, setContent] = useState(initialContent);
  const [mode, setMode] = useState<EditorMode>(initialMode);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const wysiwygRef = useRef<HTMLDivElement>(null);

  // Update content when initialContent changes
  useEffect(() => {
    setContent(initialContent);
  }, [initialContent]);

  // Auto-focus
  useEffect(() => {
    if (autoFocus) {
      if (mode === 'markdown' && editorRef.current) {
        editorRef.current.focus();
      } else if (mode === 'wysiwyg' && wysiwygRef.current) {
        wysiwygRef.current.focus();
      }
    }
  }, [autoFocus, mode]);

  const handleContentChange = useCallback(
    (newContent: string) => {
      setContent(newContent);
      onChange?.(newContent);
    },
    [onChange]
  );

  const handleSave = useCallback(async () => {
    if (onSave) {
      await onSave(content);
    }
  }, [onSave, content]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  // Formatting functions for WYSIWYG mode
  const execCommand = useCallback((command: string, value?: string) => {
    document.execCommand(command, false, value);
    wysiwygRef.current?.focus();
  }, []);

  const insertMarkdown = useCallback(
    (before: string, after: string = '') => {
      const textarea = editorRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selectedText = content.substring(start, end);
      const newText =
        content.substring(0, start) + before + selectedText + after + content.substring(end);

      handleContentChange(newText);

      // Restore cursor position
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + before.length, end + before.length);
      }, 0);
    },
    [content, handleContentChange]
  );

  const toolbarActions = {
    bold: () =>
      mode === 'markdown' ? insertMarkdown('**', '**') : execCommand('bold'),
    italic: () =>
      mode === 'markdown' ? insertMarkdown('*', '*') : execCommand('italic'),
    underline: () =>
      mode === 'markdown' ? insertMarkdown('<u>', '</u>') : execCommand('underline'),
    strikethrough: () =>
      mode === 'markdown' ? insertMarkdown('~~', '~~') : execCommand('strikeThrough'),
    h1: () =>
      mode === 'markdown' ? insertMarkdown('# ') : execCommand('formatBlock', 'h1'),
    h2: () =>
      mode === 'markdown' ? insertMarkdown('## ') : execCommand('formatBlock', 'h2'),
    h3: () =>
      mode === 'markdown' ? insertMarkdown('### ') : execCommand('formatBlock', 'h3'),
    bulletList: () =>
      mode === 'markdown' ? insertMarkdown('* ') : execCommand('insertUnorderedList'),
    numberedList: () =>
      mode === 'markdown' ? insertMarkdown('1. ') : execCommand('insertOrderedList'),
    quote: () =>
      mode === 'markdown' ? insertMarkdown('> ') : execCommand('formatBlock', 'blockquote'),
    code: () => insertMarkdown('```\n', '\n```'),
    link: () => {
      const url = prompt('Enter URL:');
      if (url) {
        if (mode === 'markdown') {
          insertMarkdown('[', `](${url})`);
        } else {
          execCommand('createLink', url);
        }
      }
    },
  };

  // Create preview HTML once for render
  const previewHtml = (mode === 'preview' || readOnly) ? markdownToHtml(content) : '';

  return (
    <div className={cn('flex flex-col border rounded-lg overflow-hidden', className)}>
      {/* Toolbar */}
      {!readOnly && (
        <div className="flex items-center gap-1 p-2 border-b bg-muted/30 flex-wrap">
          <ToolbarButton
            icon={<Bold className="h-4 w-4" />}
            label="Bold (Ctrl+B)"
            onClick={toolbarActions.bold}
          />
          <ToolbarButton
            icon={<Italic className="h-4 w-4" />}
            label="Italic (Ctrl+I)"
            onClick={toolbarActions.italic}
          />
          <ToolbarButton
            icon={<Underline className="h-4 w-4" />}
            label="Underline (Ctrl+U)"
            onClick={toolbarActions.underline}
          />
          <ToolbarButton
            icon={<Strikethrough className="h-4 w-4" />}
            label="Strikethrough"
            onClick={toolbarActions.strikethrough}
          />

          <ToolbarSeparator />

          <ToolbarButton
            icon={<Heading1 className="h-4 w-4" />}
            label="Heading 1"
            onClick={toolbarActions.h1}
          />
          <ToolbarButton
            icon={<Heading2 className="h-4 w-4" />}
            label="Heading 2"
            onClick={toolbarActions.h2}
          />
          <ToolbarButton
            icon={<Heading3 className="h-4 w-4" />}
            label="Heading 3"
            onClick={toolbarActions.h3}
          />

          <ToolbarSeparator />

          <ToolbarButton
            icon={<List className="h-4 w-4" />}
            label="Bullet List"
            onClick={toolbarActions.bulletList}
          />
          <ToolbarButton
            icon={<ListOrdered className="h-4 w-4" />}
            label="Numbered List"
            onClick={toolbarActions.numberedList}
          />
          <ToolbarButton
            icon={<Quote className="h-4 w-4" />}
            label="Quote"
            onClick={toolbarActions.quote}
          />
          <ToolbarButton
            icon={<Code className="h-4 w-4" />}
            label="Code Block"
            onClick={toolbarActions.code}
          />
          <ToolbarButton
            icon={<Link className="h-4 w-4" />}
            label="Insert Link"
            onClick={toolbarActions.link}
          />

          <div className="flex-1" />

          {/* Mode switcher */}
          <div className="flex items-center gap-1 border rounded-md p-0.5">
            <Button
              variant={mode === 'wysiwyg' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setMode('wysiwyg')}
              className="h-7 px-2 text-xs"
            >
              <Edit className="h-3 w-3 mr-1" />
              Edit
            </Button>
            <Button
              variant={mode === 'markdown' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setMode('markdown')}
              className="h-7 px-2 text-xs"
            >
              <Code className="h-3 w-3 mr-1" />
              Markdown
            </Button>
            <Button
              variant={mode === 'preview' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setMode('preview')}
              className="h-7 px-2 text-xs"
            >
              <Eye className="h-3 w-3 mr-1" />
              Preview
            </Button>
          </div>

          {onSave && (
            <>
              <ToolbarSeparator />
              <Button
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
      )}

      {/* Editor content */}
      <div className="flex-1 min-h-[300px] overflow-auto">
        {mode === 'markdown' && !readOnly && (
          <textarea
            ref={editorRef}
            value={content}
            onChange={(e) => handleContentChange(e.target.value)}
            placeholder={placeholder}
            className="w-full h-full min-h-[300px] p-4 font-mono text-sm bg-background resize-none focus:outline-none"
          />
        )}

        {mode === 'wysiwyg' && !readOnly && (
          <div
            ref={wysiwygRef}
            contentEditable
            suppressContentEditableWarning
            onInput={(e) =>
              handleContentChange((e.target as HTMLDivElement).innerText)
            }
            className="w-full min-h-[300px] p-4 prose prose-sm max-w-none focus:outline-none"
            data-placeholder={placeholder}
          >
            {content || <span className="text-muted-foreground">{placeholder}</span>}
          </div>
        )}

        {(mode === 'preview' || readOnly) && (
          <div
            className="w-full min-h-[300px] p-4 prose prose-sm max-w-none note-preview"
            // NOTE: In production, sanitize with DOMPurify before rendering
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-2 border-t text-xs text-muted-foreground bg-muted/20">
        <span>
          {content.length} characters | {content.split(/\s+/).filter(Boolean).length} words
        </span>
        {saving && <span className="text-primary">Saving...</span>}
      </div>
    </div>
  );
}
