/**
 * Note detail and editor view component.
 * Part of Epic #338, Issues #354, #774, #775, #2256
 *
 * Features:
 * - Auto-generated title for new notes (e.g., "Feb 6, 2026 11:00")
 * - Yjs collaborative editing for content (#2256)
 * - Debounced metadata save (title, notebook, visibility, hide_from_agents) — 5s
 * - Three-tier Yjs-aware save status indicator
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
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
  Wifi,
  WifiOff,
} from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/ui/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/components/ui/tooltip';
import { Switch } from '@/ui/components/ui/switch';
import { Label } from '@/ui/components/ui/label';
import { NoteEditor } from '../editor';
import { ExportButton } from '../export';
import { useYjsProvider } from '@/ui/hooks/use-yjs-provider';
import type { YjsConnectionStatus } from '@/ui/hooks/use-yjs-provider';
import type { Note, NoteVisibility, Notebook } from '../types';

/** Metadata save debounce delay (5 seconds) */
const METADATA_SAVE_DELAY_MS = 5000;

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
  onSave?: (data: { title: string; content: string; notebook_id?: string; visibility: NoteVisibility; hide_from_agents: boolean }) => Promise<void>;
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
  const [notebook_id, setNotebookId] = useState(note?.notebook_id);
  const [visibility, setVisibility] = useState<NoteVisibility>(note?.visibility || 'private');
  const [hide_from_agents, setHideFromAgents] = useState(note?.hide_from_agents || false);
  const [metadataSaveStatus, setMetadataSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [metadataSaveError, setMetadataSaveError] = useState<string | null>(null);

  // Track content for non-Yjs fallback (when Yjs is disabled, content changes flow through onChange)
  const [localContent, setLocalContent] = useState(note?.content ?? '');

  // Track whether we've created the note yet (for new notes)
  const [noteCreated, setNoteCreated] = useState(!isNew);

  // Yjs collaborative editing (#2256)
  const noteId = note?.id ?? null;
  const { doc: yjsDoc, provider: yjsProvider, status: yjsStatus, yjsEnabled } = useYjsProvider(noteCreated ? noteId : null);

  // Refs for metadata save
  const metadataSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedMetadataRef = useRef<{
    title: string;
    notebook_id?: string;
    visibility: NoteVisibility;
    hide_from_agents: boolean;
  } | null>(
    note
      ? {
          title: note.title,
          notebook_id: note.notebook_id,
          visibility: note.visibility,
          hide_from_agents: note.hide_from_agents,
        }
      : null,
  );

  // Handle content change from editor (keeps localContent in sync for both Yjs and non-Yjs modes)
  const handleContentChange = useCallback((content: string) => {
    setLocalContent(content);
  }, []);

  // Check if there are unsaved changes (metadata, or content when Yjs is disabled)
  const hasMetadataChanges = useMemo(() => {
    if (!lastSavedMetadataRef.current) {
      return title.trim() !== '' || (!yjsEnabled && localContent !== (note?.content ?? ''));
    }
    const metaChanged =
      title !== lastSavedMetadataRef.current.title ||
      notebook_id !== lastSavedMetadataRef.current.notebook_id ||
      visibility !== lastSavedMetadataRef.current.visibility ||
      hide_from_agents !== lastSavedMetadataRef.current.hide_from_agents;
    // When Yjs is disabled, content changes also need saving via the REST path
    const contentChanged = !yjsEnabled && localContent !== (note?.content ?? '');
    return metaChanged || contentChanged;
  }, [title, notebook_id, visibility, hide_from_agents, yjsEnabled, localContent, note?.content]);

  // Reset when note changes (e.g., navigating to different note)
  useEffect(() => {
    if (note) {
      setTitle(note.title);
      setLocalContent(note.content ?? '');
      setNotebookId(note.notebook_id);
      setVisibility(note.visibility);
      setHideFromAgents(note.hide_from_agents);
      setNoteCreated(true);
      lastSavedMetadataRef.current = {
        title: note.title,
        notebook_id: note.notebook_id,
        visibility: note.visibility,
        hide_from_agents: note.hide_from_agents,
      };
      setMetadataSaveStatus('idle');
      setMetadataSaveError(null);
    }
  }, [note]);

  // Perform metadata-only save (title, notebook_id, visibility, hide_from_agents)
  const performMetadataSave = useCallback(async () => {
    if (!onSave) return;

    const currentTitle = title.trim() || autoTitle;
    const data = {
      title: currentTitle,
      // localContent is kept in sync via ContentSyncPlugin onChange in both Yjs and non-Yjs modes.
      content: localContent,
      notebook_id,
      visibility,
      hide_from_agents,
    };

    setMetadataSaveStatus('saving');
    setMetadataSaveError(null);

    try {
      await onSave(data);
      lastSavedMetadataRef.current = {
        title: currentTitle,
        notebook_id,
        visibility,
        hide_from_agents,
      };
      setNoteCreated(true);
      setMetadataSaveStatus('saved');

      if (statusResetTimerRef.current) {
        clearTimeout(statusResetTimerRef.current);
      }
      statusResetTimerRef.current = setTimeout(() => {
        setMetadataSaveStatus((current) => (current === 'saved' ? 'idle' : current));
      }, 3000);
    } catch (error) {
      console.error('[NoteDetail] Metadata save failed:', error);
      setMetadataSaveError('Unable to save. Please try again.');
      setMetadataSaveStatus('error');
    }
  }, [onSave, title, notebook_id, visibility, hide_from_agents, autoTitle, localContent]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (statusResetTimerRef.current) {
        clearTimeout(statusResetTimerRef.current);
      }
      if (metadataSaveTimerRef.current) {
        clearTimeout(metadataSaveTimerRef.current);
      }
    };
  }, []);

  // Debounced metadata save — 5 seconds after last metadata change
  useEffect(() => {
    if (!onSave || !hasMetadataChanges || metadataSaveStatus === 'saving') {
      return;
    }

    // For new notes, require at least a title before first save
    if (!noteCreated && !title.trim()) {
      return;
    }

    if (metadataSaveTimerRef.current) {
      clearTimeout(metadataSaveTimerRef.current);
    }

    metadataSaveTimerRef.current = setTimeout(() => {
      performMetadataSave();
    }, METADATA_SAVE_DELAY_MS);

    return () => {
      if (metadataSaveTimerRef.current) {
        clearTimeout(metadataSaveTimerRef.current);
      }
    };
  }, [onSave, hasMetadataChanges, noteCreated, title, performMetadataSave, metadataSaveStatus]);

  // Sync with external saving state
  useEffect(() => {
    if (saving) {
      setMetadataSaveStatus('saving');
    }
  }, [saving]);

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

  // Three-tier Yjs-aware save status indicator (#2256)
  const SaveStatusIndicator = () => {
    // If Yjs is enabled, show Yjs connection status
    if (yjsEnabled) {
      return <YjsSaveStatus status={yjsStatus} metadataStatus={metadataSaveStatus} metadataError={metadataSaveError} />;
    }

    // Fallback to metadata-only status when Yjs is not active
    switch (metadataSaveStatus) {
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
                <p>{metadataSaveError || 'Failed to save note'}</p>
                <p className="text-xs text-muted-foreground mt-1">Changes will be retried automatically</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      default:
        if (hasMetadataChanges) {
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
                <Select value={visibility} onValueChange={(v) => setVisibility(v as NoteVisibility)}>
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

          {/* Export / Download button (#2479) */}
          {note && !isNew && (
            <ExportButton
              sourceType="note"
              sourceId={note.id}
              sourceName={note.title}
            />
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
                    {note?.is_pinned ? (
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
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
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
          <Select value={notebook_id ?? 'none'} onValueChange={(v) => setNotebookId(v === 'none' ? undefined : v)}>
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
          <Switch id="hide-from-agents" checked={hide_from_agents} onCheckedChange={setHideFromAgents} className="h-4 w-7" />
          <Label htmlFor="hide-from-agents" className="text-xs text-muted-foreground cursor-pointer">
            {hide_from_agents ? (
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
            v{note.version} · Updated {note.updated_at.toLocaleDateString()}
          </span>
        )}
      </div>

      {/* Editor - key forces remount when switching notes (#786) */}
      <div className="flex-1 overflow-hidden">
        <NoteEditor
          key={note?.id ?? 'new'}
          initialContent={note?.content ?? ''}
          onChange={handleContentChange}
          saving={metadataSaveStatus === 'saving'}
          autoFocus={isNew}
          className="h-full border-0 rounded-none"
          yjsDoc={yjsDoc}
          yjsProvider={yjsProvider}
          yjsEnabled={yjsEnabled}
          yjsId={noteId ?? undefined}
          currentUser={{ name: 'User', color: '#3b82f6' }}
        />
      </div>
    </div>
  );
}

/** Three-tier Yjs-aware save status (#2256) */
function YjsSaveStatus({
  status,
  metadataStatus,
  metadataError,
}: {
  status: YjsConnectionStatus;
  metadataStatus: 'idle' | 'saving' | 'saved' | 'error';
  metadataError: string | null;
}) {
  // Show metadata errors prominently
  if (metadataStatus === 'error') {
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
            <p>{metadataError || 'Failed to save note metadata'}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (metadataStatus === 'saving') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        <span>Saving metadata...</span>
      </div>
    );
  }

  switch (status) {
    case 'synced':
      return (
        <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
          <Check className="size-3" />
          <span>All changes synced</span>
        </div>
      );
    case 'connected':
      return (
        <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
          <Wifi className="size-3" />
          <span>Syncing...</span>
        </div>
      );
    case 'connecting':
      return (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          <span>Connecting...</span>
        </div>
      );
    case 'disconnected':
      return (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <WifiOff className="size-3" />
          <span>Offline — reconnecting...</span>
        </div>
      );
    default:
      return (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Cloud className="size-3" />
          <span>All changes saved</span>
        </div>
      );
  }
}
