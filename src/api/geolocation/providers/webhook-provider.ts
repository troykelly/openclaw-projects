/**
 * Webhook geolocation provider plugin.
 * Receives location updates passively via HTTP POST with Bearer token auth.
 * Issue #1248.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  GeoProviderPlugin,
  Connection,
  LocationUpdate,
  ProviderConfig,
  Result,
  ValidationError,
  VerifyResult,
  EntityInfo,
  LocationUpdateHandler,
} from '../types.ts';
import { registerProvider } from '../registry.ts';

// ---------- token generation ----------

/** Prefix for all webhook tokens. */
const TOKEN_PREFIX = 'whk_';

/** Generate a new webhook token: `whk_` + 64 hex chars (32 random bytes). */
export function generateWebhookToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString('hex');
}

/** Validate that a string looks like a valid webhook token. */
export function isValidTokenFormat(token: string): boolean {
  return (
    typeof token === 'string' &&
    token.startsWith(TOKEN_PREFIX) &&
    token.length === TOKEN_PREFIX.length + 64 &&
    /^[0-9a-f]{64}$/.test(token.slice(TOKEN_PREFIX.length))
  );
}

// ---------- timing-safe token comparison ----------

/**
 * Compare two tokens in constant time to prevent timing attacks.
 * Returns false if either token is empty or they differ in length.
 */
