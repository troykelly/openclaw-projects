/**
 * SSRF / TLS network validation for outbound provider connections.
 * Enforces TLS-only connections and blocks private IP ranges.
 * Part of Issue #1244.
 */

import type { Result } from './types.ts';

/** Schemes that require TLS — the only ones we allow. */
const ALLOWED_SCHEMES = new Set(['https:', 'wss:']);

/**
 * Check whether an IP address falls within a private/reserved range.
 *
 * Blocked ranges:
 *   IPv4: 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, 0.0.0.0/8
 *   IPv6: ::1, fc00::/7, fe80::/10
 */
/** Known local hostnames that must be blocked regardless of IP checks. */
const LOCAL_HOSTNAMES = new Set(['localhost', 'localhost.localdomain']);
const LOCAL_HOSTNAME_SUFFIXES = ['.local', '.localhost', '.internal'];

function isLocalHostname(host: string): boolean {
  const lower = host.toLowerCase();
  if (LOCAL_HOSTNAMES.has(lower)) return true;
  return LOCAL_HOSTNAME_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

function isPrivateIpv4(a: number, b: number): boolean {
  if (a === 127) return true; // 127.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // 169.254.0.0/16
  if (a === 0) return true; // 0.0.0.0/8
  return false;
}

export function isPrivateIp(ip: string): boolean {
  // Normalise: strip IPv6 zone IDs and surrounding brackets
  const cleaned = ip.replace(/%.*$/, '').replace(/^\[|\]$/g, '');

  // IPv4
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(cleaned)) {
    const parts = cleaned.split('.').map(Number);
    return isPrivateIpv4(parts[0], parts[1]);
  }

  // IPv6
  const lower = cleaned.toLowerCase();
  if (lower === '::1' || lower === '::') return true;

  // Expand :: and parse groups
  const expanded = expandIpv6(lower);
  if (!expanded) return false;

  // Check for IPv4-mapped IPv6 (::ffff:x.x.x.x → groups [0,0,0,0,0,0xffff,high,low])
  if (
    expanded[0] === 0 && expanded[1] === 0 && expanded[2] === 0 &&
    expanded[3] === 0 && expanded[4] === 0 && expanded[5] === 0xffff
  ) {
    const a = (expanded[6] >> 8) & 0xff;
    const b = expanded[6] & 0xff;
    return isPrivateIpv4(a, b);
  }

  const first = expanded[0];
  // fc00::/7 → first byte 0xfc or 0xfd → first group 0xfc00–0xfdff
  if (first >= 0xfc00 && first <= 0xfdff) return true;
  // fe80::/10 → first 10 bits = 0x3fa0 → first group 0xfe80–0xfebf
  if (first >= 0xfe80 && first <= 0xfebf) return true;

  return false;
}

/**
 * Validate an outbound URL for provider connections.
 * Accepts only `https:` and `wss:` schemes with non-private hosts.
 */
export function validateOutboundUrl(url: string): Result<URL, string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: `Invalid URL: ${url}` };
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return {
      ok: false,
      error: `Scheme "${parsed.protocol.replace(':', '')}" is not allowed; use https or wss`,
    };
  }

  const host = parsed.hostname;
  if (!host) {
    return { ok: false, error: 'URL has no hostname' };
  }

  if (isLocalHostname(host)) {
    return { ok: false, error: `Host "${host}" is a local/reserved hostname` };
  }

  if (isPrivateIp(host)) {
    return { ok: false, error: `Host "${host}" resolves to a private/reserved IP range` };
  }

  return { ok: true, value: parsed };
}

/**
 * Validate an outbound host and port for MQTT-style connections.
 * Port must be 1–65535 and the host must not be a private IP.
 */
export function validateOutboundHost(host: string, port: number): Result<void, string> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: `Invalid port: ${port}; must be 1–65535` };
  }

  if (!host) {
    return { ok: false, error: 'Host must not be empty' };
  }

  // Reject standard non-TLS MQTT port
  if (port === 1883) {
    return { ok: false, error: 'Port 1883 is the standard non-TLS MQTT port; use port 8883 (MQTTS) instead' };
  }

  if (isLocalHostname(host)) {
    return { ok: false, error: `Host "${host}" is a local/reserved hostname` };
  }

  if (isPrivateIp(host)) {
    return { ok: false, error: `Host "${host}" resolves to a private/reserved IP range` };
  }

  return { ok: true, value: undefined };
}

/**
 * Expand a normalised (lowercase, no zone-id) IPv6 address into an array of
 * eight 16-bit group values.  Returns null if the address doesn't look like IPv6.
 */
function expandIpv6(addr: string): number[] | null {
  // Handle IPv4-mapped IPv6 (e.g. ::ffff:192.168.1.1)
  const v4Mapped = addr.match(/^(.*):(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4Mapped) {
    const ipv4Parts = v4Mapped[2].split('.').map(Number);
    const high = (ipv4Parts[0] << 8) | ipv4Parts[1];
    const low = (ipv4Parts[2] << 8) | ipv4Parts[3];
    // Replace the IPv4 portion with two hex groups
    addr = `${v4Mapped[1]}:${high.toString(16)}:${low.toString(16)}`;
  }

  const sides = addr.split('::');
  if (sides.length > 2) return null; // at most one ::

  const left = sides[0] ? sides[0].split(':').map((g) => parseInt(g, 16)) : [];
  const right = sides.length === 2 && sides[1] ? sides[1].split(':').map((g) => parseInt(g, 16)) : [];

  if (sides.length === 2) {
    const fill = 8 - left.length - right.length;
    if (fill < 0) return null;
    return [...left, ...Array(fill).fill(0) as number[], ...right];
  }

  if (left.length !== 8) return null;
  return left;
}
