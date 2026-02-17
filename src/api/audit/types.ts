/**
 * Types for audit logging.
 * Part of Issue #214.
 */

export type AuditActorType = 'agent' | 'human' | 'system';
export type AuditActionType = 'create' | 'update' | 'delete' | 'auth' | 'webhook';

export interface AuditLogEntry {
  id: string;
  timestamp: Date;
  actor_type: AuditActorType;
  actor_id: string | null;
  action: AuditActionType;
  entity_type: string;
  entity_id: string | null;
  changes: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
}

export interface AuditLogQueryOptions {
  entity_type?: string;
  entity_id?: string;
  actor_type?: AuditActorType;
  actor_id?: string;
  action?: AuditActionType;
  start_date?: Date;
  end_date?: Date;
  limit?: number;
  offset?: number;
}

export interface AuditLogCreateParams {
  actor_type: AuditActorType;
  actor_id?: string | null;
  action: AuditActionType;
  entity_type: string;
  entity_id?: string | null;
  changes?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

export interface AuditActor {
  type: AuditActorType;
  id: string | null;
}
