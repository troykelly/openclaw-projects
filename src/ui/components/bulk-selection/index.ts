/**
 * Bulk selection components
 * Issue #397: Implement bulk contact operations
 */
export { BulkSelectionProvider, useBulkSelection } from './bulk-selection-context';
export { ContactCheckbox } from './contact-checkbox';
export type { ContactCheckboxProps } from './contact-checkbox';
export { ContactBulkActionBar } from './contact-bulk-action-bar';
export type { ContactBulkActionBarProps } from './contact-bulk-action-bar';
export { BulkDeleteDialog } from './bulk-delete-dialog';
export type { BulkDeleteDialogProps } from './bulk-delete-dialog';
export { BulkAddToGroupDialog } from './bulk-add-to-group-dialog';
export type { BulkAddToGroupDialogProps } from './bulk-add-to-group-dialog';
export { BulkUpdateDialog } from './bulk-update-dialog';
export type { BulkUpdateDialogProps } from './bulk-update-dialog';
export type {
  Contact,
  ContactGroup,
  BulkUpdateField,
  BulkUpdateFieldConfig,
  BulkOperationResult,
} from './types';
