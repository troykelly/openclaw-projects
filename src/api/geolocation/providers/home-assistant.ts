/**
 * Home Assistant geolocation provider plugin.
 * Connects via WebSocket (primary) with REST fallback for discovery/verify.
 * Issue #1246.
 */

import WebSocket from 'ws';
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
import { resolveAndValidateOutboundUrl } from '../network-guard.ts';
import { registerProvider } from '../registry.ts';
import type { HaStateChange } from '../ha-event-processor.ts';
import { HaEventRouter } from '../ha-event-router.ts';
import { GeoIngestorProcessor } from '../processors/geo-ingestor-processor.ts';

// ---------- credential parsing ----------

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000; // refresh 5 minutes before expiry

export interface HaCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  isOAuth: boolean;
  isExpired: boolean;
}

/**
 * Parse HA credentials — either a plain access token string or JSON OAuth blob.
 */
export function parseHaCredentials(raw: string): HaCredentials {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && typeof (parsed as Record<string, unknown>).access_token === 'string') {
      const obj = parsed as Record<string, unknown>;
      const expiresAt = typeof obj.expires_at === 'string' ? new Date(obj.expires_at) : undefined;
      const isExpired = expiresAt
        ? expiresAt.getTime() - TOKEN_EXPIRY_BUFFER_MS <= Date.now()
        : false;
      return {
        accessToken: obj.access_token as string,
        refreshToken: typeof obj.refresh_token === 'string' ? obj.refresh_token : undefined,
        expiresAt,
        isOAuth: true,
        isExpired,
      };
    }
  } catch {
    // Not JSON — treat as plain token
  }

  return {
    accessToken: raw,
    isOAuth: false,
    isExpired: false,
  };
}

// ---------- entity matching ----------

const TRACKED_PREFIXES = ['device_tracker.', 'person.'];
const BERMUDA_PREFIX = 'sensor.bermuda_';

function isTrackedEntity(entity_id: string): boolean {
  return (
    TRACKED_PREFIXES.some((p) => entity_id.startsWith(p)) ||
    entity_id.startsWith(BERMUDA_PREFIX)
  );
}

// ---------- HA state type ----------

interface HaState {
  entity_id: string;
  state?: string;
  attributes?: Record<string, unknown>;
  last_changed?: string;
  last_updated?: string;
}

// ---------- payload parsing ----------

/**
 * Parse a Home Assistant state object into a LocationUpdate.
 * Returns null if the entity is not tracked or lacks location data.
 */
export function parseStatePayload(state: HaState): LocationUpdate | null {
  const entity_id = state.entity_id;
  if (!isTrackedEntity(entity_id)) return null;

  const attrs = state.attributes;
  if (!attrs) return null;

  const lat = typeof attrs.latitude === 'number' ? attrs.latitude : undefined;
  const lng = typeof attrs.longitude === 'number' ? attrs.longitude : undefined;

  // We require lat/lng to produce a valid update
  if (lat === undefined || lng === undefined) return null;

  const update: LocationUpdate = {
    entity_id: entity_id,
    lat,
    lng,
    raw_payload: state,
  };

  if (typeof attrs.gps_accuracy === 'number') {
    update.accuracy_m = attrs.gps_accuracy;
  }
  if (typeof attrs.altitude === 'number') {
    update.altitude_m = attrs.altitude;
  }
  if (typeof attrs.speed === 'number') {
    update.speed_mps = attrs.speed;
  }
  if (typeof attrs.course === 'number') {
    update.bearing = attrs.course;
  }

  // Bermuda indoor tracking
  if (entity_id.startsWith(BERMUDA_PREFIX) && typeof attrs.area_name === 'string') {
    update.indoor_zone = attrs.area_name;
  }

  return update;
}

// ---------- REST helpers ----------

async function haFetch(
  baseUrl: string,
  path: string,
  token: string,
): Promise<Response> {
  const url = baseUrl.replace(/\/+$/, '') + path;
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
}

