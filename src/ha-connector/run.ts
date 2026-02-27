/**
 * HA Connector container entry point.
 *
 * Boots the dedicated Home Assistant WebSocket connector service:
 * 1. Register provider plugins
 * 2. Create event router + processors
 * 3. Start lifecycle manager (connects to configured HA instances)
 * 4. Listen for config changes and service calls via NOTIFY
 * 5. Health server on configurable port
 * 6. Graceful shutdown
 *
 * Issue #1636, parent #1603.
 */

import type { Pool } from 'pg';
import { createPool } from '../db.ts';
import { bootstrapGeoProviders } from '../api/geolocation/bootstrap.ts';
import { HaEventRouter } from '../api/geolocation/ha-event-router.ts';
import { GeoIngestorProcessor } from '../api/geolocation/processors/geo-ingestor-processor.ts';
import { HomeObserverProcessor } from '../api/geolocation/processors/home-observer-processor.ts';
import { EntityTierResolver } from '../api/geolocation/ha-entity-tiers.ts';
import { NotifyListener } from '../worker/listener.ts';
import { ProviderLifecycleManager } from './lifecycle.ts';
import { ServiceCallHandler } from './service-calls.ts';
import { startConnectorHealthServer } from './health.ts';
import type { ConnectorHealthStatus } from './health.ts';

// ─── Configuration ───

const HEALTH_PORT = parseInt(process.env.HA_CONNECTOR_HEALTH_PORT || '9001', 10);
const POOL_MAX = parseInt(process.env.HA_CONNECTOR_POOL_MAX || '5', 10);
const NOTIFY_CHANNELS = ['geo_provider_config_changed', 'ha_service_call'];

// ─── State ───

let shuttingDown = false;

// ─── Main ───

async function main(): Promise<void> {
  console.log('[HA-Connector] Starting...');

  // 1. Register provider plugins
  bootstrapGeoProviders();
  console.log('[HA-Connector] Provider plugins registered');

  // 2. Create database pool
  const pool = createPool({
    max: POOL_MAX,
    statement_timeout: '120s',
  } as Record<string, unknown>);

  // 3. Verify DB connectivity
  try {
    await pool.query('SELECT 1');
    console.log('[HA-Connector] Database connection verified');
  } catch (err) {
    console.error('[HA-Connector] Database connection failed:', (err as Error).message);
    process.exit(1);
  }

  // 4. Create event router + register processors
  const router = new HaEventRouter();

  const geoProcessor = new GeoIngestorProcessor(pool, (update) => {
    console.debug('[HA-Connector] Location update:', update.entity_id, update.lat, update.lng);
  });
  router.register(geoProcessor);

  const observerProcessor = new HomeObserverProcessor({
    pool,
    tierResolver: new EntityTierResolver(),
  });
  router.register(observerProcessor);

  console.log('[HA-Connector] Event router configured with 2 processors');

  // 5. Start lifecycle manager
  const lifecycle = new ProviderLifecycleManager(pool, router);
  await lifecycle.start();
  console.log('[HA-Connector] Lifecycle manager started');

  // 6. NOTIFY listener for config changes and service calls
  const serviceCallHandler = new ServiceCallHandler(lifecycle);
  let listenerConnected = false;
  const listener = new NotifyListener({
    connectionConfig: {},
    channels: NOTIFY_CHANNELS,
    onNotification: (channel: string, payload: string) => {
      if (shuttingDown) return;

      if (channel === 'ha_service_call' && payload) {
        void serviceCallHandler.handleNotification(payload).catch((err) => {
          console.error('[HA-Connector] Service call error:', (err as Error).message);
        });
      } else {
        void lifecycle.reconcile();
      }
    },
    onReconnect: () => {
      listenerConnected = true;
      // Re-reconcile after reconnect to catch changes missed during disconnect
      if (!shuttingDown) {
        void lifecycle.reconcile();
      }
    },
  });
  await listener.start();
  listenerConnected = listener.isConnected();
  console.log('[HA-Connector] NOTIFY listener started on channels:', NOTIFY_CHANNELS.join(', '));

  // 7. Health server
  const healthChecks = async (): Promise<ConnectorHealthStatus> => {
    let dbConnected = false;
    try {
      await pool.query('SELECT 1');
      dbConnected = true;
    } catch { /* db down */ }

    const health = lifecycle.getHealth();
    return {
      running: lifecycle.isRunning(),
      dbConnected,
      providers: health.providers,
    };
  };

  const healthServer = startConnectorHealthServer(HEALTH_PORT, healthChecks);

  // 8. Startup banner
  const providerHealth = lifecycle.getHealth();
  console.log(
    `[HA-Connector] Ready — ${providerHealth.providers.length} provider(s), ` +
    `health on :${HEALTH_PORT}, NOTIFY on [${NOTIFY_CHANNELS.join(', ')}]`,
  );

  // 9. Graceful shutdown
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[HA-Connector] ${signal} received, shutting down...`);

    try {
      await listener.stop();
      await lifecycle.shutdown();
      healthServer.close();
      await pool.end();
      console.log('[HA-Connector] Shutdown complete');
      process.exit(0);
    } catch (err) {
      console.error('[HA-Connector] Shutdown error:', (err as Error).message);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[HA-Connector] Fatal:', err);
  process.exit(1);
});
