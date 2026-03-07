/**
 * Unit tests for Symphony Prometheus metrics and health endpoint.
 * Epic #2186, Issue #2206
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SymphonyMetrics,
  formatPrometheusMetrics,
  buildHealthResponse,
} from '../../src/api/symphony/metrics.ts';

// ============================================================
// METRICS COLLECTION
// ============================================================

describe('SymphonyMetrics', () => {
  let metrics: SymphonyMetrics;

  beforeEach(() => {
    metrics = new SymphonyMetrics();
  });

  it('initializes with zero counters', () => {
    const snapshot = metrics.snapshot();
    expect(snapshot.runs_active).toBe(0);
    expect(snapshot.runs_total).toBe(0);
    expect(snapshot.tokens_total).toBe(0);
    expect(snapshot.cost_usd_total).toBe(0);
    expect(snapshot.github_api_calls_total).toBe(0);
    expect(snapshot.retries_total).toBe(0);
    expect(snapshot.claims_total).toBe(0);
    expect(snapshot.cleanup_items_pending).toBe(0);
  });

  it('increments runs_total counter', () => {
    metrics.recordRunStarted();
    metrics.recordRunStarted();
    const snapshot = metrics.snapshot();
    expect(snapshot.runs_total).toBe(2);
  });

  it('tracks active runs gauge', () => {
    metrics.recordRunStarted();
    metrics.recordRunStarted();
    expect(metrics.snapshot().runs_active).toBe(2);

    metrics.recordRunCompleted();
    expect(metrics.snapshot().runs_active).toBe(1);
  });

  it('does not go below zero for active runs', () => {
    metrics.recordRunCompleted();
    expect(metrics.snapshot().runs_active).toBe(0);
  });

  it('records provisioning duration', () => {
    metrics.recordProvisioningDuration(15.5);
    metrics.recordProvisioningDuration(30.2);
    const snapshot = metrics.snapshot();
    expect(snapshot.provisioning_duration_seconds.count).toBe(2);
    expect(snapshot.provisioning_duration_seconds.sum).toBeCloseTo(45.7, 1);
  });

  it('records agent duration', () => {
    metrics.recordAgentDuration(120.0);
    const snapshot = metrics.snapshot();
    expect(snapshot.agent_duration_seconds.count).toBe(1);
    expect(snapshot.agent_duration_seconds.sum).toBeCloseTo(120.0, 1);
  });

  it('records token usage', () => {
    metrics.recordTokens(5000);
    metrics.recordTokens(3000);
    expect(metrics.snapshot().tokens_total).toBe(8000);
  });

  it('records cost', () => {
    metrics.recordCost(0.05);
    metrics.recordCost(0.15);
    expect(metrics.snapshot().cost_usd_total).toBeCloseTo(0.2, 2);
  });

  it('records GitHub API calls', () => {
    metrics.recordGitHubApiCall();
    metrics.recordGitHubApiCall();
    expect(metrics.snapshot().github_api_calls_total).toBe(2);
  });

  it('records GitHub rate remaining', () => {
    metrics.setGitHubRateRemaining(4500);
    expect(metrics.snapshot().github_rate_remaining).toBe(4500);
  });

  it('records host sessions', () => {
    metrics.setHostActiveSessions(3);
    expect(metrics.snapshot().host_active_sessions).toBe(3);
  });

  it('records host capacity remaining', () => {
    metrics.setHostCapacityRemaining(7);
    expect(metrics.snapshot().host_capacity_remaining).toBe(7);
  });

  it('records retries', () => {
    metrics.recordRetry();
    metrics.recordRetry();
    expect(metrics.snapshot().retries_total).toBe(2);
  });

  it('records claims', () => {
    metrics.recordClaim();
    expect(metrics.snapshot().claims_total).toBe(1);
  });

  it('records cleanup pending', () => {
    metrics.setCleanupItemsPending(5);
    expect(metrics.snapshot().cleanup_items_pending).toBe(5);
  });

  it('records cleanup backlog age', () => {
    metrics.setCleanupBacklogAge(3600);
    expect(metrics.snapshot().cleanup_backlog_age_seconds).toBe(3600);
  });

  it('records heartbeat age', () => {
    metrics.setHeartbeatAge(45);
    expect(metrics.snapshot().heartbeat_age_seconds).toBe(45);
  });
});

// ============================================================
// PROMETHEUS FORMAT
// ============================================================

describe('formatPrometheusMetrics', () => {
  it('produces valid Prometheus text format', () => {
    const metrics = new SymphonyMetrics();
    metrics.recordRunStarted();
    metrics.recordProvisioningDuration(10.5);
    metrics.recordTokens(1000);

    const text = formatPrometheusMetrics(metrics.snapshot());

    expect(text).toContain('# HELP symphony_runs_active');
    expect(text).toContain('# TYPE symphony_runs_active gauge');
    expect(text).toContain('symphony_runs_active 1');

    expect(text).toContain('# HELP symphony_runs_total');
    expect(text).toContain('# TYPE symphony_runs_total counter');
    expect(text).toContain('symphony_runs_total 1');

    expect(text).toContain('# HELP symphony_provisioning_duration_seconds');
    expect(text).toContain('# TYPE symphony_provisioning_duration_seconds summary');
    expect(text).toContain('symphony_provisioning_duration_seconds_count 1');
    expect(text).toContain('symphony_provisioning_duration_seconds_sum 10.5');

    expect(text).toContain('# HELP symphony_tokens_total');
    expect(text).toContain('symphony_tokens_total 1000');
  });

  it('includes all 15+ metrics in output', () => {
    const metrics = new SymphonyMetrics();
    const text = formatPrometheusMetrics(metrics.snapshot());

    const metricNames = [
      'symphony_runs_active',
      'symphony_runs_total',
      'symphony_provisioning_duration_seconds',
      'symphony_agent_duration_seconds',
      'symphony_tokens_total',
      'symphony_cost_usd_total',
      'symphony_github_api_calls_total',
      'symphony_github_rate_remaining',
      'symphony_host_active_sessions',
      'symphony_host_capacity_remaining',
      'symphony_retries_total',
      'symphony_claims_total',
      'symphony_cleanup_items_pending',
      'symphony_cleanup_backlog_age_seconds',
      'symphony_orchestrator_heartbeat_age_seconds',
    ];

    for (const name of metricNames) {
      expect(text).toContain(`# HELP ${name}`);
    }
  });
});

// ============================================================
// HEALTH ENDPOINT
// ============================================================

describe('buildHealthResponse', () => {
  it('returns healthy status when all checks pass', () => {
    const response = buildHealthResponse({
      dbConnected: true,
      activeRuns: 3,
      lastPollTime: new Date().toISOString(),
      circuitBreakers: [],
      uptimeSeconds: 3600,
    });

    expect(response.status).toBe('healthy');
    expect(response.checks.database).toBe('ok');
    expect(response.activeRuns).toBe(3);
    expect(response.uptimeSeconds).toBe(3600);
  });

  it('returns unhealthy status when DB is disconnected', () => {
    const response = buildHealthResponse({
      dbConnected: false,
      activeRuns: 0,
      lastPollTime: null,
      circuitBreakers: [],
      uptimeSeconds: 100,
    });

    expect(response.status).toBe('unhealthy');
    expect(response.checks.database).toBe('fail');
  });

  it('returns degraded status when circuit breaker is open', () => {
    const response = buildHealthResponse({
      dbConnected: true,
      activeRuns: 1,
      lastPollTime: new Date().toISOString(),
      circuitBreakers: [{ name: 'github_api', state: 'open' }],
      uptimeSeconds: 1800,
    });

    expect(response.status).toBe('degraded');
    expect(response.checks.circuit_breakers).toBe('degraded');
  });

  it('includes lastPollTime in response', () => {
    const pollTime = '2026-03-06T12:00:00Z';
    const response = buildHealthResponse({
      dbConnected: true,
      activeRuns: 0,
      lastPollTime: pollTime,
      circuitBreakers: [],
      uptimeSeconds: 60,
    });

    expect(response.lastPollTime).toBe(pollTime);
  });
});
