/**
 * Session affinity utilities for HA deployments.
 *
 * Issue #2124 — No session affinity routing for HA deployments.
 *
 * In HA deployments with multiple tmux workers, a terminal session is bound
 * to the specific worker that created it (tmux runs locally on that worker).
 * This module provides session-to-worker mapping and worker routing so that
 * API requests are directed to the correct worker.
 *
 * The session's `worker_id` column records which worker owns it. For single-worker
 * deployments, all requests go to the one configured worker. For multi-worker
 * deployments, a worker registry maps worker IDs to gRPC URLs.
 */

import type pg from 'pg';

/** Worker registration entry with its gRPC endpoint. */
export interface WorkerEntry {
  workerId: string;
  grpcUrl: string;
  lastSeen: Date;
}

/**
 * Look up which worker owns a given session.
 * Returns the worker_id or null if the session doesn't exist.
 */
export async function getSessionWorkerId(
  pool: pg.Pool,
  sessionId: string,
): Promise<string | null> {
  const result = await pool.query<{ worker_id: string }>(
    `SELECT worker_id FROM terminal_session WHERE id = $1`,
    [sessionId],
  );
  if (result.rows.length === 0) return null;
  return result.rows[0].worker_id;
}

/**
 * Parse the TMUX_WORKER_REGISTRY environment variable.
 *
 * Format: "worker-id-1=host1:port1,worker-id-2=host2:port2"
 * Falls back to single-worker mode using TMUX_WORKER_GRPC_URL.
 *
 * Returns a Map of worker_id -> grpcUrl.
 */
export function parseWorkerRegistry(): Map<string, string> {
  const registry = new Map<string, string>();
  const registryEnv = process.env.TMUX_WORKER_REGISTRY ?? '';

  if (registryEnv) {
    for (const entry of registryEnv.split(',')) {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx <= 0) continue;
      const workerId = trimmed.slice(0, eqIdx).trim();
      const grpcUrl = trimmed.slice(eqIdx + 1).trim();
      if (workerId && grpcUrl) {
        registry.set(workerId, grpcUrl);
      }
    }
  }

  return registry;
}

/**
 * Resolve the gRPC URL for a given worker ID.
 *
 * Strategy:
 * 1. Check the worker registry (TMUX_WORKER_REGISTRY)
 * 2. Fall back to the default gRPC URL (TMUX_WORKER_GRPC_URL)
 * 3. Fall back to localhost:50051
 *
 * Returns the gRPC URL to use.
 */
export function resolveWorkerGrpcUrl(
  workerId: string,
  registry?: Map<string, string>,
): string {
  const reg = registry ?? parseWorkerRegistry();
  const fromRegistry = reg.get(workerId);
  if (fromRegistry) return fromRegistry;

  return process.env.TMUX_WORKER_GRPC_URL ?? 'localhost:50051';
}

/**
 * Check if the deployment is in multi-worker (HA) mode.
 * Returns true if TMUX_WORKER_REGISTRY is configured with entries.
 */
export function isMultiWorkerMode(): boolean {
  return parseWorkerRegistry().size > 0;
}
