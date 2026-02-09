/**
 * Hierarchy validation utilities for work item moves
 *
 * Hierarchy rules:
 * - Project: can only be root (no parent)
 * - Initiative: parent must be project
 * - Epic: parent must be project or initiative
 * - Issue: parent must be project, initiative, or epic
 */

import type { TreeItemKind } from '@/ui/components/tree/types';

/**
 * Returns the valid parent kinds for a given item kind.
 * If the array is empty, the item must be at root level.
 */
export function getValidParentKinds(kind: TreeItemKind): TreeItemKind[] {
  switch (kind) {
    case 'project':
      // Projects must be root - no parent allowed
      return [];
    case 'initiative':
      // Initiatives can only be under projects
      return ['project'];
    case 'epic':
      // Epics can be under projects or initiatives
      return ['project', 'initiative'];
    case 'issue':
      // Issues can be under projects, initiatives, or epics
      return ['project', 'initiative', 'epic'];
  }
}

/**
 * Check if an item can be moved to a specific parent.
 *
 * @param item - The item being moved
 * @param targetParent - The potential new parent (null for root)
 * @returns true if the move is valid
 */
export function canMoveToParent(item: { id: string; kind: TreeItemKind }, targetParent: { id: string; kind: TreeItemKind } | null): boolean {
  // Can't move item to itself
  if (targetParent && item.id === targetParent.id) {
    return false;
  }

  const validParentKinds = getValidParentKinds(item.kind);

  // If no valid parent kinds, item must be root
  if (validParentKinds.length === 0) {
    return targetParent === null;
  }

  // Item cannot be root if it requires a parent
  if (targetParent === null) {
    return false;
  }

  // Check if target parent's kind is in the valid list
  return validParentKinds.includes(targetParent.kind);
}

/**
 * Check if moving an item would create a circular dependency.
 * This happens when the target parent is a descendant of the item being moved.
 *
 * @param itemId - The ID of the item being moved
 * @param targetParentId - The ID of the target parent
 * @param getChildren - Function to get children of an item
 * @returns true if the move would create a cycle
 */
export function wouldCreateCycle(itemId: string, targetParentId: string, getChildren: (id: string) => string[]): boolean {
  // Check if targetParentId is a descendant of itemId
  const visited = new Set<string>();
  const queue = [itemId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const children = getChildren(current);
    for (const childId of children) {
      if (childId === targetParentId) {
        return true;
      }
      queue.push(childId);
    }
  }

  return false;
}
