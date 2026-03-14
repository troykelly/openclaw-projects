import { describe, expect, it, vi } from 'vitest';

/**
 * Tests for the rewritten logger adapter (#2537, #2546).
 *
 * TDD: These tests are written FIRST. They should FAIL until the
 * implementation in logger.ts is updated.
 */

import {
  createPluginLogger,
  createFallbackLogger,
  redactSensitive,
  type PluginLogger,
  type Logger,
} from '../src/logger.js';

// ── Helper: create a mock PluginLogger ──────────────────────────────────────

function createMockHost(): PluginLogger & { calls: Record<string, string[]> } {
  const calls: Record<string, string[]> = { info: [], warn: [], error: [], debug: [] };
  return {
    calls,
    info: (msg: string) => { calls.info.push(msg); },
    warn: (msg: string) => { calls.warn.push(msg); },
    error: (msg: string) => { calls.error.push(msg); },
    debug: (msg: string) => { calls.debug.push(msg); },
  };
}

// ── createPluginLogger ──────────────────────────────────────────────────────

describe('createPluginLogger', () => {
  it('prepends [openclaw-projects] to info messages', () => {
    const host = createMockHost();
    const logger = createPluginLogger(host);
    logger.info('hello');
    expect(host.calls.info).toEqual(['[openclaw-projects] hello']);
  });

  it('prepends [openclaw-projects] to warn messages', () => {
    const host = createMockHost();
    const logger = createPluginLogger(host);
    logger.warn('warning');
    expect(host.calls.warn).toEqual(['[openclaw-projects] warning']);
  });

  it('prepends [openclaw-projects] to error messages', () => {
    const host = createMockHost();
    const logger = createPluginLogger(host);
    logger.error('failure');
    expect(host.calls.error).toEqual(['[openclaw-projects] failure']);
  });

  it('prepends [openclaw-projects] to debug messages', () => {
    const host = createMockHost();
    const logger = createPluginLogger(host);
    logger.debug('trace');
    expect(host.calls.debug).toEqual(['[openclaw-projects] trace']);
  });

  it('prepends [openclaw-projects:component] when created with component', () => {
    const host = createMockHost();
    const logger = createPluginLogger(host, 'memory');
    logger.info('fetching');
    expect(host.calls.info).toEqual(['[openclaw-projects:memory] fetching']);
  });

  it('flattens data object into message as JSON', () => {
    const host = createMockHost();
    const logger = createPluginLogger(host);
    logger.info('event', { key: 'value', count: 42 });
    const msg = host.calls.info[0];
    expect(msg).toContain('[openclaw-projects] event');
    expect(msg).toContain('"key":"value"');
    expect(msg).toContain('"count":42');
  });

  it('handles empty data object (no trailing {})', () => {
    const host = createMockHost();
    const logger = createPluginLogger(host);
    logger.info('event', {});
    expect(host.calls.info).toEqual(['[openclaw-projects] event']);
  });

  it('handles undefined data (no trailing undefined)', () => {
    const host = createMockHost();
    const logger = createPluginLogger(host);
    logger.info('event', undefined);
    expect(host.calls.info).toEqual(['[openclaw-projects] event']);
  });

  it('redacts sensitive fields in data before stringifying', () => {
    const host = createMockHost();
    const logger = createPluginLogger(host);
    logger.info('config', { apiKey: 'sk-1234', url: 'https://example.com' });
    const msg = host.calls.info[0];
    expect(msg).toContain('[REDACTED]');
    expect(msg).not.toContain('sk-1234');
    expect(msg).toContain('https://example.com');
  });

  it('redacts values containing Bearer token patterns', () => {
    const host = createMockHost();
    const logger = createPluginLogger(host);
    logger.info('auth', { header: 'Bearer eyJhbGciOiJIUzI1NiJ9.test' });
    const msg = host.calls.info[0];
    expect(msg).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(msg).toContain('[REDACTED]');
  });

  it('redacts values containing sk_live_ prefixes', () => {
    const host = createMockHost();
    const logger = createPluginLogger(host);
    logger.info('stripe', { key: 'sk_live_abc123def456' });
    const msg = host.calls.info[0];
    expect(msg).not.toContain('sk_live_abc123def456');
    expect(msg).toContain('[REDACTED]');
  });

  it('redacts values containing sk_test_ prefixes', () => {
    const host = createMockHost();
    const logger = createPluginLogger(host);
    logger.info('stripe', { key: 'sk_test_abc123def456' });
    const msg = host.calls.info[0];
    expect(msg).not.toContain('sk_test_abc123def456');
    expect(msg).toContain('[REDACTED]');
  });

  it('child() creates a nested component logger', () => {
    const host = createMockHost();
    const logger = createPluginLogger(host);
    const child = logger.child('api');
    child.info('request sent');
    expect(host.calls.info).toEqual(['[openclaw-projects:api] request sent']);
  });

  it('child() of child creates nested prefix', () => {
    const host = createMockHost();
    const logger = createPluginLogger(host, 'memory');
    const child = logger.child('recall');
    child.info('searching');
    expect(host.calls.info).toEqual(['[openclaw-projects:memory:recall] searching']);
  });

  it('child() nesting is limited to max 3 levels', () => {
    const host = createMockHost();
    const logger = createPluginLogger(host);
    const l1 = logger.child('a');
    const l2 = l1.child('b');
    const l3 = l2.child('c');
    // l3 should work
    l3.info('deep');
    expect(host.calls.info[0]).toContain('[openclaw-projects:a:b:c]');

    // l4 should NOT add another level — it returns l3's logger
    const l4 = l3.child('d');
    l4.info('too deep');
    expect(host.calls.info[1]).toContain('[openclaw-projects:a:b:c]');
    expect(host.calls.info[1]).not.toContain(':d]');
  });

  it('debug is a no-op when host logger has no debug method', () => {
    const host = createMockHost();
    const hostNoDebug: PluginLogger = {
      info: host.info,
      warn: host.warn,
      error: host.error,
    };
    const logger = createPluginLogger(hostNoDebug);
    // Should not throw
    logger.debug('silent');
    expect(host.calls.debug).toEqual([]);
  });

  it('calls the correct host logger method for each level', () => {
    const host = createMockHost();
    const logger = createPluginLogger(host);
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    logger.debug('d');
    expect(host.calls.info).toEqual(['[openclaw-projects] i']);
    expect(host.calls.warn).toEqual(['[openclaw-projects] w']);
    expect(host.calls.error).toEqual(['[openclaw-projects] e']);
    expect(host.calls.debug).toEqual(['[openclaw-projects] d']);
  });

  // Safe serialization tests
  it('handles circular references in data without throwing', () => {
    const host = createMockHost();
    const logger = createPluginLogger(host);
    const data: Record<string, unknown> = { name: 'test' };
    data.self = data; // circular reference
    logger.info('circular', data);
    const msg = host.calls.info[0];
    expect(msg).toContain('[openclaw-projects] circular');
    expect(msg).toContain('[Circular]');
  });

  it('handles BigInt values in data without throwing', () => {
    const host = createMockHost();
    const logger = createPluginLogger(host);
    logger.info('big', { value: BigInt(9007199254740991) });
    const msg = host.calls.info[0];
    expect(msg).toContain('[openclaw-projects] big');
    expect(msg).toContain('9007199254740991');
  });

  it('serializes Error objects in data as { message, stack?, code? }', () => {
    const host = createMockHost();
    const logger = createPluginLogger(host);
    const err = new Error('something broke');
    logger.info('failed', { error: err });
    const msg = host.calls.info[0];
    expect(msg).toContain('something broke');
    // Should NOT produce empty {} for Error objects
    expect(msg).not.toMatch(/"error":\s*\{\}/);
  });

  it('serializes Error objects with code property', () => {
    const host = createMockHost();
    const logger = createPluginLogger(host);
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    logger.info('failed', { error: err });
    const msg = host.calls.info[0];
    expect(msg).toContain('ENOENT');
  });
});

