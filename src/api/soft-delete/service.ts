/**
 * Soft delete service.
 * Part of Issue #225.
 */

import type { Pool } from 'pg';
import type {
  SoftDeleteEntityType,
  TrashItem,
  TrashQueryOptions,
  PurgeResult,
  RestoreResult,
} from './types.ts';

const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

/**
 * Soft delete a work item
 */
export async function softDeleteWorkItem(
  pool: Pool,
  workItemId: string
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE work_item
     SET deleted_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id`,
    [workItemId]
  );
  return result.rowCount !== null && result.rowCount > 0;
}

/**
 * Soft delete a contact
 */
export async function softDeleteContact(
  pool: Pool,
  contactId: string
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE contact
     SET deleted_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id`,
    [contactId]
  );
  return result.rowCount !== null && result.rowCount > 0;
}

/**
 * Permanently delete a work item
 */
export async function hardDeleteWorkItem(
  pool: Pool,
  workItemId: string
): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM work_item WHERE id = $1 RETURNING id`,
    [workItemId]
  );
  return result.rowCount !== null && result.rowCount > 0;
}

/**
 * Permanently delete a contact
 */
export async function hardDeleteContact(
  pool: Pool,
  contactId: string
): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM contact WHERE id = $1 RETURNING id`,
    [contactId]
  );
  return result.rowCount !== null && result.rowCount > 0;
}

/**
 * Restore a soft-deleted work item
 */
export async function restoreWorkItem(
  pool: Pool,
  workItemId: string
): Promise<RestoreResult | null> {
  const result = await pool.query(
    `UPDATE work_item
     SET deleted_at = NULL
     WHERE id = $1 AND deleted_at IS NOT NULL
     RETURNING id::text`,
    [workItemId]
  );

  if (result.rowCount === 0) {
    return null;
  }

  return {
    success: true,
    entityType: 'work_item',
    entityId: result.rows[0].id,
    restoredAt: new Date(),
  };
}

/**
 * Restore a soft-deleted contact
 */
export async function restoreContact(
  pool: Pool,
  contactId: string
): Promise<RestoreResult | null> {
  const result = await pool.query(
    `UPDATE contact
     SET deleted_at = NULL
     WHERE id = $1 AND deleted_at IS NOT NULL
     RETURNING id::text`,
    [contactId]
  );

  if (result.rowCount === 0) {
    return null;
  }

  return {
    success: true,
    entityType: 'contact',
    entityId: result.rows[0].id,
    restoredAt: new Date(),
  };
}

/**
 * Restore any entity by type and ID
 */
export async function restore(
  pool: Pool,
  entityType: SoftDeleteEntityType,
  entityId: string
): Promise<RestoreResult | null> {
  switch (entityType) {
    case 'work_item':
      return restoreWorkItem(pool, entityId);
    case 'contact':
      return restoreContact(pool, entityId);
    default:
      throw new Error(`Unknown entity type: ${entityType}`);
  }
}

/**
 * List items in trash
 */
export async function listTrash(
  pool: Pool,
  options: TrashQueryOptions = {}
): Promise<{ items: TrashItem[]; total: number }> {
  const limit = Math.min(options.limit || DEFAULT_LIMIT, MAX_LIMIT);
  const offset = options.offset || 0;

  const items: TrashItem[] = [];
  let total = 0;

  // Query work items
  if (!options.entityType || options.entityType === 'work_item') {
    const wiResult = await pool.query(
      `SELECT
        id::text,
        title,
        deleted_at,
        GREATEST(0, $1 - EXTRACT(DAY FROM (now() - deleted_at)))::integer as days_until_purge
      FROM work_item
      WHERE deleted_at IS NOT NULL
      ORDER BY deleted_at DESC
      LIMIT $2 OFFSET $3`,
      [DEFAULT_RETENTION_DAYS, limit, offset]
    );

    const wiCountResult = await pool.query(
      `SELECT COUNT(*) FROM work_item WHERE deleted_at IS NOT NULL`
    );

    for (const row of wiResult.rows) {
      items.push({
        id: row.id,
        entityType: 'work_item',
        title: row.title,
        deletedAt: row.deleted_at,
        daysUntilPurge: row.days_until_purge,
      });
    }

    total += parseInt(wiCountResult.rows[0].count, 10);
  }

  // Query contacts
  if (!options.entityType || options.entityType === 'contact') {
    const cResult = await pool.query(
      `SELECT
        id::text,
        display_name,
        deleted_at,
        GREATEST(0, $1 - EXTRACT(DAY FROM (now() - deleted_at)))::integer as days_until_purge
      FROM contact
      WHERE deleted_at IS NOT NULL
      ORDER BY deleted_at DESC
      LIMIT $2 OFFSET $3`,
      [DEFAULT_RETENTION_DAYS, limit, offset]
    );

    const cCountResult = await pool.query(
      `SELECT COUNT(*) FROM contact WHERE deleted_at IS NOT NULL`
    );

    for (const row of cResult.rows) {
      items.push({
        id: row.id,
        entityType: 'contact',
        displayName: row.display_name,
        deletedAt: row.deleted_at,
        daysUntilPurge: row.days_until_purge,
      });
    }

    total += parseInt(cCountResult.rows[0].count, 10);
  }

  // Sort combined results by deleted_at desc
  items.sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());

  return { items: items.slice(0, limit), total };
}

/**
 * Purge old soft-deleted items
 */
export async function purgeOldItems(
  pool: Pool,
  retentionDays: number = DEFAULT_RETENTION_DAYS
): Promise<PurgeResult> {
  const result = await pool.query(
    `SELECT * FROM purge_soft_deleted($1)`,
    [retentionDays]
  );

  const row = result.rows[0];
  const workItemsPurged = parseInt(row.work_items_purged || '0', 10);
  const contactsPurged = parseInt(row.contacts_purged || '0', 10);

  return {
    workItemsPurged,
    contactsPurged,
    totalPurged: workItemsPurged + contactsPurged,
  };
}

/**
 * Get trash item count
 */
export async function getTrashCount(pool: Pool): Promise<{
  workItems: number;
  contacts: number;
  total: number;
}> {
  const wiResult = await pool.query(
    `SELECT COUNT(*) FROM work_item WHERE deleted_at IS NOT NULL`
  );
  const cResult = await pool.query(
    `SELECT COUNT(*) FROM contact WHERE deleted_at IS NOT NULL`
  );

  const workItems = parseInt(wiResult.rows[0].count, 10);
  const contacts = parseInt(cResult.rows[0].count, 10);

  return {
    workItems,
    contacts,
    total: workItems + contacts,
  };
}

/**
 * Check if entity is soft-deleted
 */
export async function isDeleted(
  pool: Pool,
  entityType: SoftDeleteEntityType,
  entityId: string
): Promise<boolean> {
  const table = entityType === 'work_item' ? 'work_item' : 'contact';
  const result = await pool.query(
    `SELECT deleted_at FROM ${table} WHERE id = $1`,
    [entityId]
  );

  if (result.rowCount === 0) {
    return false; // Entity doesn't exist
  }

  return result.rows[0].deleted_at !== null;
}
