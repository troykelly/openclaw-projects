/**
 * Types for work item deletion components
 */

export interface DeleteItem {
  id: string;
  title: string;
  kind?: 'project' | 'initiative' | 'epic' | 'issue';
  childCount?: number;
}

export interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Single item to delete */
  item?: DeleteItem;
  /** Multiple items for bulk delete */
  items?: DeleteItem[];
  onConfirm: () => void;
  isDeleting: boolean;
}

export interface UndoToastProps {
  visible: boolean;
  itemTitle: string;
  /** Number of items if bulk delete */
  itemCount?: number;
  onUndo: () => void;
  onDismiss: () => void;
  /** Auto-dismiss timeout in ms (default: 5000) */
  timeout?: number;
}

export interface UndoState {
  itemId: string;
  itemTitle: string;
  itemCount?: number;
  onUndo: () => void;
}

export interface UseWorkItemDeleteOptions {
  onDeleted?: () => void;
  onRestored?: () => void;
  onError?: (error: Error) => void;
}

export interface UseWorkItemDeleteReturn {
  deleteItem: (item: { id: string; title: string }) => Promise<void>;
  deleteItems: (items: { id: string; title: string }[]) => Promise<void>;
  restoreItem: (id: string) => Promise<void>;
  isDeleting: boolean;
  undoState: UndoState | null;
  dismissUndo: () => void;
}
