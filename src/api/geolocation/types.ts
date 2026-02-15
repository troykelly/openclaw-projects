/**
 * Geolocation provider plugin types and interfaces.
 * Part of Issue #1244.
 */

/** Provider types matching DB enum `geo_provider_type`. */
export type GeoProviderType = 'home_assistant' | 'mqtt' | 'webhook';

/** Authentication types matching DB enum `geo_auth_type`. */
export type GeoAuthType = 'oauth2' | 'access_token' | 'mqtt_credentials' | 'webhook_token';

/** Provider status matching DB enum `geo_provider_status`. */
export type GeoProviderStatus = 'active' | 'inactive' | 'error' | 'connecting';

/** Result type for validation — discriminated union. */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

/** A single validation error with field path and message. */
export interface ValidationError {
  field: string;
  message: string;
}

/** Provider-specific configuration. */
export interface ProviderConfig {
  [key: string]: unknown;
}

/** Information about a discovered entity (device/person/zone). */
export interface EntityInfo {
  id: string;
  name: string;
  type?: string;
  lastSeen?: Date;
}

/** Result of verifying a provider connection. */
export interface VerifyResult {
  success: boolean;
  message: string;
  entities: EntityInfo[];
}

/** A location update emitted by a provider. */
export interface LocationUpdate {
  entity_id: string;
  lat: number;
  lng: number;
  accuracy_m?: number;
  altitude_m?: number;
  speed_mps?: number;
  bearing?: number;
  indoor_zone?: string;
  timestamp?: Date;
  raw_payload?: unknown;
}

/** Callback invoked when a provider emits a location update. */
export type LocationUpdateHandler = (update: LocationUpdate) => void;

/** A live connection to a provider. */
export interface Connection {
  disconnect(): Promise<void>;
  addEntities(entityIds: string[]): void;
  removeEntities(entityIds: string[]): void;
  isConnected(): boolean;
}

/** The plugin interface all geolocation providers must implement. */
export interface GeoProviderPlugin {
  type: GeoProviderType;
  validateConfig(config: unknown): Result<ProviderConfig, ValidationError[]>;
  verify(config: ProviderConfig, credentials: string): Promise<VerifyResult>;
  discoverEntities(config: ProviderConfig, credentials: string): Promise<EntityInfo[]>;
  connect(
    config: ProviderConfig,
    credentials: string,
    onUpdate: LocationUpdateHandler,
  ): Promise<Connection>;
}
