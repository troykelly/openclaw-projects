/**
 * Provider lifecycle manager for the HA Connector container.
 *
 * Manages the full lifecycle of geo provider connections:
 * - Boot: query active providers from DB
 * - Connect: decrypt credentials, establish WebSocket/connection
 * - Monitor: track connection health
 * - Reconcile: handle config changes (add/remove/reconnect)
 * - Shutdown: graceful disconnect all
 *
 * Issue #1636, parent #1603.
 */

import type { Pool } from 'pg';
import type { Connection, LocationUpdate } from '../api/geolocation/types.ts';
import { getProvider } from '../api/geolocation/registry.ts';
import { decryptCredentials, isGeoEncryptionEnabled } from '../api/geolocation/crypto.ts';
import type { HaEventRouter } from '../api/geolocation/ha-event-router.ts';
import type { HaStateChange } from '../api/geolocation/ha-event-processor.ts';
import type { ProviderHealthInfo } from './health.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProviderRow {
  id: string;
  provider_type: string;
  label: string;
  config: Record<string, unknown>;
  credentials: Buffer | null;
  status: string;
  owner_email: string;
}

interface ManagedProvider {
  row: ProviderRow;
  connection: Connection | null;
  error?: string;
}

export interface LifecycleHealth {
  providers: ProviderHealthInfo[];
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const ACTIVE_PROVIDERS_SQL = `
  SELECT id, provider_type, label, config, credentials, status, owner_email
  FROM geo_provider
  WHERE deleted_at IS NULL
    AND status NOT IN ('error')
  ORDER BY created_at
`;

const UPDATE_STATUS_SQL = `
  UPDATE geo_provider SET status = $2, status_message = $3, last_seen_at = CASE WHEN $2 = 'active' THEN now() ELSE last_seen_at END
  WHERE id = $1
`;

// ---------------------------------------------------------------------------
// ProviderLifecycleManager
// ---------------------------------------------------------------------------

export class ProviderLifecycleManager {
  private pool: Pool;
  private router: HaEventRouter;
  private managed: Map<string, ManagedProvider> = new Map();
  private running = false;

  constructor(pool: Pool, router: HaEventRouter) {
    this.pool = pool;
    this.router = router;
  }

  /**
   * Boot the lifecycle manager: query active providers and connect to each.
   */
  async start(): Promise<void> {
    this.running = true;
    const rows = await this.fetchProviders();
    await Promise.all(rows.map((row) => this.addProvider(row)));
  }

  /**
   * Graceful shutdown: disconnect all providers and flush router.
   */
  async shutdown(): Promise<void> {
    this.running = false;

    const disconnects = [...this.managed.values()].map(async (mp) => {
      try {
        if (mp.connection) {
          await mp.connection.disconnect();
        }
      } catch (err) {
        console.error(`[Lifecycle] Error disconnecting ${mp.row.id}:`, (err as Error).message);
      }
    });

    await Promise.allSettled(disconnects);
    await this.router.shutdown();
    this.managed.clear();
  }

  /**
   * Reconcile running connections with current DB state.
   * Called when geo_provider_config_changed NOTIFY is received.
   */
  async reconcile(): Promise<void> {
    const rows = await this.fetchProviders();
    const currentIds = new Set(rows.map((r) => r.id));
    const managedIds = new Set(this.managed.keys());

    // Remove providers no longer in DB
    for (const id of managedIds) {
      if (!currentIds.has(id)) {
        await this.removeProvider(id);
      }
    }

    // Add new providers
    for (const row of rows) {
      if (!managedIds.has(row.id)) {
        await this.addProvider(row);
      }
    }
  }

  /** Check if the lifecycle manager is running. */
  isRunning(): boolean {
    return this.running;
  }

  /** Get the active connection for a provider by ID. */
  getConnection(providerId: string): Connection | undefined {
    return this.managed.get(providerId)?.connection ?? undefined;
  }

  /** Get health info for all managed providers. */
  getHealth(): LifecycleHealth {
    return {
      providers: [...this.managed.values()].map((mp) => ({
        id: mp.row.id,
        label: mp.row.label,
        type: mp.row.provider_type,
        connected: mp.connection?.isConnected() ?? false,
        ...(mp.error ? { error: mp.error } : {}),
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private async fetchProviders(): Promise<ProviderRow[]> {
    const result = await this.pool.query(ACTIVE_PROVIDERS_SQL, []);
    return result.rows as ProviderRow[];
  }

  private async addProvider(row: ProviderRow): Promise<void> {
    const mp: ManagedProvider = { row, connection: null };
    this.managed.set(row.id, mp);

    try {
      const conn = await this.connectProvider(row);
      mp.connection = conn;
      mp.error = undefined;

      await this.updateStatus(row.id, 'active', 'Connected');
      await this.router.notifyConnect(String(row.config.url ?? row.label));
    } catch (err) {
      mp.error = (err as Error).message;
      console.error(`[Lifecycle] Failed to connect ${row.id} (${row.label}):`, mp.error);
      await this.updateStatus(row.id, 'error', mp.error);
    }
  }

  private async removeProvider(id: string): Promise<void> {
    const mp = this.managed.get(id);
    if (!mp) return;

    try {
      if (mp.connection) {
        await mp.connection.disconnect();
        await this.router.notifyDisconnect(`Provider ${id} removed`);
      }
    } catch (err) {
      console.error(`[Lifecycle] Error disconnecting ${id}:`, (err as Error).message);
    }

    this.managed.delete(id);
  }

  /** Connect to a provider using the registry plugin. Override in tests. */
  protected async connectProvider(row: ProviderRow): Promise<Connection> {
    const plugin = getProvider(row.provider_type);
    if (!plugin) {
      throw new Error(`No plugin registered for type: ${row.provider_type}`);
    }

    const credentials = row.credentials
      ? decryptCredentials(row.credentials.toString('utf8'), row.id)
      : '';

    const onUpdate = (update: LocationUpdate) => {
      // Convert LocationUpdate to HaStateChange and dispatch through router
      const stateChange: HaStateChange = {
        entity_id: update.entity_id,
        domain: update.entity_id.split('.')[0] ?? 'unknown',
        old_state: null,
        new_state: 'state_changed',
        old_attributes: {},
        new_attributes: {
          latitude: update.lat,
          longitude: update.lng,
          ...(update.accuracy_m !== undefined ? { gps_accuracy: update.accuracy_m } : {}),
          ...(update.altitude_m !== undefined ? { altitude: update.altitude_m } : {}),
          ...(update.speed_mps !== undefined ? { speed: update.speed_mps } : {}),
          ...(update.bearing !== undefined ? { bearing: update.bearing } : {}),
          ...(update.indoor_zone !== undefined ? { indoor_zone: update.indoor_zone } : {}),
        },
        last_changed: new Date().toISOString(),
        last_updated: new Date().toISOString(),
        context: { id: '', parent_id: null, user_id: null },
      };
      void this.router.dispatch(stateChange, row.owner_email);
    };

    return plugin.connect(row.config, credentials, onUpdate);
  }

  private async updateStatus(providerId: string, status: string, message: string): Promise<void> {
    try {
      await this.pool.query(UPDATE_STATUS_SQL, [providerId, status, message]);
    } catch (err) {
      console.error(`[Lifecycle] Failed to update status for ${providerId}:`, (err as Error).message);
    }
  }
}
