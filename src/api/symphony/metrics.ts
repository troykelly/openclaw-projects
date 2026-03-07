/**
 * Symphony Prometheus metrics and health endpoint.
 * Epic #2186, Issue #2206
 *
 * Provides 15+ metrics for orchestrator observability,
 * a Kubernetes-compatible health endpoint, and structured logging context.
 */

// ─── Histogram/Summary accumulator ───────────────────────────

/** Simple summary accumulator for duration metrics. */
export interface SummarySnapshot {
  count: number;
  sum: number;
}

// ─── Metrics snapshot ────────────────────────────────────────

/** Full snapshot of all Symphony metrics. */
export interface MetricsSnapshot {
  runs_active: number;
  runs_total: number;
  provisioning_duration_seconds: SummarySnapshot;
  agent_duration_seconds: SummarySnapshot;
  tokens_total: number;
  cost_usd_total: number;
  github_api_calls_total: number;
  github_rate_remaining: number;
  host_active_sessions: number;
  host_capacity_remaining: number;
  retries_total: number;
  claims_total: number;
  cleanup_items_pending: number;
  cleanup_backlog_age_seconds: number;
  heartbeat_age_seconds: number;
}

// ─── Metrics collector ───────────────────────────────────────

/**
 * In-process metrics collector for the Symphony orchestrator.
 * Thread-safe for single-process Node.js (no locking needed).
 */
export class SymphonyMetrics {
  private _runsActive = 0;
  private _runsTotal = 0;
  private _provisioningDuration: SummarySnapshot = { count: 0, sum: 0 };
  private _agentDuration: SummarySnapshot = { count: 0, sum: 0 };
  private _tokensTotal = 0;
  private _costUsdTotal = 0;
  private _githubApiCallsTotal = 0;
  private _githubRateRemaining = 0;
  private _hostActiveSessions = 0;
  private _hostCapacityRemaining = 0;
  private _retriesTotal = 0;
  private _claimsTotal = 0;
  private _cleanupItemsPending = 0;
  private _cleanupBacklogAge = 0;
  private _heartbeatAge = 0;

  /** Record a new run starting. Increments both active gauge and total counter. */
  recordRunStarted(): void {
    this._runsActive++;
    this._runsTotal++;
  }

  /** Record a run completing. Decrements active gauge (never below zero). */
  recordRunCompleted(): void {
    this._runsActive = Math.max(0, this._runsActive - 1);
  }

  /** Set the active runs gauge directly from DB count (does not affect total counter). */
  setRunsActive(count: number): void {
    this._runsActive = Math.max(0, count);
  }

  /** Record provisioning pipeline duration in seconds. */
  recordProvisioningDuration(seconds: number): void {
    this._provisioningDuration.count++;
    this._provisioningDuration.sum += seconds;
  }

  /** Record agent execution duration in seconds. */
  recordAgentDuration(seconds: number): void {
    this._agentDuration.count++;
    this._agentDuration.sum += seconds;
  }

  /** Record token usage from an agent run. */
  recordTokens(tokens: number): void {
    this._tokensTotal += tokens;
  }

  /** Record cost in USD from an agent run. */
  recordCost(usd: number): void {
    this._costUsdTotal += usd;
  }

  /** Record a GitHub API call. */
  recordGitHubApiCall(): void {
    this._githubApiCallsTotal++;
  }

  /** Set the current GitHub rate limit remaining. */
  setGitHubRateRemaining(remaining: number): void {
    this._githubRateRemaining = remaining;
  }

  /** Set the number of active host sessions. */
  setHostActiveSessions(sessions: number): void {
    this._hostActiveSessions = sessions;
  }

  /** Set the remaining host capacity. */
  setHostCapacityRemaining(capacity: number): void {
    this._hostCapacityRemaining = capacity;
  }

  /** Record a retry attempt. */
  recordRetry(): void {
    this._retriesTotal++;
  }

  /** Record a claim attempt. */
  recordClaim(): void {
    this._claimsTotal++;
  }

  /** Set the number of pending cleanup items. */
  setCleanupItemsPending(count: number): void {
    this._cleanupItemsPending = count;
  }

  /** Set the age of the oldest cleanup backlog item in seconds. */
  setCleanupBacklogAge(seconds: number): void {
    this._cleanupBacklogAge = seconds;
  }

  /** Set the age of the last orchestrator heartbeat in seconds. */
  setHeartbeatAge(seconds: number): void {
    this._heartbeatAge = seconds;
  }

  /** Take a point-in-time snapshot of all metrics. */
  snapshot(): MetricsSnapshot {
    return {
      runs_active: this._runsActive,
      runs_total: this._runsTotal,
      provisioning_duration_seconds: { ...this._provisioningDuration },
      agent_duration_seconds: { ...this._agentDuration },
      tokens_total: this._tokensTotal,
      cost_usd_total: this._costUsdTotal,
      github_api_calls_total: this._githubApiCallsTotal,
      github_rate_remaining: this._githubRateRemaining,
      host_active_sessions: this._hostActiveSessions,
      host_capacity_remaining: this._hostCapacityRemaining,
      retries_total: this._retriesTotal,
      claims_total: this._claimsTotal,
      cleanup_items_pending: this._cleanupItemsPending,
      cleanup_backlog_age_seconds: this._cleanupBacklogAge,
      heartbeat_age_seconds: this._heartbeatAge,
    };
  }
}

