/**
 * MQTT geolocation provider plugin.
 * Connects via MQTTS to receive location updates from OwnTracks, Home Assistant, or custom formats.
 * Issue #1247.
 */

import type { IClientOptions, MqttClient } from 'mqtt';
import mqtt from 'mqtt';

import { validateOutboundHost } from '../network-guard.ts';
import { registerProvider } from '../registry.ts';
import type {
  Connection,
  EntityInfo,
  GeoProviderPlugin,
  LocationUpdate,
  LocationUpdateHandler,
  ProviderConfig,
  Result,
  ValidationError,
  VerifyResult,
} from '../types.ts';

// ---------- config types ----------

/** Supported payload formats. */
export type MqttPayloadFormat = 'owntracks' | 'home_assistant' | 'custom';

/** Dot-notation property path mapping for custom payloads. */
export interface PayloadMapping {
  lat: string;
  lng: string;
  accuracy?: string;
  altitude?: string;
  speed?: string;
  bearing?: string;
  indoor_zone?: string;
  entity_id?: string;
  timestamp?: string;
}

/** Validated MQTT provider configuration. */
export interface MqttProviderConfig {
  host: string;
  port: number;
  ca_cert?: string;
  format: MqttPayloadFormat;
  topics: string[];
  payload_mapping?: PayloadMapping;
}

// ---------- dot-notation property extraction ----------

/**
 * Extract a value from a nested object using dot-notation path.
 * No recursive descent -- only direct property access.
 * Example: extractByPath({ a: { b: 1 } }, 'a.b') => 1
 */
