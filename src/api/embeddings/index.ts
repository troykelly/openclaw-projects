/**
 * Embedding service exports.
 */

export * from './types.ts';
export * from './errors.ts';
export * from './config.ts';
export * from './service.ts';
export * from './memory-integration.ts';
export * from './message-integration.ts';
export * from './note-integration.ts';
export * from './skill-store-integration.ts';
export * from './work-item-integration.ts';
export * from './health.ts';
export * from './settings.ts';
export { createProvider, VoyageAIProvider, OpenAIProvider, GeminiProvider } from './providers/index.ts';