// ─── Prometheus text format ──────────────────────────────────

/** Metric type for Prometheus exposition format. */
type MetricType = 'counter' | 'gauge' | 'summary';

interface MetricDef {
  name: string;
  help: string;
  type: MetricType;
}

const METRIC_DEFS: MetricDef[] = [
  { name: 'symphony_runs_active', help: 'Number of currently active Symphony runs', type: 'gauge' },
  { name: 'symphony_runs_total', help: 'Total number of Symphony runs started', type: 'counter' },
  { name: 'symphony_provisioning_duration_seconds', help: 'Provisioning pipeline duration in seconds', type: 'summary' },
  { name: 'symphony_agent_duration_seconds', help: 'Agent execution duration in seconds', type: 'summary' },
  { name: 'symphony_tokens_total', help: 'Total tokens consumed by agent runs', type: 'counter' },
  { name: 'symphony_cost_usd_total', help: 'Total cost in USD of agent runs', type: 'counter' },
  { name: 'symphony_github_api_calls_total', help: 'Total GitHub API calls made', type: 'counter' },
  { name: 'symphony_github_rate_remaining', help: 'Remaining GitHub API rate limit budget', type: 'gauge' },
  { name: 'symphony_host_active_sessions', help: 'Number of active sessions on hosts', type: 'gauge' },
  { name: 'symphony_host_capacity_remaining', help: 'Remaining session capacity across hosts', type: 'gauge' },
  { name: 'symphony_retries_total', help: 'Total number of run retry attempts', type: 'counter' },
  { name: 'symphony_claims_total', help: 'Total number of issue claim attempts', type: 'counter' },
  { name: 'symphony_cleanup_items_pending', help: 'Number of pending cleanup items', type: 'gauge' },
  { name: 'symphony_cleanup_backlog_age_seconds', help: 'Age of oldest pending cleanup item in seconds', type: 'gauge' },
  { name: 'symphony_orchestrator_heartbeat_age_seconds', help: 'Age of last orchestrator heartbeat in seconds', type: 'gauge' },
];

/**
 * Format a MetricsSnapshot as Prometheus text exposition format.
 * See https://prometheus.io/docs/instrumenting/exposition_formats/
 */
export function formatPrometheusMetrics(snap: MetricsSnapshot): string {
  const lines: string[] = [];

  for (const def of METRIC_DEFS) {
    lines.push(`# HELP ${def.name} ${def.help}`);
    lines.push(`# TYPE ${def.name} ${def.type}`);

    if (def.type === 'summary') {
      const key = def.name.replace('symphony_', '').replace(/_seconds$/, '_duration_seconds') as keyof MetricsSnapshot;
      // Map metric name to snapshot key
      const summaryKey = def.name === 'symphony_provisioning_duration_seconds'
        ? 'provisioning_duration_seconds'
        : 'agent_duration_seconds';
      const s = snap[summaryKey] as SummarySnapshot;
      lines.push(`${def.name}_count ${s.count}`);
      lines.push(`${def.name}_sum ${s.sum}`);
    } else {
      // Map metric name to snapshot key
      const snapKey = def.name.replace('symphony_', '').replace('orchestrator_', '') as keyof MetricsSnapshot;
      const value = snap[snapKey];
      if (typeof value === 'number') {
        lines.push(`${def.name} ${value}`);
      }
    }
  }

  return lines.join('\n') + '\n';
}

// ─── Health endpoint ─────────────────────────────────────────

/** Circuit breaker state for health check. */
export interface CircuitBreakerInfo {
  name: string;
  state: 'closed' | 'open' | 'half_open';
}

/** Input to build a health response. */
export interface HealthInput {
  dbConnected: boolean;
  activeRuns: number;
  lastPollTime: string | null;
  circuitBreakers: CircuitBreakerInfo[];
  uptimeSeconds: number;
}

/** Health check result for individual subsystems. */
type CheckStatus = 'ok' | 'fail' | 'degraded';

/** Health response for Kubernetes probes. */
export interface HealthResponse {
  status: 'healthy' | 'unhealthy' | 'degraded';
  checks: {
    database: CheckStatus;
    circuit_breakers: CheckStatus;
  };
  activeRuns: number;
  lastPollTime: string | null;
  uptimeSeconds: number;
  circuitBreakers: CircuitBreakerInfo[];
}

/**
 * Build a health response from the current system state.
 * Compatible with Kubernetes liveness/readiness probes.
 */
export function buildHealthResponse(input: HealthInput): HealthResponse {
  const dbCheck: CheckStatus = input.dbConnected ? 'ok' : 'fail';
  const hasOpenBreakers = input.circuitBreakers.some((cb) => cb.state === 'open');
  const cbCheck: CheckStatus = hasOpenBreakers ? 'degraded' : 'ok';

  let status: 'healthy' | 'unhealthy' | 'degraded';
  if (!input.dbConnected) {
    status = 'unhealthy';
  } else if (hasOpenBreakers) {
    status = 'degraded';
  } else {
    status = 'healthy';
  }

  return {
    status,
    checks: {
      database: dbCheck,
      circuit_breakers: cbCheck,
    },
    activeRuns: input.activeRuns,
    lastPollTime: input.lastPollTime,
    uptimeSeconds: input.uptimeSeconds,
    circuitBreakers: input.circuitBreakers,
  };
}
