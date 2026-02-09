/**
 * Voyage AI embedding provider implementation.
 *
 * Voyage AI is recommended by Anthropic for Claude ecosystem embeddings.
 * Default model: voyage-3-large (1024 dimensions)
 */

import { getApiKey } from '../config.ts';
import { EmbeddingError } from '../errors.ts';
import { type EmbeddingProvider, PROVIDER_DETAILS, DEFAULT_TIMEOUT_MS } from '../types.ts';

const PROVIDER = PROVIDER_DETAILS.voyageai;

interface VoyageResponse {
  object: string;
  data: Array<{
    object: string;
    index: number;
    embedding: number[];
  }>;
  model: string;
  usage: {
    total_tokens: number;
  };
}

/**
 * Voyage AI embedding provider.
 */
export class VoyageAIProvider implements EmbeddingProvider {
  readonly name = 'voyageai' as const;
  readonly model = PROVIDER.model;
  readonly dimensions = PROVIDER.dimensions;

  private apiKey: string | null = null;

  /**
   * Get the API key, loading it lazily.
   */
  private getKey(): string {
    if (!this.apiKey) {
      this.apiKey = getApiKey('voyageai');
    }
    return this.apiKey;
  }

  /**
   * Generate embeddings for a batch of texts.
   */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const apiKey = this.getKey();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const response = await fetch(PROVIDER.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: texts,
          input_type: 'document',
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        await this.handleError(response);
      }

      const data = (await response.json()) as VoyageResponse;

      // Log usage for cost tracking (no secrets)
      console.log(`[Embeddings] Voyage AI: embedded ${texts.length} texts, ${data.usage.total_tokens} tokens`);

      // Sort by index to ensure correct order
      const sorted = data.data.sort((a, b) => a.index - b.index);
      return sorted.map((item) => item.embedding);
    } catch (error) {
      clearTimeout(timeoutId);

      if ((error as Error).name === 'AbortError') {
        throw new EmbeddingError('timeout', 'Voyage AI request timed out', {
          provider: this.name,
        });
      }

      if (error instanceof EmbeddingError) {
        throw error;
      }

      throw new EmbeddingError('network', `Voyage AI request failed: ${(error as Error).message}`, {
        provider: this.name,
        cause: error,
      });
    }
  }

  /**
   * Handle HTTP error responses.
   */
  private async handleError(response: Response): Promise<never> {
    const status = response.status;
    let errorMessage = `HTTP ${status}`;

    try {
      const body = (await response.json()) as { detail?: string; error?: { message?: string } };
      errorMessage = body.detail || body.error?.message || errorMessage;
    } catch {
      // Ignore JSON parse errors
    }

    if (status === 401 || status === 403) {
      throw new EmbeddingError('auth', `Voyage AI authentication failed: ${errorMessage}`, {
        provider: this.name,
      });
    }

    if (status === 429) {
      // Check for Retry-After header
      const retryAfter = response.headers.get('Retry-After');
      const retryAfterMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : undefined;

      throw new EmbeddingError('rate_limit', `Voyage AI rate limit exceeded: ${errorMessage}`, {
        provider: this.name,
        retryAfterMs,
      });
    }

    if (status === 400) {
      throw new EmbeddingError('invalid_input', `Voyage AI invalid input: ${errorMessage}`, {
        provider: this.name,
      });
    }

    throw new EmbeddingError('network', `Voyage AI error: ${errorMessage}`, {
      provider: this.name,
    });
  }
}
