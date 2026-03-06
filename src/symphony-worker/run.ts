/**
 * Symphony worker process entrypoint.
 * Polls for queued symphony runs and orchestrates their execution.
 * Issue #2195 — Symphony Worker Process Skeleton.
 *
 * E5: LISTEN/NOTIFY behavior with multiple orchestrators:
 * Postgres NOTIFY delivers to ALL listeners on the same channel.
 * This worker uses an orchestrator_id-based partition approach:
 * - Each orchestrator claims work via the symphony_claim table
 *   with a partial unique index that prevents duplicate active claims
 * - Notifications trigger a poll, but the claim mechanism ensures
 *   only one orchestrator processes each work item
 * - This is effectively optimistic concurrency: all orchestrators
 *   try to claim, but the DB ensures exclusivity
 */

import type { Pool } from 'pg';
import { createPool } from '../db.ts';
import { NotifyListener } from '../worker/listener.ts';
import { SYMPHONY_CHANNELS } from './channels.ts';
import { startSymphonyHealthServer } from './health.ts';
import type { SymphonyHealthStatus } from './health.ts';
import { HeartbeatManager, generateOrchestratorId } from './heartbeat.ts';
import { recoverySweep } from './recovery.ts';
import { loadConfig, getDefaultConfig } from './config.ts';
import type { OrchestratorConfig } from './config.ts';
import { RunState, TERMINAL_STATES } from '../symphony/states.ts';
import {
  symphonyTickDuration,
  symphonyTicksTotal,
  symphonyActiveRuns,
  symphonyListenReconnectsTotal,
  symphonyPoolActiveConnections,
  symphonyPoolIdleConnections,
} from './metrics.ts';
import { existsSync } from 'fs';

// ─── Configuration ───

const SYMPHONY_HEALTH_PORT = parseInt(
  process.env.SYMPHONY_HEALTH_PORT || '9001',
  10,
);
const SYMPHONY_NAMESPACE = process.env.SYMPHONY_NAMESPACE || 'default';
const SYMPHONY_POOL_MAX = parseInt(process.env.SYMPHONY_POOL_MAX || '5', 10);

// ─── State ───

let shuttingDown = false;
let tickInFlight = false;
let lastTickAt: number | null = null;
let ticksTotal = 0;
let activeRunsCount = 0;
let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
let currentConfig: OrchestratorConfig = getDefaultConfig();

// ─── Main ───