// ── createFallbackLogger ────────────────────────────────────────────────────

describe('createFallbackLogger', () => {
  it('calls console.info without extra formatting', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const logger = createFallbackLogger();
    logger.info('test message');
    expect(spy).toHaveBeenCalledWith('test message');
    spy.mockRestore();
  });

  it('calls console.warn without extra formatting', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logger = createFallbackLogger();
    logger.warn('warning message');
    expect(spy).toHaveBeenCalledWith('warning message');
    spy.mockRestore();
  });

  it('calls console.error without extra formatting', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = createFallbackLogger();
    logger.error('error message');
    expect(spy).toHaveBeenCalledWith('error message');
    spy.mockRestore();
  });

  it('calls console.debug without extra formatting', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const logger = createFallbackLogger();
    logger.debug!('debug message');
    expect(spy).toHaveBeenCalledWith('debug message');
    spy.mockRestore();
  });

  it('does not add timestamps or level prefixes', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const logger = createFallbackLogger();
    logger.info('plain message');
    const call = spy.mock.calls[0][0] as string;
    expect(call).not.toMatch(/\[\d{4}-\d{2}-\d{2}/);
    expect(call).not.toMatch(/\[INFO\]/);
    expect(call).toBe('plain message');
    spy.mockRestore();
  });
});

// ── redactSensitive ─────────────────────────────────────────────────────────

