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
        latencyMs: Date.now() - start,
        details: {
          configured: false,
          gatewayUrl: null,
          hasToken: false,
          message: 'OpenClaw webhook dispatch not configured. Events will queue but not dispatch.',
        },
      };
    }

    return {
      status: 'healthy',
      latencyMs: Date.now() - start,
      details: {
        configured: true,
        gatewayUrl: summary.gatewayUrl,
        hasToken: summary.hasToken,
        defaultModel: summary.defaultModel,
        timeoutSeconds: summary.timeoutSeconds,
      },
    };
  }
}
