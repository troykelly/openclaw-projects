/**
 * BudgetGauge — visual indicator showing budget usage percentage.
 *
 * Renders a horizontal progress bar with spent/limit label.
 * Changes color based on usage threshold (green < 75%, yellow < 90%, red >= 90%).
 *
 * Issue #2207
 */
import React from 'react';
import { Progress } from '@/ui/components/ui/progress';

export interface BudgetGaugeProps {
  /** Amount spent today (USD). */
  spent: number;
  /** Daily budget limit (USD). */
  limit: number;
}

export function BudgetGauge({ spent, limit }: BudgetGaugeProps): React.JSX.Element {
  const pct = limit > 0 ? Math.min((spent / limit) * 100, 100) : 0;

  let colorClass = 'text-green-500';
  if (pct >= 90) {
    colorClass = 'text-destructive';
  } else if (pct >= 75) {
    colorClass = 'text-yellow-500';
  }

  return (
    <div data-testid="budget-gauge" className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className={colorClass} data-testid="budget-spent">
          ${spent.toFixed(2)}
        </span>
        <span className="text-muted-foreground" data-testid="budget-limit">
          / ${limit.toFixed(2)}
        </span>
      </div>
      <Progress value={pct} className="h-2" data-testid="budget-progress" />
      <span className="text-xs text-muted-foreground" data-testid="budget-pct">
        {pct.toFixed(0)}% of daily budget
      </span>
    </div>
  );
}
