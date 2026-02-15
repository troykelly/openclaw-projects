/**
 * Geolocation ingestion pipeline.
 * Validates, deduplicates, rate-limits, and stores location updates.
 * Issue #1245.
 */

import type { Pool } from 'pg';
import type { Result, LocationUpdate } from './types.ts';
import type { GeoLocation } from './service.ts';

const MAX_CLOCK_SKEW_MS = 30_000; // 30 seconds
const MAX_AGE_MS = 3_600_000; // 1 hour
const MAX_ACCURACY_M = 100_000;
const MAX_ENTITY_ID_LENGTH = 255;
const EARTH_RADIUS_M = 6_371_000;
const DEFAULT_DEDUP_THRESHOLD_M = 5;
const DEFAULT_DEDUP_THRESHOLD_S = 30;
const DEFAULT_RATE_LIMIT_S = 10;

/**
 * Validate a location update from any provider.
 */
export function validateLocationUpdate(update: LocationUpdate): Result<LocationUpdate, string> {
  // Guard against malformed runtime input
  if (typeof update.entity_id !== 'string') {
    return { ok: false, error: 'entity_id must be a string' };
  }
  if (typeof update.lat !== 'number' || !Number.isFinite(update.lat)) {
    return { ok: false, error: 'lat must be a finite number' };
  }
  if (typeof update.lng !== 'number' || !Number.isFinite(update.lng)) {
    return { ok: false, error: 'lng must be a finite number' };
  }

  // Sanitise entity_id: strip control characters, truncate
  let entityId = update.entity_id.replace(/[\x00-\x1f\x7f]/g, '');
  if (entityId.length > MAX_ENTITY_ID_LENGTH) {
    entityId = entityId.slice(0, MAX_ENTITY_ID_LENGTH);
  }

  if (update.lat < -90 || update.lat > 90) {
    return { ok: false, error: `Invalid lat: ${update.lat}; must be between -90 and 90` };
  }
  if (update.lng < -180 || update.lng > 180) {
    return { ok: false, error: `Invalid lng: ${update.lng}; must be between -180 and 180` };
  }

  if (update.accuracy_m !== undefined && update.accuracy_m !== null) {
    if (update.accuracy_m < 0) {
      return { ok: false, error: `Invalid accuracy_m: ${update.accuracy_m}; must be >= 0` };
    }
    if (update.accuracy_m > MAX_ACCURACY_M) {
      return { ok: false, error: `Invalid accuracy_m: ${update.accuracy_m}; must be <= ${MAX_ACCURACY_M}` };
    }
  }

  if (update.bearing !== undefined && update.bearing !== null) {
    if (update.bearing < 0 || update.bearing >= 360) {
      return { ok: false, error: `Invalid bearing: ${update.bearing}; must be >= 0 and < 360` };
    }
  }

  // Default timestamp to now
  let timestamp = update.timestamp;
  if (!timestamp) {
    timestamp = new Date();
  } else if (!(timestamp instanceof Date) || Number.isNaN(timestamp.getTime())) {
    return { ok: false, error: 'timestamp must be a valid Date' };
  }

  const now = Date.now();
  if (timestamp.getTime() > now + MAX_CLOCK_SKEW_MS) {
    return { ok: false, error: `Timestamp is in the future (beyond 30s clock skew)` };
  }
  if (timestamp.getTime() < now - MAX_AGE_MS) {
    return { ok: false, error: `Timestamp is too old (older than 1 hour)` };
  }

  return {
    ok: true,
    value: {
      ...update,
      entity_id: entityId,
      timestamp,
    },
  };
}

/**
 * Haversine distance between two lat/lng points in metres.
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  if (lat1 === lat2 && lng1 === lng2) return 0;

  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

/**
 * Check if update should be deduplicated (too close in space + time).
 */
export function shouldDedup(
  current: LocationUpdate,
  previous: GeoLocation | null,
  thresholdM: number = DEFAULT_DEDUP_THRESHOLD_M,
  thresholdS: number = DEFAULT_DEDUP_THRESHOLD_S,
): boolean {
  if (!previous) return false;

  const currentTime = current.timestamp ?? new Date();
  const timeDiffS = (currentTime.getTime() - previous.time.getTime()) / 1000;

  // If enough time has passed, don't dedup
  if (timeDiffS >= thresholdS) return false;

  const distance = haversineDistance(current.lat, current.lng, previous.lat, previous.lng);

  // Dedup if both close in space AND time
  return distance <= thresholdM;
}