export function extractByPath(obj: unknown, path: string): unknown {
  const segments = path.split('.');
  let current: unknown = obj;
  for (const seg of segments) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

/**
 * Validate that a dot-notation path is well-formed.
 * Rules: non-empty, no leading/trailing dots, no consecutive dots, alphanumeric + underscore segments.
 */
export function isValidPropertyPath(path: string): boolean {
  if (!path || path.startsWith('.') || path.endsWith('.')) return false;
  const segments = path.split('.');
  return segments.every((seg) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(seg));
}

// ---------- payload parsers ----------

/**
 * Parse an OwnTracks location payload (_type: "location").
 * See: https://owntracks.org/booklet/tech/json/#_typelocation
 */
export function parseOwnTracksLocation(payload: Record<string, unknown>, topic: string): LocationUpdate | null {
  if (payload._type !== 'location') return null;

  const lat = typeof payload.lat === 'number' ? payload.lat : undefined;
  const lon = typeof payload.lon === 'number' ? payload.lon : undefined;
  if (lat === undefined || lon === undefined) return null;

  // Entity ID: derive from topic (owntracks/user/device -> user/device)
  const entityId = deriveEntityIdFromTopic(topic);

  const update: LocationUpdate = {
    entity_id: entityId,
    lat,
    lng: lon,
    raw_payload: payload,
  };

  if (typeof payload.acc === 'number') update.accuracy_m = payload.acc;
  if (typeof payload.alt === 'number') update.altitude_m = payload.alt;
  if (typeof payload.vel === 'number') update.speed_mps = payload.vel;
  if (typeof payload.cog === 'number') update.bearing = payload.cog;

  if (typeof payload.tst === 'number') {
    update.timestamp = new Date(payload.tst * 1000);
  }

  return update;
}

/**
 * Parse an OwnTracks transition payload (_type: "transition").
 * Emits an indoor_zone update when entering/leaving a region.
 */
export function parseOwnTracksTransition(payload: Record<string, unknown>, topic: string): LocationUpdate | null {
  if (payload._type !== 'transition') return null;

  const lat = typeof payload.lat === 'number' ? payload.lat : undefined;
  const lon = typeof payload.lon === 'number' ? payload.lon : undefined;
  if (lat === undefined || lon === undefined) return null;

  const entityId = deriveEntityIdFromTopic(topic);
  const event = payload.event as string | undefined;
  const desc = payload.desc as string | undefined;

  const update: LocationUpdate = {
    entity_id: entityId,
    lat,
    lng: lon,
    raw_payload: payload,
  };

  // If entering a region, set indoor_zone to the region description
  // If leaving, set indoor_zone to empty string to clear it
  if (typeof desc === 'string') {
    update.indoor_zone = event === 'enter' ? desc : '';
  }

  if (typeof payload.acc === 'number') update.accuracy_m = payload.acc;
  if (typeof payload.tst === 'number') {
    update.timestamp = new Date(payload.tst * 1000);
  }

  return update;
}

/**
 * Parse a Home Assistant MQTT payload.
 * HA publishes device tracker state with latitude, longitude, gps_accuracy.
 */
export function parseHaMqttPayload(payload: Record<string, unknown>, topic: string): LocationUpdate | null {
  const lat = typeof payload.latitude === 'number' ? payload.latitude : undefined;
  const lng = typeof payload.longitude === 'number' ? payload.longitude : undefined;
  if (lat === undefined || lng === undefined) return null;

  // Entity ID: use the last segment of the topic
  const entityId = topic.split('/').pop() ?? topic;

  const update: LocationUpdate = {
    entity_id: entityId,
    lat,
    lng,
    raw_payload: payload,
  };

  if (typeof payload.gps_accuracy === 'number') update.accuracy_m = payload.gps_accuracy;
  if (typeof payload.altitude === 'number') update.altitude_m = payload.altitude;
  if (typeof payload.speed === 'number') update.speed_mps = payload.speed;
  if (typeof payload.bearing === 'number') update.bearing = payload.bearing;

  return update;
}

/**
 * Parse a custom-format payload using dot-notation property mappings.
 */
export function parseCustomPayload(payload: Record<string, unknown>, topic: string, mapping: PayloadMapping): LocationUpdate | null {
  const lat = extractByPath(payload, mapping.lat);
  const lng = extractByPath(payload, mapping.lng);

  if (typeof lat !== 'number' || typeof lng !== 'number') return null;

  // Entity ID: from mapping or fallback to last topic segment
  let entityId: string;
  if (mapping.entity_id) {
    const extracted = extractByPath(payload, mapping.entity_id);
    entityId = typeof extracted === 'string' ? extracted : (topic.split('/').pop() ?? topic);
  } else {
    entityId = topic.split('/').pop() ?? topic;
  }

  const update: LocationUpdate = {
    entity_id: entityId,
    lat,
    lng,
    raw_payload: payload,
  };

  if (mapping.accuracy) {
    const v = extractByPath(payload, mapping.accuracy);
    if (typeof v === 'number') update.accuracy_m = v;
  }
  if (mapping.altitude) {
    const v = extractByPath(payload, mapping.altitude);
    if (typeof v === 'number') update.altitude_m = v;
  }
  if (mapping.speed) {
    const v = extractByPath(payload, mapping.speed);
    if (typeof v === 'number') update.speed_mps = v;
  }
  if (mapping.bearing) {
    const v = extractByPath(payload, mapping.bearing);
    if (typeof v === 'number') update.bearing = v;
  }
  if (mapping.indoor_zone) {
    const v = extractByPath(payload, mapping.indoor_zone);
    if (typeof v === 'string') update.indoor_zone = v;
  }
  if (mapping.timestamp) {
    const v = extractByPath(payload, mapping.timestamp);
    if (typeof v === 'number') {
      update.timestamp = new Date(v * 1000);
    } else if (typeof v === 'string') {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) update.timestamp = d;
    }
  }

  return update;
}

/**
 * Derive an entity ID from an MQTT topic.
 * For OwnTracks topics like "owntracks/user/device", returns "user/device".
 * For other topics, returns the last two segments or the full topic.
 */
export function deriveEntityIdFromTopic(topic: string): string {
  const parts = topic.split('/');
  if (parts.length >= 3 && parts[0].toLowerCase() === 'owntracks') {
    return parts.slice(1).join('/');
  }
  if (parts.length >= 2) {
    return parts.slice(-2).join('/');
  }
  return topic;
}

// ---------- config validation ----------

const VALID_FORMATS: ReadonlySet<string> = new Set(['owntracks', 'home_assistant', 'custom']);
const DEFAULT_PORT = 8883;

