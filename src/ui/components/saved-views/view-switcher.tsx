/**
 * View Switcher component
 * Issue #406: Implement saved views with sharing
 */
import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/components/ui/popover';
import { Badge } from '@/ui/components/ui/badge';
import type { SavedView } from './types';

export interface ViewSwitcherProps {
  views: SavedView[];
  activeViewId: string | null;
  onSelectView: (view: SavedView) => void;
}

export function ViewSwitcher({ views, activeViewId, onSelectView }: ViewSwitcherProps) {
  const [open, setOpen] = React.useState(false);
  const activeView = views.find((v) => v.id === activeViewId);

  const handleSelectView = (view: SavedView) => {
    onSelectView(view);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Views">
          {activeView ? activeView.name : 'Views'}
          {views.length > 0 && !activeView && (
            <Badge variant="secondary" className="ml-2">
              {views.length}
            </Badge>
          )}
          <ChevronDown className="h-4 w-4 ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1">
        {views.length === 0 ? (
          <div className="px-2 py-4 text-sm text-muted-foreground text-center">No saved views</div>
        ) : (
          <div className="space-y-1">
            {views.map((view) => (
              <button
                key={view.id}
                type="button"
                onClick={() => handleSelectView(view)}
                className={`w-full text-left px-2 py-1.5 text-sm rounded hover:bg-accent cursor-pointer ${activeViewId === view.id ? 'bg-accent' : ''}`}
              >
                <span className="truncate">{view.name}</span>
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
