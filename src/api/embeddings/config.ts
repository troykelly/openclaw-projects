/**
 * Configuration loading for embedding providers.
 *
 * Follows the same three-tier loading pattern as auth/secret.ts:
 * 1. Command (e.g., 1Password CLI)
 * 2. File
 * 3. Direct environment variable
 */

import { execSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { type EmbeddingProviderName, PROVIDER_PRIORITY, PROVIDER_DETAILS, type ProviderDetails } from './types.ts';

/**
 * Environment variable names for each provider's API key.
 */
const PROVIDER_ENV_VARS: Record<EmbeddingProviderName, string> = {
  voyageai: 'VOYAGERAI_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

/**
 * Loads an API key using three-tier priority:
 * 1. {KEY}_COMMAND - Execute command and use output
 * 2. {KEY}_FILE - Read from file
 * 3. {KEY} - Direct environment variable
 *
 * @param envVarBase Base name for the environment variable (e.g., 'OPENAI_API_KEY')
 * @returns The API key, or empty string if not configured
 */
export function loadApiKey(envVarBase: string): string {
  // Priority 1: Command (e.g., 1Password CLI)
  const command = process.env[`${envVarBase}_COMMAND`];
  if (command && command.trim()) {
    try {
      // Security note: This uses execSync intentionally because:
      // 1. The command comes from environment variables set by system administrators
      // 2. It must support shell commands like `op read 'op://...'` for secret managers
      // 3. This is NOT user input - it's server-side configuration
      // This matches the established pattern in auth/secret.ts
      // eslint-disable-next-line security/detect-child-process
      const result = execSync(command, {
        encoding: 'utf-8',
        timeout: 10000, // 10 second timeout
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return result.trim();
    } catch (error) {
      // Log error but don't throw - fall through to other methods
      console.error(`[Embeddings] Failed to execute ${envVarBase}_COMMAND:`, (error as Error).message);
    }
  }

  // Priority 2: File
  const file = process.env[`${envVarBase}_FILE`];
  if (file && file.trim()) {
    try {
      // Check file permissions - warn if world-readable
      const stats = statSync(file);
      const mode = stats.mode & 0o777;
      if (mode & 0o004) {
        console.warn(`[Embeddings] Warning: API key file ${file} is world-readable (mode ${mode.toString(8)})`);
      }

      const content = readFileSync(file, 'utf-8');
      return content.trim();
    } catch (error) {
      console.error(`[Embeddings] Failed to read ${envVarBase}_FILE:`, (error as Error).message);
    }
  }

  // Priority 3: Direct environment variable
  const directValue = process.env[envVarBase];
  if (directValue) {
    return directValue.trim();
  }

  return '';
}

/**
 * Checks if an API key is configured for a provider.
 */
export function isProviderConfigured(provider: EmbeddingProviderName): boolean {
  const envVar = PROVIDER_ENV_VARS[provider];
  return loadApiKey(envVar).length > 0;
}

/**
 * Gets the API key for a provider.
 *
 * @param provider The provider name
 * @returns The API key
 * @throws Error if the provider is not configured
 */
export function getApiKey(provider: EmbeddingProviderName): string {
  const envVar = PROVIDER_ENV_VARS[provider];
  const key = loadApiKey(envVar);
  if (!key) {
    throw new Error(`[Embeddings] No API key configured for ${provider}. ` + `Set ${envVar}, ${envVar}_FILE, or ${envVar}_COMMAND.`);
  }
  return key;
}

/**
 * Determines the active provider based on configuration.
 *
 * If EMBEDDING_PROVIDER is set, uses that provider.
 * Otherwise, uses the first configured provider in priority order.
 *
 * @returns The active provider name, or null if none configured
 */
export function getActiveProvider(): EmbeddingProviderName | null {
  // Check for explicit provider override
  const explicitProvider = process.env.EMBEDDING_PROVIDER as EmbeddingProviderName | undefined;
  if (explicitProvider && PROVIDER_PRIORITY.includes(explicitProvider)) {
    if (isProviderConfigured(explicitProvider)) {
      return explicitProvider;
    }
    console.warn(`[Embeddings] EMBEDDING_PROVIDER=${explicitProvider} specified but not configured. Falling back to auto-detection.`);
  }

  // Auto-detect first configured provider in priority order
  for (const provider of PROVIDER_PRIORITY) {
    if (isProviderConfigured(provider)) {
      return provider;
    }
  }

  return null;
}

/**
 * Gets the details for the active provider.
 *
 * @returns Provider details, or null if no provider is configured
 */
export function getActiveProviderDetails(): ProviderDetails | null {
  const provider = getActiveProvider();
  return provider ? PROVIDER_DETAILS[provider] : null;
}

// Cache for provider configuration
let cachedProvider: EmbeddingProviderName | null = null;
let cacheInitialized = false;

/**
 * Gets the cached active provider, initializing if necessary.
 */
export function getCachedProvider(): EmbeddingProviderName | null {
  if (!cacheInitialized) {
    cachedProvider = getActiveProvider();
    cacheInitialized = true;
    if (cachedProvider) {
      console.log(`[Embeddings] Using provider: ${cachedProvider}`);
    } else {
      console.log('[Embeddings] No embedding provider configured');
    }
  }
  return cachedProvider;
}

/**
 * Clears the cached provider, forcing re-detection on next access.
 */
export function clearCachedProvider(): void {
  cachedProvider = null;
  cacheInitialized = false;
}

/**
 * Returns configuration summary for health checks (no secrets).
 */
export function getConfigSummary(): {
  provider: EmbeddingProviderName | null;
  configuredProviders: EmbeddingProviderName[];
  model: string | null;
  dimensions: number | null;
} {
  const provider = getCachedProvider();
  const details = provider ? PROVIDER_DETAILS[provider] : null;

  const configuredProviders = PROVIDER_PRIORITY.filter(isProviderConfigured);

  return {
    provider,
    configuredProviders,
    model: details?.model ?? null,
    dimensions: details?.dimensions ?? null,
  };
}