/**
 * Check if update should be rate-limited.
 */
export function shouldRateLimit(
  lastInsertTime: Date | null,
  minIntervalSeconds: number = DEFAULT_RATE_LIMIT_S,
): boolean {
  if (!lastInsertTime) return false;

  const elapsedS = (Date.now() - lastInsertTime.getTime()) / 1000;
  return elapsedS < minIntervalSeconds;
}

/**
 * Main ingestion entry point.
 * Validates, finds matching subscriptions, checks rate limiting and dedup,
 * then inserts into geo_location for each matched user.
 */
export async function ingestLocationUpdate(
  pool: Pool,
  providerId: string,
  update: LocationUpdate,
): Promise<{ inserted: boolean; reason?: string }> {
  // 1. Validate
  const validated = validateLocationUpdate(update);
  if (!validated.ok) {
    return { inserted: false, reason: `Validation failed: ${validated.error}` };
  }
  const validUpdate = validated.value;

  // 2. Find matching subscriptions for this entity
  const subsResult = await pool.query(
    `SELECT user_email, provider_id FROM geo_provider_user
     WHERE provider_id = $1 AND is_active = true
       AND (entities = '[]'::jsonb OR entities @> $2::jsonb)`,
    [providerId, JSON.stringify([{ id: validUpdate.entity_id }])],
  );

  if (subsResult.rows.length === 0) {
    // Still update last_seen_at
    await pool.query(
      `UPDATE geo_provider SET last_seen_at = now() WHERE id = $1`,
      [providerId],
    );
    return { inserted: false, reason: 'No subscriptions matched entity' };
  }

  let anyInserted = false;
  let lastReason: string | undefined;

  for (const sub of subsResult.rows) {
    const userEmail = sub.user_email as string;

    // 3a. Rate limit check
    const rateLimitResult = await pool.query(
      `SELECT time FROM geo_location
       WHERE provider_id = $1 AND user_email = $2 AND entity_id = $3
       ORDER BY time DESC LIMIT 1`,
      [providerId, userEmail, validUpdate.entity_id],
    );
    const lastInsertTime = rateLimitResult.rows.length > 0
      ? (rateLimitResult.rows[0].time as Date)
      : null;

    if (shouldRateLimit(lastInsertTime)) {
      lastReason = 'Skipped: rate-limited';
      continue;
    }

    // 3b. Dedup check
    const dedupResult = await pool.query(
      `SELECT time, lat, lng FROM geo_location
       WHERE provider_id = $1 AND user_email = $2 AND entity_id = $3
       ORDER BY time DESC LIMIT 1`,
      [providerId, userEmail, validUpdate.entity_id],
    );
    const previousLocation = dedupResult.rows.length > 0
      ? (dedupResult.rows[0] as GeoLocation)
      : null;

    if (shouldDedup(validUpdate, previousLocation)) {
      lastReason = 'Skipped: dedup (too close in space+time)';
      continue;
    }

    // 3c. Insert into geo_location
    await pool.query(
      `INSERT INTO geo_location (
        time, user_email, provider_id, entity_id, lat, lng,
        accuracy_m, altitude_m, speed_mps, bearing,
        indoor_zone, raw_payload
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        validUpdate.timestamp,
        userEmail,
        providerId,
        validUpdate.entity_id,
        validUpdate.lat,
        validUpdate.lng,
        validUpdate.accuracy_m ?? null,
        validUpdate.altitude_m ?? null,
        validUpdate.speed_mps ?? null,
        validUpdate.bearing ?? null,
        validUpdate.indoor_zone ?? null,
        validUpdate.raw_payload ? JSON.stringify(validUpdate.raw_payload) : null,
      ],
    );

    anyInserted = true;
  }

  // 4. Update last_seen_at on provider
  await pool.query(
    `UPDATE geo_provider SET last_seen_at = now() WHERE id = $1`,
    [providerId],
  );

  if (anyInserted) {
    return { inserted: true };
  }
  return { inserted: false, reason: lastReason };
}
