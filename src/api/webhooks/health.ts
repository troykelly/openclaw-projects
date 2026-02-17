/**
 * Health check for webhook dispatch service.
 * Part of Issue #201.
 */

import type { HealthChecker, HealthCheckResult } from '../health.ts';
import { getConfigSummary, isOpenClawConfigured } from './config.ts';

/**
 * Health checker for webhook dispatch service.
 *
 * Reports:
 * - Whether OpenClaw is configured
 * - Gateway URL
 * - Token presence
 *
 * Non-critical: webhook failures don't break the application,
 * but OpenClaw integration won't work.
 */
export class WebhookHealthChecker implements HealthChecker {
  readonly name = 'webhooks';
  readonly critical = false;

  async check(): Promise<HealthCheckResult> {
    const start = Date.now();

    const summary = getConfigSummary();

    if (!summary.configured) {
      return {
        status: 'degraded',
        latency_ms: Date.now() - start,
        details: {
          configured: false,
          gateway_url: null,
          has_token: false,
          message: 'OpenClaw webhook dispatch not configured. Events will queue but not dispatch.',
        },
      };
    }

    return {
      status: 'healthy',
      latency_ms: Date.now() - start,
      details: {
        configured: true,
        gateway_url: summary.gateway_url,
        has_token: summary.has_token,
        default_model: summary.default_model,
        timeout_seconds: summary.timeout_seconds,
      },
    };
  }
}
