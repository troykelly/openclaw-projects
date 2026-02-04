import { describe, it, expect } from 'vitest';
import {
  EmbeddingError,
  calculateRetryDelay,
  DEFAULT_RETRY_CONFIG,
} from '../../src/api/embeddings/errors.ts';

describe('EmbeddingError', () => {
  describe('constructor', () => {
    it('creates rate_limit error as retryable', () => {
      const error = new EmbeddingError('rate_limit', 'Too many requests');

      expect(error.type).toBe('rate_limit');
      expect(error.message).toBe('Too many requests');
      expect(error.retryable).toBe(true);
    });

    it('creates auth error as non-retryable', () => {
      const error = new EmbeddingError('auth', 'Invalid API key');

      expect(error.type).toBe('auth');
      expect(error.retryable).toBe(false);
    });

    it('creates network error as retryable', () => {
      const error = new EmbeddingError('network', 'Connection failed');

      expect(error.type).toBe('network');
      expect(error.retryable).toBe(true);
    });

    it('creates invalid_input error as non-retryable', () => {
      const error = new EmbeddingError('invalid_input', 'Text too long');

      expect(error.type).toBe('invalid_input');
      expect(error.retryable).toBe(false);
    });

    it('creates timeout error as retryable', () => {
      const error = new EmbeddingError('timeout', 'Request timed out');

      expect(error.type).toBe('timeout');
      expect(error.retryable).toBe(true);
    });

    it('stores optional provider', () => {
      const error = new EmbeddingError('auth', 'Invalid API key', {
        provider: 'openai',
      });

      expect(error.provider).toBe('openai');
    });

    it('stores optional retryAfterMs', () => {
      const error = new EmbeddingError('rate_limit', 'Too many requests', {
        retryAfterMs: 5000,
      });

      expect(error.retryAfterMs).toBe(5000);
    });
  });

  describe('toSafeString', () => {
    it('includes type and message', () => {
      const error = new EmbeddingError('auth', 'Invalid API key');

      expect(error.toSafeString()).toContain('[auth]');
      expect(error.toSafeString()).toContain('Invalid API key');
    });

    it('includes provider when set', () => {
      const error = new EmbeddingError('auth', 'Invalid API key', {
        provider: 'openai',
      });

      expect(error.toSafeString()).toContain('(provider: openai)');
    });

    it('indicates retryable status', () => {
      const retryable = new EmbeddingError('rate_limit', 'Too many requests');
      const nonRetryable = new EmbeddingError('auth', 'Invalid API key');

      expect(retryable.toSafeString()).toContain('(retryable)');
      expect(nonRetryable.toSafeString()).not.toContain('(retryable)');
    });
  });
});

describe('calculateRetryDelay', () => {
  it('calculates exponential backoff', () => {
    const config = { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 10000 };

    // First attempt (0): ~1000ms
    const delay0 = calculateRetryDelay(0, config);
    expect(delay0).toBeGreaterThanOrEqual(1000);
    expect(delay0).toBeLessThanOrEqual(1250); // 1000 + 25% jitter

    // Second attempt (1): ~2000ms
    const delay1 = calculateRetryDelay(1, config);
    expect(delay1).toBeGreaterThanOrEqual(2000);
    expect(delay1).toBeLessThanOrEqual(2500);

    // Third attempt (2): ~4000ms
    const delay2 = calculateRetryDelay(2, config);
    expect(delay2).toBeGreaterThanOrEqual(4000);
    expect(delay2).toBeLessThanOrEqual(5000);
  });

  it('respects maxDelayMs', () => {
    const config = { maxRetries: 10, baseDelayMs: 1000, maxDelayMs: 3000 };

    // Even with many retries, should cap at maxDelayMs
    const delay = calculateRetryDelay(5, config);
    expect(delay).toBeLessThanOrEqual(3000);
  });

  it('uses server-suggested delay when provided', () => {
    const config = { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 10000 };

    const delay = calculateRetryDelay(0, config, 5000);
    expect(delay).toBe(5000);
  });

  it('caps server-suggested delay at maxDelayMs', () => {
    const config = { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 3000 };

    const delay = calculateRetryDelay(0, config, 5000);
    expect(delay).toBe(3000);
  });
});

describe('DEFAULT_RETRY_CONFIG', () => {
  it('has correct config for rate_limit', () => {
    expect(DEFAULT_RETRY_CONFIG.rate_limit).toEqual({
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 10000,
    });
  });

  it('has correct config for network', () => {
    expect(DEFAULT_RETRY_CONFIG.network).toEqual({
      maxRetries: 1,
      baseDelayMs: 100,
      maxDelayMs: 1000,
    });
  });

  it('has no retries for auth errors', () => {
    expect(DEFAULT_RETRY_CONFIG.auth.maxRetries).toBe(0);
  });

  it('has no retries for invalid_input errors', () => {
    expect(DEFAULT_RETRY_CONFIG.invalid_input.maxRetries).toBe(0);
  });
});
