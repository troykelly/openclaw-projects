/**
 * Note detail and editor view component.
 * Part of Epic #338, Issues #354, #774, #775
 *
 * Features:
 * - Auto-generated title for new notes (e.g., "Feb 6, 2026 11:00")
 * - Throttled autosave (saves 2 seconds after last change)
 * - Save status indicator (Saved/Saving/Error)
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  ArrowLeft,
  Share2,
  History,
  MoreVertical,
  Trash2,
  Pin,
  PinOff,
  Eye,
  EyeOff,
  Lock,
  Users,
  Globe,
  Loader2,
  BookOpen,
  Check,
  AlertCircle,
  Cloud,
  CloudOff,
} from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/ui/components/ui/tooltip';
import { Switch } from '@/ui/components/ui/switch';
import { Label } from '@/ui/components/ui/label';
import { NoteEditor } from '../editor';
import type { Note, NoteVisibility, Notebook } from '../types';

/** Autosave delay in milliseconds (2 seconds) */
const AUTOSAVE_DELAY_MS = 2000;

/** Save status for the indicator */
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Generate a human-friendly note title from the current date/time.
 * Format: "Feb 6, 2026 11:00"
 */
function generateAutoTitle(): string {
  const now = new Date();
  return now.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  });
}

export interface NoteDetailProps {
  note?: Note;
  notebooks?: Notebook[];
  onSave?: (data: {
    title: string;
    content: string;
    notebookId?: string;
    visibility: NoteVisibility;
    hideFromAgents: boolean;
  }) => Promise<void>;
  onBack?: () => void;
  onShare?: () => void;
  onViewHistory?: () => void;
  onDelete?: () => void;
  onTogglePin?: () => void;
  isNew?: boolean;
  saving?: boolean;
  className?: string;
}

