/**
 * Types for dependency management
 * Issue #390: Implement dependency creation UI
 */

import type { WorkItemKind, WorkItemStatus } from '@/ui/components/detail/types';

/**
 * Dependency type representing the relationship between tasks
 * - finish_to_start: B can't start until A finishes (default, most common)
 * - start_to_start: B can't start until A starts
 * - finish_to_finish: B can't finish until A finishes
 * - start_to_finish: B can't finish until A starts
 */
export type DependencyType = 'finish_to_start' | 'start_to_start' | 'finish_to_finish' | 'start_to_finish';

/**
 * Direction of the dependency relationship
 * - blocks: this item blocks the target item
 * - blocked_by: this item is blocked by the target item
 */
export type DependencyDirection = 'blocks' | 'blocked_by';

/**
 * Minimal work item info for dependency selection
 */
export interface WorkItemSummary {
  id: string;
  title: string;
  kind: WorkItemKind;
  status: WorkItemStatus;
}

/**
 * Full dependency information
 */
export interface Dependency {
  id: string;
  targetId: string;
  title: string;
  kind: WorkItemKind;
  status: WorkItemStatus;
  direction: DependencyDirection;
  type: DependencyType;
  lagDays?: number;
}

/**
 * Parameters for creating a new dependency
 */
export interface CreateDependencyParams {
  targetId: string;
  direction: DependencyDirection;
  type: DependencyType;
  lagDays?: number;
}
