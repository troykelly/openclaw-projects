import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getOpenClawConfig,
  isOpenClawConfigured,
  clearConfigCache,
  getConfigSummary,
} from '../../src/api/webhooks/config.ts';

describe('Webhook Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    clearConfigCache();
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    clearConfigCache();
  });

  describe('getOpenClawConfig', () => {
    it('returns null when OPENCLAW_GATEWAY_URL is not set', () => {
      delete process.env.OPENCLAW_GATEWAY_URL;
      delete process.env.OPENCLAW_HOOK_TOKEN;

      expect(getOpenClawConfig()).toBeNull();
    });

    it('returns null when OPENCLAW_HOOK_TOKEN is not set', () => {
      process.env.OPENCLAW_GATEWAY_URL = 'http://localhost:18789';
      delete process.env.OPENCLAW_HOOK_TOKEN;

      expect(getOpenClawConfig()).toBeNull();
    });

    it('returns config when both required vars are set', () => {
      process.env.OPENCLAW_GATEWAY_URL = 'http://localhost:18789';
      process.env.OPENCLAW_HOOK_TOKEN = 'test-token';

      const config = getOpenClawConfig();

      expect(config).not.toBeNull();
      expect(config!.gatewayUrl).toBe('http://localhost:18789');
      expect(config!.hookToken).toBe('test-token');
    });

    it('removes trailing slash from gateway URL', () => {
      process.env.OPENCLAW_GATEWAY_URL = 'http://localhost:18789/';
      process.env.OPENCLAW_HOOK_TOKEN = 'test-token';

      const config = getOpenClawConfig();

      expect(config!.gatewayUrl).toBe('http://localhost:18789');
    });

    it('uses default model when not specified', () => {
      process.env.OPENCLAW_GATEWAY_URL = 'http://localhost:18789';
      process.env.OPENCLAW_HOOK_TOKEN = 'test-token';

      const config = getOpenClawConfig();

      expect(config!.defaultModel).toBe('anthropic/claude-sonnet-4-20250514');
    });

    it('uses custom model when specified', () => {
      process.env.OPENCLAW_GATEWAY_URL = 'http://localhost:18789';
      process.env.OPENCLAW_HOOK_TOKEN = 'test-token';
      process.env.OPENCLAW_DEFAULT_MODEL = 'anthropic/claude-opus-4';

      const config = getOpenClawConfig();

      expect(config!.defaultModel).toBe('anthropic/claude-opus-4');
    });

    it('uses default timeout when not specified', () => {
      process.env.OPENCLAW_GATEWAY_URL = 'http://localhost:18789';
      process.env.OPENCLAW_HOOK_TOKEN = 'test-token';

      const config = getOpenClawConfig();

      expect(config!.timeoutSeconds).toBe(120);
    });

    it('uses custom timeout when specified', () => {
      process.env.OPENCLAW_GATEWAY_URL = 'http://localhost:18789';
      process.env.OPENCLAW_HOOK_TOKEN = 'test-token';
      process.env.OPENCLAW_TIMEOUT_SECONDS = '300';

      const config = getOpenClawConfig();

      expect(config!.timeoutSeconds).toBe(300);
    });

    it('caches the config', () => {
      process.env.OPENCLAW_GATEWAY_URL = 'http://localhost:18789';
      process.env.OPENCLAW_HOOK_TOKEN = 'test-token';

      const config1 = getOpenClawConfig();
      process.env.OPENCLAW_GATEWAY_URL = 'http://changed:8080';
      const config2 = getOpenClawConfig();

      expect(config1).toBe(config2);
      expect(config2!.gatewayUrl).toBe('http://localhost:18789');
    });
  });

  describe('isOpenClawConfigured', () => {
    it('returns false when not configured', () => {
      delete process.env.OPENCLAW_GATEWAY_URL;
      delete process.env.OPENCLAW_HOOK_TOKEN;

      expect(isOpenClawConfigured()).toBe(false);
    });

    it('returns true when configured', () => {
      process.env.OPENCLAW_GATEWAY_URL = 'http://localhost:18789';
      process.env.OPENCLAW_HOOK_TOKEN = 'test-token';

      expect(isOpenClawConfigured()).toBe(true);
    });
  });

  describe('getConfigSummary', () => {
    it('returns unconfigured summary when not set', () => {
      delete process.env.OPENCLAW_GATEWAY_URL;
      delete process.env.OPENCLAW_HOOK_TOKEN;

      const summary = getConfigSummary();

      expect(summary.configured).toBe(false);
      expect(summary.gatewayUrl).toBeNull();
      expect(summary.hasToken).toBe(false);
    });

    it('returns configured summary when set', () => {
      process.env.OPENCLAW_GATEWAY_URL = 'http://localhost:18789';
      process.env.OPENCLAW_HOOK_TOKEN = 'test-token';

      const summary = getConfigSummary();

      expect(summary.configured).toBe(true);
      expect(summary.gatewayUrl).toBe('http://localhost:18789');
      expect(summary.hasToken).toBe(true);
      expect(summary.defaultModel).toBe('anthropic/claude-sonnet-4-20250514');
    });
  });
});
