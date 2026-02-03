/**
 * Types for bulk selection and operations
 * Issue #397: Implement bulk contact operations
 */

/** A contact for bulk operations */
export interface Contact {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  avatar?: string;
  organizationId?: string;
  organizationName?: string;
  role?: string;
}

/** A contact group */
export interface ContactGroup {
  id: string;
  name: string;
  color: string;
  description?: string;
  memberCount: number;
}

/** Fields that can be bulk updated */
export type BulkUpdateField = 'organization' | 'role' | 'status';

/** Bulk update field configuration */
export interface BulkUpdateFieldConfig {
  id: BulkUpdateField;
  label: string;
  placeholder: string;
}

/** Bulk operation result */
export interface BulkOperationResult {
  success: number;
  failed: number;
  errors?: string[];
}
