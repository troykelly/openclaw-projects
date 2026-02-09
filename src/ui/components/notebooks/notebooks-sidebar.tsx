/**
 * Notebooks sidebar navigation component.
 * Part of Epic #338, Issue #352
 */

import React, { useState } from 'react';
import { Book, ChevronDown, ChevronRight, Plus, MoreVertical, Pencil, Trash2, FileText, FolderOpen } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/ui/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/components/ui/tooltip';
import type { Notebook } from '../notes/types';

export interface NotebooksSidebarProps {
  notebooks: Notebook[];
  selectedNotebookId?: string;
  onSelectNotebook?: (notebook: Notebook | null) => void;
  onCreateNotebook?: () => void;
  onEditNotebook?: (notebook: Notebook) => void;
  onDeleteNotebook?: (notebook: Notebook) => void;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  className?: string;
}

function NotebookColorDot({ color }: { color?: string }) {
  return <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: color || '#6366f1' }} />;
}

export function NotebooksSidebar({
  notebooks,
  selectedNotebookId,
  onSelectNotebook,
  onCreateNotebook,
  onEditNotebook,
  onDeleteNotebook,
  collapsed = false,
  onCollapsedChange,
  className,
}: NotebooksSidebarProps) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    notebooks: true,
  });

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const totalNotes = notebooks.reduce((sum, nb) => sum + nb.noteCount, 0);

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        data-testid="notebooks-sidebar"
        className={cn('flex h-full flex-col border-r bg-muted/30 transition-all duration-300', collapsed ? 'w-12' : 'w-56', className)}
      >
        {/* Header */}
        <div className="flex h-12 items-center justify-between px-3 border-b">
          {!collapsed && <span className="text-sm font-medium text-foreground">Notes</span>}
          <div className="flex items-center gap-1">
            {onCreateNotebook && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-7" onClick={onCreateNotebook}>
                    <Plus className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">New notebook</TooltipContent>
              </Tooltip>
            )}
            {!collapsed && onCollapsedChange && (
              <Button variant="ghost" size="icon" className="size-7" onClick={() => onCollapsedChange(true)}>
                <ChevronDown className="size-4 rotate-90" />
              </Button>
            )}
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="py-2">
            {/* All Notes */}
            <button
              onClick={() => onSelectNotebook?.(null)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors',
                collapsed && 'justify-center',
                !selectedNotebookId ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <FileText className="size-4 shrink-0" />
              {!collapsed && (
                <>
                  <span className="flex-1 text-left">All Notes</span>
                  <span className="text-xs">{totalNotes}</span>
                </>
              )}
            </button>

            {/* Notebooks section */}
            {!collapsed && (
              <button
                onClick={() => toggleSection('notebooks')}
                className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                {expandedSections.notebooks ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                NOTEBOOKS
              </button>
            )}

            {(collapsed || expandedSections.notebooks) && (
              <div className={cn('space-y-0.5', !collapsed && 'pl-2')}>
                {notebooks.map((notebook) => {
                  const isSelected = selectedNotebookId === notebook.id;

                  const notebookButton = (
                    <div
                      key={notebook.id}
                      className={cn(
                        'group flex items-center gap-2 px-3 py-1.5 text-sm transition-colors cursor-pointer',
                        collapsed && 'justify-center',
                        isSelected ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                      onClick={() => onSelectNotebook?.(notebook)}
                    >
                      <NotebookColorDot color={notebook.color} />
                      {!collapsed && (
                        <>
                          <span className="flex-1 text-left truncate">{notebook.name}</span>
                          <span className="text-xs opacity-60">{notebook.noteCount}</span>

                          {/* Actions */}
                          {(onEditNotebook || onDeleteNotebook) && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="size-5 opacity-0 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
                                  <MoreVertical className="size-3" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {onEditNotebook && (
                                  <DropdownMenuItem
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onEditNotebook(notebook);
                                    }}
                                  >
                                    <Pencil className="mr-2 size-4" />
                                    Edit
                                  </DropdownMenuItem>
                                )}
                                {onDeleteNotebook && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      className="text-destructive focus:text-destructive"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onDeleteNotebook(notebook);
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
                        </>
                      )}
                    </div>
                  );

                  if (collapsed) {
                    return (
                      <Tooltip key={notebook.id}>
                        <TooltipTrigger asChild>{notebookButton}</TooltipTrigger>
                        <TooltipContent side="right">
                          {notebook.name} ({notebook.noteCount})
                        </TooltipContent>
                      </Tooltip>
                    );
                  }

                  return notebookButton;
                })}

                {notebooks.length === 0 && !collapsed && (
                  <div className="px-3 py-4 text-center">
                    <FolderOpen className="mx-auto size-8 text-muted-foreground/40" />
                    <p className="mt-2 text-xs text-muted-foreground">No notebooks yet</p>
                    {onCreateNotebook && (
                      <Button variant="ghost" size="sm" className="mt-2 h-7 text-xs" onClick={onCreateNotebook}>
                        <Plus className="mr-1 size-3" />
                        Create one
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Expand button when collapsed */}
        {collapsed && onCollapsedChange && (
          <div className="border-t p-2">
            <Button variant="ghost" size="icon" className="w-full h-7" onClick={() => onCollapsedChange(false)}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        )}
      </aside>
    </TooltipProvider>
  );
}
