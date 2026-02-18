/**
 * Note card component for list views.
 * Part of Epic #338, Issue #353
 */

import React from 'react';
import { FileText, MoreVertical, Pencil, Trash2, Share2, Pin, PinOff, Eye, EyeOff, Lock, Users, Globe } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Badge } from '@/ui/components/ui/badge';
import { Button } from '@/ui/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/ui/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/components/ui/tooltip';
import type { Note } from '../types';

function getVisibilityIcon(visibility: Note['visibility']) {
  switch (visibility) {
    case 'private':
      return <Lock className="size-3" />;
    case 'shared':
      return <Users className="size-3" />;
    case 'public':
      return <Globe className="size-3" />;
  }
}

function getVisibilityLabel(visibility: Note['visibility']) {
  switch (visibility) {
    case 'private':
      return 'Private';
    case 'shared':
      return 'Shared';
    case 'public':
      return 'Public';
  }
}

export interface NoteCardProps {
  note: Note;
  onClick?: (note: Note) => void;
  onEdit?: (note: Note) => void;
  onDelete?: (note: Note) => void;
  onShare?: (note: Note) => void;
  onTogglePin?: (note: Note) => void;
  className?: string;
}

export function NoteCard({ note, onClick, onEdit, onDelete, onShare, onTogglePin, className }: NoteCardProps) {
  // Strip markdown for preview
  const plainContent = note.content
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/```[\s\S]*?```/g, '[code]')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  const preview = plainContent.slice(0, 150) + (plainContent.length > 150 ? '...' : '');

  return (
    <div
      data-testid="note-card"
      className={cn(
        'group relative rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50',
        note.isPinned && 'border-primary/30 bg-primary/5',
        onClick && 'cursor-pointer',
        className,
      )}
      onClick={() => onClick?.(note)}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {note.isPinned && <Pin className="size-3 text-primary shrink-0 fill-primary" />}
          <h3 className="font-medium leading-tight truncate">{note.title || 'Untitled'}</h3>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* Visibility indicator */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-muted-foreground">{getVisibilityIcon(note.visibility)}</span>
              </TooltipTrigger>
              <TooltipContent>
                <p>{getVisibilityLabel(note.visibility)}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Hidden from agents indicator */}
          {note.hideFromAgents && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-muted-foreground">
                    <EyeOff className="size-3" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Hidden from AI agents</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Actions menu */}
          {(onEdit || onDelete || onShare || onTogglePin) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-6 opacity-0 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onTogglePin && (
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      onTogglePin(note);
                    }}
                  >
                    {note.isPinned ? (
                      <>
                        <PinOff className="mr-2 size-4" />
                        Unpin
                      </>
                    ) : (
                      <>
                        <Pin className="mr-2 size-4" />
                        Pin
                      </>
                    )}
                  </DropdownMenuItem>
                )}
                {onShare && (
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      onShare(note);
                    }}
                  >
                    <Share2 className="mr-2 size-4" />
                    Share
                  </DropdownMenuItem>
                )}
                {onEdit && (
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(note);
                    }}
                  >
                    <Pencil className="mr-2 size-4" />
                    Edit
                  </DropdownMenuItem>
                )}
                {onDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(note);
                      }}
                    >
                      <Trash2 className="mr-2 size-4" />
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Preview */}
      <p className="mt-2 text-sm text-muted-foreground line-clamp-2">{preview}</p>

      {/* Footer */}
      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          {note.notebookTitle && (
            <span className="flex items-center gap-1 truncate max-w-[140px]">
              <FileText className="size-3" />
              {note.notebookTitle}
            </span>
          )}
        </div>

        <span>{note.updated_at.toLocaleDateString()}</span>
      </div>

      {/* Tags */}
      {note.tags && note.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {note.tags.slice(0, 3).map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs">
              {tag}
            </Badge>
          ))}
          {note.tags.length > 3 && (
            <Badge variant="outline" className="text-xs">
              +{note.tags.length - 3}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