describe('redactSensitive', () => {
  it('redacts apiKey field', () => {
    const obj = { apiKey: 'secret-key-12345', other: 'value' };
    const redacted = redactSensitive(obj);
    expect(redacted.apiKey).toBe('[REDACTED]');
    expect(redacted.other).toBe('value');
  });

  it('redacts token field', () => {
    const obj = { token: 'bearer-token-xyz', other: 'value' };
    const redacted = redactSensitive(obj);
    expect(redacted.token).toBe('[REDACTED]');
  });

  it('redacts password field', () => {
    const obj = { password: 'supersecret', user: 'john' };
    const redacted = redactSensitive(obj);
    expect(redacted.password).toBe('[REDACTED]');
    expect(redacted.user).toBe('john');
  });

  it('redacts secret field', () => {
    const obj = { secret: 'my-secret', id: '123' };
    const redacted = redactSensitive(obj);
    expect(redacted.secret).toBe('[REDACTED]');
  });

  it('redacts authorization header', () => {
    const obj = { authorization: 'Bearer xyz', other: 'value' };
    const redacted = redactSensitive(obj);
    expect(redacted.authorization).toBe('[REDACTED]');
  });

  // New fields from #2537 review findings
  it('redacts share_token field', () => {
    const obj = { share_token: 'tok-abc', id: '1' };
    const redacted = redactSensitive(obj);
    expect(redacted.share_token).toBe('[REDACTED]');
  });

  it('redacts session_token field', () => {
    const obj = { session_token: 'sess-abc' };
    const redacted = redactSensitive(obj);
    expect(redacted.session_token).toBe('[REDACTED]');
  });

  it('redacts id_token field', () => {
    const obj = { id_token: 'id-abc' };
    const redacted = redactSensitive(obj);
    expect(redacted.id_token).toBe('[REDACTED]');
  });

  it('redacts webhook_token field', () => {
    const obj = { webhook_token: 'wh-abc' };
    const redacted = redactSensitive(obj);
    expect(redacted.webhook_token).toBe('[REDACTED]');
  });

  it('redacts connection_token field', () => {
    const obj = { connection_token: 'conn-abc' };
    const redacted = redactSensitive(obj);
    expect(redacted.connection_token).toBe('[REDACTED]');
  });

  it('redacts otp field', () => {
    const obj = { otp: '123456' };
    const redacted = redactSensitive(obj);
    expect(redacted.otp).toBe('[REDACTED]');
  });

  it('redacts field names case-insensitively', () => {
    const obj = { APIKEY: 'secret', Password: 'pass', SECRET: 'shh' };
    const redacted = redactSensitive(obj);
    expect(redacted.APIKEY).toBe('[REDACTED]');
    expect(redacted.Password).toBe('[REDACTED]');
    expect(redacted.SECRET).toBe('[REDACTED]');
  });

  it('handles nested objects', () => {
    const obj = {
      config: { apiKey: 'secret', url: 'http://example.com' },
      data: 'value',
    };
    const redacted = redactSensitive(obj);
    expect(redacted.config.apiKey).toBe('[REDACTED]');
    expect(redacted.config.url).toBe('http://example.com');
  });

  it('handles arrays', () => {
    const obj = {
      items: [
        { apiKey: 'secret1', name: 'item1' },
        { apiKey: 'secret2', name: 'item2' },
      ],
    };
    const redacted = redactSensitive(obj);
    expect(redacted.items[0].apiKey).toBe('[REDACTED]');
    expect(redacted.items[1].apiKey).toBe('[REDACTED]');
    expect(redacted.items[0].name).toBe('item1');
  });

  it('does not modify original object', () => {
    const obj = { apiKey: 'secret', other: 'value' };
    redactSensitive(obj);
    expect(obj.apiKey).toBe('secret');
  });

  it('handles null and undefined', () => {
    expect(redactSensitive(null)).toBe(null);
    expect(redactSensitive(undefined)).toBe(undefined);
  });

  it('handles primitive values', () => {
    expect(redactSensitive('string')).toBe('string');
    expect(redactSensitive(123)).toBe(123);
    expect(redactSensitive(true)).toBe(true);
  });

  // Value-pattern redaction tests
  it('redacts values containing Bearer token patterns', () => {
    const obj = { header: 'Bearer eyJhbGciOiJIUzI1NiJ9.test', name: 'ok' };
    const redacted = redactSensitive(obj);
    expect(redacted.header).toBe('[REDACTED]');
    expect(redacted.name).toBe('ok');
  });

  it('redacts values containing sk_live_ prefixes', () => {
    const obj = { key: 'sk_live_abc123', name: 'ok' };
    const redacted = redactSensitive(obj);
    expect(redacted.key).toBe('[REDACTED]');
  });

  it('redacts values containing sk_test_ prefixes', () => {
    const obj = { key: 'sk_test_abc123', name: 'ok' };
    const redacted = redactSensitive(obj);
    expect(redacted.key).toBe('[REDACTED]');
  });
});
