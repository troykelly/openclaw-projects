/**
 * Embedding service with retry logic and batch support.
 */

import { getCachedProvider, getConfigSummary, clearCachedProvider } from './config.ts';
import { createProvider } from './providers/index.ts';
import { withRetry, EmbeddingError } from './errors.ts';
import {
  type EmbeddingProvider,
  type EmbeddingResult,
  type EmbeddingConfig,
  type EmbeddingStatus,
  type BatchOptions,
  type EmbeddingProviderName,
  PROVIDER_DETAILS,
  MAX_EMBEDDING_TEXT_LENGTH,
  DEFAULT_MAX_CONCURRENT,
} from './types.ts';

/**
 * Embedding service interface.
 */
export interface EmbeddingService {
  /**
   * Check if an embedding provider is configured.
   */
  isConfigured(): boolean;

  /**
   * Get the active provider instance.
   */
  getProvider(): EmbeddingProvider | null;

  /**
   * Get the current embedding configuration.
   */
  getConfig(): EmbeddingConfig | null;

  /**
   * Generate an embedding for a single text.
   */
  embed(text: string): Promise<EmbeddingResult | null>;

  /**
   * Generate embeddings for multiple texts.
   */
  embedBatch(texts: string[], options?: BatchOptions): Promise<(EmbeddingResult | null)[]>;

  /**
   * Clear cached provider (for testing or config reload).
   */
  clearCache(): void;
}

// Singleton provider instance
let providerInstance: EmbeddingProvider | null = null;
let providerName: EmbeddingProviderName | null = null;

/**
 * Get or create the provider instance.
 */
function getOrCreateProvider(): EmbeddingProvider | null {
  const currentProvider = getCachedProvider();

  // If provider changed, recreate instance
  if (currentProvider !== providerName) {
    providerInstance = currentProvider ? createProvider(currentProvider) : null;
    providerName = currentProvider;
  }

  return providerInstance;
}

/**
 * Validate text before embedding.
 */
function validateText(text: string): void {
  if (!text || text.trim().length === 0) {
    throw new EmbeddingError('invalid_input', 'Text cannot be empty');
  }

  if (text.length > MAX_EMBEDDING_TEXT_LENGTH) {
    throw new EmbeddingError('invalid_input', `Text exceeds maximum length of ${MAX_EMBEDDING_TEXT_LENGTH} characters`);
  }
}

/**
 * Sanitize text for embedding.
 * - Normalize unicode
 * - Remove control characters (except newlines and tabs)
 */
function sanitizeText(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '') // Remove control chars
    .trim();
}

/**
 * Semaphore for limiting concurrent requests.
 */
class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.permits++;
    }
  }
}

/**
 * Create the embedding service.
 */
export function createEmbeddingService(): EmbeddingService {
  return {
    isConfigured(): boolean {
      return getCachedProvider() !== null;
    },

    getProvider(): EmbeddingProvider | null {
      return getOrCreateProvider();
    },

    getConfig(): EmbeddingConfig | null {
      const provider = getCachedProvider();
      if (!provider) {
        return null;
      }

      const details = PROVIDER_DETAILS[provider];
      return {
        provider,
        model: details.model,
        dimensions: details.dimensions,
        status: 'active' as EmbeddingStatus,
      };
    },

    async embed(text: string): Promise<EmbeddingResult | null> {
      const provider = getOrCreateProvider();
      if (!provider) {
        return null;
      }

      const sanitized = sanitizeText(text);
      validateText(sanitized);

      try {
        const embeddings = await withRetry(() => provider.embed([sanitized]));
        return {
          embedding: embeddings[0],
          provider: provider.name,
          model: provider.model,
        };
      } catch (error) {
        // Log error but don't crash - caller can handle null result
        console.error('[Embeddings] Failed to embed:', (error as EmbeddingError).toSafeString?.() ?? (error as Error).message);
        throw error;
      }
    },

    async embedBatch(texts: string[], options?: BatchOptions): Promise<(EmbeddingResult | null)[]> {
      const provider = getOrCreateProvider();
      if (!provider) {
        return texts.map(() => null);
      }

      const maxConcurrent = options?.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
      const semaphore = new Semaphore(maxConcurrent);

      // Process texts with concurrency limit
      const promises = texts.map(async (text, index) => {
        await semaphore.acquire();
        try {
          const sanitized = sanitizeText(text);
          validateText(sanitized);

          const embeddings = await withRetry(() => provider.embed([sanitized]));
          return {
            embedding: embeddings[0],
            provider: provider.name,
            model: provider.model,
          } as EmbeddingResult;
        } catch (error) {
          console.error(`[Embeddings] Failed to embed text ${index}:`, (error as EmbeddingError).toSafeString?.() ?? (error as Error).message);
          return null;
        } finally {
          semaphore.release();
        }
      });

      return Promise.all(promises);
    },

    clearCache(): void {
      clearCachedProvider();
      providerInstance = null;
      providerName = null;
    },
  };
}

// Export singleton instance
export const embeddingService = createEmbeddingService();