async function main(): Promise<void> {
  const orchestratorId = generateOrchestratorId();
  const startTime = Date.now();

  console.log(`[Symphony] Starting orchestrator: ${orchestratorId}`);
  console.log(`[Symphony] Namespace: ${SYMPHONY_NAMESPACE}`);

  // 1. Create pool
  const pool = createPool({
    max: SYMPHONY_POOL_MAX,
    statement_timeout: '120s',
  } as Record<string, unknown>);

  // 2. Verify DB connectivity
  try {
    await pool.query('SELECT 1');
    console.log('[Symphony] Database connection verified');
  } catch (err) {
    console.error('[Symphony] Database connection failed:', (err as Error).message);
    process.exit(1);
  }

  // 3. Load config
  try {
    const loaded = await loadConfig(pool, SYMPHONY_NAMESPACE);
    currentConfig = loaded.config;
    console.log(`[Symphony] Config loaded (version ${loaded.version})`);
  } catch (err) {
    console.warn('[Symphony] Config load failed, using defaults:', (err as Error).message);
  }

  // 4. Recovery sweep — reclaim orphaned runs from dead orchestrators
  try {
    const recovered = await recoverySweep(pool, SYMPHONY_NAMESPACE);
    if (recovered.length > 0) {
      console.log(`[Symphony] Recovery sweep: ${recovered.length} run(s) recovered`);
    }
  } catch (err) {
    console.error('[Symphony] Recovery sweep failed:', (err as Error).message);
    // Non-fatal — continue starting
  }

  // 5. Start heartbeat
  const heartbeat = new HeartbeatManager({
    pool,
    namespace: SYMPHONY_NAMESPACE,
    orchestratorId,
    intervalMs: currentConfig.heartbeatIntervalMs,
    activeRunsGetter: () => activeRunsCount,
  });
  await heartbeat.start();

  // 6. Listener for LISTEN/NOTIFY coordination
  const listener = new NotifyListener({
    connectionConfig: {
      host: process.env.PGHOST || (existsSync('/.dockerenv') ? 'postgres' : 'localhost'),
      port: parseInt(process.env.PGPORT || '5432', 10),
      user: process.env.PGUSER || 'openclaw',
      password: process.env.PGPASSWORD || 'openclaw',
      database: process.env.PGDATABASE || 'openclaw',
    },
    channels: [...SYMPHONY_CHANNELS],
    onNotification: (channel: string, payload: string) => {
      // Config change — reload
      if (channel === 'symphony_config_changed') {
        reloadConfig(pool, payload).catch((err) => {
          console.error('[Symphony] Config reload failed:', (err as Error).message);
        });
      }
      // Any notification triggers a poll
      scheduleTick(pool, orchestratorId);
    },
    onReconnect: () => {
      symphonyListenReconnectsTotal.inc();
      // Sweep after reconnect in case we missed notifications
      scheduleTick(pool, orchestratorId);
    },
  });

  await listener.start();

  // 7. Health server (P2-1: configurable port, fail fast on conflict)
  let healthServer;
  try {
    healthServer = await startSymphonyHealthServer(
      SYMPHONY_HEALTH_PORT,
      async (): Promise<SymphonyHealthStatus> => {
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
          activeRuns: activeRunsCount,
          lastTickAt,
          ticksTotal,
          orchestratorId,
          uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
        };
      },
    );
  } catch (err) {
    console.error('[Symphony] Health server failed to start:', (err as Error).message);
    heartbeat.stop();
    await listener.stop();
    await pool.end();
    process.exit(1);
  }

  // 8. Startup banner
  console.log('[Symphony] Worker process ready');
  console.log(`[Symphony]   Orchestrator ID: ${orchestratorId}`);
  console.log(`[Symphony]   Pool max: ${SYMPHONY_POOL_MAX}`);
  console.log(`[Symphony]   Poll interval: ${currentConfig.pollIntervalMs}ms`);
  console.log(`[Symphony]   Health port: ${SYMPHONY_HEALTH_PORT}`);
  console.log(`[Symphony]   Max concurrent runs: ${currentConfig.maxConcurrentRuns}`);

  // 9. Immediate tick on startup
  await tick(pool, orchestratorId);

  // 10. Fallback polling timer
  scheduleFallback(pool, orchestratorId);

  // 11. Graceful shutdown
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('[Symphony] Shutting down...');

    // Stop accepting new ticks
    if (fallbackTimer) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }

    // Stop heartbeat
    heartbeat.stop();

    // Wait for in-flight tick (up to 30 s)
    if (tickInFlight) {
      console.log('[Symphony] Waiting for in-flight tick to finish...');
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (!tickInFlight) {
            clearInterval(check);
            resolve();
          }
        }, 250);

        const deadline = setTimeout(() => {
          clearInterval(check);
          console.warn('[Symphony] Timed out waiting for in-flight tick');
          resolve();
        }, 30_000);
        deadline.unref();
      });
    }

    // Tear down
    await listener.stop();
    await pool.end();
    healthServer.close();

    console.log('[Symphony] Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// ─── Tick ───

let tickScheduled = false;

function scheduleTick(pool: Pool, orchestratorId: string): void {
  if (shuttingDown || tickScheduled || tickInFlight) return;
  tickScheduled = true;

  setImmediate(() => {
    tickScheduled = false;
    tick(pool, orchestratorId).catch((err) => {
      console.error('[Symphony] Tick error:', (err as Error).message);
    });
  });
}

function scheduleFallback(pool: Pool, orchestratorId: string): void {
  if (shuttingDown) return;

  fallbackTimer = setTimeout(() => {
    fallbackTimer = null;
    tick(pool, orchestratorId)
      .catch((err) => {
        console.error('[Symphony] Fallback tick error:', (err as Error).message);
      })
      .finally(() => {
        scheduleFallback(pool, orchestratorId);
      });
  }, currentConfig.pollIntervalMs);
}

async function tick(pool: Pool, orchestratorId: string): Promise<void> {
  if (shuttingDown || tickInFlight) return;
  tickInFlight = true;

  const tickStart = Date.now();

  try {
    // Build terminal status list for SQL IN clause
    const terminalArr = [...TERMINAL_STATES];
    const terminalParams = terminalArr.map((_, i) => `$${i + 3}`).join(', ');

    // Count active runs (not in terminal states)
    const activeResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM symphony_run
       WHERE namespace = $1
         AND orchestrator_id = $2
         AND status NOT IN (${terminalParams})`,
      [SYMPHONY_NAMESPACE, orchestratorId, ...terminalArr],
    );
    activeRunsCount = parseInt(activeResult.rows[0].count, 10);
    symphonyActiveRuns.set(activeRunsCount);

    // Find unclaimed runs to claim (if under capacity)
    if (activeRunsCount < currentConfig.maxConcurrentRuns) {
      const slotsAvailable = currentConfig.maxConcurrentRuns - activeRunsCount;

      const unclaimedRuns = await pool.query<{ id: string; work_item_id: string }>(
        `SELECT id, work_item_id
         FROM symphony_run
         WHERE namespace = $1
           AND status = $2
           AND orchestrator_id IS NULL
         ORDER BY created_at ASC
         LIMIT $3`,
        [SYMPHONY_NAMESPACE, RunState.Unclaimed, slotsAvailable],
      );

      for (const run of unclaimedRuns.rows) {
        // Attempt to claim — uses optimistic concurrency via state_version
        const claimed = await pool.query(
          `UPDATE symphony_run
           SET orchestrator_id = $1,
               status = $2,
               state_version = state_version + 1
           WHERE id = $3
             AND status = $4
             AND orchestrator_id IS NULL`,
          [orchestratorId, RunState.Claimed, run.id, RunState.Unclaimed],
        );

        if (claimed.rowCount === 1) {
          console.log(`[Symphony] Claimed run ${run.id} for work item ${run.work_item_id}`);
          activeRunsCount++;
        }
      }

      symphonyActiveRuns.set(activeRunsCount);
    }

    // Update pool metrics
    updatePoolMetrics(pool);

    symphonyTicksTotal.inc();
  } finally {
    const elapsed = (Date.now() - tickStart) / 1000;
    symphonyTickDuration.observe({}, elapsed);
    lastTickAt = Date.now();
    ticksTotal++;
    tickInFlight = false;
  }
}

// ─── Config reload ───

async function reloadConfig(pool: Pool, _payload: string): Promise<void> {
  const loaded = await loadConfig(pool, SYMPHONY_NAMESPACE);
  currentConfig = loaded.config;
  console.log(`[Symphony] Config reloaded (version ${loaded.version})`);
}

// ─── Pool metrics ───

function updatePoolMetrics(pool: Pool): void {
  const p = pool as unknown as {
    totalCount?: number;
    idleCount?: number;
  };
  if (typeof p.totalCount === 'number' && typeof p.idleCount === 'number') {
    symphonyPoolActiveConnections.set(p.totalCount - p.idleCount);
    symphonyPoolIdleConnections.set(p.idleCount);
  }
}

// ─── Entry ───

main().catch((err) => {
  console.error('[Symphony] Fatal error:', err);
  process.exit(1);
});