function stateToEntityInfo(s: HaState): EntityInfo {
  const attrs = s.attributes ?? {};
  const info: EntityInfo = {
    id: s.entity_id,
    name: (typeof attrs.friendly_name === 'string' ? attrs.friendly_name : s.entity_id),
  };
  if (s.entity_id.startsWith('person.')) {
    info.type = 'person';
  } else if (s.entity_id.startsWith('device_tracker.')) {
    info.type = 'device_tracker';
  } else if (s.entity_id.startsWith(BERMUDA_PREFIX)) {
    info.type = 'bermuda_sensor';
  }
  if (s.last_changed) {
    const d = new Date(s.last_changed);
    if (!isNaN(d.getTime())) info.lastSeen = d;
  }
  return info;
}

async function fetchTrackedStates(
  baseUrl: string,
  token: string,
): Promise<EntityInfo[]> {
  const resp = await haFetch(baseUrl, '/api/states', token);
  if (!resp.ok) {
    throw new Error(`HA states request failed: ${resp.status}`);
  }
  const states: HaState[] = await resp.json();
  return states
    .filter((s) => isTrackedEntity(s.entity_id))
    .map(stateToEntityInfo);
}

// ---------- reconnection ----------

const INITIAL_DELAY_MS = 1_000;
const MAX_DELAY_MS = 5 * 60 * 1_000;

