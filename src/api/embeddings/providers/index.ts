/**
 * Provider factory for embedding providers.
 */

import { type EmbeddingProvider, type EmbeddingProviderName } from '../types.ts';
import { VoyageAIProvider } from './voyageai.ts';
import { OpenAIProvider } from './openai.ts';
import { GeminiProvider } from './gemini.ts';

/**
 * Create an embedding provider instance by name.
 *
 * @param name The provider name
 * @returns The provider instance
 */
export function createProvider(name: EmbeddingProviderName): EmbeddingProvider {
  switch (name) {
    case 'voyageai':
      return new VoyageAIProvider();
    case 'openai':
      return new OpenAIProvider();
    case 'gemini':
      return new GeminiProvider();
    default:
      throw new Error(`Unknown embedding provider: ${name}`);
  }
}

export { VoyageAIProvider } from './voyageai.ts';
export { OpenAIProvider } from './openai.ts';
export { GeminiProvider } from './gemini.ts';