function validatePayloadMapping(mapping: unknown): Result<PayloadMapping, ValidationError[]> {
  if (typeof mapping !== 'object' || mapping === null) {
    return {
      ok: false,
      error: [{ field: 'payload_mapping', message: 'payload_mapping must be an object' }],
    };
  }

  const m = mapping as Record<string, unknown>;
  const errors: ValidationError[] = [];

  // lat and lng are required for custom mappings
  if (typeof m.lat !== 'string' || !isValidPropertyPath(m.lat)) {
    errors.push({ field: 'payload_mapping.lat', message: 'lat must be a valid dot-notation property path' });
  }
  if (typeof m.lng !== 'string' || !isValidPropertyPath(m.lng)) {
    errors.push({ field: 'payload_mapping.lng', message: 'lng must be a valid dot-notation property path' });
  }

  // Optional fields must be valid paths if present
  const optionalFields: Array<keyof PayloadMapping> = ['accuracy', 'altitude', 'speed', 'bearing', 'indoor_zone', 'entity_id', 'timestamp'];
  for (const field of optionalFields) {
    if (m[field] !== undefined) {
      if (typeof m[field] !== 'string' || !isValidPropertyPath(m[field] as string)) {
        errors.push({
          field: `payload_mapping.${field}`,
          message: `${field} must be a valid dot-notation property path`,
        });
      }
    }
  }

  if (errors.length > 0) return { ok: false, error: errors };

  const result: PayloadMapping = {
    lat: m.lat as string,
    lng: m.lng as string,
  };
  for (const field of optionalFields) {
    if (typeof m[field] === 'string') {
      (result as Record<string, string>)[field] = m[field] as string;
    }
  }

  return { ok: true, value: result };
}

// ---------- reconnection ----------

const INITIAL_DELAY_MS = 1_000;
const MAX_DELAY_MS = 5 * 60 * 1_000;

function nextDelay(attempt: number): number {
  const base = Math.min(INITIAL_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  const jitter = Math.random() * 0.5 * base;
  return base + jitter;
}

// ---------- MQTT connection ----------

interface MqttContext {
  client: MqttClient | null;
  connected: boolean;
  disconnecting: boolean;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  trackedEntities: Set<string>;
  subscribedTopics: Set<string>;
  attempt: number;
}

function buildMqttUrl(host: string, port: number): string {
  return `mqtts://${host}:${port}`;
}

function buildClientOptions(config: MqttProviderConfig, credentials: string): IClientOptions {
  const opts: IClientOptions = {
    protocol: 'mqtts',
    host: config.host,
    port: config.port,
    rejectUnauthorized: true,
    reconnectPeriod: 0, // We handle reconnection ourselves
    connectTimeout: 30_000,
  };

  // Parse credentials as JSON for username/password
  try {
    const creds = JSON.parse(credentials) as { username?: string; password?: string };
    if (creds.username) opts.username = creds.username;
    if (creds.password) opts.password = creds.password;
  } catch {
    // If credentials is not JSON, treat as a plain password
    if (credentials) {
      opts.password = credentials;
    }
  }

  // Custom CA cert
  if (config.ca_cert) {
    opts.ca = config.ca_cert;
  }

  return opts;
}

function createMessageHandler(config: MqttProviderConfig, ctx: MqttContext, onUpdate: LocationUpdateHandler): (topic: string, message: Buffer) => void {
  return (topic: string, message: Buffer) => {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(message.toString()) as Record<string, unknown>;
    } catch {
      return; // Ignore non-JSON messages
    }

    let update: LocationUpdate | null = null;

    switch (config.format) {
      case 'owntracks':
        update = parseOwnTracksLocation(payload, topic) ?? parseOwnTracksTransition(payload, topic);
        break;
      case 'home_assistant':
        update = parseHaMqttPayload(payload, topic);
        break;
      case 'custom':
        if (config.payload_mapping) {
          update = parseCustomPayload(payload, topic, config.payload_mapping);
        }
        break;
    }

    if (!update) return;

    // If we have a tracked entity set, filter to only those
    if (ctx.trackedEntities.size > 0 && !ctx.trackedEntities.has(update.entity_id)) return;

    onUpdate(update);
  };
}

