/**
 * Unit tests for symphony worker metrics.
 * Issue #2195 — Symphony Worker Process Skeleton.
 * Issue #2203 — GitHub Rate Limit Management.
 */

import { describe, it, expect } from 'vitest';
import {
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
  serialize,
} from './metrics.ts';

describe('symphony metrics', () => {
  it('serializes all metrics to Prometheus text format', () => {
    const output = serialize();
    expect(output).toContain('symphony_tick_duration_seconds');
    expect(output).toContain('symphony_ticks_total');
    expect(output).toContain('symphony_heartbeat_total');
    expect(output).toContain('symphony_heartbeat_errors_total');
    expect(output).toContain('symphony_recovery_total');
    expect(output).toContain('symphony_listen_reconnects_total');
    expect(output).toContain('symphony_pool_active_connections');
    expect(output).toContain('symphony_pool_idle_connections');
    expect(output).toContain('symphony_active_runs');
    expect(output).toContain('symphony_github_rate_remaining');
    expect(output).toContain('symphony_github_api_calls_total');
  });

  it('counter increments and reads correctly', () => {
    const initialValue = symphonyTicksTotal.get();
    symphonyTicksTotal.inc();
    expect(symphonyTicksTotal.get()).toBe(initialValue + 1);
  });

  it('gauge sets and reads correctly', () => {
    symphonyActiveRuns.set(5);
    expect(symphonyActiveRuns.get()).toBe(5);
    symphonyActiveRuns.set(0);
    expect(symphonyActiveRuns.get()).toBe(0);
  });

  it('histogram observes values', () => {
    symphonyTickDuration.observe({}, 0.123);
    const output = symphonyTickDuration.serialize();
    expect(output).toContain('symphony_tick_duration_seconds_sum');
    expect(output).toContain('symphony_tick_duration_seconds_count');
  });

  it('GitHub rate limit metrics are properly typed', () => {
    symphonyGithubRateRemaining.set({ resource: 'core' }, 4500);
    expect(symphonyGithubRateRemaining.get({ resource: 'core' })).toBe(4500);

    const initialCalls = symphonyGithubApiCallsTotal.get();
    symphonyGithubApiCallsTotal.inc();
    expect(symphonyGithubApiCallsTotal.get()).toBe(initialCalls + 1);
  });
});
