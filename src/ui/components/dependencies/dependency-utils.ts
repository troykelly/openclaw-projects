/**
 * Utility functions for dependency management
 * Issue #390: Implement dependency creation UI
 */

import type { DependencyType, WorkItemSummary } from './types';

/**
 * Graph representation: Map from task ID to array of task IDs it blocks
 */
export type DependencyGraph = Map<string, string[]>;

/**
 * Detect if adding a new dependency would create a circular dependency
 *
 * @param graph - Current dependency graph (from -> [blocks])
 * @param fromId - ID of the task that would block
 * @param toId - ID of the task that would be blocked
 * @returns true if adding this edge would create a cycle
 */
export function detectCircularDependency(graph: DependencyGraph, fromId: string, toId: string): boolean {
  // Self-reference is always circular
  if (fromId === toId) {
    return true;
  }

  // Check if there's a path from toId to fromId in the existing graph
  // If so, adding fromId -> toId would create a cycle
  const visited = new Set<string>();
  const stack = [toId];

  while (stack.length > 0) {
    const current = stack.pop()!;

    if (current === fromId) {
      return true; // Found a path back to fromId - cycle detected
    }

    if (visited.has(current)) {
      continue;
    }

    visited.add(current);

    // Add all nodes that current blocks to the stack
    const blockedBy = graph.get(current) || [];
    for (const blocked of blockedBy) {
      if (!visited.has(blocked)) {
        stack.push(blocked);
      }
    }
  }

  return false;
}

/**
 * Get human-readable label for dependency type
 */
export function getDependencyTypeLabel(type: DependencyType): string {
  const labels: Record<DependencyType, string> = {
    finish_to_start: 'Finish to Start',
    start_to_start: 'Start to Start',
    finish_to_finish: 'Finish to Finish',
    start_to_finish: 'Start to Finish',
  };
  return labels[type];
}

/**
 * Get short description for dependency type
 */
export function getDependencyTypeDescription(type: DependencyType): string {
  const descriptions: Record<DependencyType, string> = {
    finish_to_start: 'Target cannot start until source finishes',
    start_to_start: 'Target cannot start until source starts',
    finish_to_finish: 'Target cannot finish until source finishes',
    start_to_finish: 'Target cannot finish until source starts',
  };
  return descriptions[type];
}

/**
 * Check if a work item can be added as a dependency
 *
 * @param item - The potential dependency item
 * @param sourceId - The source item ID
 * @param existingDependencyIds - IDs of already linked dependencies
 * @returns true if the item can be added as a dependency
 */
export function isValidDependency(item: WorkItemSummary, sourceId: string, existingDependencyIds: string[]): boolean {
  // Cannot add self as dependency
  if (item.id === sourceId) {
    return false;
  }

  // Cannot add already linked item
  if (existingDependencyIds.includes(item.id)) {
    return false;
  }

  return true;
}

/**
 * Build a dependency graph from a list of dependencies
 */
export function buildDependencyGraph(dependencies: Array<{ fromId: string; toId: string }>): DependencyGraph {
  const graph: DependencyGraph = new Map();

  for (const dep of dependencies) {
    const existing = graph.get(dep.fromId) || [];
    existing.push(dep.toId);
    graph.set(dep.fromId, existing);

    // Ensure toId exists in graph even with empty array
    if (!graph.has(dep.toId)) {
      graph.set(dep.toId, []);
    }
  }

  return graph;
}
