/**
 * Dashboard widget container
 * Issue #405: Implement custom dashboard builder
 */
import * as React from 'react';
import { Settings, X, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { cn } from '@/ui/lib/utils';

export interface DashboardWidgetProps {
  id: string;
  title: string;
  children: React.ReactNode;
  onConfigure?: () => void;
  onRemove?: () => void;
  loading?: boolean;
  error?: string;
  className?: string;
}

export function DashboardWidget({
  id,
  title,
  children,
  onConfigure,
  onRemove,
  loading = false,
  error,
  className,
}: DashboardWidgetProps) {
  return (
    <div
      data-testid={`widget-container-${id}`}
      className={cn(
        'h-full rounded-lg border bg-card flex flex-col',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h3 className="font-medium text-sm">{title}</h3>
        <div className="flex items-center gap-1">
          {onConfigure && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onConfigure}
              aria-label="Configure widget"
            >
              <Settings className="h-4 w-4" />
            </Button>
          )}
          {onRemove && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={onRemove}
              aria-label="Remove widget"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div
            data-testid="widget-loading"
            className="flex items-center justify-center h-full"
          >
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <AlertCircle className="h-6 w-6 mb-2 text-destructive" />
            <p className="text-sm">{error}</p>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
