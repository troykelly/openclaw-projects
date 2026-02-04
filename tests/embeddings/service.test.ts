import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createEmbeddingService,
  embeddingService,
} from '../../src/api/embeddings/service.ts';
import { clearCachedProvider } from '../../src/api/embeddings/config.ts';

describe('Embedding Service', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    clearCachedProvider();
    embeddingService.clearCache();
  });

  afterEach(() => {
    process.env = originalEnv;
    clearCachedProvider();
    embeddingService.clearCache();
  });

  describe('isConfigured', () => {
    it('returns false when no provider configured', () => {
      delete process.env.VOYAGERAI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GEMINI_API_KEY;

      const service = createEmbeddingService();
      expect(service.isConfigured()).toBe(false);
    });

    it('returns true when a provider is configured', () => {
      process.env.VOYAGERAI_API_KEY = 'test-key';

      const service = createEmbeddingService();
      expect(service.isConfigured()).toBe(true);
    });
  });

  describe('getProvider', () => {
    it('returns null when no provider configured', () => {
      delete process.env.VOYAGERAI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GEMINI_API_KEY;

      const service = createEmbeddingService();
      expect(service.getProvider()).toBeNull();
    });

    it('returns provider when configured', () => {
      process.env.VOYAGERAI_API_KEY = 'test-key';

      const service = createEmbeddingService();
      const provider = service.getProvider();

      expect(provider).not.toBeNull();
      expect(provider?.name).toBe('voyageai');
    });
  });

  describe('getConfig', () => {
    it('returns null when no provider configured', () => {
      delete process.env.VOYAGERAI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GEMINI_API_KEY;

      const service = createEmbeddingService();
      expect(service.getConfig()).toBeNull();
    });

    it('returns config when provider configured', () => {
      process.env.VOYAGERAI_API_KEY = 'test-key';

      const service = createEmbeddingService();
      const config = service.getConfig();

      expect(config).not.toBeNull();
      expect(config?.provider).toBe('voyageai');
      expect(config?.model).toBe('voyage-3-large');
      expect(config?.dimensions).toBe(1024);
      expect(config?.status).toBe('active');
    });
  });

  describe('embed - integration', () => {
    const hasApiKey = !!(
      process.env.VOYAGERAI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.GEMINI_API_KEY
    );

    it.skipIf(!hasApiKey)('returns null when no provider configured', async () => {
      delete process.env.VOYAGERAI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GEMINI_API_KEY;

      const service = createEmbeddingService();
      const result = await service.embed('Hello, world!');

      expect(result).toBeNull();
    });

    it.skipIf(!hasApiKey)('generates embedding for text', async () => {
      const service = createEmbeddingService();
      const result = await service.embed('Hello, world!');

      expect(result).not.toBeNull();
      expect(result!.embedding).toBeInstanceOf(Array);
      expect(result!.embedding.length).toBeGreaterThan(0);
      expect(result!.provider).toBeDefined();
      expect(result!.model).toBeDefined();
    });
  });

  describe('embedBatch - integration', () => {
    const hasApiKey = !!(
      process.env.VOYAGERAI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.GEMINI_API_KEY
    );

    it.skipIf(!hasApiKey)('returns null array when no provider configured', async () => {
      delete process.env.VOYAGERAI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GEMINI_API_KEY;

      const service = createEmbeddingService();
      const results = await service.embedBatch(['Hello', 'World']);

      expect(results).toHaveLength(2);
      expect(results[0]).toBeNull();
      expect(results[1]).toBeNull();
    });

    it.skipIf(!hasApiKey)('generates embeddings for multiple texts', async () => {
      const service = createEmbeddingService();
      const results = await service.embedBatch(['Hello', 'World']);

      expect(results).toHaveLength(2);
      results.forEach((result) => {
        expect(result).not.toBeNull();
        expect(result!.embedding).toBeInstanceOf(Array);
      });
    });
  });
});
