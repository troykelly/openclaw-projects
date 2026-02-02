/**
 * Health check for the embedding service.
 */

import type { HealthChecker, HealthCheckResult } from '../health.js';
import { getConfigSummary } from './config.js';
import { embeddingService } from './service.js';

/**
 * Health checker for the embedding service.
 *
 * Reports:
 * - Whether embeddings are configured
 * - Which provider is active
 * - Model and dimensions
 *
 * Non-critical: embedding failures cause degraded mode (text search fallback),
 * not application failure.
 */
export class EmbeddingHealthChecker implements HealthChecker {
  readonly name = 'embeddings';
  readonly critical = false; // Not critical - search falls back to text

  async check(): Promise<HealthCheckResult> {
    const start = Date.now();

    const summary = getConfigSummary();

    if (!summary.provider) {
      return {
        status: 'degraded',
        latencyMs: Date.now() - start,
        details: {
          configured: false,
          provider: null,
          model: null,
          dimensions: null,
          message: 'No embedding provider configured. Semantic search unavailable.',
        },
      };
    }

    // Optionally verify the provider is working
    // For now, just report configuration status
    return {
      status: 'healthy',
      latencyMs: Date.now() - start,
      details: {
        configured: true,
        provider: summary.provider,
        model: summary.model,
        dimensions: summary.dimensions,
        configuredProviders: summary.configuredProviders,
      },
    };
  }
}
