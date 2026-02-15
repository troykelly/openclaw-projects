import { describe, it, expect } from 'vitest';
import { validateOutboundUrl, validateOutboundHost, isPrivateIp } from './network-guard.ts';

describe('isPrivateIp', () => {
  it.each([
    ['127.0.0.1', true],
    ['127.255.255.255', true],
    ['10.0.0.1', true],
    ['10.255.255.255', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['192.168.0.1', true],
    ['192.168.255.255', true],
    ['169.254.1.1', true],
    ['0.0.0.0', true],
    ['::1', true],
    ['fc00::1', true],
    ['fd12::1', true],
    ['fe80::1', true],
    ['febf::1', true],
    ['::', true],
    // IPv4-mapped IPv6
    ['::ffff:127.0.0.1', true],
    ['::ffff:10.0.0.1', true],
    ['::ffff:192.168.1.1', true],
    ['::ffff:172.16.0.1', true],
    ['::ffff:8.8.8.8', false],
    // Public IPs
    ['8.8.8.8', false],
    ['1.1.1.1', false],
    ['203.0.113.1', false],
    ['172.32.0.1', false],
    ['172.15.255.255', false],
    ['192.169.0.1', false],
    ['2607:f8b0:4004:800::200e', false],
  ])('isPrivateIp(%s) === %s', (ip, expected) => {
    expect(isPrivateIp(ip)).toBe(expected);
  });
});

describe('validateOutboundUrl', () => {
  it('accepts valid https URLs with public hosts', () => {
    const result = validateOutboundUrl('https://example.com/api');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.hostname).toBe('example.com');
    }
  });

  it('accepts valid wss URLs with public hosts', () => {
    const result = validateOutboundUrl('wss://stream.example.com/ws');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.hostname).toBe('stream.example.com');
    }
  });

  it('rejects http scheme', () => {
    const result = validateOutboundUrl('http://example.com');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('http');
      expect(result.error).toContain('not allowed');
    }
  });

  it('rejects ws scheme', () => {
    const result = validateOutboundUrl('ws://example.com');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('ws');
      expect(result.error).toContain('not allowed');
    }
  });

  it('rejects file scheme', () => {
    const result = validateOutboundUrl('file:///etc/passwd');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('not allowed');
    }
  });

  it('rejects ftp scheme', () => {
    const result = validateOutboundUrl('ftp://ftp.example.com');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('not allowed');
    }
  });

  it('rejects private IP hosts in https URLs', () => {
    const result = validateOutboundUrl('https://192.168.1.1/api');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('private');
    }
  });

  it('rejects localhost IP in https URLs', () => {
    const result = validateOutboundUrl('https://127.0.0.1/api');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('private');
    }
  });

  it('rejects "localhost" hostname', () => {
    const result = validateOutboundUrl('https://localhost/api');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('local');
    }
  });

  it('rejects ".local" suffix hostnames', () => {
    const result = validateOutboundUrl('https://homeassistant.local/api');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('local');
    }
  });

  it('rejects IPv4-mapped IPv6 loopback', () => {
    const result = validateOutboundUrl('https://[::ffff:127.0.0.1]/api');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('private');
    }
  });

  it('rejects IPv4-mapped IPv6 private', () => {
    const result = validateOutboundUrl('https://[::ffff:192.168.1.1]/api');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('private');
    }
  });

  it('rejects invalid URLs', () => {
    const result = validateOutboundUrl('not-a-url');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Invalid URL');
    }
  });

  it('rejects 10.x.x.x private range', () => {
    const result = validateOutboundUrl('https://10.0.0.1/api');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('private');
    }
  });

  it('rejects 172.16.x.x private range', () => {
    const result = validateOutboundUrl('https://172.16.0.1/api');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('private');
    }
  });

  it('rejects IPv6 loopback in URL', () => {
    const result = validateOutboundUrl('https://[::1]/api');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('private');
    }
  });

  it('accepts public IPv4 in URL', () => {
    const result = validateOutboundUrl('https://8.8.8.8/dns');
    expect(result.ok).toBe(true);
  });
});

describe('validateOutboundHost', () => {
  it('accepts valid public host and port', () => {
    const result = validateOutboundHost('mqtt.example.com', 8883);
    expect(result.ok).toBe(true);
  });

  it('rejects port 0', () => {
    const result = validateOutboundHost('mqtt.example.com', 0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('port');
    }
  });

  it('rejects port above 65535', () => {
    const result = validateOutboundHost('mqtt.example.com', 65536);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('port');
    }
  });

  it('rejects negative port', () => {
    const result = validateOutboundHost('mqtt.example.com', -1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('port');
    }
  });

  it('rejects non-integer port', () => {
    const result = validateOutboundHost('mqtt.example.com', 1.5);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('port');
    }
  });

  it('rejects private IP hosts', () => {
    const result = validateOutboundHost('192.168.1.1', 8883);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('private');
    }
  });

  it('rejects localhost IP', () => {
    const result = validateOutboundHost('127.0.0.1', 8883);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('private');
    }
  });

  it('rejects "localhost" hostname', () => {
    const result = validateOutboundHost('localhost', 8883);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('local');
    }
  });

  it('rejects standard non-TLS MQTT port 1883', () => {
    const result = validateOutboundHost('mqtt.example.com', 1883);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('1883');
      expect(result.error).toContain('8883');
    }
  });

  it('rejects empty host', () => {
    const result = validateOutboundHost('', 8883);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('empty');
    }
  });

  it('accepts port 1 (minimum)', () => {
    const result = validateOutboundHost('mqtt.example.com', 1);
    expect(result.ok).toBe(true);
  });

  it('accepts port 65535 (maximum)', () => {
    const result = validateOutboundHost('mqtt.example.com', 65535);
    expect(result.ok).toBe(true);
  });
});