export function NoteDetail({
  note,
  notebooks = [],
  onSave,
  onBack,
  onShare,
  onViewHistory,
  onDelete,
  onTogglePin,
  isNew = false,
  saving = false,
  className,
}: NoteDetailProps) {
  // Auto-generate title for new notes
  const autoTitle = useMemo(() => generateAutoTitle(), []);

  const [title, setTitle] = useState(note?.title || (isNew ? autoTitle : ''));
  const [content, setContent] = useState(note?.content || '');
  const [notebookId, setNotebookId] = useState(note?.notebookId);
  const [visibility, setVisibility] = useState<NoteVisibility>(note?.visibility || 'private');
  const [hideFromAgents, setHideFromAgents] = useState(note?.hideFromAgents || false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  // Track whether we've created the note yet (for new notes)
  const [noteCreated, setNoteCreated] = useState(!isNew);

  // Refs for autosave and status reset timers
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<{
    title: string;
    content: string;
    notebookId?: string;
    visibility: NoteVisibility;
    hideFromAgents: boolean;
  } | null>(note ? {
    title: note.title,
    content: note.content,
    notebookId: note.notebookId,
    visibility: note.visibility,
    hideFromAgents: note.hideFromAgents,
  } : null);

  // Check if there are unsaved changes
  const hasChanges = useMemo(() => {
    if (!lastSavedRef.current) {
      // For new notes, any content counts as a change
      return title.trim() !== '' || content.trim() !== '';
    }
    return (
      title !== lastSavedRef.current.title ||
      content !== lastSavedRef.current.content ||
      notebookId !== lastSavedRef.current.notebookId ||
      visibility !== lastSavedRef.current.visibility ||
      hideFromAgents !== lastSavedRef.current.hideFromAgents
    );
  }, [title, content, notebookId, visibility, hideFromAgents]);

  // Reset when note changes (e.g., navigating to different note)
  useEffect(() => {
    if (note) {
      setTitle(note.title);
      setContent(note.content);
      setNotebookId(note.notebookId);
      setVisibility(note.visibility);
      setHideFromAgents(note.hideFromAgents);
      setNoteCreated(true);
      lastSavedRef.current = {
        title: note.title,
        content: note.content,
        notebookId: note.notebookId,
        visibility: note.visibility,
        hideFromAgents: note.hideFromAgents,
      };
      setSaveStatus('idle');
      setSaveError(null);
    }
  }, [note]);

  // Perform the actual save
  const performSave = useCallback(async () => {
    if (!onSave) return;

    const currentTitle = title.trim() || autoTitle;
    const data = {
      title: currentTitle,
      content,
      notebookId,
      visibility,
      hideFromAgents,
    };

    setSaveStatus('saving');
    setSaveError(null);

    try {
      await onSave(data);
      lastSavedRef.current = data;
      setNoteCreated(true);
      setSaveStatus('saved');

      // Reset to idle after 3 seconds (use ref to prevent memory leak on unmount)
      if (statusResetTimerRef.current) {
        clearTimeout(statusResetTimerRef.current);
      }
      statusResetTimerRef.current = setTimeout(() => {
        setSaveStatus((current) => (current === 'saved' ? 'idle' : current));
      }, 3000);
    } catch (error) {
      // Log detailed error for debugging, show generic message to user
      console.error('[NoteDetail] Save failed:', error);
      setSaveError('Unable to save. Please try again.');
      setSaveStatus('error');
    }
  }, [onSave, title, content, notebookId, visibility, hideFromAgents, autoTitle]);

  // Cleanup status reset timer on unmount
  useEffect(() => {
    return () => {
      if (statusResetTimerRef.current) {
        clearTimeout(statusResetTimerRef.current);
      }
    };
  }, []);

  // Schedule autosave when changes occur
  useEffect(() => {
    // Don't autosave if there's no onSave handler, no changes, or already saving
    if (!onSave || !hasChanges || saveStatus === 'saving') {
      return;
    }

    // Clear existing timer
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }

    // For new notes, require at least some content before first save
    if (!noteCreated && !title.trim() && !content.trim()) {
      return;
    }

    // Schedule autosave
    autosaveTimerRef.current = setTimeout(() => {
      performSave();
    }, AUTOSAVE_DELAY_MS);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [onSave, hasChanges, noteCreated, title, content, performSave, saveStatus]);

  // Sync with external saving state
  useEffect(() => {
    if (saving) {
      setSaveStatus('saving');
    }
  }, [saving]);

  const handleContentChange = useCallback((newContent: string) => {
    setContent(newContent);
  }, []);

  const getVisibilityIcon = () => {
    switch (visibility) {
      case 'private':
        return <Lock className="size-4" />;
      case 'shared':
        return <Users className="size-4" />;
      case 'public':
        return <Globe className="size-4" />;
    }
  };

  // Save status indicator component
  const SaveStatusIndicator = () => {
    switch (saveStatus) {
      case 'saving':
        return (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            <span>Saving...</span>
          </div>
        );
      case 'saved':
        return (
          <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
            <Check className="size-3" />
            <span>Saved</span>
          </div>
        );
      case 'error':
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5 text-xs text-destructive cursor-help">
                  <AlertCircle className="size-3" />
                  <span>Error saving</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>{saveError || 'Failed to save note'}</p>
                <p className="text-xs text-muted-foreground mt-1">Changes will be retried automatically</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      default:
        if (hasChanges) {
          return (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CloudOff className="size-3" />
              <span>Unsaved</span>
            </div>
          );
        }
        return (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Cloud className="size-3" />
            <span>All changes saved</span>
          </div>
        );
    }
  };

  return (
    <div className={cn('flex h-full flex-col', className)}>
      {/* Header */}
      <div className="flex items-center gap-3 border-b p-4">
        {onBack && (
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="size-4" />
          </Button>
        )}

        {/* Title input */}
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={autoTitle}
          className="flex-1 border-0 bg-transparent text-lg font-semibold focus-visible:ring-0 px-0"
        />

        {/* Actions */}
        <div className="flex items-center gap-2">
          {/* Save status indicator */}
          <SaveStatusIndicator />

          {/* Visibility selector */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Select
                  value={visibility}
                  onValueChange={(v) => setVisibility(v as NoteVisibility)}
                >
                  <SelectTrigger className="w-auto gap-2 border-0 bg-transparent">
                    {getVisibilityIcon()}
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="private">
                      <div className="flex items-center gap-2">
                        <Lock className="size-4" />
                        Private
                      </div>
                    </SelectItem>
                    <SelectItem value="shared">
                      <div className="flex items-center gap-2">
                        <Users className="size-4" />
                        Shared
                      </div>
                    </SelectItem>
                    <SelectItem value="public">
                      <div className="flex items-center gap-2">
                        <Globe className="size-4" />
                        Public
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </TooltipTrigger>
              <TooltipContent>Visibility</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Share button */}
          {onShare && visibility !== 'private' && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={onShare}>
                    <Share2 className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Share</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* History button */}
          {onViewHistory && !isNew && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={onViewHistory}>
                    <History className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Version history</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* More actions */}
          {(onTogglePin || onDelete) && !isNew && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onTogglePin && (
                  <DropdownMenuItem onClick={onTogglePin}>
                    {note?.isPinned ? (
                      <>
                        <PinOff className="mr-2 size-4" />
                        Unpin note
                      </>
                    ) : (
                      <>
                        <Pin className="mr-2 size-4" />
                        Pin note
                      </>
                    )}
                  </DropdownMenuItem>
                )}
                {onDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={onDelete}
                    >
                      <Trash2 className="mr-2 size-4" />
                      Delete note
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Metadata bar */}
      <div className="flex items-center gap-4 border-b px-4 py-2 text-sm">
        {/* Notebook selector */}
        <div className="flex items-center gap-2">
          <BookOpen className="size-4 text-muted-foreground" />
          <Select
            value={notebookId ?? 'none'}
            onValueChange={(v) => setNotebookId(v === 'none' ? undefined : v)}
          >
            <SelectTrigger className="w-[140px] h-7 text-xs">
              <SelectValue placeholder="No notebook" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No notebook</SelectItem>
              {notebooks.map((nb) => (
                <SelectItem key={nb.id} value={nb.id}>
                  {nb.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="h-4 w-px bg-border" />

        {/* Hide from agents toggle */}
        <div className="flex items-center gap-2">
          <Switch
            id="hide-from-agents"
            checked={hideFromAgents}
            onCheckedChange={setHideFromAgents}
            className="h-4 w-7"
          />
          <Label htmlFor="hide-from-agents" className="text-xs text-muted-foreground cursor-pointer">
            {hideFromAgents ? (
              <span className="flex items-center gap-1">
                <EyeOff className="size-3" />
                Hidden from AI
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <Eye className="size-3" />
                Visible to AI
              </span>
            )}
          </Label>
        </div>

        <div className="flex-1" />

        {/* Version info */}
        {note && !isNew && (
          <span className="text-xs text-muted-foreground">
            v{note.version} · Updated {note.updatedAt.toLocaleDateString()}
          </span>
        )}
      </div>

      {/* Editor - key forces remount when switching notes (#786) */}
      <div className="flex-1 overflow-hidden">
        <NoteEditor
          key={note?.id ?? 'new'}
          initialContent={note?.content ?? ''}
          onChange={handleContentChange}
          saving={saveStatus === 'saving'}
          autoFocus={isNew}
          className="h-full border-0 rounded-none"
        />
      </div>
    </div>
  );
}
