/**
 * Worker process entrypoint.
 * Polls internal_job + webhook_outbox, and reacts to LISTEN/NOTIFY.
 * Part of Issue #1178.
 */

import type { Pool } from 'pg';
import { existsSync } from 'fs';
import { createPool } from '../db.ts';
import { processJobs, getPendingJobCounts } from '../api/jobs/processor.ts';
import { processPendingWebhooks } from '../api/webhooks/dispatcher.ts';
import { processGeoGeocode, processGeoEmbeddings } from '../api/geolocation/workers.ts';
import { validateOpenClawConfig, getConfigSummary } from '../api/webhooks/config.ts';
import { CircuitBreaker } from './circuit-breaker.ts';
import { NotifyListener } from './listener.ts';
import { WORKER_CHANNELS } from './channels.ts';
import { startHealthServer } from './health.ts';
import type { HealthStatus } from './health.ts';
import {
  jobsProcessedTotal,
  jobsDuration,
  jobsPending,
  jobsDeadLetterTotal,
  webhooksDispatchedTotal,
  webhooksDuration,
  webhooksPending,
  webhooksDeadLetterTotal,
  circuitBreakerState,
  circuitBreakerTripsTotal,
  tickDuration,
  listenReconnectsTotal,
  poolActiveConnections,
  poolIdleConnections,
  poolWaitingRequests,
} from './metrics.ts';

// ─── Configuration ───

const WORKER_HEALTH_PORT = parseInt(process.env.WORKER_HEALTH_PORT || '9000', 10);
const WORKER_POLL_INTERVAL_MS = parseInt(process.env.WORKER_POLL_INTERVAL_MS || '30000', 10);
const WORKER_POOL_MAX = parseInt(process.env.WORKER_POOL_MAX || '5', 10);
const JOB_BATCH_SIZE = 10;
const WEBHOOK_BATCH_SIZE = 50;

// ─── State ───

let shuttingDown = false;
let tickInFlight = false;
let lastTickAt: number | null = null;
let ticksTotal = 0;
let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Main ───

