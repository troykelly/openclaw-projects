/**
 * Tests for OpenClaw config validation.
 * Part of Issue #1178.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateOpenClawConfig, clearConfigCache } from '../../src/api/webhooks/config.ts';

describe('validateOpenClawConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    clearConfigCache();
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
    clearConfigCache();
  });

  describe('valid configuration', () => {
    it('returns valid when all vars are properly set', () => {
      process.env.OPENCLAW_GATEWAY_URL = 'https://gateway.example.com';
      process.env.OPENCLAW_API_TOKEN = 'my-secret-token';

      const result = validateOpenClawConfig();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('missing variables', () => {
    it('reports missing OPENCLAW_GATEWAY_URL', () => {
      delete process.env.OPENCLAW_GATEWAY_URL;
      process.env.OPENCLAW_API_TOKEN = 'my-secret-token';

      const result = validateOpenClawConfig();
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('OPENCLAW_GATEWAY_URL is not set');
    });

    it('reports missing OPENCLAW_API_TOKEN', () => {
      process.env.OPENCLAW_GATEWAY_URL = 'https://gateway.example.com';
      delete process.env.OPENCLAW_API_TOKEN;

      const result = validateOpenClawConfig();
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('OPENCLAW_API_TOKEN is not set');
    });

    it('reports both missing', () => {
      delete process.env.OPENCLAW_GATEWAY_URL;
      delete process.env.OPENCLAW_API_TOKEN;

      const result = validateOpenClawConfig();
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
    });
  });

  describe('invalid values', () => {
    it('detects invalid URL', () => {
      process.env.OPENCLAW_GATEWAY_URL = 'not-a-url';
      process.env.OPENCLAW_API_TOKEN = 'my-secret-token';

      const result = validateOpenClawConfig();
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('OPENCLAW_GATEWAY_URL is not a valid URL');
    });

    it('detects empty token (whitespace)', () => {
      process.env.OPENCLAW_GATEWAY_URL = 'https://gateway.example.com';
      process.env.OPENCLAW_API_TOKEN = '   ';

      const result = validateOpenClawConfig();
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('OPENCLAW_API_TOKEN is empty or whitespace');
    });

    it('detects 1Password reference (op://)', () => {
      process.env.OPENCLAW_GATEWAY_URL = 'https://gateway.example.com';
      process.env.OPENCLAW_API_TOKEN = 'op://vault/item/field';

      const result = validateOpenClawConfig();
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('1Password reference'))).toBe(true);
    });

    it('detects 1Password CLI placeholder', () => {
      process.env.OPENCLAW_GATEWAY_URL = 'https://gateway.example.com';
      process.env.OPENCLAW_API_TOKEN = "some text [use 'op item get' to retrieve] rest";

      const result = validateOpenClawConfig();
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('1Password CLI placeholder'))).toBe(true);
    });
  });
});
