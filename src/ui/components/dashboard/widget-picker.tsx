/**
 * Widget picker dialog
 * Issue #405: Implement custom dashboard builder
 */
import * as React from 'react';
import { Search, CheckSquare, Calendar, Activity, BarChart, Zap, Bell } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import { cn } from '@/ui/lib/utils';
import { WIDGET_TYPES, type WidgetType } from './types';

export interface WidgetPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (widgetType: WidgetType) => void;
  excludeTypes?: WidgetType[];
  className?: string;
}

const ICON_MAP: Record<string, React.ElementType> = {
  CheckSquare,
  Calendar,
  Activity,
  BarChart,
  Zap,
  Bell,
};

export function WidgetPicker({
  open,
  onOpenChange,
  onSelect,
  excludeTypes = [],
  className,
}: WidgetPickerProps) {
  const [search, setSearch] = React.useState('');

  const availableWidgets = React.useMemo(() => {
    const excluded = new Set(excludeTypes);
    return WIDGET_TYPES.filter((widget) => {
      if (excluded.has(widget.type)) return false;
      if (!search) return true;
      const lowerSearch = search.toLowerCase();
      return (
        widget.name.toLowerCase().includes(lowerSearch) ||
        widget.description.toLowerCase().includes(lowerSearch)
      );
    });
  }, [excludeTypes, search]);

  const handleSelect = (type: WidgetType) => {
    onSelect(type);
    onOpenChange(false);
    setSearch('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('sm:max-w-lg', className)}>
        <DialogHeader>
          <DialogTitle>Add Widget</DialogTitle>
          <DialogDescription className="sr-only">Choose a widget to add to your dashboard</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search widgets..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Widget list */}
          <div className="grid grid-cols-2 gap-3">
            {availableWidgets.map((widget) => {
              const Icon = ICON_MAP[widget.icon] || CheckSquare;

              return (
                <button
                  key={widget.type}
                  type="button"
                  onClick={() => handleSelect(widget.type)}
                  className="flex flex-col items-start gap-2 p-4 rounded-lg border hover:border-primary hover:bg-muted/50 transition-colors text-left"
                >
                  <Icon className="h-6 w-6 text-primary" />
                  <div>
                    <div className="font-medium text-sm">{widget.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {widget.description}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {availableWidgets.length === 0 && (
            <div className="py-8 text-center text-muted-foreground">
              No widgets match your search
            </div>
          )}

          {/* Cancel button */}
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