async function main(): Promise<void> {
  // 1. Validate config
  const configResult = validateOpenClawConfig();
  const configSummary = getConfigSummary();

  if (!configResult.valid) {
    console.warn('[Worker] OpenClaw config validation warnings:', configResult.errors.join('; '));
  }

  // 2. Create pool
  const pool = createPool({
    max: WORKER_POOL_MAX,
    statement_timeout: '120s',
  } as Record<string, unknown>);

  // 3. Verify DB connectivity
  try {
    await pool.query('SELECT 1');
    console.log('[Worker] Database connection verified');
  } catch (err) {
    console.error('[Worker] Database connection failed:', (err as Error).message);
    process.exit(1);
  }

  // 4. Circuit breaker
  const breaker = new CircuitBreaker();

  // 5. Listener
  const listener = new NotifyListener({
    connectionConfig: {
      host: process.env.PGHOST || (existsSync('/.dockerenv') ? 'postgres' : 'localhost'),
      port: parseInt(process.env.PGPORT || '5432', 10),
      user: process.env.PGUSER || 'openclaw',
      password: process.env.PGPASSWORD || 'openclaw',
      database: process.env.PGDATABASE || 'openclaw',
    },
    channels: [...WORKER_CHANNELS],
    onNotification: () => {
      // Immediate tick on NOTIFY (debounced inside listener)
      scheduleTick(pool, breaker);
    },
    onReconnect: () => {
      listenReconnectsTotal.inc();
      // Sweep after reconnect in case we missed notifications
      scheduleTick(pool, breaker);
    },
  });

  await listener.start();

  // 6. Health server
  const healthServer = startHealthServer(WORKER_HEALTH_PORT, async (): Promise<HealthStatus> => {
    // Quick DB probe
    let dbConnected = false;
    try {
      await pool.query('SELECT 1');
      dbConnected = true;
    } catch {
      // keep false
    }

    return {
      dbConnected,
      listenClientConnected: listener.isConnected(),
      webhookConfigValid: configResult.valid,
      lastTickAt,
      ticksTotal,
    };
  });

  // 7. Startup banner
  console.log('[Worker] Starting worker process');
  console.log(`[Worker]   Gateway URL: ${configSummary.gateway_url ?? '(not set)'}`);
  console.log(`[Worker]   Gateway configured: ${configSummary.configured ? 'yes' : 'no'}`);
  console.log(`[Worker]   Pool max: ${WORKER_POOL_MAX}`);
  console.log(`[Worker]   Poll interval: ${WORKER_POLL_INTERVAL_MS}ms`);
  console.log(`[Worker]   Health port: ${WORKER_HEALTH_PORT}`);

  // 8. Immediate sweep on startup
  await tick(pool, breaker);

  // 9. Fallback polling timer
  scheduleFallback(pool, breaker);

  // 10. Graceful shutdown
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('[Worker] Shutting down...');

    // Stop accepting new ticks
    if (fallbackTimer) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }

    // Wait for in-flight tick (up to 30 s)
    if (tickInFlight) {
      console.log('[Worker] Waiting for in-flight tick to finish...');
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (!tickInFlight) {
            clearInterval(check);
            resolve();
          }
        }, 250);

        const deadline = setTimeout(() => {
          clearInterval(check);
          console.warn('[Worker] Timed out waiting for in-flight tick');
          resolve();
        }, 30_000);
        deadline.unref();
      });
    }

    // Tear down
    await listener.stop();
    await pool.end();
    healthServer.close();

    console.log('[Worker] Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// ─── Tick ───

let tickScheduled = false;

function scheduleTick(pool: Pool, breaker: CircuitBreaker): void {
  if (shuttingDown || tickScheduled || tickInFlight) return;
  tickScheduled = true;

  // setImmediate so multiple rapid NOTIFYs collapse into one tick
  setImmediate(() => {
    tickScheduled = false;
    tick(pool, breaker).catch((err) => {
      console.error('[Worker] Tick error:', (err as Error).message);
    });
  });
}

function scheduleFallback(pool: Pool, breaker: CircuitBreaker): void {
  if (shuttingDown) return;

  fallbackTimer = setTimeout(() => {
    fallbackTimer = null;
    tick(pool, breaker)
      .catch((err) => {
        console.error('[Worker] Fallback tick error:', (err as Error).message);
      })
      .finally(() => {
        scheduleFallback(pool, breaker);
      });
  }, WORKER_POLL_INTERVAL_MS);
}

async function tick(pool: Pool, breaker: CircuitBreaker): Promise<void> {
  if (shuttingDown || tickInFlight) return;
  tickInFlight = true;

  const tickStart = Date.now();

  try {
    // ── Process jobs ──
    const jobStart = Date.now();
    const jobStats = await processJobs(pool, JOB_BATCH_SIZE);
    const jobElapsed = (Date.now() - jobStart) / 1000;

    jobsProcessedTotal.inc({ status: 'succeeded' }, jobStats.succeeded);
    jobsProcessedTotal.inc({ status: 'failed' }, jobStats.failed);
    jobsDuration.observe({}, jobElapsed);

    if (jobStats.processed > 0) {
      console.log(
        `[Worker] Jobs: ${jobStats.succeeded} ok, ${jobStats.failed} failed, ${jobStats.skipped} skipped`,
      );
    }

    // ── Process webhooks ──
    const whStart = Date.now();
    const whStats = await processPendingWebhooks(pool, WEBHOOK_BATCH_SIZE);
    const whElapsed = (Date.now() - whStart) / 1000;

    webhooksDispatchedTotal.inc({ status: 'succeeded' }, whStats.succeeded);
    webhooksDispatchedTotal.inc({ status: 'failed' }, whStats.failed);
    webhooksDuration.observe({}, whElapsed);

    if (whStats.processed > 0) {
      console.log(
        `[Worker] Webhooks: ${whStats.succeeded} ok, ${whStats.failed} failed, ${whStats.skipped} skipped`,
      );
    }

    // ── Process geo workers ──
    let geocoded = 0;
    let embedded = 0;
    try {
      geocoded = await processGeoGeocode(pool);
    } catch (err) {
      console.warn('[Worker] Geo geocode error:', (err as Error).message);
    }
    try {
      embedded = await processGeoEmbeddings(pool);
    } catch (err) {
      console.warn('[Worker] Geo embeddings error:', (err as Error).message);
    }
    if (geocoded > 0 || embedded > 0) {
      console.log(`[Worker] Geo: ${geocoded} geocoded, ${embedded} embedded`);
    }

    // ── Update pending gauges ──
    try {
      const pendingJobs = await getPendingJobCounts(pool);
      let totalPending = 0;
      for (const kind of Object.keys(pendingJobs)) {
        jobsPending.set({ kind }, pendingJobs[kind]);
        totalPending += pendingJobs[kind];
      }
      if (Object.keys(pendingJobs).length === 0) {
        jobsPending.set(0);
      }

      const whPendingResult = await pool.query(
        `SELECT COUNT(*) as count FROM webhook_outbox WHERE dispatched_at IS NULL AND attempts < 5`,
      );
      webhooksPending.set(parseInt((whPendingResult.rows[0] as { count: string }).count, 10));

      // Dead-letter counts
      const jobDlResult = await pool.query(
        `SELECT COUNT(*) as count FROM internal_job WHERE completed_at IS NULL AND attempts >= 5`,
      );
      const jobDlCount = parseInt((jobDlResult.rows[0] as { count: string }).count, 10);
      if (jobDlCount > 0) {
        jobsDeadLetterTotal.inc({}, 0); // Ensure metric exists; counter only grows from actual events
      }

      const whDlResult = await pool.query(
        `SELECT COUNT(*) as count FROM webhook_outbox WHERE dispatched_at IS NULL AND attempts >= 5`,
      );
      const whDlCount = parseInt((whDlResult.rows[0] as { count: string }).count, 10);
      if (whDlCount > 0) {
        webhooksDeadLetterTotal.inc({}, 0);
      }
    } catch (err) {
      console.warn('[Worker] Failed to update pending metrics:', (err as Error).message);
    }

    // ── Circuit breaker metrics ──
    const cbStats = breaker.getStats();
    const stateMap: Record<string, number> = { closed: 0, open: 1, half_open: 2 };
    for (const [dest, info] of cbStats) {
      circuitBreakerState.set({ destination: dest }, stateMap[info.state] ?? 0);
    }

    // ── Pool metrics ──
    updatePoolMetrics(pool);
  } finally {
    const elapsed = (Date.now() - tickStart) / 1000;
    tickDuration.observe({}, elapsed);
    lastTickAt = Date.now();
    ticksTotal++;
    tickInFlight = false;
  }
}

function updatePoolMetrics(pool: Pool): void {
  // pg Pool exposes these counts directly
  const p = pool as unknown as {
    totalCount?: number;
    idleCount?: number;
    waitingCount?: number;
  };
  if (typeof p.totalCount === 'number' && typeof p.idleCount === 'number') {
    poolActiveConnections.set(p.totalCount - p.idleCount);
    poolIdleConnections.set(p.idleCount);
  }
  if (typeof p.waitingCount === 'number') {
    poolWaitingRequests.set(p.waitingCount);
  }
}

// ─── Entry ───

main().catch((err) => {
  console.error('[Worker] Fatal error:', err);
  process.exit(1);
});
