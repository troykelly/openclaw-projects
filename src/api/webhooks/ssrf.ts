/**
 * SSRF protection for webhook URLs.
 *
 * Validates that webhook destination URLs do not target private/internal networks.
 * Part of Issue #823.
 */

import { isIP } from 'node:net';

/** Known private/reserved IPv4 CIDR ranges. */
const PRIVATE_IPV4_RANGES: Array<{ network: number; mask: number; label: string }> = [
  { network: ip4ToInt('127.0.0.0'), mask: prefixToMask(8), label: 'loopback' },
  { network: ip4ToInt('10.0.0.0'), mask: prefixToMask(8), label: 'private (10/8)' },
  { network: ip4ToInt('172.16.0.0'), mask: prefixToMask(12), label: 'private (172.16/12)' },
  { network: ip4ToInt('192.168.0.0'), mask: prefixToMask(16), label: 'private (192.168/16)' },
  { network: ip4ToInt('169.254.0.0'), mask: prefixToMask(16), label: 'link-local' },
  { network: ip4ToInt('0.0.0.0'), mask: prefixToMask(8), label: 'unspecified' },
];

/** Known blocked hostnames. */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata.google',
]);

/** Blocked hostname suffixes. */
const BLOCKED_SUFFIXES = [
  '.internal',
  '.local',
  '.localhost',
];

/** Convert dotted-quad IPv4 to 32-bit integer. */
function ip4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/** Convert CIDR prefix length to 32-bit mask. */
function prefixToMask(bits: number): number {
  return bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
}

/**
 * Check if an IPv4 address falls within any private/reserved range.
 */
function isPrivateIPv4(ip: string): string | null {
  const ipInt = ip4ToInt(ip);
  for (const range of PRIVATE_IPV4_RANGES) {
    if ((ipInt & range.mask) === (range.network & range.mask)) {
      return range.label;
    }
  }
  return null;
}

/**
 * Check if an IPv6 address is private/reserved.
 */
function isPrivateIPv6(ip: string): string | null {
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') {
    return 'loopback (IPv6)';
  }
  // fc00::/7 — unique local addresses
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return 'private (IPv6 ULA)';
  }
  // fe80::/10 — link-local
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') ||
      normalized.startsWith('fea') || normalized.startsWith('feb')) {
    return 'link-local (IPv6)';
  }
  // IPv4-mapped IPv6 in dotted-decimal form: ::ffff:x.x.x.x
  const v4Mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Mapped) {
    return isPrivateIPv4(v4Mapped[1]);
  }
  // IPv4-mapped IPv6 in hex form: ::ffff:HHHH:HHHH (Node.js URL parser normalizes to this)
  const v4MappedHex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (v4MappedHex) {
    const high = parseInt(v4MappedHex[1], 16);
    const low = parseInt(v4MappedHex[2], 16);
    const ipv4 = `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
    return isPrivateIPv4(ipv4);
  }
  return null;
}

/**
 * Check if a hostname is blocked (internal/local).
 */
function isBlockedHostname(hostname: string): string | null {
  const lower = hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(lower)) {
    return `blocked hostname: ${lower}`;
  }

  for (const suffix of BLOCKED_SUFFIXES) {
    if (lower.endsWith(suffix)) {
      return `blocked hostname suffix: ${suffix}`;
    }
  }

  return null;
}

/**
 * Validate a webhook URL against SSRF risks.
 *
 * Checks:
 * 1. Hostname is not a blocked name (localhost, *.internal, etc.)
 * 2. If hostname is an IP literal, it must not be in a private/reserved range
 *
 * Note: This performs hostname-level validation only. DNS rebinding attacks
 * (where a hostname resolves to a private IP after validation) require
 * additional protection at the network/fetch layer.
 *
 * @returns null if safe, error message if blocked
 */
export function validateSsrf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'Invalid URL';
  }

  const hostname = parsed.hostname;

  // Check blocked hostnames
  const hostBlockReason = isBlockedHostname(hostname);
  if (hostBlockReason) {
    return `SSRF protection: ${hostBlockReason}`;
  }

  // If hostname is an IP literal, check against private ranges
  // Remove brackets from IPv6 literals for net.isIP check
  const bareHost = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;

  const ipVersion = isIP(bareHost);

  if (ipVersion === 4) {
    const reason = isPrivateIPv4(bareHost);
    if (reason) {
      return `SSRF protection: ${reason} address not allowed`;
    }
  } else if (ipVersion === 6) {
    const reason = isPrivateIPv6(bareHost);
    if (reason) {
      return `SSRF protection: ${reason} address not allowed`;
    }
  }

  return null;
}

/**
 * Redact sensitive header values for display.
 *
 * Replaces values with `***` for headers that commonly contain credentials.
 * All other header values are also redacted to be safe.
 */
export function redactWebhookHeaders(
  headers: Record<string, string> | null | undefined
): Record<string, string> | null {
  if (!headers || typeof headers !== 'object') {
    return null;
  }

  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string' && value.length > 0) {
      redacted[key] = '***';
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

/**
 * Check if a URL is absolute (has a protocol).
 */
export function isAbsoluteUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}
