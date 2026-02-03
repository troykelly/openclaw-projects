/**
 * Notes list component with search and filters.
 * Part of Epic #338, Issue #353
 */

import React, { useState, useMemo } from 'react';
import { Search, Plus, FileText, SlidersHorizontal, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { Badge } from '@/ui/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/ui/components/ui/popover';
import { Checkbox } from '@/ui/components/ui/checkbox';
import { Label } from '@/ui/components/ui/label';
import { NoteCard } from './note-card';
import type { Note, NoteFilter, Notebook } from '../types';

export interface NotesListProps {
  notes: Note[];
  notebooks?: Notebook[];
  onNoteClick?: (note: Note) => void;
  onAddNote?: () => void;
  onEditNote?: (note: Note) => void;
  onDeleteNote?: (note: Note) => void;
  onShareNote?: (note: Note) => void;
  onTogglePin?: (note: Note) => void;
  selectedNotebookId?: string;
  className?: string;
}

export function NotesList({
  notes,
  notebooks = [],
  onNoteClick,
  onAddNote,
  onEditNote,
  onDeleteNote,
  onShareNote,
  onTogglePin,
  selectedNotebookId,
  className,
}: NotesListProps) {
  const [filter, setFilter] = useState<NoteFilter>({
    notebookId: selectedNotebookId,
  });
  const [showFilters, setShowFilters] = useState(false);

  // Update filter when selectedNotebookId changes
  React.useEffect(() => {
    setFilter((prev) => ({ ...prev, notebookId: selectedNotebookId }));
  }, [selectedNotebookId]);

  const filteredNotes = useMemo(() => {
    let result = notes;

    // Search filter
    if (filter.search?.trim()) {
      const query = filter.search.toLowerCase();
      result = result.filter(
        (n) =>
          n.title.toLowerCase().includes(query) ||
          n.content.toLowerCase().includes(query) ||
          n.tags?.some((t) => t.toLowerCase().includes(query))
      );
    }

    // Notebook filter
    if (filter.notebookId) {
      result = result.filter((n) => n.notebookId === filter.notebookId);
    }

    // Visibility filter
    if (filter.visibility) {
      result = result.filter((n) => n.visibility === filter.visibility);
    }

    // Pinned filter
    if (filter.isPinned !== undefined) {
      result = result.filter((n) => n.isPinned === filter.isPinned);
    }

    // Sort: pinned first, then by updated date
    result = [...result].sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });

    return result;
  }, [notes, filter]);

  const activeFilterCount = [
    filter.visibility,
    filter.isPinned !== undefined,
    filter.tags?.length,
  ].filter(Boolean).length;

  const clearFilters = () => {
    setFilter({ search: filter.search, notebookId: filter.notebookId });
  };

  return (
    <div className={cn('flex h-full flex-col', className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b p-4">
        <h2 className="text-lg font-semibold">
          {filter.notebookId
            ? notebooks.find((nb) => nb.id === filter.notebookId)?.name || 'Notes'
            : 'All Notes'}
        </h2>
        {onAddNote && (
          <Button size="sm" onClick={onAddNote}>
            <Plus className="mr-1 size-4" />
            New Note
          </Button>
        )}
      </div>

      {/* Search and Filters */}
      <div className="flex gap-2 border-b p-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter.search ?? ''}
            onChange={(e) => setFilter((prev) => ({ ...prev, search: e.target.value }))}
            placeholder="Search notes..."
            className="pl-9"
          />
        </div>

        {/* Notebook selector (when not already filtered) */}
        {!selectedNotebookId && notebooks.length > 0 && (
          <Select
            value={filter.notebookId ?? 'all'}
            onValueChange={(v) =>
              setFilter((prev) => ({
                ...prev,
                notebookId: v === 'all' ? undefined : v,
              }))
            }
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="All notebooks" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All notebooks</SelectItem>
              {notebooks.map((nb) => (
                <SelectItem key={nb.id} value={nb.id}>
                  {nb.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Advanced filters */}
        <Popover open={showFilters} onOpenChange={setShowFilters}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="icon" className="relative">
              <SlidersHorizontal className="size-4" />
              {activeFilterCount > 0 && (
                <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64" align="end">
            <div className="grid gap-4">
              <div className="space-y-2">
                <h4 className="font-medium leading-none">Filters</h4>
                <p className="text-sm text-muted-foreground">
                  Narrow down your notes
                </p>
              </div>

              {/* Visibility filter */}
              <div className="grid gap-2">
                <Label>Visibility</Label>
                <Select
                  value={filter.visibility ?? 'all'}
                  onValueChange={(v) =>
                    setFilter((prev) => ({
                      ...prev,
                      visibility: v === 'all' ? undefined : (v as NoteFilter['visibility']),
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="private">Private</SelectItem>
                    <SelectItem value="shared">Shared</SelectItem>
                    <SelectItem value="public">Public</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Pinned filter */}
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="pinned"
                  checked={filter.isPinned === true}
                  onCheckedChange={(checked) =>
                    setFilter((prev) => ({
                      ...prev,
                      isPinned: checked ? true : undefined,
                    }))
                  }
                />
                <Label htmlFor="pinned" className="text-sm font-normal">
                  Pinned only
                </Label>
              </div>

              {activeFilterCount > 0 && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  <X className="mr-1 size-3" />
                  Clear filters
                </Button>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Active filters display */}
      {activeFilterCount > 0 && (
        <div className="flex items-center gap-2 border-b px-4 py-2">
          <span className="text-xs text-muted-foreground">Active filters:</span>
          {filter.visibility && (
            <Badge variant="secondary" className="text-xs">
              {filter.visibility}
              <button
                className="ml-1 hover:text-foreground"
                onClick={() => setFilter((prev) => ({ ...prev, visibility: undefined }))}
              >
                <X className="size-3" />
              </button>
            </Badge>
          )}
          {filter.isPinned && (
            <Badge variant="secondary" className="text-xs">
              Pinned
              <button
                className="ml-1 hover:text-foreground"
                onClick={() => setFilter((prev) => ({ ...prev, isPinned: undefined }))}
              >
                <X className="size-3" />
              </button>
            </Badge>
          )}
        </div>
      )}

      {/* Notes grid */}
      <ScrollArea className="flex-1">
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredNotes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              onClick={onNoteClick}
              onEdit={onEditNote}
              onDelete={onDeleteNote}
              onShare={onShareNote}
              onTogglePin={onTogglePin}
            />
          ))}

          {filteredNotes.length === 0 && (
            <div className="col-span-full py-12 text-center">
              <FileText className="mx-auto size-12 text-muted-foreground/50" />
              <p className="mt-4 text-muted-foreground">
                {filter.search || activeFilterCount > 0
                  ? 'No notes found'
                  : 'No notes yet'}
              </p>
              {!filter.search && activeFilterCount === 0 && onAddNote && (
                <Button variant="outline" size="sm" className="mt-4" onClick={onAddNote}>
                  Create your first note
                </Button>
              )}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Footer with count */}
      <div className="border-t px-4 py-2 text-xs text-muted-foreground">
        {filteredNotes.length} of {notes.length} notes
      </div>
    </div>
  );
}
