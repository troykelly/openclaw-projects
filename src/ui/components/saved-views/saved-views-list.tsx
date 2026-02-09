/**
 * Saved Views List component
 * Issue #406: Implement saved views with sharing
 */
import * as React from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { Badge } from '@/ui/components/ui/badge';
import { cn } from '@/ui/lib/utils';
import type { SavedView } from './types';

export interface SavedViewsListProps {
  views: SavedView[];
  activeViewId?: string | null;
  onSelectView: (view: SavedView) => void;
  onEditView: (view: SavedView) => void;
  onDeleteView: (viewId: string) => void;
}

export function SavedViewsList({ views, activeViewId, onSelectView, onEditView, onDeleteView }: SavedViewsListProps) {
  if (views.length === 0) {
    return <div className="text-center py-8 text-muted-foreground">No saved views yet. Save your current filters to create one.</div>;
  }

  return (
    <div className="space-y-2">
      {views.map((view) => {
        const isActive = activeViewId === view.id;

        return (
          <div
            key={view.id}
            data-testid={`saved-view-${view.id}`}
            data-active={isActive}
            className={cn(
              'flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors',
              isActive ? 'bg-accent border-accent-foreground/20' : 'hover:bg-muted/50',
            )}
            onClick={() => onSelectView(view)}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium truncate">{view.name}</span>
                {view.config.viewType && (
                  <Badge variant="secondary" className="text-xs">
                    {view.config.viewType}
                  </Badge>
                )}
              </div>
              {view.description && <p className="text-sm text-muted-foreground truncate mt-1">{view.description}</p>}
            </div>

            <div className="flex items-center gap-1 ml-2">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Edit view"
                onClick={(e) => {
                  e.stopPropagation();
                  onEditView(view);
                }}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Delete view"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteView(view.id);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
