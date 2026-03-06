/**
 * Prometheus metrics for the symphony worker.
 * Reuses the Counter/Gauge/Histogram primitives from src/worker/metrics.ts.
 * Issue #2195 — Symphony Worker Process Skeleton.
 * Issue #2203 — GitHub Rate Limit Management.
 */

import { Counter, Gauge, Histogram } from '../worker/metrics.ts';

// ─── Tick / poll metrics ───

export const symphonyTickDuration = new Histogram(
  'symphony_tick_duration_seconds',
  'Symphony worker tick loop duration in seconds',
);

export const symphonyTicksTotal = new Counter(
  'symphony_ticks_total',
  'Total symphony worker ticks executed',
);

// ─── Heartbeat metrics ───

export const symphonyHeartbeatTotal = new Counter(
  'symphony_heartbeat_total',
  'Total heartbeats written',
);

export const symphonyHeartbeatErrors = new Counter(
  'symphony_heartbeat_errors_total',
  'Total heartbeat write errors',
);

// ─── Recovery metrics ───

export const symphonyRecoveryTotal = new Counter(
  'symphony_recovery_total',
  'Total runs recovered during startup sweep',
);

// ─── Listener metrics ───

export const symphonyListenReconnectsTotal = new Counter(
  'symphony_listen_reconnects_total',
  'Total LISTEN client reconnections',
);

// ─── Pool metrics ───

export const symphonyPoolActiveConnections = new Gauge(
  'symphony_pool_active_connections',
  'Active pool connections',
);

export const symphonyPoolIdleConnections = new Gauge(
  'symphony_pool_idle_connections',
  'Idle pool connections',
);

// ─── Active runs ───

export const symphonyActiveRuns = new Gauge(
  'symphony_active_runs',
  'Number of currently active symphony runs',
);

// ─── GitHub rate limit metrics (Issue #2203) ───

export const symphonyGithubRateRemaining = new Gauge(
  'symphony_github_rate_remaining',
  'Remaining GitHub API calls before rate limit resets',
);

export const symphonyGithubApiCallsTotal = new Counter(
  'symphony_github_api_calls_total',
  'Total GitHub API calls made',
);

// ─── All metrics for serialization ───

const ALL_METRICS = [
  symphonyTickDuration,
  symphonyTicksTotal,
  symphonyHeartbeatTotal,
  symphonyHeartbeatErrors,
  symphonyRecoveryTotal,
  symphonyListenReconnectsTotal,
  symphonyPoolActiveConnections,
  symphonyPoolIdleConnections,
  symphonyActiveRuns,
  symphonyGithubRateRemaining,
  symphonyGithubApiCallsTotal,
];

/** Serialize all symphony worker metrics to Prometheus text exposition format. */
export function serialize(): string {
  return ALL_METRICS.map((m) => m.serialize()).join('\n\n') + '\n';
}
