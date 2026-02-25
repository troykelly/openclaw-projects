import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for DNS rebinding SSRF protection in network-guard.
 * Issue #1820: validateOutboundUrl() only checks literal hostname strings
 * against private IP patterns. An attacker-controlled domain resolving to
 * a private IP bypasses the check. These tests verify that
 * resolveAndValidateOutboundUrl() performs DNS resolution and blocks
 * hostnames that resolve to private IPs.
 */

// Mock dns.promises before importing the module under test
const mockLookup = vi.fn();
vi.mock('node:dns', () => ({
  promises: {
    lookup: mockLookup,
  },
}));

// Import after mocking
const { resolveAndValidateOutboundUrl, resolveAndValidateOutboundHost } = await import(
  '../../../src/api/geolocation/network-guard.ts'
);

beforeEach(() => {
  mockLookup.mockReset();
});

describe('resolveAndValidateOutboundUrl — DNS rebinding protection', () => {
  it('rejects URL with private IP literal (no DNS needed)', async () => {
    const result = await resolveAndValidateOutboundUrl('https://192.168.1.1/api');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('private');
    }
    // Should not even call DNS for a literal private IP
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('rejects URL whose hostname resolves to a private IPv4 (10.x)', async () => {
    mockLookup.mockResolvedValue({ address: '10.0.0.5', family: 4 });
    const result = await resolveAndValidateOutboundUrl('https://evil.example.com/api');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('private');
    }
  });

  it('rejects URL whose hostname resolves to 127.0.0.1', async () => {
    mockLookup.mockResolvedValue({ address: '127.0.0.1', family: 4 });
    const result = await resolveAndValidateOutboundUrl('https://evil.example.com/api');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('private');
    }
  });

  it('rejects URL whose hostname resolves to 172.16.x.x', async () => {
    mockLookup.mockResolvedValue({ address: '172.16.5.1', family: 4 });
    const result = await resolveAndValidateOutboundUrl('https://evil.example.com/api');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('private');
    }
  });

  it('rejects URL whose hostname resolves to 192.168.x.x', async () => {
    mockLookup.mockResolvedValue({ address: '192.168.0.1', family: 4 });
    const result = await resolveAndValidateOutboundUrl('https://evil.example.com/api');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('private');
    }
  });

  it('rejects URL whose hostname resolves to IPv6 loopback ::1', async () => {
    mockLookup.mockResolvedValue({ address: '::1', family: 6 });
    const result = await resolveAndValidateOutboundUrl('https://evil.example.com/api');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('private');
    }
  });

  it('rejects URL whose hostname resolves to IPv6 ULA (fc00::/7)', async () => {
    mockLookup.mockResolvedValue({ address: 'fd12::1', family: 6 });
    const result = await resolveAndValidateOutboundUrl('https://evil.example.com/api');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('private');
    }
  });

  it('rejects URL whose hostname resolves to IPv6 link-local (fe80::/10)', async () => {
    mockLookup.mockResolvedValue({ address: 'fe80::1', family: 6 });
    const result = await resolveAndValidateOutboundUrl('https://evil.example.com/api');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('private');
    }
  });

  it('accepts URL whose hostname resolves to a public IP', async () => {
    mockLookup.mockResolvedValue({ address: '93.184.216.34', family: 4 });
    const result = await resolveAndValidateOutboundUrl('https://example.com/api');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.hostname).toBe('example.com');
    }
  });

  it('rejects localhost hostname before DNS resolution', async () => {
    const result = await resolveAndValidateOutboundUrl('https://localhost/api');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('local');
    }
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('rejects non-https scheme before DNS resolution', async () => {
    const result = await resolveAndValidateOutboundUrl('http://evil.example.com/api');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('not allowed');
    }
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('rejects when DNS resolution fails', async () => {
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'));
    const result = await resolveAndValidateOutboundUrl('https://nonexistent.example.com/api');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('resolve');
    }
  });
});

describe('resolveAndValidateOutboundHost — DNS rebinding protection', () => {
  it('rejects host resolving to private IP', async () => {
    mockLookup.mockResolvedValue({ address: '10.0.0.1', family: 4 });
    const result = await resolveAndValidateOutboundHost('evil.example.com', 8883);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('private');
    }
  });

  it('accepts host resolving to public IP', async () => {
    mockLookup.mockResolvedValue({ address: '93.184.216.34', family: 4 });
    const result = await resolveAndValidateOutboundHost('mqtt.example.com', 8883);
    expect(result.ok).toBe(true);
  });

  it('rejects private IP literal without DNS lookup', async () => {
    const result = await resolveAndValidateOutboundHost('192.168.1.1', 8883);
    expect(result.ok).toBe(false);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('rejects when DNS resolution fails', async () => {
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'));
    const result = await resolveAndValidateOutboundHost('nonexistent.example.com', 8883);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('resolve');
    }
  });
});