export function timingSafeTokenCompare(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;

  const providedBuf = Buffer.from(provided, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');

  // timingSafeEqual requires equal-length buffers.
  // To avoid leaking length information, we compare against
  // the expected buffer padded/truncated to match, but still
  // return false if lengths differ.
  if (providedBuf.length !== expectedBuf.length) {
    // Still do a comparison to avoid short-circuit timing leak
    const dummy = Buffer.alloc(expectedBuf.length);
    timingSafeEqual(dummy, expectedBuf);
    return false;
  }

  return timingSafeEqual(providedBuf, expectedBuf);
}

// ---------- token rotation ----------

/**
 * Generate a new webhook token for rotation.
 * Returns the new plaintext token. The caller is responsible for
 * encrypting it (via encryptCredentials) and persisting it.
 */
export function rotateWebhookToken(): string {
  return generateWebhookToken();
}

// ---------- payload parsing ----------

/** Standard webhook payload shape. */
export interface StandardWebhookPayload {
  lat: number;
  lng: number;
  accuracy_m?: number;
  altitude_m?: number;
  speed_mps?: number;
  bearing?: number;
  entity_id?: string;
  indoor_zone?: string;
  timestamp?: string;
}

/** OwnTracks HTTP payload shape. */
export interface OwnTracksPayload {
  _type: 'location';
  lat: number;
  lon: number;
  acc?: number;
  alt?: number;
  vel?: number;
  cog?: number;
  tid?: string;
  tst?: number;
  [key: string]: unknown;
}

/**
 * Detect whether a payload is OwnTracks HTTP format.
 * OwnTracks payloads have `_type: "location"` and use `lon` instead of `lng`.
 */
export function isOwnTracksPayload(payload: unknown): payload is OwnTracksPayload {
  if (typeof payload !== 'object' || payload === null) return false;
  const p = payload as Record<string, unknown>;
  return p._type === 'location' && typeof p.lat === 'number' && typeof p.lon === 'number';
}

/**
 * Parse an OwnTracks payload into a LocationUpdate.
 */
export function parseOwnTracksPayload(payload: OwnTracksPayload): LocationUpdate {
  const update: LocationUpdate = {
    entity_id: payload.tid ?? 'owntracks',
    lat: payload.lat,
    lng: payload.lon,
    raw_payload: payload,
  };

  if (typeof payload.acc === 'number') {
    update.accuracy_m = payload.acc;
  }
  if (typeof payload.alt === 'number') {
    update.altitude_m = payload.alt;
  }
  if (typeof payload.vel === 'number') {
    update.speed_mps = payload.vel;
  }
  if (typeof payload.cog === 'number') {
    update.bearing = payload.cog;
  }
  if (typeof payload.tst === 'number') {
    update.timestamp = new Date(payload.tst * 1000);
  }

  return update;
}

/**
 * Parse a standard webhook payload into a LocationUpdate.
 * Returns null if lat/lng are missing or invalid.
 */
export function parseStandardPayload(payload: unknown): LocationUpdate | null {
  if (typeof payload !== 'object' || payload === null) return null;

  const p = payload as Record<string, unknown>;

  if (typeof p.lat !== 'number' || typeof p.lng !== 'number') return null;

  const update: LocationUpdate = {
    entity_id: typeof p.entity_id === 'string' ? p.entity_id : 'webhook',
    lat: p.lat,
    lng: p.lng,
    raw_payload: payload,
  };

  if (typeof p.accuracy_m === 'number') {
    update.accuracy_m = p.accuracy_m;
  }
  if (typeof p.altitude_m === 'number') {
    update.altitude_m = p.altitude_m;
  }
  if (typeof p.speed_mps === 'number') {
    update.speed_mps = p.speed_mps;
  }
  if (typeof p.bearing === 'number') {
    update.bearing = p.bearing;
  }
  if (typeof p.indoor_zone === 'string') {
    update.indoor_zone = p.indoor_zone;
  }
  if (typeof p.timestamp === 'string') {
    const d = new Date(p.timestamp);
    if (!Number.isNaN(d.getTime())) {
      update.timestamp = d;
    }
  }

  return update;
}

/**
 * Parse any incoming webhook payload, auto-detecting format.
 * Tries OwnTracks first, then standard format.
 * Returns null if the payload is not a valid location update.
 */
export function parseWebhookPayload(payload: unknown): LocationUpdate | null {
  if (isOwnTracksPayload(payload)) {
    return parseOwnTracksPayload(payload);
  }
  return parseStandardPayload(payload);
}

// ---------- webhook connection ----------

interface WebhookConnectionContext {
  connected: boolean;
  trackedEntities: Set<string>;
  onUpdate: LocationUpdateHandler;
}

/**
 * Create a Connection that accepts location updates pushed via the webhook handler.
 * Unlike HA/MQTT, this does not make outbound connections — it receives data passively.
 */
function createWebhookConnection(
  onUpdate: LocationUpdateHandler,
): { connection: Connection; pushUpdate: (update: LocationUpdate) => void } {
  const ctx: WebhookConnectionContext = {
    connected: true,
    trackedEntities: new Set<string>(),
    onUpdate,
  };

  function pushUpdate(update: LocationUpdate): void {
    if (!ctx.connected) return;

    // If entity filtering is active, only pass through tracked entities
    if (ctx.trackedEntities.size > 0 && !ctx.trackedEntities.has(update.entity_id)) {
      return;
    }

    ctx.onUpdate(update);
  }

  const connection: Connection = {
    async disconnect(): Promise<void> {
      ctx.connected = false;
    },

    addEntities(entityIds: string[]): void {
      for (const id of entityIds) {
        ctx.trackedEntities.add(id);
      }
    },

    removeEntities(entityIds: string[]): void {
      for (const id of entityIds) {
        ctx.trackedEntities.delete(id);
      }
    },

    isConnected(): boolean {
      return ctx.connected;
    },
  };

  return { connection, pushUpdate };
}

// ---------- plugin ----------

export const webhookPlugin: GeoProviderPlugin = {
  type: 'webhook',

  validateConfig(config: unknown): Result<ProviderConfig, ValidationError[]> {
    if (typeof config !== 'object' || config === null) {
      return {
        ok: false,
        error: [{ field: 'label', message: 'Config must be an object' }],
      };
    }

    const cfg = config as Record<string, unknown>;

    // Webhook provider only needs a label — the URL is auto-generated from provider ID
    if (typeof cfg.label !== 'string' || !cfg.label.trim()) {
      return {
        ok: false,
        error: [{ field: 'label', message: 'label is required and must be a non-empty string' }],
      };
    }

    return { ok: true, value: { label: cfg.label.trim() } };
  },

  async verify(_config: ProviderConfig, credentials: string): Promise<VerifyResult> {
    // For webhooks, verify just checks the token exists and appears encrypted or valid
    if (!credentials || credentials.length === 0) {
      return {
        success: false,
        message: 'No webhook token configured',
        entities: [],
      };
    }

    return {
      success: true,
      message: 'Webhook token is configured. Waiting for incoming location data.',
      entities: [],
    };
  },

  async discoverEntities(): Promise<EntityInfo[]> {
    // Webhooks don't have discoverable entities — devices identify themselves in payloads
    return [];
  },

  async connect(
    _config: ProviderConfig,
    _credentials: string,
    onUpdate: LocationUpdateHandler,
  ): Promise<Connection> {
    const { connection } = createWebhookConnection(onUpdate);
    return connection;
  },
};

// Re-export createWebhookConnection for the webhook handler
export { createWebhookConnection };

// ---------- registration ----------

/** Register the webhook provider in the plugin registry. */
export function registerWebhookProvider(): void {
  registerProvider(webhookPlugin);
}
