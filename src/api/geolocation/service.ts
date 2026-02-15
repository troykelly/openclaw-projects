/**
 * Geolocation service CRUD layer.
 * Database operations for geo providers, subscriptions, and location data.
 * Issue #1245.
 */

import type { Pool, PoolClient } from 'pg';
import type { GeoProviderType, GeoAuthType, GeoProviderStatus } from './types.ts';

/** Queryable database connection — either a Pool or a PoolClient (for transactions). */
type Queryable = Pool | PoolClient;

// ─── Row types (camelCase) ───────────────────────────────────────────────────

export interface GeoProvider {
  id: string;
  ownerEmail: string;
  providerType: GeoProviderType;
  authType: GeoAuthType;
  label: string;
  status: GeoProviderStatus;
  statusMessage: string | null;
  config: Record<string, unknown>;
  credentials: string | null;
  pollIntervalSeconds: number | null;
  maxAgeSeconds: number;
  isShared: boolean;
  lastSeenAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GeoProviderUser {
  id: string;
  providerId: string;
  userEmail: string;
  priority: number;
  isActive: boolean;
  entities: Array<{ id: string; subPriority?: number }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface GeoLocation {
  time: Date;
  userEmail: string;
  providerId: string;
  entityId: string | null;
  lat: number;
  lng: number;
  accuracyM: number | null;
  altitudeM: number | null;
  speedMps: number | null;
  bearing: number | null;
  indoorZone: string | null;
  address: string | null;
  placeLabel: string | null;
  rawPayload: unknown;
  locationEmbedding: number[] | null;
  embeddingStatus: string;
}

// ─── Row mappers ─────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

export function rowToProvider(row: any): GeoProvider {
  return {
    id: row.id,
    ownerEmail: row.owner_email,
    providerType: row.provider_type,
    authType: row.auth_type,
    label: row.label,
    status: row.status,
    statusMessage: row.status_message,
    config: row.config,
    credentials: row.credentials,
    pollIntervalSeconds: row.poll_interval_seconds,
    maxAgeSeconds: row.max_age_seconds,
    isShared: row.is_shared,
    lastSeenAt: row.last_seen_at,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToProviderUser(row: any): GeoProviderUser {
  return {
    id: row.id,
    providerId: row.provider_id,
    userEmail: row.user_email,
    priority: row.priority,
    isActive: row.is_active,
    entities: row.entities,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToLocation(row: any): GeoLocation {
  return {
    time: row.time,
    userEmail: row.user_email,
    providerId: row.provider_id,
    entityId: row.entity_id,
    lat: row.lat,
    lng: row.lng,
    accuracyM: row.accuracy_m,
    altitudeM: row.altitude_m,
    speedMps: row.speed_mps,
    bearing: row.bearing,
    indoorZone: row.indoor_zone,
    address: row.address,
    placeLabel: row.place_label,
    rawPayload: row.raw_payload,
    locationEmbedding: row.location_embedding,
    embeddingStatus: row.embedding_status,
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── Input types ─────────────────────────────────────────────────────────────

export interface CreateProviderInput {
  ownerEmail: string;
  providerType: GeoProviderType;
  authType: GeoAuthType;
  label: string;
  config: Record<string, unknown>;
  credentials?: string | null;
  pollIntervalSeconds?: number | null;
  maxAgeSeconds?: number;
  isShared?: boolean;
}

export interface CreateSubscriptionInput {
  providerId: string;
  userEmail: string;
  priority?: number;
  isActive?: boolean;
  entities?: Array<{ id: string; subPriority?: number }>;
}

export interface InsertLocationInput {
  time: Date;
  userEmail: string;
  providerId: string;
  entityId: string | null;
  lat: number;
  lng: number;
  accuracyM?: number | null;
  altitudeM?: number | null;
  speedMps?: number | null;
  bearing?: number | null;
  indoorZone?: string | null;
  address?: string | null;
  placeLabel?: string | null;
  rawPayload?: unknown;
}

// ─── Provider CRUD ───────────────────────────────────────────────────────────

export async function createProvider(pool: Queryable, input: CreateProviderInput): Promise<GeoProvider> {
  const result = await pool.query(
    `INSERT INTO geo_provider (
      owner_email, provider_type, auth_type, label, config, credentials,
      poll_interval_seconds, max_age_seconds, is_shared
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *`,
    [
      input.ownerEmail,
      input.providerType,
      input.authType,
      input.label,
      JSON.stringify(input.config),
      input.credentials ?? null,
      input.pollIntervalSeconds ?? null,
      input.maxAgeSeconds ?? 300,
      input.isShared ?? false,
    ],
  );
  return rowToProvider(result.rows[0]);
}

export async function getProvider(pool: Queryable, id: string): Promise<GeoProvider | null> {
  const result = await pool.query(
    `SELECT * FROM geo_provider WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return result.rows.length > 0 ? rowToProvider(result.rows[0]) : null;
}

export async function listProviders(pool: Queryable, userEmail: string): Promise<GeoProvider[]> {
  const result = await pool.query(
    `SELECT DISTINCT gp.* FROM geo_provider gp
     LEFT JOIN geo_provider_user gpu ON gp.id = gpu.provider_id
     WHERE gp.deleted_at IS NULL
       AND (gp.owner_email = $1 OR gpu.user_email = $1)
     ORDER BY gp.created_at DESC`,
    [userEmail],
  );
  return result.rows.map(rowToProvider);
}

/** Allowed fields for partial update. */
interface UpdateProviderFields {
  label?: string;
  config?: Record<string, unknown>;
  credentials?: string | null;
  status?: GeoProviderStatus;
  statusMessage?: string | null;
  pollIntervalSeconds?: number | null;
  maxAgeSeconds?: number;
  isShared?: boolean;
}

const PROVIDER_FIELD_MAP: Record<string, string> = {
  label: 'label',
  config: 'config',
  credentials: 'credentials',
  status: 'status',
  statusMessage: 'status_message',
  pollIntervalSeconds: 'poll_interval_seconds',
  maxAgeSeconds: 'max_age_seconds',
  isShared: 'is_shared',
};

export async function updateProvider(
  pool: Queryable,
  id: string,
  updates: UpdateProviderFields,
): Promise<GeoProvider | null> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  for (const [key, dbCol] of Object.entries(PROVIDER_FIELD_MAP)) {
    if (key in updates) {
      const val = (updates as Record<string, unknown>)[key];
      setClauses.push(`${dbCol} = $${paramIdx}`);
      values.push(key === 'config' ? JSON.stringify(val) : val);
      paramIdx++;
    }
  }

  if (setClauses.length === 0) return null;

  setClauses.push('updated_at = now()');
  values.push(id);

  const result = await pool.query(
    `UPDATE geo_provider SET ${setClauses.join(', ')} WHERE id = $${paramIdx} AND deleted_at IS NULL RETURNING *`,
    values,
  );
  return result.rows.length > 0 ? rowToProvider(result.rows[0]) : null;
}

export async function softDeleteProvider(pool: Queryable, id: string): Promise<void> {
  await pool.query(
    `UPDATE geo_provider SET deleted_at = now(), updated_at = now() WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
}

/** Result of checking whether a provider can be deleted. */
export interface CanDeleteProviderResult {
  canDelete: boolean;
  reason?: string;
  subscriberCount?: number;
}

/**
 * Check whether a geo provider can be safely deleted.
 * Non-shared providers are always deletable.
 * Shared providers are blocked if other users (not the owner) are subscribed.
 */
export async function canDeleteProvider(pool: Queryable, providerId: string): Promise<CanDeleteProviderResult> {
  const providerResult = await pool.query(
    `SELECT owner_email, is_shared FROM geo_provider WHERE id = $1 AND deleted_at IS NULL`,
    [providerId],
  );

  if (providerResult.rows.length === 0) {
    return { canDelete: false, reason: 'Provider not found' };
  }

  const { owner_email, is_shared } = providerResult.rows[0];

  if (!is_shared) {
    return { canDelete: true };
  }

  // Count subscribers that are not the owner
  const subResult = await pool.query(
    `SELECT COUNT(*)::text AS count FROM geo_provider_user WHERE provider_id = $1 AND user_email != $2`,
    [providerId, owner_email],
  );

  const subscriberCount = parseInt(subResult.rows[0].count, 10);

  if (subscriberCount > 0) {
    return {
      canDelete: false,
      reason: 'Cannot delete shared provider with active subscribers',
      subscriberCount,
    };
  }

  return { canDelete: true };
}

/** Delete all subscriptions for a provider. Used during provider cleanup. */
export async function deleteSubscriptionsByProvider(pool: Queryable, providerId: string): Promise<void> {
  await pool.query(
    `DELETE FROM geo_provider_user WHERE provider_id = $1`,
    [providerId],
  );
}

// ─── Subscription CRUD ──────────────────────────────────────────────────────

export async function createSubscription(pool: Queryable, input: CreateSubscriptionInput): Promise<GeoProviderUser> {
  const result = await pool.query(
    `INSERT INTO geo_provider_user (provider_id, user_email, priority, is_active, entities)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      input.providerId,
      input.userEmail,
      input.priority ?? 0,
      input.isActive ?? true,
      JSON.stringify(input.entities ?? []),
    ],
  );
  return rowToProviderUser(result.rows[0]);
}

export async function listSubscriptions(pool: Queryable, userEmail: string): Promise<GeoProviderUser[]> {
  const result = await pool.query(
    `SELECT * FROM geo_provider_user WHERE user_email = $1 ORDER BY priority ASC`,
    [userEmail],
  );
  return result.rows.map(rowToProviderUser);
}

interface UpdateSubscriptionFields {
  priority?: number;
  isActive?: boolean;
  entities?: Array<{ id: string; subPriority?: number }>;
}

const SUBSCRIPTION_FIELD_MAP: Record<string, string> = {
  priority: 'priority',
  isActive: 'is_active',
  entities: 'entities',
};

export async function updateSubscription(
  pool: Queryable,
  id: string,
  updates: UpdateSubscriptionFields,
): Promise<GeoProviderUser | null> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  for (const [key, dbCol] of Object.entries(SUBSCRIPTION_FIELD_MAP)) {
    if (key in updates) {
      const val = (updates as Record<string, unknown>)[key];
      setClauses.push(`${dbCol} = $${paramIdx}`);
      values.push(key === 'entities' ? JSON.stringify(val) : val);
      paramIdx++;
    }
  }

  if (setClauses.length === 0) return null;

  setClauses.push('updated_at = now()');
  values.push(id);

  const result = await pool.query(
    `UPDATE geo_provider_user SET ${setClauses.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
    values,
  );
  return result.rows.length > 0 ? rowToProviderUser(result.rows[0]) : null;
}

// ─── Location queries ────────────────────────────────────────────────────────

export async function getCurrentLocation(pool: Queryable, userEmail: string): Promise<GeoLocation | null> {
  const result = await pool.query(
    `SELECT gl.* FROM geo_location gl
     JOIN geo_provider_user gpu ON gl.provider_id = gpu.provider_id
     JOIN geo_provider gp ON gl.provider_id = gp.id
     WHERE gpu.user_email = $1
       AND gpu.is_active = true
       AND gp.deleted_at IS NULL
       AND gl.time > now() - (gp.max_age_seconds || ' seconds')::interval
     ORDER BY gpu.priority ASC, gl.accuracy_m ASC NULLS LAST, gl.time DESC
     LIMIT 1`,
    [userEmail],
  );
  return result.rows.length > 0 ? rowToLocation(result.rows[0]) : null;
}

export async function getLocationHistory(
  pool: Queryable,
  userEmail: string,
  from: Date,
  to: Date,
  limit: number,
): Promise<GeoLocation[]> {
  const result = await pool.query(
    `SELECT gl.* FROM geo_location gl
     WHERE gl.user_email = $1
       AND gl.time >= $2
       AND gl.time <= $3
     ORDER BY gl.time DESC
     LIMIT $4`,
    [userEmail, from, to, limit],
  );
  return result.rows.map(rowToLocation);
}

export async function insertLocation(pool: Queryable, input: InsertLocationInput): Promise<GeoLocation> {
  const result = await pool.query(
    `INSERT INTO geo_location (
      time, user_email, provider_id, entity_id, lat, lng,
      accuracy_m, altitude_m, speed_mps, bearing,
      indoor_zone, address, place_label, raw_payload
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    RETURNING *`,
    [
      input.time,
      input.userEmail,
      input.providerId,
      input.entityId,
      input.lat,
      input.lng,
      input.accuracyM ?? null,
      input.altitudeM ?? null,
      input.speedMps ?? null,
      input.bearing ?? null,
      input.indoorZone ?? null,
      input.address ?? null,
      input.placeLabel ?? null,
      input.rawPayload ? JSON.stringify(input.rawPayload) : null,
    ],
  );
  return rowToLocation(result.rows[0]);
}
