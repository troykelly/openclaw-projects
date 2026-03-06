/**
 * Orchestrator heartbeat management.
 * Writes periodic heartbeats to `symphony_orchestrator_heartbeat`.
 * Issue #2195 — Symphony Worker Process Skeleton.
 */

import type { Pool } from 'pg';
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import {
  symphonyHeartbeatTotal,
  symphonyHeartbeatErrors,
} from './metrics.ts';

/** Generate a unique orchestrator instance ID: hostname-pid-random. */
export function generateOrchestratorId(): string {
  const host = hostname();
  const pid = process.pid;
  const rand = randomBytes(4).toString('hex');
  return `${host}-${pid}-${rand}`;
}

/**
 * Write or update the heartbeat row for this orchestrator instance.
 * Uses UPSERT (ON CONFLICT) so the first call inserts and subsequent calls update.
 */
export async function writeHeartbeat(
  pool: Pool,
  namespace: string,
  orchestratorId: string,
  activeRuns: number,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO symphony_orchestrator_heartbeat
         (namespace, orchestrator_id, last_heartbeat_at, active_runs, metadata)
       VALUES ($1, $2, NOW(), $3, $4)
       ON CONFLICT (orchestrator_id)
       DO UPDATE SET
         last_heartbeat_at = NOW(),
         active_runs = EXCLUDED.active_runs,
         metadata = EXCLUDED.metadata`,
      [namespace, orchestratorId, activeRuns, JSON.stringify({ pid: process.pid })],
    );
    symphonyHeartbeatTotal.inc();
  } catch (err) {
    symphonyHeartbeatErrors.inc();
    console.error('[SymphonyHeartbeat] Write failed:', (err as Error).message);
    throw err;
  }
}

/** Default heartbeat staleness threshold (90 seconds). */
const STALE_THRESHOLD_MS = 90_000;

/**
 * Detect stale orchestrator entries — orchestrators whose heartbeat
 * is older than the threshold. Used on startup to identify dead orchestrators
 * whose runs need recovery.
 *
 * @returns Array of stale orchestrator IDs.
 */
export async function findStaleOrchestrators(
  pool: Pool,
  namespace: string,
  thresholdMs: number = STALE_THRESHOLD_MS,
): Promise<string[]> {
  const result = await pool.query<{ orchestrator_id: string }>(
    `SELECT orchestrator_id
     FROM symphony_orchestrator_heartbeat
     WHERE namespace = $1
       AND last_heartbeat_at < NOW() - ($2 || ' milliseconds')::INTERVAL`,
    [namespace, thresholdMs.toString()],
  );
  return result.rows.map((r) => r.orchestrator_id);
}

/**
 * Remove a stale orchestrator heartbeat entry.
 * Called after recovery sweep has reclaimed all of its orphaned runs.
 */
export async function removeHeartbeat(
  pool: Pool,
  orchestratorId: string,
): Promise<void> {
  await pool.query(
    `DELETE FROM symphony_orchestrator_heartbeat WHERE orchestrator_id = $1`,
    [orchestratorId],
  );
}

/**
 * Manages a periodic heartbeat timer.
 * Start it after the worker initializes, stop it during shutdown.
 */
export class HeartbeatManager {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly pool: Pool;
  private readonly namespace: string;
  private readonly orchestratorId: string;
  private readonly intervalMs: number;
  private activeRunsGetter: () => number;

  constructor(opts: {
    pool: Pool;
    namespace: string;
    orchestratorId: string;
    intervalMs?: number;
    activeRunsGetter: () => number;
  }) {
    this.pool = opts.pool;
    this.namespace = opts.namespace;
    this.orchestratorId = opts.orchestratorId;
    this.intervalMs = opts.intervalMs ?? 30_000;
    this.activeRunsGetter = opts.activeRunsGetter;
  }

  /** Start the periodic heartbeat. Writes an immediate heartbeat first. */
  async start(): Promise<void> {
    // Immediate heartbeat on start
    await writeHeartbeat(this.pool, this.namespace, this.orchestratorId, this.activeRunsGetter());

    this.timer = setInterval(() => {
      writeHeartbeat(this.pool, this.namespace, this.orchestratorId, this.activeRunsGetter()).catch(
        (err) => {
          console.error('[SymphonyHeartbeat] Periodic write failed:', (err as Error).message);
        },
      );
    }, this.intervalMs);

    // Don't prevent process exit
    this.timer.unref();
  }

  /** Stop the periodic heartbeat. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