function connectMqtt(config: MqttProviderConfig, credentials: string, onUpdate: LocationUpdateHandler): Promise<Connection> {
  const ctx: MqttContext = {
    client: null,
    connected: false,
    disconnecting: false,
    reconnectTimer: null,
    trackedEntities: new Set<string>(),
    subscribedTopics: new Set<string>(config.topics),
    attempt: 0,
  };

  const messageHandler = createMessageHandler(config, ctx, onUpdate);

  function subscribeTopics(client: MqttClient): void {
    for (const topic of ctx.subscribedTopics) {
      client.subscribe(topic);
    }
  }

  function scheduleReconnect(): void {
    if (ctx.disconnecting) return;
    const delay = nextDelay(ctx.attempt);
    ctx.attempt++;
    ctx.reconnectTimer = setTimeout(() => {
      if (ctx.disconnecting) return;
      const opts = buildClientOptions(config, credentials);
      const url = buildMqttUrl(config.host, config.port);
      const client = mqtt.connect(url, opts);
      ctx.client = client;

      client.on('connect', () => {
        ctx.connected = true;
        ctx.attempt = 0;
        subscribeTopics(client);
      });

      client.on('message', messageHandler);

      client.on('close', () => {
        ctx.connected = false;
        ctx.client = null;
        scheduleReconnect();
      });

      client.on('error', () => {
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
      const clientRef = ctx.client;
      if (clientRef) {
        clientRef.removeAllListeners();
        await new Promise<void>((resolve) => {
          clientRef.end(false, {}, () => resolve());
        });
        ctx.client = null;
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
    const opts = buildClientOptions(config, credentials);
    const url = buildMqttUrl(config.host, config.port);
    const client = mqtt.connect(url, opts);
    ctx.client = client;

    const timeout = setTimeout(() => {
      client.end(true);
      reject(new Error('Connection timeout'));
    }, 30_000);

    client.on('connect', () => {
      clearTimeout(timeout);
      ctx.connected = true;
      ctx.attempt = 0;
      subscribeTopics(client);
      resolve(connection);
    });

    client.on('message', messageHandler);

    client.on('close', () => {
      ctx.connected = false;
      ctx.client = null;
      if (!ctx.disconnecting && ctx.attempt > 0) {
        scheduleReconnect();
      }
    });

    client.on('error', (err: Error) => {
      ctx.connected = false;
      clearTimeout(timeout);
      if (ctx.attempt === 0) {
        reject(new Error(`MQTT connection error: ${err.message}`));
      }
    });
  });
}

// ---------- verify ----------

async function verifyMqtt(config: MqttProviderConfig, credentials: string): Promise<VerifyResult> {
  const opts = buildClientOptions(config, credentials);
  const url = buildMqttUrl(config.host, config.port);

  return new Promise<VerifyResult>((resolve) => {
    const client = mqtt.connect(url, opts);
    const entities: EntityInfo[] = [];
    const seenEntities = new Set<string>();

    const timeout = setTimeout(() => {
      client.end(true);
      if (entities.length > 0) {
        resolve({
          success: true,
          message: `Connected to MQTT broker. Received ${entities.length} location updates in 10s.`,
          entities,
        });
      } else {
        resolve({
          success: true,
          message: 'Connected to MQTT broker. No location messages received within 10s (this may be normal if devices are idle).',
          entities: [],
        });
      }
    }, 10_000);

    client.on('connect', () => {
      for (const topic of config.topics) {
        client.subscribe(topic);
      }
    });

    client.on('message', (topic: string, message: Buffer) => {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(message.toString()) as Record<string, unknown>;
      } catch {
        return;
      }

      let update: LocationUpdate | null = null;
      switch (config.format) {
        case 'owntracks':
          update = parseOwnTracksLocation(payload, topic) ?? parseOwnTracksTransition(payload, topic);
          break;
        case 'home_assistant':
          update = parseHaMqttPayload(payload, topic);
          break;
        case 'custom':
          if (config.payload_mapping) {
            update = parseCustomPayload(payload, topic, config.payload_mapping);
          }
          break;
      }

      if (update && !seenEntities.has(update.entity_id)) {
        seenEntities.add(update.entity_id);
        entities.push({
          id: update.entity_id,
          name: update.entity_id,
          lastSeen: update.timestamp ?? new Date(),
        });
      }
    });

    client.on('error', (err: Error) => {
      clearTimeout(timeout);
      client.end(true);
      resolve({
        success: false,
        message: `MQTT connection failed: ${err.message}`,
        entities: [],
      });
    });
  });
}

// ---------- plugin ----------

export const mqttPlugin: GeoProviderPlugin = {
  type: 'mqtt',

  validateConfig(config: unknown): Result<ProviderConfig, ValidationError[]> {
    if (typeof config !== 'object' || config === null) {
      return {
        ok: false,
        error: [{ field: 'host', message: 'Config must be an object with host, format, and topics properties' }],
      };
    }

    const cfg = config as Record<string, unknown>;
    const errors: ValidationError[] = [];

    // host: required string
    if (typeof cfg.host !== 'string' || !cfg.host) {
      errors.push({ field: 'host', message: 'host is required and must be a non-empty string' });
    }

    // port: optional number, default 8883
    const port = cfg.port !== undefined ? cfg.port : DEFAULT_PORT;
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
      errors.push({ field: 'port', message: 'port must be an integer between 1 and 65535' });
    }

    // format: required, one of valid formats
    if (typeof cfg.format !== 'string' || !VALID_FORMATS.has(cfg.format)) {
      errors.push({
        field: 'format',
        message: `format must be one of: ${[...VALID_FORMATS].join(', ')}`,
      });
    }

    // topics: required non-empty array of strings
    if (!Array.isArray(cfg.topics) || cfg.topics.length === 0) {
      errors.push({ field: 'topics', message: 'topics must be a non-empty array of strings' });
    } else {
      for (let i = 0; i < cfg.topics.length; i++) {
        if (typeof cfg.topics[i] !== 'string' || !(cfg.topics[i] as string).trim()) {
          errors.push({ field: `topics[${i}]`, message: 'Each topic must be a non-empty string' });
        }
      }
    }

    // ca_cert: optional string
    if (cfg.ca_cert !== undefined && typeof cfg.ca_cert !== 'string') {
      errors.push({ field: 'ca_cert', message: 'ca_cert must be a string (PEM-encoded certificate)' });
    }

    // Bail early if we have basic errors
    if (errors.length > 0) return { ok: false, error: errors };

    // Network guard validation
    const hostResult = validateOutboundHost(cfg.host as string, port as number);
    if (!hostResult.ok) {
      return {
        ok: false,
        error: [{ field: 'host', message: hostResult.error }],
      };
    }

    // payload_mapping: required for custom format, validated at config save time
    let payloadMapping: PayloadMapping | undefined;
    if (cfg.format === 'custom') {
      if (!cfg.payload_mapping) {
        return {
          ok: false,
          error: [{ field: 'payload_mapping', message: 'payload_mapping is required when format is "custom"' }],
        };
      }
      const mappingResult = validatePayloadMapping(cfg.payload_mapping);
      if (!mappingResult.ok) return mappingResult;
      payloadMapping = mappingResult.value;
    } else if (cfg.payload_mapping) {
      // Non-custom format with a mapping provided -- validate it anyway
      const mappingResult = validatePayloadMapping(cfg.payload_mapping);
      if (!mappingResult.ok) return mappingResult;
      payloadMapping = mappingResult.value;
    }

    const validated: MqttProviderConfig = {
      host: cfg.host as string,
      port: port as number,
      format: cfg.format as MqttPayloadFormat,
      topics: cfg.topics as string[],
    };

    if (typeof cfg.ca_cert === 'string') {
      validated.ca_cert = cfg.ca_cert;
    }

    if (payloadMapping) {
      validated.payload_mapping = payloadMapping;
    }

    return { ok: true, value: validated as unknown as ProviderConfig };
  },

  async verify(config: ProviderConfig, credentials: string): Promise<VerifyResult> {
    try {
      return await verifyMqtt(config as unknown as MqttProviderConfig, credentials);
    } catch (err) {
      return {
        success: false,
        message: `Failed to connect: ${err instanceof Error ? err.message : String(err)}`,
        entities: [],
      };
    }
  },

  async discoverEntities(_config: ProviderConfig, _credentials: string): Promise<EntityInfo[]> {
    // MQTT is a pub/sub model -- we cannot enumerate entities without listening.
    // Return empty; entities are discovered as messages arrive.
    return [];
  },

  connect(config: ProviderConfig, credentials: string, onUpdate: LocationUpdateHandler): Promise<Connection> {
    return connectMqtt(config as unknown as MqttProviderConfig, credentials, onUpdate);
  },
};

// ---------- registration ----------

/** Register the MQTT provider in the plugin registry. */
export function registerMqttProvider(): void {
  registerProvider(mqttPlugin);
}
