/**
 * Note detail and editor view component.
 * Part of Epic #338, Issue #354
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  ArrowLeft,
  Save,
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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import { Badge } from '@/ui/components/ui/badge';
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
import { NoteEditor, type EditorMode } from '../editor';
import type { Note, NoteVisibility, Notebook } from '../types';

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
  const [title, setTitle] = useState(note?.title || '');
  const [content, setContent] = useState(note?.content || '');
  const [notebookId, setNotebookId] = useState(note?.notebookId);
  const [visibility, setVisibility] = useState<NoteVisibility>(note?.visibility || 'private');
  const [hideFromAgents, setHideFromAgents] = useState(note?.hideFromAgents || false);
  const [hasChanges, setHasChanges] = useState(false);

  // Track changes
  useEffect(() => {
    if (!note) {
      setHasChanges(title.trim() !== '' || content.trim() !== '');
      return;
    }
    const changed =
      title !== note.title ||
      content !== note.content ||
      notebookId !== note.notebookId ||
      visibility !== note.visibility ||
      hideFromAgents !== note.hideFromAgents;
    setHasChanges(changed);
  }, [note, title, content, notebookId, visibility, hideFromAgents]);

  // Reset when note changes
  useEffect(() => {
    if (note) {
      setTitle(note.title);
      setContent(note.content);
      setNotebookId(note.notebookId);
      setVisibility(note.visibility);
      setHideFromAgents(note.hideFromAgents);
    }
  }, [note]);

  const handleSave = useCallback(async () => {
    if (!onSave) return;
    await onSave({
      title: title.trim() || 'Untitled',
      content,
      notebookId,
      visibility,
      hideFromAgents,
    });
    setHasChanges(false);
  }, [onSave, title, content, notebookId, visibility, hideFromAgents]);

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
          placeholder="Note title..."
          className="flex-1 border-0 bg-transparent text-lg font-semibold focus-visible:ring-0 px-0"
        />

        {/* Actions */}
        <div className="flex items-center gap-2">
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

          {/* Save button */}
          {onSave && (
            <Button
              onClick={handleSave}
              disabled={saving || !hasChanges}
            >
              {saving ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Save className="mr-2 size-4" />
              )}
              {saving ? 'Saving...' : 'Save'}
            </Button>
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

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        <NoteEditor
          initialContent={content}
          onChange={handleContentChange}
          onSave={handleSave}
          saving={saving}
          autoFocus={isNew}
          className="h-full border-0 rounded-none"
        />
      </div>

      {/* Unsaved changes indicator */}
      {hasChanges && (
        <div className="border-t px-4 py-2 bg-amber-50 dark:bg-amber-950/20 text-xs text-amber-700 dark:text-amber-400">
          You have unsaved changes
        </div>
      )}
    </div>
  );
}
