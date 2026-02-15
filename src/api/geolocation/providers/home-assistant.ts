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
import { validateOutboundUrl } from '../network-guard.ts';
import { registerProvider } from '../registry.ts';

// ---------- entity matching ----------

const TRACKED_PREFIXES = ['device_tracker.', 'person.'];
const BERMUDA_PREFIX = 'sensor.bermuda_';

function isTrackedEntity(entityId: string): boolean {
  return (
    TRACKED_PREFIXES.some((p) => entityId.startsWith(p)) ||
    entityId.startsWith(BERMUDA_PREFIX)
  );
}

// ---------- HA state type ----------

interface HaState {
  entity_id: string;
  state?: string;
  attributes?: Record<string, unknown>;
  last_changed?: string;
}

// ---------- payload parsing ----------

/**
 * Parse a Home Assistant state object into a LocationUpdate.
 * Returns null if the entity is not tracked or lacks location data.
 */
export function parseStatePayload(state: HaState): LocationUpdate | null {
  const entityId = state.entity_id;
  if (!isTrackedEntity(entityId)) return null;

  const attrs = state.attributes;
  if (!attrs) return null;

  const lat = typeof attrs.latitude === 'number' ? attrs.latitude : undefined;
  const lng = typeof attrs.longitude === 'number' ? attrs.longitude : undefined;

  // We require lat/lng to produce a valid update
  if (lat === undefined || lng === undefined) return null;

  const update: LocationUpdate = {
    entity_id: entityId,
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
  if (entityId.startsWith(BERMUDA_PREFIX) && typeof attrs.area_name === 'string') {
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

function connectWs(
  config: ProviderConfig,
  credentials: string,
  onUpdate: LocationUpdateHandler,
): Promise<Connection> {
  const baseUrl = config.url as string;
  const wsUrl = buildWsUrl(baseUrl);

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
    const event = msg.event as { event_type?: string; data?: { entity_id?: string; new_state?: HaState } } | undefined;
    if (!event?.data?.new_state) return;

    const entityId = event.data.entity_id ?? event.data.new_state.entity_id;
    if (!entityId) return;

    // If we have a tracked entity set, filter to only those
    if (ctx.trackedEntities.size > 0 && !ctx.trackedEntities.has(entityId)) return;

    const update = parseStatePayload(event.data.new_state);
    if (update) {
      onUpdate(update);
    }
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
          ws.send(JSON.stringify({ type: 'auth', access_token: credentials }));
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
          ws.close();
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
      ws.on('error', () => {
        ctx.connected = false;
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
          ws.send(JSON.stringify({ type: 'auth', access_token: credentials }));
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
          ws.close();
          reject(new Error('Authentication failed: invalid access token'));
          break;

        case 'event':
          handleEvent(msg);
          break;
      }
    });

    ws.on('close', () => {
      ctx.connected = false;
      ctx.ws = null;
      if (!ctx.disconnecting && ctx.attempt > 0) {
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

  validateConfig(config: unknown): Result<ProviderConfig, ValidationError[]> {
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

    const urlResult = validateOutboundUrl(cfg.url);
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

    try {
      const apiResp = await haFetch(baseUrl, '/api/', credentials);
      if (!apiResp.ok) {
        return {
          success: false,
          message: `HA API returned status ${apiResp.status}`,
          entities: [],
        };
      }

      const apiInfo = await apiResp.json() as { version?: string; message?: string };
      const entities = await fetchTrackedStates(baseUrl, credentials);

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
    return fetchTrackedStates(baseUrl, credentials);
  },

  connect(
    config: ProviderConfig,
    credentials: string,
    onUpdate: LocationUpdateHandler,
  ): Promise<Connection> {
    return connectWs(config, credentials, onUpdate);
  },
};

// ---------- registration ----------

/** Register the HA provider in the plugin registry. */
export function registerHaProvider(): void {
  registerProvider(homeAssistantPlugin);
}