function nextDelay(attempt: number): number {
  const base = Math.min(INITIAL_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  const jitter = Math.random() * 0.5 * base;
  return base + jitter;
}

// ---------- WebSocket connection ----------

function buildWsUrl(httpsUrl: string): string {
  return httpsUrl.replace(/^https:\/\//, 'wss://').replace(/\/+$/, '') + '/api/websocket';
}

interface WsContext {
  ws: WebSocket | null;
  connected: boolean;
  disconnecting: boolean;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  trackedEntities: Set<string>;
  attempt: number;
  msgId: number;
}

/**
 * Extract domain from an entity_id (the part before the first dot).
 */
function extractDomain(entityId: string): string {
  const dotIndex = entityId.indexOf('.');
  return dotIndex > 0 ? entityId.slice(0, dotIndex) : entityId;
}

/**
 * Convert a raw HA WebSocket state_changed event into an HaStateChange.
 * Returns null if the event data is missing required fields.
 */
function parseWsEvent(
  msg: { type: string; [key: string]: unknown },
): HaStateChange | null {
  const event = msg.event as {
    event_type?: string;
    data?: {
      entity_id?: string;
      new_state?: HaState;
      old_state?: HaState | null;
    };
    context?: { id: string; parent_id: string | null; user_id: string | null };
  } | undefined;

  if (!event?.data?.new_state) return null;

  const entityId = event.data.entity_id ?? event.data.new_state.entity_id;
  if (!entityId) return null;

  return {
    entity_id: entityId,
    domain: extractDomain(entityId),
    old_state: event.data.old_state?.state ?? null,
    new_state: event.data.new_state.state ?? '',
    old_attributes: event.data.old_state?.attributes ?? {},
    new_attributes: event.data.new_state.attributes ?? {},
    last_changed: event.data.new_state.last_changed ?? '',
    last_updated: event.data.new_state.last_updated ?? event.data.new_state.last_changed ?? '',
    context: event.context ?? { id: '', parent_id: null, user_id: null },
  };
}

function connectWs(
  config: ProviderConfig,
  credentials: string,
  onUpdate: LocationUpdateHandler,
  refreshCb?: () => Promise<string>,
): Promise<Connection> {
  const baseUrl = config.url as string;
  const wsUrl = buildWsUrl(baseUrl);
  const namespace = 'default';
  const creds = parseHaCredentials(credentials);
  let currentToken = creds.accessToken;

  // Set up event router with geo ingestor processor
  const router = new HaEventRouter();
  router.register(new GeoIngestorProcessor(onUpdate));

  const ctx: WsContext = {
    ws: null,
    connected: false,
    disconnecting: false,
    reconnectTimer: null,
    trackedEntities: new Set<string>(),
    attempt: 0,
    msgId: 0,
  };

  function handleEvent(msg: { type: string; [key: string]: unknown }) {
    const stateChange = parseWsEvent(msg);
    if (!stateChange) return;

    // If we have a tracked entity set, filter to only those
    if (ctx.trackedEntities.size > 0 && !ctx.trackedEntities.has(stateChange.entity_id)) return;

    void router.dispatch(stateChange, namespace);
  }

  function setupMessageHandler(ws: WebSocket) {
    ws.on('message', (data: WebSocket.Data) => {
      let msg: { type: string; [key: string]: unknown };
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }

      switch (msg.type) {
        case 'auth_required':
          ws.send(JSON.stringify({ type: 'auth', access_token: currentToken }));
          break;

        case 'auth_ok':
          ctx.connected = true;
          ctx.attempt = 0;
          ctx.msgId++;
          ws.send(
            JSON.stringify({
              id: ctx.msgId,
              type: 'subscribe_events',
              event_type: 'state_changed',
            }),
          );
          break;

        case 'auth_invalid':
          ctx.connected = false;
          if (refreshCb) {
            void refreshCb().then((newToken) => {
              currentToken = newToken;
              ws.send(JSON.stringify({ type: 'auth', access_token: newToken }));
            }).catch(() => {
              ws.close();
            });
          } else {
            ws.close();
          }
          break;

        case 'event':
          handleEvent(msg);
          break;
      }
    });
  }

  function scheduleReconnect() {
    if (ctx.disconnecting) return;
    const delay = nextDelay(ctx.attempt);
    ctx.attempt++;
    ctx.reconnectTimer = setTimeout(() => {
      if (ctx.disconnecting) return;
      const ws = new WebSocket(wsUrl);
      ctx.ws = ws;
      setupMessageHandler(ws);
      ws.on('close', () => {
        ctx.connected = false;
        ctx.ws = null;
        scheduleReconnect();
      });
      ws.on('error', (err: Error) => {
        ctx.connected = false;
        console.error('[HA-WS] Reconnect socket error:', err.message);
      });
    }, delay);
  }

  const connection: Connection = {
    async disconnect() {
      ctx.disconnecting = true;
      if (ctx.reconnectTimer) {
        clearTimeout(ctx.reconnectTimer);
        ctx.reconnectTimer = null;
      }
      if (ctx.ws) {
        ctx.ws.removeAllListeners();
        ctx.ws.close();
        ctx.ws = null;
      }
      ctx.connected = false;
      await router.shutdown();
    },

    addEntities(entityIds: string[]) {
      for (const id of entityIds) {
        ctx.trackedEntities.add(id);
      }
    },

    removeEntities(entityIds: string[]) {
      for (const id of entityIds) {
        ctx.trackedEntities.delete(id);
      }
    },

    isConnected() {
      return ctx.connected;
    },
  };

  return new Promise<Connection>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ctx.ws = ws;

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Connection timeout'));
    }, 30_000);

    ws.on('message', (data: WebSocket.Data) => {
      let msg: { type: string; [key: string]: unknown };
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }

      switch (msg.type) {
        case 'auth_required':
          ws.send(JSON.stringify({ type: 'auth', access_token: currentToken }));
          break;

        case 'auth_ok':
          clearTimeout(timeout);
          ctx.connected = true;
          ctx.attempt = 0;
          ctx.msgId++;
          ws.send(
            JSON.stringify({
              id: ctx.msgId,
              type: 'subscribe_events',
              event_type: 'state_changed',
            }),
          );
          // Switch to standard message handler for ongoing events
          ws.removeAllListeners('message');
          setupMessageHandler(ws);
          resolve(connection);
          break;

        case 'auth_invalid':
          clearTimeout(timeout);
          ctx.connected = false;
          if (refreshCb) {
            void refreshCb().then((newToken) => {
              currentToken = newToken;
              ws.send(JSON.stringify({ type: 'auth', access_token: newToken }));
            }).catch(() => {
              ws.close();
              reject(new Error('Authentication failed: token refresh failed'));
            });
          } else {
            ws.close();
            reject(new Error('Authentication failed: invalid access token'));
          }
          break;

        case 'event':
          handleEvent(msg);
          break;
      }
    });

    ws.on('close', () => {
      ctx.connected = false;
      ctx.ws = null;
      if (!ctx.disconnecting) {
        scheduleReconnect();
      }
    });

    ws.on('error', (err: Error) => {
      ctx.connected = false;
      clearTimeout(timeout);
      if (ctx.attempt === 0) {
        reject(new Error(`WebSocket error: ${err.message}`));
      }
    });
  });
}

