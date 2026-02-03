/**
 * Types for Clone Dialog component
 */

/**
 * Work item data needed for cloning
 */
export interface WorkItemForClone {
  id: string;
  title: string;
  kind: string;
  hasChildren: boolean;
  hasTodos: boolean;
}

/**
 * Options selected by user for cloning
 */
export interface CloneOptions {
  title: string;
  includeChildren: boolean;
  includeTodos: boolean;
}

/**
 * Props for CloneDialog component
 */
export interface CloneDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** The work item to clone */
  item: WorkItemForClone;
  /** Callback when user confirms clone */
  onClone: (options: CloneOptions) => void;
  /** Callback when user cancels */
  onCancel: () => void;
  /** Whether clone operation is in progress */
  isCloning?: boolean;
}
