import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createProvider, VoyageAIProvider, OpenAIProvider, GeminiProvider } from '../../src/api/embeddings/providers/index.ts';
import { EmbeddingError } from '../../src/api/embeddings/errors.ts';

describe('Embedding Providers - Integration', () => {
  // These tests require API keys to be configured
  // They will be skipped if the corresponding API key is not set

  const hasVoyageKey = !!process.env.VOYAGERAI_API_KEY;
  const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
  const hasGeminiKey = !!process.env.GEMINI_API_KEY;

  describe('VoyageAI Provider', () => {
    const skipReason = hasVoyageKey ? '' : 'VOYAGERAI_API_KEY not set';

    it.skipIf(!hasVoyageKey)('generates embeddings for single text', async () => {
      const provider = new VoyageAIProvider();
      const embeddings = await provider.embed(['Hello, world!']);

      expect(embeddings).toHaveLength(1);
      expect(embeddings[0]).toHaveLength(1024); // voyage-3-large dimensions
      expect(embeddings[0].every((v) => typeof v === 'number')).toBe(true);
    });

    it.skipIf(!hasVoyageKey)('generates embeddings for multiple texts', async () => {
      const provider = new VoyageAIProvider();
      const texts = ['First text', 'Second text', 'Third text'];
      const embeddings = await provider.embed(texts);

      expect(embeddings).toHaveLength(3);
      embeddings.forEach((embedding) => {
        expect(embedding).toHaveLength(1024);
      });
    });

    it.skipIf(!hasVoyageKey)('returns empty array for empty input', async () => {
      const provider = new VoyageAIProvider();
      const embeddings = await provider.embed([]);

      expect(embeddings).toHaveLength(0);
    });

    it.skipIf(!hasVoyageKey)('produces similar embeddings for similar texts', async () => {
      const provider = new VoyageAIProvider();
      const embeddings = await provider.embed(['The weather is sunny today', 'Today has sunny weather', 'Programming in TypeScript']);

      // Calculate cosine similarity
      const cosineSimilarity = (a: number[], b: number[]): number => {
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < a.length; i++) {
          dotProduct += a[i] * b[i];
          normA += a[i] * a[i];
          normB += b[i] * b[i];
        }
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
      };

      const sim01 = cosineSimilarity(embeddings[0], embeddings[1]);
      const sim02 = cosineSimilarity(embeddings[0], embeddings[2]);

      // Similar sentences should have higher similarity
      expect(sim01).toBeGreaterThan(sim02);
      expect(sim01).toBeGreaterThan(0.8); // Should be quite similar
    });
  });

  describe('OpenAI Provider', () => {
    it.skipIf(!hasOpenAIKey)('generates embeddings for single text', async () => {
      const provider = new OpenAIProvider();
      const embeddings = await provider.embed(['Hello, world!']);

      expect(embeddings).toHaveLength(1);
      expect(embeddings[0]).toHaveLength(1024); // text-embedding-3-large dimensions
      expect(embeddings[0].every((v) => typeof v === 'number')).toBe(true);
    });

    it.skipIf(!hasOpenAIKey)('generates embeddings for multiple texts', async () => {
      const provider = new OpenAIProvider();
      const texts = ['First text', 'Second text'];
      const embeddings = await provider.embed(texts);

      expect(embeddings).toHaveLength(2);
      embeddings.forEach((embedding) => {
        expect(embedding).toHaveLength(1024);
      });
    });

    it.skipIf(!hasOpenAIKey)('returns empty array for empty input', async () => {
      const provider = new OpenAIProvider();
      const embeddings = await provider.embed([]);

      expect(embeddings).toHaveLength(0);
    });
  });

  describe('Gemini Provider', () => {
    it.skipIf(!hasGeminiKey)('generates embeddings for single text', async () => {
      const provider = new GeminiProvider();
      const embeddings = await provider.embed(['Hello, world!']);

      expect(embeddings).toHaveLength(1);
      expect(embeddings[0]).toHaveLength(1024); // gemini-embedding-001 dimensions
      expect(embeddings[0].every((v) => typeof v === 'number')).toBe(true);
    });

    it.skipIf(!hasGeminiKey)('generates embeddings for multiple texts', async () => {
      const provider = new GeminiProvider();
      const texts = ['First text', 'Second text'];
      const embeddings = await provider.embed(texts);

      expect(embeddings).toHaveLength(2);
      embeddings.forEach((embedding) => {
        expect(embedding).toHaveLength(1024);
      });
    });

    it.skipIf(!hasGeminiKey)('returns empty array for empty input', async () => {
      const provider = new GeminiProvider();
      const embeddings = await provider.embed([]);

      expect(embeddings).toHaveLength(0);
    });
  });

  describe('createProvider factory', () => {
    it('creates VoyageAI provider', () => {
      const provider = createProvider('voyageai');
      expect(provider).toBeInstanceOf(VoyageAIProvider);
      expect(provider.name).toBe('voyageai');
      expect(provider.dimensions).toBe(1024);
    });

    it('creates OpenAI provider', () => {
      const provider = createProvider('openai');
      expect(provider).toBeInstanceOf(OpenAIProvider);
      expect(provider.name).toBe('openai');
      expect(provider.dimensions).toBe(1024);
    });

    it('creates Gemini provider', () => {
      const provider = createProvider('gemini');
      expect(provider).toBeInstanceOf(GeminiProvider);
      expect(provider.name).toBe('gemini');
      expect(provider.dimensions).toBe(1024);
    });

    it('throws for unknown provider', () => {
      // @ts-expect-error Testing invalid input
      expect(() => createProvider('unknown')).toThrow('Unknown embedding provider');
    });
  });
});
