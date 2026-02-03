/**
 * Comparison view showing baseline vs current state
 * Issue #391: Implement baseline snapshots for progress tracking
 */
import * as React from 'react';
import {
  Plus,
  Minus,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';
import { Badge } from '@/ui/components/ui/badge';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { cn } from '@/ui/lib/utils';
import {
  compareBaselines,
  formatSlippage,
  getSlippageClass,
  type BaselineSnapshot,
  type BaselineItem,
} from './baseline-utils';

export interface BaselineComparisonProps {
  baseline: BaselineSnapshot;
  currentItems: BaselineItem[];
  className?: string;
}

export function BaselineComparison({
  baseline,
  currentItems,
  className,
}: BaselineComparisonProps) {
  const comparison = React.useMemo(
    () => compareBaselines(baseline.items, currentItems),
    [baseline.items, currentItems]
  );

  return (
    <div className={cn('space-y-6', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Baseline Comparison</h3>
          <p className="text-sm text-muted-foreground">
            Comparing "{baseline.name}" to current state
          </p>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-lg border p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <span className="text-sm">Unchanged</span>
          </div>
          <div className="mt-2 text-2xl font-bold">{comparison.unchanged.length}</div>
        </div>

        <div className="rounded-lg border p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <RefreshCw className="h-4 w-4 text-amber-500" />
            <span className="text-sm">Modified</span>
          </div>
          <div className="mt-2 text-2xl font-bold">{comparison.modified.length}</div>
        </div>

        <div className="rounded-lg border p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Plus className="h-4 w-4 text-blue-500" />
            <span className="text-sm">{comparison.added.length} Added</span>
          </div>
          <div className="mt-2 text-2xl font-bold text-blue-600">+{comparison.added.length}</div>
        </div>

        <div className="rounded-lg border p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Minus className="h-4 w-4 text-red-500" />
            <span className="text-sm">{comparison.removed.length} Removed</span>
          </div>
          <div className="mt-2 text-2xl font-bold text-red-600">-{comparison.removed.length}</div>
        </div>
      </div>

      {/* Slippage Summary */}
      <div className="rounded-lg border bg-muted/30 p-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-sm text-muted-foreground">Total Slippage</div>
            <div
              className={cn(
                'text-xl font-semibold mt-1',
                comparison.totalSlippage > 0
                  ? 'text-destructive'
                  : 'text-green-600 dark:text-green-400'
              )}
            >
              {comparison.totalSlippage > 0 ? '+' : ''}
              {comparison.totalSlippage} days
            </div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Scope Change</div>
            <div
              className={cn(
                'text-xl font-semibold mt-1',
                comparison.scopeChangePercent > 25
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-muted-foreground'
              )}
            >
              {comparison.scopeChangePercent.toFixed(0)}%
            </div>
          </div>
        </div>
      </div>

      {/* Item Details */}
      <ScrollArea className="h-[400px]">
        <div className="space-y-6 pr-4">
          {/* Modified Items */}
          {comparison.modified.length > 0 && (
            <div>
              <h4 className="flex items-center gap-2 text-sm font-medium mb-3">
                <RefreshCw className="h-4 w-4 text-amber-500" />
                Modified Items ({comparison.modified.length})
              </h4>
              <div className="space-y-2">
                {comparison.modified.map(({ baseline: base, current, slippage }) => (
                  <div
                    key={current.id}
                    data-status="modified"
                    className="flex items-center justify-between p-3 rounded-md border bg-amber-50/50 dark:bg-amber-950/20"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{current.title}</div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                        <span>{base.endDate || 'No date'}</span>
                        <ArrowRight className="h-3 w-3" />
                        <span>{current.endDate || 'No date'}</span>
                      </div>
                    </div>
                    <div className={cn('text-sm font-medium shrink-0 ml-4', getSlippageClass(slippage))}>
                      {formatSlippage(slippage)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Added Items */}
          {comparison.added.length > 0 && (
            <div>
              <h4 className="flex items-center gap-2 text-sm font-medium mb-3">
                <Plus className="h-4 w-4 text-blue-500" />
                Added Items ({comparison.added.length})
              </h4>
              <div className="space-y-2">
                {comparison.added.map((item) => (
                  <div
                    key={item.id}
                    data-status="added"
                    className="flex items-center justify-between p-3 rounded-md border bg-blue-50/50 dark:bg-blue-950/20"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{item.title}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {item.endDate ? `Due: ${item.endDate}` : 'No due date'}
                      </div>
                    </div>
                    <Badge variant="secondary" className="ml-4">New</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Removed Items */}
          {comparison.removed.length > 0 && (
            <div>
              <h4 className="flex items-center gap-2 text-sm font-medium mb-3">
                <Minus className="h-4 w-4 text-red-500" />
                Removed Items ({comparison.removed.length})
              </h4>
              <div className="space-y-2">
                {comparison.removed.map((item) => (
                  <div
                    key={item.id}
                    data-status="removed"
                    className="flex items-center justify-between p-3 rounded-md border bg-red-50/50 dark:bg-red-950/20 opacity-70"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate line-through">{item.title}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {item.endDate ? `Was due: ${item.endDate}` : 'Had no due date'}
                      </div>
                    </div>
                    <Badge variant="destructive" className="ml-4">Removed</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Unchanged Items */}
          {comparison.unchanged.length > 0 && (
            <div>
              <h4 className="flex items-center gap-2 text-sm font-medium mb-3">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                Unchanged Items ({comparison.unchanged.length})
              </h4>
              <div className="space-y-2">
                {comparison.unchanged.map((item) => (
                  <div
                    key={item.id}
                    data-status="unchanged"
                    className="flex items-center justify-between p-3 rounded-md border"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{item.title}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {item.endDate ? `Due: ${item.endDate}` : 'No due date'}
                      </div>
                    </div>
                    <span className="text-sm text-muted-foreground ml-4">On track</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
