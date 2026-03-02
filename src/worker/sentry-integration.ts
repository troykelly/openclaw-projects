/**
 * Sentry integration helpers for the Worker process (#2001).
 *
 * Provides:
 * - processJobWithSpan(): wraps individual job processing in a Sentry tracing span
 * - recordCircuitBreakerBreadcrumb(): records circuit breaker state changes as breadcrumbs
 *
 * These are safe no-ops when Sentry is not initialized (SENTRY_DSN unset).
 *
 * Epic #1998 — GlitchTip/Sentry Error Tracking Integration
 */

import * as Sentry from '@sentry/node';
import type { CircuitState } from './circuit-breaker.ts';

interface JobIdentifier {
  id: string;
  kind: string;
}

/**
 * Wrap a single job's processing in a Sentry tracing span.
 *
 * Creates one span per job (not one per polling batch), providing
 * granular tracing of individual job execution times and errors.
 */
export async function processJobWithSpan<T>(
  job: JobIdentifier,
  handler: () => Promise<T>,
): Promise<T> {
  return Sentry.startSpan(
    {
      name: `job.process ${job.kind}`,
      op: 'job.process',
      attributes: {
        'job.id': job.id,
        'job.kind': job.kind,
      },
    },
    () => handler(),
  );
}

/**
 * Record a circuit breaker state change as a Sentry breadcrumb.
 *
 * Uses 'warning' level for trips (closed->open, half_open->open)
 * and 'info' level for recovery transitions (->closed).
 */
export function recordCircuitBreakerBreadcrumb(
  destination: string,
  previousState: CircuitState,
  newState: CircuitState,
  failures: number,
): void {
  Sentry.addBreadcrumb({
    category: 'circuit_breaker',
    message: `Circuit breaker for ${destination}: ${previousState} -> ${newState}`,
    level: newState === 'closed' ? 'info' : 'warning',
    data: {
      destination,
      previousState,
      newState,
      failures,
    },
  });
}
