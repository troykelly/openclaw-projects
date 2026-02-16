/**
 * Configuration for OpenClaw webhook dispatch.
 * Part of Issue #201. Updated in Issue #1349 to use OPENCLAW_API_TOKEN.
 * Updated in Issue #1410 to prefer OPENCLAW_HOOK_TOKEN for gateway dispatch.
 */

import type { OpenClawConfig } from './types.ts';

let cachedConfig: OpenClawConfig | null = null;

/**
 * Load OpenClaw configuration from environment variables.
 * Returns null if required variables are not set.
 *
 * Uses OPENCLAW_HOOK_TOKEN for outbound hook authentication to the gateway.
 * Falls back to OPENCLAW_API_TOKEN for backwards compatibility.
 */
export function getOpenClawConfig(): OpenClawConfig | null {
  if (cachedConfig) {
    return cachedConfig;
  }

  const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL;
  const apiToken = process.env.OPENCLAW_HOOK_TOKEN || process.env.OPENCLAW_API_TOKEN;

  if (!gatewayUrl || !apiToken) {
    return null;
  }

  cachedConfig = {
    gatewayUrl: gatewayUrl.replace(/\/$/, ''), // Remove trailing slash
    apiToken,
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
 * Validate OpenClaw configuration and return detailed errors.
 *
 * Checks:
 * - OPENCLAW_GATEWAY_URL is present and parseable as a URL
 * - OPENCLAW_HOOK_TOKEN (or OPENCLAW_API_TOKEN) is present, non-empty, not a 1Password reference
 *
 * Never logs actual token values — only presence/absence.
 */
export function validateOpenClawConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL;
  if (!gatewayUrl) {
    errors.push('OPENCLAW_GATEWAY_URL is not set');
  } else {
    try {
      new URL(gatewayUrl);
    } catch {
      errors.push('OPENCLAW_GATEWAY_URL is not a valid URL');
    }
  }

  const apiToken = process.env.OPENCLAW_HOOK_TOKEN || process.env.OPENCLAW_API_TOKEN;
  if (!apiToken) {
    errors.push('OPENCLAW_HOOK_TOKEN (or OPENCLAW_API_TOKEN) is not set');
  } else if (apiToken.trim().length === 0) {
    errors.push('OPENCLAW_HOOK_TOKEN is empty or whitespace');
  } else if (apiToken.startsWith('op://')) {
    errors.push('OPENCLAW_HOOK_TOKEN appears to be an unresolved 1Password reference (starts with op://)');
  } else if (apiToken.includes("[use 'op item get")) {
    errors.push('OPENCLAW_HOOK_TOKEN contains unresolved 1Password CLI placeholder');
  }

  return { valid: errors.length === 0, errors };
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
    hasToken: !!config.apiToken,
    defaultModel: config.defaultModel || null,
    timeoutSeconds: config.timeoutSeconds || null,
  };
}
