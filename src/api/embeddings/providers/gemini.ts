/**
 * Gemini embedding provider implementation.
 *
 * Default model: gemini-embedding-001 (1024 dimensions, reduced from 3072)
 *
 * Note: Gemini uses a different API format than OpenAI/Voyage.
 * Uses output_dimensionality to request reduced dimensions for pgvector compatibility.
 */

import { getApiKey } from '../config.ts';
import { EmbeddingError } from '../errors.ts';
import { type EmbeddingProvider, PROVIDER_DETAILS, DEFAULT_TIMEOUT_MS } from '../types.ts';

const PROVIDER = PROVIDER_DETAILS.gemini;

interface GeminiEmbedResponse {
  embedding: {
    values: number[];
  };
}

interface GeminiBatchEmbedResponse {
  embeddings: Array<{
    values: number[];
  }>;
}

interface GeminiError {
  error?: {
    message?: string;
    code?: number;
    status?: string;
  };
}

/**
 * Gemini embedding provider.
 */
export class GeminiProvider implements EmbeddingProvider {
  readonly name = 'gemini' as const;
  readonly model = PROVIDER.model;
  readonly dimensions = PROVIDER.dimensions;

  private apiKey: string | null = null;

  /**
   * Get the API key, loading it lazily.
   */
  private getKey(): string {
    if (!this.apiKey) {
      this.apiKey = getApiKey('gemini');
    }
    return this.apiKey;
  }

  /**
   * Get the endpoint URL for a specific model.
   */
  private getEndpoint(): string {
    // Gemini uses model-specific endpoints
    return `${PROVIDER.apiEndpoint}/${this.model}:batchEmbedContents`;
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
      // Gemini uses a different request format
      // Each request can include outputDimensionality for dimension reduction
      const requests = texts.map((text) => ({
        model: `models/${this.model}`,
        content: {
          parts: [{ text }],
        },
        outputDimensionality: this.dimensions, // Request reduced dimensions for pgvector
      }));

      const response = await fetch(`${this.getEndpoint()}?key=${apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ requests }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        await this.handleError(response);
      }

      const data = (await response.json()) as GeminiBatchEmbedResponse;

      // Log usage for cost tracking (no secrets)
      console.log(`[Embeddings] Gemini: embedded ${texts.length} texts`);

      return data.embeddings.map((e) => e.values);
    } catch (error) {
      clearTimeout(timeoutId);

      if ((error as Error).name === 'AbortError') {
        throw new EmbeddingError('timeout', 'Gemini request timed out', {
          provider: this.name,
        });
      }

      if (error instanceof EmbeddingError) {
        throw error;
      }

      throw new EmbeddingError('network', `Gemini request failed: ${(error as Error).message}`, {
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
      const body = (await response.json()) as GeminiError;
      errorMessage = body.error?.message || errorMessage;
    } catch {
      // Ignore JSON parse errors
    }

    if (status === 401 || status === 403) {
      throw new EmbeddingError('auth', `Gemini authentication failed: ${errorMessage}`, {
        provider: this.name,
      });
    }

    if (status === 429) {
      throw new EmbeddingError('rate_limit', `Gemini rate limit exceeded: ${errorMessage}`, {
        provider: this.name,
      });
    }

    if (status === 400) {
      throw new EmbeddingError('invalid_input', `Gemini invalid input: ${errorMessage}`, {
        provider: this.name,
      });
    }

    throw new EmbeddingError('network', `Gemini error: ${errorMessage}`, {
      provider: this.name,
    });
  }
}
