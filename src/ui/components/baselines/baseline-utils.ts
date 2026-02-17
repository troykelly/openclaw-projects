/**
 * Utility functions for baseline snapshots
 * Issue #391: Implement baseline snapshots for progress tracking
 */

import type { WorkItemStatus } from '@/ui/components/detail/types';

/**
 * A single item captured in a baseline snapshot
 */
export interface BaselineItem {
  id: string;
  title: string;
  startDate?: string;
  endDate?: string;
  estimate?: number;
  status?: WorkItemStatus | string;
  parent_id?: string;
}

/**
 * A baseline snapshot capturing project state at a point in time
 */
export interface BaselineSnapshot {
  id: string;
  name: string;
  description?: string;
  project_id: string;
  created_at: string;
  createdBy: string;
  items: BaselineItem[];
}

/**
 * Result of comparing baseline to current state
 */
export interface ComparisonResult {
  /** Items unchanged from baseline */
  unchanged: BaselineItem[];
  /** Items modified (dates or estimates changed) */
  modified: Array<{
    baseline: BaselineItem;
    current: BaselineItem;
    slippage: number;
  }>;
  /** Items added since baseline */
  added: BaselineItem[];
  /** Items removed since baseline */
  removed: BaselineItem[];
  /** Total project slippage in days */
  totalSlippage: number;
  /** Scope change percentage */
  scopeChangePercent: number;
}

/**
 * Compare baseline items to current items
 */
export function compareBaselines(baseline: BaselineItem[], current: BaselineItem[]): ComparisonResult {
  const baselineMap = new Map(baseline.map((item) => [item.id, item]));
  const currentMap = new Map(current.map((item) => [item.id, item]));

  const unchanged: BaselineItem[] = [];
  const modified: ComparisonResult['modified'] = [];
  const added: BaselineItem[] = [];
  const removed: BaselineItem[] = [];

  // Check each current item against baseline
  for (const currentItem of current) {
    const baselineItem = baselineMap.get(currentItem.id);

    if (!baselineItem) {
      // Item was added
      added.push(currentItem);
    } else {
      // Check if modified
      const slippage = calculateSlippage(baselineItem, currentItem);
      const isModified = slippage !== 0 || baselineItem.startDate !== currentItem.startDate || baselineItem.estimate !== currentItem.estimate;

      if (isModified) {
        modified.push({ baseline: baselineItem, current: currentItem, slippage });
      } else {
        unchanged.push(currentItem);
      }
    }
  }

  // Check for removed items
  for (const baselineItem of baseline) {
    if (!currentMap.has(baselineItem.id)) {
      removed.push(baselineItem);
    }
  }

  // Calculate totals
  const totalSlippage = modified.reduce((sum, m) => sum + Math.max(0, m.slippage), 0);
  const scopeChangePercent = baseline.length > 0 ? ((added.length + removed.length) / baseline.length) * 100 : 0;

  return {
    unchanged,
    modified,
    added,
    removed,
    totalSlippage,
    scopeChangePercent,
  };
}

/**
 * Calculate slippage in days between baseline and current item
 * Positive = delayed, Negative = ahead of schedule
 */
export function calculateSlippage(baseline: BaselineItem, current: BaselineItem): number {
  if (!baseline.endDate || !current.endDate) {
    return 0;
  }

  const baselineEnd = new Date(baseline.endDate);
  const currentEnd = new Date(current.endDate);

  // Calculate difference in days
  const diffMs = currentEnd.getTime() - baselineEnd.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Format slippage for display
 */
export function formatSlippage(days: number): string {
  if (days === 0) {
    return 'On track';
  }

  const absValue = Math.abs(days);
  const unit = absValue === 1 ? 'day' : 'days';
  const sign = days > 0 ? '+' : '';

  return `${sign}${days} ${unit}`;
}

/**
 * Get CSS class for slippage indicator
 */
export function getSlippageClass(days: number): string {
  if (days > 0) {
    return 'text-destructive';
  }
  if (days < 0) {
    return 'text-green-600 dark:text-green-400';
  }
  return 'text-muted-foreground';
}
