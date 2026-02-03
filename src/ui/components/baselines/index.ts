/**
 * Baseline snapshot components
 * Issue #391: Implement baseline snapshots for progress tracking
 */
export { CreateBaselineDialog } from './create-baseline-dialog';
export type { CreateBaselineDialogProps } from './create-baseline-dialog';
export { BaselineList } from './baseline-list';
export type { BaselineListProps } from './baseline-list';
export { BaselineComparison } from './baseline-comparison';
export type { BaselineComparisonProps } from './baseline-comparison';
export {
  compareBaselines,
  calculateSlippage,
  formatSlippage,
  getSlippageClass,
  type BaselineSnapshot,
  type BaselineItem,
  type ComparisonResult,
} from './baseline-utils';
