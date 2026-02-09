/**
 * Note version history component.
 * Part of Epic #338, Issue #356
 */

import React, { useState, useMemo } from 'react';
import { History, RotateCcw, Eye, ChevronRight, Calendar, User, FileText, Loader2, X } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import { Badge } from '@/ui/components/ui/badge';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/ui/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/components/ui/tooltip';
import { Separator } from '@/ui/components/ui/separator';
import type { Note, NoteVersion } from '../types';

export interface VersionHistoryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  note: Note;
  versions: NoteVersion[];
  onPreviewVersion?: (version: NoteVersion) => void;
  onRestoreVersion?: (version: NoteVersion) => Promise<void>;
  className?: string;
}

function formatDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

function getContentDiff(current: string, previous: string): { added: number; removed: number } {
  const currentWords = current.split(/\s+/).length;
  const previousWords = previous.split(/\s+/).length;
  const diff = currentWords - previousWords;

  return {
    added: diff > 0 ? diff : 0,
    removed: diff < 0 ? Math.abs(diff) : 0,
  };
}

export function VersionHistory({ open, onOpenChange, note, versions, onPreviewVersion, onRestoreVersion, className }: VersionHistoryProps) {
  const [selectedVersion, setSelectedVersion] = useState<NoteVersion | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  // Sort versions by version number (newest first)
  const sortedVersions = useMemo(() => [...versions].sort((a, b) => b.version - a.version), [versions]);

  const handleRestore = async (version: NoteVersion) => {
    if (!onRestoreVersion) return;
    setRestoringId(version.id);
    try {
      await onRestoreVersion(version);
      onOpenChange(false);
    } finally {
      setRestoringId(null);
    }
  };

  const handlePreview = (version: NoteVersion) => {
    setSelectedVersion(version);
    onPreviewVersion?.(version);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className={cn('sm:max-w-lg', className)}>
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <History className="size-5" />
            Version History
          </SheetTitle>
          <SheetDescription>View and restore previous versions of "{note.title || 'Untitled'}"</SheetDescription>
        </SheetHeader>

        <div className="flex h-[calc(100vh-8rem)] flex-col mt-4">
          {/* Current version indicator */}
          <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 mb-4">
            <Badge variant="default">Current</Badge>
            <span className="text-sm font-medium">Version {note.version}</span>
            <span className="text-xs text-muted-foreground ml-auto">{formatDate(note.updatedAt)}</span>
          </div>

          <Separator className="mb-4" />

          {/* Version list */}
          <ScrollArea className="flex-1 -mx-6 px-6">
            {sortedVersions.length === 0 ? (
              <div className="py-12 text-center">
                <FileText className="mx-auto size-12 text-muted-foreground/40" />
                <p className="mt-4 text-sm text-muted-foreground">No previous versions available</p>
                <p className="text-xs text-muted-foreground mt-1">Versions are created when you save changes</p>
              </div>
            ) : (
              <div className="space-y-3">
                {sortedVersions.map((version, index) => {
                  const isSelected = selectedVersion?.id === version.id;
                  const previousVersion = sortedVersions[index + 1];
                  const diff = previousVersion ? getContentDiff(version.content, previousVersion.content) : null;

                  return (
                    <div
                      key={version.id}
                      className={cn(
                        'group rounded-lg border p-3 transition-colors',
                        isSelected ? 'border-primary bg-primary/5' : 'hover:border-muted-foreground/30',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              v{version.version}
                            </Badge>
                            <span className="text-xs text-muted-foreground">{formatDate(version.changedAt)}</span>
                          </div>

                          {/* Title change indicator */}
                          {version.title !== note.title && <div className="mt-1 text-sm truncate">Title: {version.title}</div>}

                          {/* Change reason */}
                          {version.changeReason && <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{version.changeReason}</p>}

                          {/* Change stats */}
                          <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <User className="size-3" />
                              {version.changedBy}
                            </span>
                            {diff && (diff.added > 0 || diff.removed > 0) && (
                              <span className="flex items-center gap-1">
                                {diff.added > 0 && <span className="text-green-600">+{diff.added} words</span>}
                                {diff.added > 0 && diff.removed > 0 && ', '}
                                {diff.removed > 0 && <span className="text-red-600">-{diff.removed} words</span>}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {onPreviewVersion && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="ghost" size="icon" className="size-7" onClick={() => handlePreview(version)}>
                                    <Eye className="size-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Preview</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                          {onRestoreVersion && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-7"
                                    onClick={() => handleRestore(version)}
                                    disabled={restoringId === version.id}
                                  >
                                    {restoringId === version.id ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Restore</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                      </div>

                      {/* Preview content when selected */}
                      {isSelected && (
                        <div className="mt-3 pt-3 border-t">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-medium">Preview</span>
                            <Button variant="ghost" size="icon" className="size-5" onClick={() => setSelectedVersion(null)}>
                              <X className="size-3" />
                            </Button>
                          </div>
                          <div className="max-h-40 overflow-y-auto rounded border bg-muted/50 p-2 text-xs font-mono whitespace-pre-wrap">
                            {version.content.slice(0, 500)}
                            {version.content.length > 500 && '...'}
                          </div>
                          {onRestoreVersion && (
                            <Button size="sm" className="mt-2 w-full" onClick={() => handleRestore(version)} disabled={restoringId === version.id}>
                              {restoringId === version.id ? <Loader2 className="mr-2 size-3.5 animate-spin" /> : <RotateCcw className="mr-2 size-3.5" />}
                              Restore this version
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>

          {/* Footer info */}
          <div className="pt-4 text-xs text-muted-foreground text-center">
            {sortedVersions.length} previous version{sortedVersions.length !== 1 ? 's' : ''}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