// ---------- plugin ----------

export const homeAssistantPlugin: GeoProviderPlugin = {
  type: 'home_assistant',

  async validateConfig(config: unknown): Promise<Result<ProviderConfig, ValidationError[]>> {
    if (typeof config !== 'object' || config === null) {
      return {
        ok: false,
        error: [{ field: 'url', message: 'Config must be an object with a url property' }],
      };
    }

    const cfg = config as Record<string, unknown>;
    if (typeof cfg.url !== 'string' || !cfg.url) {
      return {
        ok: false,
        error: [{ field: 'url', message: 'url is required and must be a string' }],
      };
    }

    // Validate URL format
    let parsed: URL;
    try {
      parsed = new URL(cfg.url);
    } catch {
      return {
        ok: false,
        error: [{ field: 'url', message: 'Invalid URL format' }],
      };
    }

    // Must be https (network-guard also checks, but give a clear error)
    if (parsed.protocol !== 'https:') {
      return {
        ok: false,
        error: [{ field: 'url', message: 'URL must use https scheme' }],
      };
    }

    // Issue #1822: DNS-resolving SSRF check prevents DNS rebinding attacks
    const urlResult = await resolveAndValidateOutboundUrl(cfg.url);
    if (!urlResult.ok) {
      return {
        ok: false,
        error: [{ field: 'url', message: urlResult.error }],
      };
    }

    return { ok: true, value: { url: cfg.url } };
  },

  async verify(config: ProviderConfig, credentials: string): Promise<VerifyResult> {
    const baseUrl = config.url as string;
    const creds = parseHaCredentials(credentials);

    try {
      const apiResp = await haFetch(baseUrl, '/api/', creds.accessToken);
      if (!apiResp.ok) {
        return {
          success: false,
          message: `HA API returned status ${apiResp.status}`,
          entities: [],
        };
      }

      const apiInfo = await apiResp.json() as { version?: string; message?: string };
      const entities = await fetchTrackedStates(baseUrl, creds.accessToken);

      return {
        success: true,
        message: `Connected to Home Assistant ${apiInfo.version ?? 'unknown'}. Found ${entities.length} trackable entities.`,
        entities,
      };
    } catch (err) {
      return {
        success: false,
        message: `Failed to connect: ${err instanceof Error ? err.message : String(err)}`,
        entities: [],
      };
    }
  },

  async discoverEntities(config: ProviderConfig, credentials: string): Promise<EntityInfo[]> {
    const baseUrl = config.url as string;
    const creds = parseHaCredentials(credentials);
    return fetchTrackedStates(baseUrl, creds.accessToken);
  },

  connect(
    config: ProviderConfig,
    credentials: string,
    onUpdate: LocationUpdateHandler,
  ): Promise<Connection> {
    const creds = parseHaCredentials(credentials);
    const refreshCb = creds.isOAuth && creds.refreshToken
      ? async (): Promise<string> => {
          // Dynamic import to avoid circular deps at module level
          const { refreshAccessToken } = await import('../../oauth/home-assistant.ts');
          const baseUrl = (config.url as string).replace(/\/+$/, '');
          // clientId must match the one used during initial authorization (PUBLIC_BASE_URL)
          const rawPublicBase = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
          const clientId = rawPublicBase.replace(/\/+$/, '');
          const tokens = await refreshAccessToken(baseUrl, creds.refreshToken!, clientId);
          return tokens.access_token;
        }
      : undefined;
    return connectWs(config, credentials, onUpdate, refreshCb);
  },
};

// ---------- registration ----------

/** Register the HA provider in the plugin registry. */
export function registerHaProvider(): void {
  registerProvider(homeAssistantPlugin);
}
