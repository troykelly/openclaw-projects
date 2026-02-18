/**
 * Shared note access page component.
 * Part of Epic #338, Issue #357
 *
 * SECURITY NOTE: This component renders user-generated markdown content.
 * The markdownToHtml function escapes HTML before processing to prevent XSS.
 * In production, you MUST also sanitize with DOMPurify for defense in depth.
 * Install: npm install dompurify @types/dompurify
 * Usage: dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(markdownToHtml(content)) }}
 */

import React, { useState, useCallback } from 'react';
import { FileText, Lock, AlertCircle, Loader2, Copy, Check, User, Calendar, Eye, Edit } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import { Badge } from '@/ui/components/ui/badge';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/components/ui/tooltip';
import { NoteEditor } from '../editor';
import type { Note } from '../types';

export type SharedNoteStatus = 'loading' | 'accessible' | 'not-found' | 'access-denied' | 'error';

export interface SharedNotePageProps {
  status: SharedNoteStatus;
  note?: Note;
  canEdit?: boolean;
  onSave?: (content: string) => Promise<void>;
  onRequestAccess?: () => void;
  errorMessage?: string;
  className?: string;
}

/**
 * Escape HTML special characters to prevent XSS.
 * This is the first line of defense - content is escaped BEFORE any processing.
 */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

/**
 * Convert markdown to HTML for display.
 *
 * SECURITY: Input is escaped FIRST via escapeHtml(), then markdown patterns
 * are converted to HTML. This approach prevents injection because user content
 * cannot contain raw HTML tags (they're escaped to &lt; &gt; etc).
 *
 * For production: Add DOMPurify.sanitize() as a second layer of defense.
 */
function markdownToHtml(markdown: string): string {
  // CRITICAL: Escape HTML first to prevent XSS
  let html = escapeHtml(markdown);

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

  // Blockquotes (note: > is escaped to &gt;)
  html = html.replace(/^&gt; (.*$)/gm, '<blockquote class="border-l-4 border-muted-foreground/30 pl-4 my-2 italic">$1</blockquote>');

  // Lists
  html = html.replace(/^\* (.*$)/gm, '<li class="ml-4">$1</li>');
  html = html.replace(/^\d+\. (.*$)/gm, '<li class="ml-4 list-decimal">$1</li>');

  // Paragraphs
  html = html.replace(/\n\n/g, '</p><p class="my-2">');
  html = `<p class="my-2">${html}</p>`;

  return html;
}

export function SharedNotePage({ status, note, canEdit = false, onSave, onRequestAccess, errorMessage, className }: SharedNotePageProps) {
  const [content, setContent] = useState(note?.content || '');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleSave = useCallback(async () => {
    if (!onSave) return;
    setSaving(true);
    try {
      await onSave(content);
    } finally {
      setSaving(false);
    }
  }, [onSave, content]);

  const handleCopyLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Loading state
  if (status === 'loading') {
    return (
      <div className={cn('flex h-full items-center justify-center', className)}>
        <div className="text-center">
          <Loader2 className="mx-auto size-8 animate-spin text-muted-foreground" />
          <p className="mt-4 text-sm text-muted-foreground">Loading note...</p>
        </div>
      </div>
    );
  }

  // Not found state
  if (status === 'not-found') {
    return (
      <div className={cn('flex h-full items-center justify-center p-8', className)}>
        <Card className="max-w-md">
          <CardHeader className="text-center">
            <FileText className="mx-auto size-12 text-muted-foreground/50" />
            <CardTitle className="mt-4">Note not found</CardTitle>
            <CardDescription>This note may have been deleted or the link is incorrect.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Access denied state
  if (status === 'access-denied') {
    return (
      <div className={cn('flex h-full items-center justify-center p-8', className)}>
        <Card className="max-w-md">
          <CardHeader className="text-center">
            <Lock className="mx-auto size-12 text-amber-500" />
            <CardTitle className="mt-4">Access denied</CardTitle>
            <CardDescription>You don't have permission to view this note.</CardDescription>
          </CardHeader>
          {onRequestAccess && (
            <CardFooter className="justify-center">
              <Button onClick={onRequestAccess}>Request access</Button>
            </CardFooter>
          )}
        </Card>
      </div>
    );
  }

  // Error state
  if (status === 'error') {
    return (
      <div className={cn('flex h-full items-center justify-center p-8', className)}>
        <Card className="max-w-md">
          <CardHeader className="text-center">
            <AlertCircle className="mx-auto size-12 text-destructive" />
            <CardTitle className="mt-4">Something went wrong</CardTitle>
            <CardDescription>{errorMessage || 'Unable to load this note. Please try again later.'}</CardDescription>
          </CardHeader>
          <CardFooter className="justify-center">
            <Button variant="outline" onClick={() => window.location.reload()}>
              Try again
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // Accessible state - show the note
  if (!note) return null;

  // Pre-compute the sanitized HTML (escapeHtml is called inside markdownToHtml)
  const renderedHtml = markdownToHtml(note.content);

  return (
    <div className={cn('flex h-full flex-col', className)}>
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto max-w-4xl px-4 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold truncate">{note.title || 'Untitled'}</h1>
              <div className="mt-2 flex items-center gap-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <User className="size-4" />
                  {note.createdBy}
                </span>
                <span className="flex items-center gap-1">
                  <Calendar className="size-4" />
                  {note.updated_at.toLocaleDateString()}
                </span>
                <Badge variant="outline" className="text-xs">
                  {canEdit ? (
                    <>
                      <Edit className="mr-1 size-3" />
                      Can edit
                    </>
                  ) : (
                    <>
                      <Eye className="mr-1 size-3" />
                      View only
                    </>
                  )}
                </Badge>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm" onClick={handleCopyLink}>
                      {copied ? <Check className="size-4 text-green-500" /> : <Copy className="size-4" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{copied ? 'Copied!' : 'Copy link'}</TooltipContent>
                </Tooltip>
              </TooltipProvider>

              {canEdit && onSave && (
                <Button onClick={handleSave} disabled={saving}>
                  {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
                  Save
                </Button>
              )}
            </div>
          </div>

          {/* Tags */}
          {note.tags && note.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {note.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl px-4 py-6">
          {canEdit ? (
            <NoteEditor initialContent={content} onChange={setContent} onSave={handleSave} saving={saving} className="min-h-[400px]" />
          ) : (
            <div
              className="prose prose-sm max-w-none dark:prose-invert"
              /* Content is pre-escaped via escapeHtml() in markdownToHtml.
                 For production, wrap with DOMPurify.sanitize() for defense in depth. */
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t py-4 text-center text-xs text-muted-foreground">
        <p>Shared via OpenClaw Projects &middot; v{note.version}</p>
      </footer>
    </div>
  );
}
