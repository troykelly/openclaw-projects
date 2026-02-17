/**
 * Geolocation service CRUD layer.
 * Database operations for geo providers, subscriptions, and location data.
 * Issue #1245.
 */

import type { Pool, PoolClient } from 'pg';
import type { GeoProviderType, GeoAuthType, GeoProviderStatus } from './types.ts';

/** Queryable database connection — either a Pool or a PoolClient (for transactions). */
type Queryable = Pool | PoolClient;

// ─── Row types (snake_case) ──────────────────────────────────────────────────

export interface GeoProvider {
  id: string;
  owner_email: string;
  provider_type: GeoProviderType;
  auth_type: GeoAuthType;
  label: string;
  status: GeoProviderStatus;
  status_message: string | null;
  config: Record<string, unknown>;
  credentials: string | null;
  poll_interval_seconds: number | null;
  max_age_seconds: number;
  is_shared: boolean;
  last_seen_at: Date | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface GeoProviderUser {
  id: string;
  provider_id: string;
  user_email: string;
  priority: number;
  is_active: boolean;
  entities: Array<{ id: string; subPriority?: number }>;
  created_at: Date;
  updated_at: Date;
}

export interface GeoLocation {
  time: Date;
  user_email: string;
  provider_id: string;
  entity_id: string | null;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  altitude_m: number | null;
  speed_mps: number | null;
  bearing: number | null;
  indoor_zone: string | null;
  address: string | null;
  place_label: string | null;
  raw_payload: unknown;
  location_embedding: number[] | null;
  embedding_status: string;
}

// ─── Row mappers ─────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

export function rowToProvider(row: any): GeoProvider {
  return {
    id: row.id,
    owner_email: row.owner_email,
    provider_type: row.provider_type,
    auth_type: row.auth_type,
    label: row.label,
    status: row.status,
    status_message: row.status_message,
    config: row.config,
    credentials: row.credentials,
    poll_interval_seconds: row.poll_interval_seconds,
    max_age_seconds: row.max_age_seconds,
    is_shared: row.is_shared,
    last_seen_at: row.last_seen_at,
    deleted_at: row.deleted_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function rowToProviderUser(row: any): GeoProviderUser {
  return {
    id: row.id,
    provider_id: row.provider_id,
    user_email: row.user_email,
    priority: row.priority,
    is_active: row.is_active,
    entities: row.entities,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function rowToLocation(row: any): GeoLocation {
  return {
    time: row.time,
    user_email: row.user_email,
    provider_id: row.provider_id,
    entity_id: row.entity_id,
    lat: row.lat,
    lng: row.lng,
    accuracy_m: row.accuracy_m,
    altitude_m: row.altitude_m,
    speed_mps: row.speed_mps,
    bearing: row.bearing,
    indoor_zone: row.indoor_zone,
    address: row.address,
    place_label: row.place_label,
    raw_payload: row.raw_payload,
    location_embedding: row.location_embedding,
    embedding_status: row.embedding_status,
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── Input types ─────────────────────────────────────────────────────────────

export interface CreateProviderInput {
  owner_email: string;
  provider_type: GeoProviderType;
  auth_type: GeoAuthType;
  label: string;
  config: Record<string, unknown>;
  credentials?: string | null;
  poll_interval_seconds?: number | null;
  max_age_seconds?: number;
  is_shared?: boolean;
}

export interface CreateSubscriptionInput {
  provider_id: string;
  user_email: string;
  priority?: number;
  is_active?: boolean;
  entities?: Array<{ id: string; subPriority?: number }>;
}

export interface InsertLocationInput {
  time: Date;
  user_email: string;
  provider_id: string;
  entity_id: string | null;
  lat: number;
  lng: number;
  accuracy_m?: number | null;
  altitude_m?: number | null;
  speed_mps?: number | null;
  bearing?: number | null;
  indoor_zone?: string | null;
  address?: string | null;
  place_label?: string | null;
  raw_payload?: unknown;
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
      input.owner_email,
      input.provider_type,
      input.auth_type,
      input.label,
      JSON.stringify(input.config),
      input.credentials ?? null,
      input.poll_interval_seconds ?? null,
      input.max_age_seconds ?? 300,
      input.is_shared ?? false,
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

export async function listProviders(pool: Queryable, user_email: string): Promise<GeoProvider[]> {
  const result = await pool.query(
    `SELECT DISTINCT gp.* FROM geo_provider gp
     LEFT JOIN geo_provider_user gpu ON gp.id = gpu.provider_id
     WHERE gp.deleted_at IS NULL
       AND (gp.owner_email = $1 OR gpu.user_email = $1)
     ORDER BY gp.created_at DESC`,
    [user_email],
  );
  return result.rows.map(rowToProvider);
}

/** Allowed fields for partial update. */
interface UpdateProviderFields {
  label?: string;
  config?: Record<string, unknown>;
  credentials?: string | null;
  status?: GeoProviderStatus;
  status_message?: string | null;
  poll_interval_seconds?: number | null;
  max_age_seconds?: number;
  is_shared?: boolean;
}

const PROVIDER_FIELD_MAP: Record<string, string> = {
  label: 'label',
  config: 'config',
  credentials: 'credentials',
  status: 'status',
  status_message: 'status_message',
  poll_interval_seconds: 'poll_interval_seconds',
  max_age_seconds: 'max_age_seconds',
  is_shared: 'is_shared',
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
  can_delete: boolean;
  reason?: string;
  subscriber_count?: number;
}

/**
 * Check whether a geo provider can be safely deleted.
 * Non-shared providers are always deletable.
 * Shared providers are blocked if other users (not the owner) are subscribed.
 */
export async function canDeleteProvider(pool: Queryable, providerId: string): Promise<CanDeleteProviderResult> {
  const providerResult = await pool.query(
    `SELECT owner_email, is_shared FROM geo_provider WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
    [providerId],
  );

  if (providerResult.rows.length === 0) {
    return { can_delete: false, reason: 'Provider not found' };
  }

  const { owner_email, is_shared } = providerResult.rows[0];

  if (!is_shared) {
    return { can_delete: true };
  }

  // Count subscribers that are not the owner
  const subResult = await pool.query(
    `SELECT COUNT(*)::text AS count FROM geo_provider_user WHERE provider_id = $1 AND user_email != $2`,
    [providerId, owner_email],
  );

  const subscriberCount = parseInt(subResult.rows[0].count, 10);

  if (subscriberCount > 0) {
    return {
      can_delete: false,
      reason: 'Cannot delete shared provider with active subscribers',
      subscriber_count: subscriberCount,
    };
  }

  return { can_delete: true };
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
      input.provider_id,
      input.user_email,
      input.priority ?? 0,
      input.is_active ?? true,
      JSON.stringify(input.entities ?? []),
    ],
  );
  return rowToProviderUser(result.rows[0]);
}

export async function listSubscriptions(pool: Queryable, user_email: string): Promise<GeoProviderUser[]> {
  const result = await pool.query(
    `SELECT * FROM geo_provider_user WHERE user_email = $1 ORDER BY priority ASC`,
    [user_email],
  );
  return result.rows.map(rowToProviderUser);
}

interface UpdateSubscriptionFields {
  priority?: number;
  is_active?: boolean;
  entities?: Array<{ id: string; subPriority?: number }>;
}

const SUBSCRIPTION_FIELD_MAP: Record<string, string> = {
  priority: 'priority',
  is_active: 'is_active',
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

export async function getCurrentLocation(pool: Queryable, user_email: string): Promise<GeoLocation | null> {
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
    [user_email],
  );
  return result.rows.length > 0 ? rowToLocation(result.rows[0]) : null;
}

export async function getLocationHistory(
  pool: Queryable,
  user_email: string,
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
    [user_email, from, to, limit],
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
      input.user_email,
      input.provider_id,
      input.entity_id,
      input.lat,
      input.lng,
      input.accuracy_m ?? null,
      input.altitude_m ?? null,
      input.speed_mps ?? null,
      input.bearing ?? null,
      input.indoor_zone ?? null,
      input.address ?? null,
      input.place_label ?? null,
      input.raw_payload ? JSON.stringify(input.raw_payload) : null,
    ],
  );
  return rowToLocation(result.rows[0]);
}
