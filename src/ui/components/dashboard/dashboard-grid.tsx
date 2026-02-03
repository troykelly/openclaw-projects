/**
 * Dashboard grid layout
 * Issue #405: Implement custom dashboard builder
 */
import * as React from 'react';
import { Plus, Pencil, Check, LayoutGrid } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { cn } from '@/ui/lib/utils';
import { DashboardWidget } from './dashboard-widget';
import type { Widget } from './types';

export interface DashboardGridProps {
  widgets: Widget[];
  onLayoutChange: (widgets: Widget[]) => void;
  onRemoveWidget: (widgetId: string) => void;
  onAddWidget?: () => void;
  onConfigureWidget?: (widgetId: string) => void;
  editable?: boolean;
  isEditing?: boolean;
  onEditModeChange?: (editing: boolean) => void;
  renderWidget?: (widget: Widget) => React.ReactNode;
  className?: string;
}

export function DashboardGrid({
  widgets,
  onLayoutChange,
  onRemoveWidget,
  onAddWidget,
  onConfigureWidget,
  editable = false,
  isEditing = false,
  onEditModeChange,
  renderWidget,
  className,
}: DashboardGridProps) {
  if (widgets.length === 0 && !isEditing) {
    return (
      <div className={cn('flex flex-col items-center justify-center py-12', className)}>
        <LayoutGrid className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium mb-2">No widgets yet</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Add widgets to customize your dashboard
        </p>
        {onAddWidget && (
          <Button onClick={onAddWidget}>
            <Plus className="h-4 w-4 mr-2" />
            Add Widget
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Toolbar */}
      {editable && (
        <div className="flex items-center justify-between">
          {onAddWidget && (
            <Button variant="outline" size="sm" onClick={onAddWidget}>
              <Plus className="h-4 w-4 mr-2" />
              Add Widget
            </Button>
          )}
          {onEditModeChange && (
            <Button
              variant={isEditing ? 'default' : 'outline'}
              size="sm"
              onClick={() => onEditModeChange(!isEditing)}
              aria-label={isEditing ? 'Done editing' : 'Edit dashboard'}
            >
              {isEditing ? (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Done
                </>
              ) : (
                <>
                  <Pencil className="h-4 w-4 mr-2" />
                  Customize
                </>
              )}
            </Button>
          )}
        </div>
      )}

      {/* Grid */}
      <div className="grid grid-cols-4 gap-4 auto-rows-[200px]">
        {widgets.map((widget) => {
          const style: React.CSSProperties = {
            gridColumn: `span ${widget.w}`,
            gridRow: `span ${widget.h}`,
          };

          return (
            <div
              key={widget.id}
              data-testid={`grid-cell-${widget.id}`}
              style={style}
              className={cn(
                'relative',
                isEditing && 'ring-2 ring-primary/20 ring-offset-2 rounded-lg'
              )}
            >
              {renderWidget ? (
                renderWidget(widget)
              ) : (
                <DashboardWidget
                  id={widget.id}
                  title={widget.type}
                  onRemove={isEditing ? () => onRemoveWidget(widget.id) : undefined}
                  onConfigure={
                    onConfigureWidget
                      ? () => onConfigureWidget(widget.id)
                      : undefined
                  }
                >
                  <div className="text-muted-foreground text-sm">
                    Widget: {widget.type}
                  </div>
                </DashboardWidget>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
