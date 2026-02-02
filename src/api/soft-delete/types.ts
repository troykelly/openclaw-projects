/**
 * Soft delete types.
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
  entityType: SoftDeleteEntityType;
  title?: string;
  displayName?: string;
  deletedAt: Date;
  daysUntilPurge: number;
}

/**
 * Query options for trash listing
 */
export interface TrashQueryOptions {
  entityType?: SoftDeleteEntityType;
  limit?: number;
  offset?: number;
}

/**
 * Purge result
 */
export interface PurgeResult {
  workItemsPurged: number;
  contactsPurged: number;
  totalPurged: number;
}

/**
 * Restore result
 */
export interface RestoreResult {
  success: boolean;
  entityType: SoftDeleteEntityType;
  entityId: string;
  restoredAt: Date;
}
