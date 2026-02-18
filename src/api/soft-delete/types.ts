/**
 * Soft delete types.
 * All property names use snake_case to match the project-wide convention (Issue #1412).
 * Part of Issue #225.
 */

/**
 * Entity types that support soft delete
 */
export type SoftDeleteEntityType = 'work_item' | 'contact';

/**
 * Trash item summary for listing
 */
export interface TrashItem {
  id: string;
  entity_type: SoftDeleteEntityType;
  title?: string;
  display_name?: string;
  deleted_at: Date;
  days_until_purge: number;
}

/**
 * Query options for trash listing
 */
export interface TrashQueryOptions {
  entity_type?: SoftDeleteEntityType;
  limit?: number;
  offset?: number;
}

/**
 * Purge result
 */
export interface PurgeResult {
  work_items_purged: number;
  contacts_purged: number;
  total_purged: number;
}

/**
 * Restore result
 */
export interface RestoreResult {
  success: boolean;
  entity_type: SoftDeleteEntityType;
  entity_id: string;
  restored_at: Date;
}
