/**
 * Soft delete service.
 * Part of Issue #225.
 */

import type { Pool } from 'pg';
import type { SoftDeleteEntityType, TrashItem, TrashQueryOptions, PurgeResult, RestoreResult } from './types.ts';

const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

/**
 * Soft delete a work item
 */
export async function softDeleteWorkItem(pool: Pool, work_item_id: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE work_item
     SET deleted_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id`,
    [work_item_id],
  );
  return result.rowCount !== null && result.rowCount > 0;
}

/**
 * Soft delete a contact
 */
export async function softDeleteContact(pool: Pool, contact_id: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE contact
     SET deleted_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id`,
    [contact_id],
  );
  return result.rowCount !== null && result.rowCount > 0;
}

/**
 * Permanently delete a work item
 */
export async function hardDeleteWorkItem(pool: Pool, work_item_id: string): Promise<boolean> {
  const result = await pool.query(`DELETE FROM work_item WHERE id = $1 RETURNING id`, [work_item_id]);
  return result.rowCount !== null && result.rowCount > 0;
}

/**
 * Permanently delete a contact
 */
export async function hardDeleteContact(pool: Pool, contact_id: string): Promise<boolean> {
  const result = await pool.query(`DELETE FROM contact WHERE id = $1 RETURNING id`, [contact_id]);
  return result.rowCount !== null && result.rowCount > 0;
}

/**
 * Restore a soft-deleted work item
 */
export async function restoreWorkItem(pool: Pool, work_item_id: string): Promise<RestoreResult | null> {
  const result = await pool.query(
    `UPDATE work_item
     SET deleted_at = NULL
     WHERE id = $1 AND deleted_at IS NOT NULL
     RETURNING id::text`,
    [work_item_id],
  );

  if (result.rowCount === 0) {
    return null;
  }

  return {
    success: true,
    entity_type: 'work_item',
    entity_id: result.rows[0].id,
    restored_at: new Date(),
  };
}

/**
 * Restore a soft-deleted contact
 */
export async function restoreContact(pool: Pool, contact_id: string): Promise<RestoreResult | null> {
  const result = await pool.query(
    `UPDATE contact
     SET deleted_at = NULL
     WHERE id = $1 AND deleted_at IS NOT NULL
     RETURNING id::text`,
    [contact_id],
  );

  if (result.rowCount === 0) {
    return null;
  }

  return {
    success: true,
    entity_type: 'contact',
    entity_id: result.rows[0].id,
    restored_at: new Date(),
  };
}

/**
 * Restore any entity by type and ID
 */
export async function restore(pool: Pool, entity_type: SoftDeleteEntityType, entity_id: string): Promise<RestoreResult | null> {
  switch (entity_type) {
    case 'work_item':
      return restoreWorkItem(pool, entity_id);
    case 'contact':
      return restoreContact(pool, entity_id);
    default:
      throw new Error(`Unknown entity type: ${entity_type}`);
  }
}

/**
 * List items in trash
 */
export async function listTrash(pool: Pool, options: TrashQueryOptions = {}): Promise<{ items: TrashItem[]; total: number }> {
  const limit = Math.min(options.limit || DEFAULT_LIMIT, MAX_LIMIT);
  const offset = options.offset || 0;

  const items: TrashItem[] = [];
  let total = 0;

  // Query work items
  if (!options.entity_type || options.entity_type === 'work_item') {
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
      [DEFAULT_RETENTION_DAYS, limit, offset],
    );

    const wiCountResult = await pool.query(`SELECT COUNT(*) FROM work_item WHERE deleted_at IS NOT NULL`);

    for (const row of wiResult.rows) {
      items.push({
        id: row.id,
        entity_type: 'work_item',
        title: row.title,
        deleted_at: row.deleted_at,
        days_until_purge: row.days_until_purge,
      });
    }

    total += parseInt(wiCountResult.rows[0].count, 10);
  }

  // Query contacts
  if (!options.entity_type || options.entity_type === 'contact') {
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
      [DEFAULT_RETENTION_DAYS, limit, offset],
    );

    const cCountResult = await pool.query(`SELECT COUNT(*) FROM contact WHERE deleted_at IS NOT NULL`);

    for (const row of cResult.rows) {
      items.push({
        id: row.id,
        entity_type: 'contact',
        display_name: row.display_name,
        deleted_at: row.deleted_at,
        days_until_purge: row.days_until_purge,
      });
    }

    total += parseInt(cCountResult.rows[0].count, 10);
  }

  // Sort combined results by deleted_at desc
  items.sort((a, b) => b.deleted_at.getTime() - a.deleted_at.getTime());

  return { items: items.slice(0, limit), total };
}

/**
 * Purge old soft-deleted items
 */
export async function purgeOldItems(pool: Pool, retention_days: number = DEFAULT_RETENTION_DAYS): Promise<PurgeResult> {
  const result = await pool.query(`SELECT * FROM purge_soft_deleted($1)`, [retention_days]);

  const row = result.rows[0];
  const work_items_purged = parseInt(row.work_items_purged || '0', 10);
  const contacts_purged = parseInt(row.contacts_purged || '0', 10);

  return {
    work_items_purged,
    contacts_purged,
    total_purged: work_items_purged + contacts_purged,
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
  const wiResult = await pool.query(`SELECT COUNT(*) FROM work_item WHERE deleted_at IS NOT NULL`);
  const cResult = await pool.query(`SELECT COUNT(*) FROM contact WHERE deleted_at IS NOT NULL`);

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
export async function isDeleted(pool: Pool, entity_type: SoftDeleteEntityType, entity_id: string): Promise<boolean> {
  const table = entity_type === 'work_item' ? 'work_item' : 'contact';
  const result = await pool.query(`SELECT deleted_at FROM ${table} WHERE id = $1`, [entity_id]);

  if (result.rowCount === 0) {
    return false; // Entity doesn't exist
  }

  return result.rows[0].deleted_at !== null;
}
