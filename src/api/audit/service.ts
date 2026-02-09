/**
 * Audit logging service.
 * Part of Issue #214.
 */

import type { Pool } from 'pg';
import type { AuditLogEntry, AuditLogQueryOptions, AuditLogCreateParams, AuditActor, AuditActorType } from './types.ts';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

/**
 * Create an audit log entry
 */
export async function createAuditLog(pool: Pool, params: AuditLogCreateParams): Promise<string> {
  const result = await pool.query(
    `INSERT INTO audit_log (actor_type, actor_id, action, entity_type, entity_id, changes, metadata)
     VALUES ($1::audit_actor_type, $2, $3::audit_action_type, $4, $5, $6, $7)
     RETURNING id::text`,
    [
      params.actorType,
      params.actorId || null,
      params.action,
      params.entityType,
      params.entityId || null,
      params.changes ? JSON.stringify(params.changes) : null,
      params.metadata ? JSON.stringify(params.metadata) : null,
    ],
  );

  return result.rows[0].id;
}

/**
 * Query audit log entries with filtering
 */
export async function queryAuditLog(pool: Pool, options: AuditLogQueryOptions = {}): Promise<{ entries: AuditLogEntry[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (options.entityType) {
    conditions.push(`entity_type = $${paramIndex++}`);
    params.push(options.entityType);
  }

  if (options.entityId) {
    conditions.push(`entity_id = $${paramIndex++}`);
    params.push(options.entityId);
  }

  if (options.actorType) {
    conditions.push(`actor_type = $${paramIndex++}::audit_actor_type`);
    params.push(options.actorType);
  }

  if (options.actorId) {
    conditions.push(`actor_id = $${paramIndex++}`);
    params.push(options.actorId);
  }

  if (options.action) {
    conditions.push(`action = $${paramIndex++}::audit_action_type`);
    params.push(options.action);
  }

  if (options.startDate) {
    conditions.push(`timestamp >= $${paramIndex++}`);
    params.push(options.startDate);
  }

  if (options.endDate) {
    conditions.push(`timestamp <= $${paramIndex++}`);
    params.push(options.endDate);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Get total count
  const countResult = await pool.query(`SELECT COUNT(*) FROM audit_log ${whereClause}`, params);
  const total = parseInt(countResult.rows[0].count, 10);

  // Get paginated results
  const limit = Math.min(options.limit || DEFAULT_LIMIT, MAX_LIMIT);
  const offset = options.offset || 0;

  params.push(limit);
  params.push(offset);

  const result = await pool.query(
    `SELECT
      id::text,
      timestamp,
      actor_type,
      actor_id,
      action,
      entity_type,
      entity_id::text,
      changes,
      metadata
    FROM audit_log
    ${whereClause}
    ORDER BY timestamp DESC
    LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
    params,
  );

  const entries: AuditLogEntry[] = result.rows.map((row) => ({
    id: row.id,
    timestamp: row.timestamp,
    actorType: row.actor_type as AuditActorType,
    actorId: row.actor_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    changes: row.changes,
    metadata: row.metadata,
  }));

  return { entries, total };
}

/**
 * Get audit log entries for a specific entity
 */
export async function getEntityAuditLog(
  pool: Pool,
  entityType: string,
  entityId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<AuditLogEntry[]> {
  const result = await queryAuditLog(pool, {
    entityType,
    entityId,
    limit: options.limit,
    offset: options.offset,
  });
  return result.entries;
}

/**
 * Get audit log entries for a specific actor
 */
export async function getActorAuditLog(
  pool: Pool,
  actorType: AuditActorType,
  actorId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<AuditLogEntry[]> {
  const result = await queryAuditLog(pool, {
    actorType,
    actorId,
    limit: options.limit,
    offset: options.offset,
  });
  return result.entries;
}

/**
 * Log an authentication event
 */
export async function logAuthEvent(
  pool: Pool,
  params: {
    actorType: AuditActorType;
    actorId?: string;
    success: boolean;
    metadata?: Record<string, unknown>;
  },
): Promise<string> {
  return createAuditLog(pool, {
    actorType: params.actorType,
    actorId: params.actorId,
    action: 'auth',
    entityType: 'session',
    changes: { success: params.success },
    metadata: params.metadata,
  });
}

/**
 * Log a webhook receipt
 */
export async function logWebhookEvent(
  pool: Pool,
  params: {
    source: string; // 'twilio', 'postmark', 'cloudflare'
    entityType?: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<string> {
  return createAuditLog(pool, {
    actorType: 'system',
    actorId: `webhook:${params.source}`,
    action: 'webhook',
    entityType: params.entityType || 'webhook',
    entityId: params.entityId,
    metadata: {
      source: params.source,
      ...params.metadata,
    },
  });
}

/**
 * Purge old audit log entries (for retention)
 */
export async function purgeOldEntries(pool: Pool, retentionDays: number = 90): Promise<number> {
  const result = await pool.query(
    `DELETE FROM audit_log
     WHERE timestamp < now() - INTERVAL '1 day' * $1
     RETURNING id`,
    [retentionDays],
  );

  return result.rowCount || 0;
}

/**
 * Update the most recent audit log entry for an entity with actor information
 * This allows the trigger-created entry to be enriched with the actual actor
 */
export async function updateLatestAuditEntry(
  pool: Pool,
  entityType: string,
  entityId: string,
  actor: AuditActor,
  metadata?: Record<string, unknown>,
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE audit_log
     SET actor_type = $1::audit_actor_type,
         actor_id = $2,
         metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
     WHERE id = (
       SELECT id FROM audit_log
       WHERE entity_type = $4 AND entity_id = $5
       ORDER BY timestamp DESC
       LIMIT 1
     )`,
    [actor.type, actor.id, JSON.stringify(metadata || {}), entityType, entityId],
  );

  return result.rowCount !== null && result.rowCount > 0;
}

/**
 * Extract actor information from request headers
 */
export function extractActor(headers: Record<string, string | undefined>): AuditActor {
  // Check for agent header
  const agentName = headers['x-agent-name'];
  if (agentName) {
    return { type: 'agent', id: agentName };
  }

  // Check for user header (from session middleware)
  const userId = headers['x-user-id'] || headers['x-user-email'];
  if (userId) {
    return { type: 'human', id: userId };
  }

  // Default to system
  return { type: 'system', id: null };
}

/**
 * Build metadata from request
 */
export function buildRequestMetadata(req: { ip?: string; headers?: Record<string, string | string[] | undefined>; id?: string }): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};

  if (req.ip) {
    metadata.ip = req.ip;
  }

  if (req.id) {
    metadata.requestId = req.id;
  }

  if (req.headers?.['user-agent']) {
    metadata.userAgent = req.headers['user-agent'];
  }

  return metadata;
}
