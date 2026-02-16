/**
 * Tests for API base URL derivation from hostname.
 *
 * Verifies that getApiBaseUrl() and getWsBaseUrl() produce correct
 * URLs for localhost, production, and override scenarios.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to dynamically import the module so we can control import.meta.env per test.
// Each test will mock window.location and import.meta.env before importing.

/** Helper: set window.location for jsdom tests. */
function setLocation(hostname: string, protocol = 'https:', port = '') {
  Object.defineProperty(window, 'location', {
    value: { hostname, protocol, port },
    writable: true,
    configurable: true,
  });
}

describe('getApiBaseUrl', () => {
  let getApiBaseUrl: typeof import('../../src/ui/lib/api-config.ts').getApiBaseUrl;

  beforeEach(async () => {
    // Reset module registry so import.meta.env changes take effect
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should return empty string for localhost', async () => {
    setLocation('localhost', 'http:', '5173');
    vi.stubEnv('VITE_API_URL', '');
    const mod = await import('../../src/ui/lib/api-config.ts');
    getApiBaseUrl = mod.getApiBaseUrl;

    expect(getApiBaseUrl()).toBe('');
  });

  it('should return empty string for 127.0.0.1', async () => {
    setLocation('127.0.0.1', 'http:', '5173');
    vi.stubEnv('VITE_API_URL', '');
    const mod = await import('../../src/ui/lib/api-config.ts');
    getApiBaseUrl = mod.getApiBaseUrl;

    expect(getApiBaseUrl()).toBe('');
  });

  it('should derive api.{domain} for production hostname', async () => {
    setLocation('example.invalid', 'https:');
    vi.stubEnv('VITE_API_URL', '');
    const mod = await import('../../src/ui/lib/api-config.ts');
    getApiBaseUrl = mod.getApiBaseUrl;

    expect(getApiBaseUrl()).toBe('https://api.example.invalid');
  });

  it('should strip www. prefix and derive api.{domain}', async () => {
    setLocation('www.example.invalid', 'https:');
    vi.stubEnv('VITE_API_URL', '');
    const mod = await import('../../src/ui/lib/api-config.ts');
    getApiBaseUrl = mod.getApiBaseUrl;

    expect(getApiBaseUrl()).toBe('https://api.example.invalid');
  });

  it('should use VITE_API_URL override when set', async () => {
    setLocation('example.invalid', 'https:');
    vi.stubEnv('VITE_API_URL', 'https://custom-api.example.invalid');
    const mod = await import('../../src/ui/lib/api-config.ts');
    getApiBaseUrl = mod.getApiBaseUrl;

    expect(getApiBaseUrl()).toBe('https://custom-api.example.invalid');
  });

  it('should strip trailing slash from VITE_API_URL', async () => {
    setLocation('example.invalid', 'https:');
    vi.stubEnv('VITE_API_URL', 'https://custom-api.example.invalid/');
    const mod = await import('../../src/ui/lib/api-config.ts');
    getApiBaseUrl = mod.getApiBaseUrl;

    expect(getApiBaseUrl()).toBe('https://custom-api.example.invalid');
  });

  it('should preserve http: protocol for non-localhost production', async () => {
    setLocation('staging.example.invalid', 'http:');
    vi.stubEnv('VITE_API_URL', '');
    const mod = await import('../../src/ui/lib/api-config.ts');
    getApiBaseUrl = mod.getApiBaseUrl;

    expect(getApiBaseUrl()).toBe('http://api.staging.example.invalid');
  });

  it('should return empty string for [::1] (IPv6 loopback)', async () => {
    setLocation('[::1]', 'http:', '5173');
    vi.stubEnv('VITE_API_URL', '');
    const mod = await import('../../src/ui/lib/api-config.ts');
    getApiBaseUrl = mod.getApiBaseUrl;

    expect(getApiBaseUrl()).toBe('');
  });
});

describe('getWsBaseUrl', () => {
  let getWsBaseUrl: typeof import('../../src/ui/lib/api-config.ts').getWsBaseUrl;

  beforeEach(async () => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should return empty string for localhost', async () => {
    setLocation('localhost', 'http:', '5173');
    vi.stubEnv('VITE_API_URL', '');
    const mod = await import('../../src/ui/lib/api-config.ts');
    getWsBaseUrl = mod.getWsBaseUrl;

    expect(getWsBaseUrl()).toBe('');
  });

  it('should derive wss://api.{domain} for https: production', async () => {
    setLocation('example.invalid', 'https:');
    vi.stubEnv('VITE_API_URL', '');
    const mod = await import('../../src/ui/lib/api-config.ts');
    getWsBaseUrl = mod.getWsBaseUrl;

    expect(getWsBaseUrl()).toBe('wss://api.example.invalid');
  });

  it('should derive ws://api.{domain} for http: production', async () => {
    setLocation('staging.example.invalid', 'http:');
    vi.stubEnv('VITE_API_URL', '');
    const mod = await import('../../src/ui/lib/api-config.ts');
    getWsBaseUrl = mod.getWsBaseUrl;

    expect(getWsBaseUrl()).toBe('ws://api.staging.example.invalid');
  });

  it('should convert VITE_API_URL https: to wss:', async () => {
    setLocation('example.invalid', 'https:');
    vi.stubEnv('VITE_API_URL', 'https://custom-api.example.invalid');
    const mod = await import('../../src/ui/lib/api-config.ts');
    getWsBaseUrl = mod.getWsBaseUrl;

    expect(getWsBaseUrl()).toBe('wss://custom-api.example.invalid');
  });

  it('should convert VITE_API_URL http: to ws:', async () => {
    setLocation('example.invalid', 'http:');
    vi.stubEnv('VITE_API_URL', 'http://custom-api.example.invalid');
    const mod = await import('../../src/ui/lib/api-config.ts');
    getWsBaseUrl = mod.getWsBaseUrl;

    expect(getWsBaseUrl()).toBe('ws://custom-api.example.invalid');
  });

  it('should strip www. and derive wss://api.{domain}', async () => {
    setLocation('www.example.invalid', 'https:');
    vi.stubEnv('VITE_API_URL', '');
    const mod = await import('../../src/ui/lib/api-config.ts');
    getWsBaseUrl = mod.getWsBaseUrl;

    expect(getWsBaseUrl()).toBe('wss://api.example.invalid');
  });
});
