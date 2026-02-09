import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadApiKey, isProviderConfigured, getActiveProvider, clearCachedProvider, getConfigSummary } from '../../src/api/embeddings/config.ts';

describe('Embeddings Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset process.env and clear cache before each test
    vi.resetModules();
    process.env = { ...originalEnv };
    clearCachedProvider();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('loadApiKey', () => {
    it('returns empty string when no key configured', () => {
      delete process.env.TEST_API_KEY;
      delete process.env.TEST_API_KEY_FILE;
      delete process.env.TEST_API_KEY_COMMAND;

      const key = loadApiKey('TEST_API_KEY');
      expect(key).toBe('');
    });

    it('loads key from direct environment variable', () => {
      process.env.TEST_API_KEY = 'direct-key-value';

      const key = loadApiKey('TEST_API_KEY');
      expect(key).toBe('direct-key-value');
    });

    it('trims whitespace from direct value', () => {
      process.env.TEST_API_KEY = '  key-with-spaces  ';

      const key = loadApiKey('TEST_API_KEY');
      expect(key).toBe('key-with-spaces');
    });
  });

  describe('isProviderConfigured', () => {
    it('returns false when voyageai not configured', () => {
      delete process.env.VOYAGERAI_API_KEY;
      delete process.env.VOYAGERAI_API_KEY_FILE;
      delete process.env.VOYAGERAI_API_KEY_COMMAND;

      expect(isProviderConfigured('voyageai')).toBe(false);
    });

    it('returns true when voyageai is configured', () => {
      process.env.VOYAGERAI_API_KEY = 'test-key';

      expect(isProviderConfigured('voyageai')).toBe(true);
    });

    it('returns true when openai is configured', () => {
      process.env.OPENAI_API_KEY = 'test-key';

      expect(isProviderConfigured('openai')).toBe(true);
    });

    it('returns true when gemini is configured', () => {
      process.env.GEMINI_API_KEY = 'test-key';

      expect(isProviderConfigured('gemini')).toBe(true);
    });
  });

  describe('getActiveProvider', () => {
    it('returns null when no provider configured', () => {
      delete process.env.VOYAGERAI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GEMINI_API_KEY;
      delete process.env.EMBEDDING_PROVIDER;

      expect(getActiveProvider()).toBeNull();
    });

    it('returns voyageai first in priority order', () => {
      process.env.VOYAGERAI_API_KEY = 'voyage-key';
      process.env.OPENAI_API_KEY = 'openai-key';
      process.env.GEMINI_API_KEY = 'gemini-key';

      expect(getActiveProvider()).toBe('voyageai');
    });

    it('falls back to openai when voyageai not configured', () => {
      delete process.env.VOYAGERAI_API_KEY;
      process.env.OPENAI_API_KEY = 'openai-key';
      process.env.GEMINI_API_KEY = 'gemini-key';

      expect(getActiveProvider()).toBe('openai');
    });

    it('falls back to gemini when voyageai and openai not configured', () => {
      delete process.env.VOYAGERAI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      process.env.GEMINI_API_KEY = 'gemini-key';

      expect(getActiveProvider()).toBe('gemini');
    });

    it('respects explicit EMBEDDING_PROVIDER override', () => {
      process.env.VOYAGERAI_API_KEY = 'voyage-key';
      process.env.OPENAI_API_KEY = 'openai-key';
      process.env.EMBEDDING_PROVIDER = 'openai';

      expect(getActiveProvider()).toBe('openai');
    });

    it('falls back to auto-detect when explicit provider not configured', () => {
      process.env.VOYAGERAI_API_KEY = 'voyage-key';
      delete process.env.OPENAI_API_KEY;
      delete process.env.GEMINI_API_KEY;
      process.env.EMBEDDING_PROVIDER = 'gemini'; // specified but not configured

      // Should warn and fall back to voyageai (first configured provider)
      expect(getActiveProvider()).toBe('voyageai');
    });
  });

  describe('getConfigSummary', () => {
    it('returns null values when no provider configured', () => {
      delete process.env.VOYAGERAI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GEMINI_API_KEY;
      clearCachedProvider();

      const summary = getConfigSummary();

      expect(summary.provider).toBeNull();
      expect(summary.model).toBeNull();
      expect(summary.dimensions).toBeNull();
      expect(summary.configuredProviders).toEqual([]);
    });

    it('returns correct details when voyageai configured', () => {
      process.env.VOYAGERAI_API_KEY = 'voyage-key';
      delete process.env.OPENAI_API_KEY;
      delete process.env.GEMINI_API_KEY;
      clearCachedProvider();

      const summary = getConfigSummary();

      expect(summary.provider).toBe('voyageai');
      expect(summary.model).toBe('voyage-3-large');
      expect(summary.dimensions).toBe(1024);
      expect(summary.configuredProviders).toEqual(['voyageai']);
    });

    it('lists all configured providers', () => {
      process.env.VOYAGERAI_API_KEY = 'voyage-key';
      process.env.OPENAI_API_KEY = 'openai-key';
      process.env.GEMINI_API_KEY = 'gemini-key';
      clearCachedProvider();

      const summary = getConfigSummary();

      expect(summary.configuredProviders).toEqual(['voyageai', 'openai', 'gemini']);
    });
  });
});
