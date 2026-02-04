/**
 * Configuration for OpenClaw webhook dispatch.
 * Part of Issue #201.
 */

import type { OpenClawConfig } from './types.ts';

let cachedConfig: OpenClawConfig | null = null;

/**
 * Load OpenClaw configuration from environment variables.
 * Returns null if required variables are not set.
 */
export function getOpenClawConfig(): OpenClawConfig | null {
  if (cachedConfig) {
    return cachedConfig;
  }

  const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL;
  const hookToken = process.env.OPENCLAW_HOOK_TOKEN;

  if (!gatewayUrl || !hookToken) {
    return null;
  }

  cachedConfig = {
    gatewayUrl: gatewayUrl.replace(/\/$/, ''), // Remove trailing slash
    hookToken,
    defaultModel: process.env.OPENCLAW_DEFAULT_MODEL || 'anthropic/claude-sonnet-4-20250514',
    timeoutSeconds: parseInt(process.env.OPENCLAW_TIMEOUT_SECONDS || '120', 10),
  };

  return cachedConfig;
}

/**
 * Check if OpenClaw webhook dispatch is configured.
 */
export function isOpenClawConfigured(): boolean {
  return getOpenClawConfig() !== null;
}

/**
 * Clear cached config (for testing).
 */
export function clearConfigCache(): void {
  cachedConfig = null;
}

/**
 * Get config summary for logging/diagnostics.
 */
export function getConfigSummary(): {
  configured: boolean;
  gatewayUrl: string | null;
  hasToken: boolean;
  defaultModel: string | null;
  timeoutSeconds: number | null;
} {
  const config = getOpenClawConfig();

  if (!config) {
    return {
      configured: false,
      gatewayUrl: null,
      hasToken: false,
      defaultModel: null,
      timeoutSeconds: null,
    };
  }

  return {
    configured: true,
    gatewayUrl: config.gatewayUrl,
    hasToken: !!config.hookToken,
    defaultModel: config.defaultModel || null,
    timeoutSeconds: config.timeoutSeconds || null,
  };
}
