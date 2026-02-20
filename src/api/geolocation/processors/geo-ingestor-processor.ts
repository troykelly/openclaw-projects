/**
 * Geo ingestor processor plugin.
 *
 * Converts HA state_changed events for geo-relevant entities (device_tracker,
 * person, bermuda sensors) into LocationUpdate objects and forwards them to
 * the registered update handler.
 *
 * This is a refactored extraction of the inline geo filtering and parsing
 * logic previously embedded in the HA WebSocket connection handler.
 *
 * Issue #1445.
 */

import type {
  HaEventProcessor,
  HaEventProcessorConfig,
  HaStateChange,
} from '../ha-event-processor.ts';
import type { LocationUpdate, LocationUpdateHandler } from '../types.ts';

const BERMUDA_PREFIX = 'sensor.bermuda_';

/**
 * Convert an HaStateChange into a LocationUpdate, if it contains geo data.
 * Returns null if the entity lacks lat/lng or is not a tracked geo entity.
 */
function stateChangeToLocationUpdate(change: HaStateChange): LocationUpdate | null {
  const entityId = change.entity_id;
  const attrs = change.new_attributes;

  const lat = typeof attrs.latitude === 'number' ? attrs.latitude : undefined;
  const lng = typeof attrs.longitude === 'number' ? attrs.longitude : undefined;

  if (lat === undefined || lng === undefined) return null;

  const update: LocationUpdate = {
    entity_id: entityId,
    lat,
    lng,
    raw_payload: change,
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

  if (entityId.startsWith(BERMUDA_PREFIX) && typeof attrs.area_name === 'string') {
    update.indoor_zone = attrs.area_name;
  }

  return update;
}

/**
 * Event processor that ingests geolocation data from HA state changes.
 *
 * Filters for device_tracker, person, and bermuda sensor entities,
 * extracts lat/lng/accuracy/etc., and forwards as LocationUpdate objects.
 */
export class GeoIngestorProcessor implements HaEventProcessor {
  private readonly updateHandler: LocationUpdateHandler;

  constructor(onUpdate: LocationUpdateHandler) {
    this.updateHandler = onUpdate;
  }

  getConfig(): HaEventProcessorConfig {
    return {
      id: 'geo-ingestor',
      name: 'Geolocation Ingestor',
      filter: {
        domains: ['device_tracker', 'person'],
        entityPatterns: ['sensor.bermuda_*'],
      },
      mode: 'individual',
    };
  }

  async onConnect(_haUrl: string): Promise<void> {
    // No-op for geo ingestor
  }

  async onDisconnect(_reason: string): Promise<void> {
    // No-op for geo ingestor
  }

  async onStateChange(change: HaStateChange, _namespace: string): Promise<void> {
    const update = stateChangeToLocationUpdate(change);
    if (update) {
      this.updateHandler(update);
    }
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async shutdown(): Promise<void> {
    // No resources to release
  }
}
