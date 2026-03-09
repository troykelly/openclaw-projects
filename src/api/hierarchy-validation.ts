/**
 * Centralized hierarchy validation for work items.
 * Issue #2293: Extract duplicated hierarchy checks into a shared function.
 *
 * Hierarchy rules:
 *  - project:    no parent allowed
 *  - initiative: parent must be project (or null for top-level)
 *  - epic:       parent must be initiative (required)
 *  - issue:      parent must be epic (or null for standalone/triage)
 *  - task:       any parent allowed except list
 *  - list:       no parent, no children under it
 */

/** Valid work item kinds */
export type WorkItemKind = 'project' | 'initiative' | 'epic' | 'issue' | 'task' | 'list';

/** Result of hierarchy validation */
export interface HierarchyValidation {
  valid: boolean;
  error?: string;
}

const VALID_KINDS = new Set<string>(['project', 'initiative', 'epic', 'issue', 'task', 'list']);

/**
 * Check whether a kind string is a valid WorkItemKind.
 */
export function isValidWorkItemKind(kind: string): kind is WorkItemKind {
  return VALID_KINDS.has(kind);
}

/**
 * Validate hierarchy constraints for a child of the given kind under a parent of the given kind.
 * @param childKind  The kind of the item being created/moved
 * @param parentKind The kind of the intended parent (null if no parent)
 */
export function validateHierarchy(
  childKind: WorkItemKind,
  parentKind: WorkItemKind | null,
): HierarchyValidation {
  // Lists cannot have children
  if (parentKind === 'list') {
    return { valid: false, error: 'cannot create child under a list' };
  }

  switch (childKind) {
    case 'project':
      if (parentKind !== null) {
        return { valid: false, error: 'project cannot have parent' };
      }
      return { valid: true };

    case 'list':
      if (parentKind !== null) {
        return { valid: false, error: 'list cannot have parent' };
      }
      return { valid: true };

    case 'initiative':
      if (parentKind !== null && parentKind !== 'project') {
        return { valid: false, error: 'initiative parent must be project' };
      }
      return { valid: true };

    case 'epic':
      if (parentKind !== 'initiative') {
        return { valid: false, error: 'epic parent must be initiative' };
      }
      return { valid: true };

    case 'issue':
      if (parentKind !== null && parentKind !== 'epic') {
        return { valid: false, error: 'issue parent must be epic' };
      }
      return { valid: true };

    case 'task':
      // Tasks can have any parent except list (handled above)
      return { valid: true };

    default:
      return { valid: false, error: `unknown kind: ${childKind}` };
  }
}
