/**
 * IP whitelist middleware for webhook endpoints.
 * Part of Epic #310, Issue #318.
 *
 * Provides defense-in-depth by checking source IP against configured
 * CIDR ranges in addition to signature verification.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Configuration for IP whitelist middleware.
 */
export interface IPWhitelistConfig {
  /** Provider name for logging */
  providerName: string;
  /** Environment variable name containing CIDR whitelist */
  whitelistEnvVar: string;
}

/**
 * Check if an IP address is within a CIDR range.
 *
 * @param ip - IP address to check
 * @param cidr - CIDR notation (e.g., "192.168.1.0/24")
 * @returns true if IP is within the CIDR range
 */
export function isIPInCIDR(ip: string, cidr: string): boolean {
  if (!ip || !cidr) return false;

  const parts = cidr.split('/');
  if (parts.length !== 2) return false;

  const [network, prefixStr] = parts;
  const prefix = parseInt(prefixStr, 10);

  if (isNaN(prefix) || prefix < 0) return false;

  // Check if IPv6
  if (ip.includes(':') || network.includes(':')) {
    return isIPv6InCIDR(ip, network, prefix);
  }

  // IPv4
  return isIPv4InCIDR(ip, network, prefix);
}

/**
 * Check if an IPv4 address is within a CIDR range.
 */
function isIPv4InCIDR(ip: string, network: string, prefix: number): boolean {
  if (prefix > 32) return false;

  const ipParts = ip.split('.');
  const networkParts = network.split('.');

  if (ipParts.length !== 4 || networkParts.length !== 4) return false;

  const ipNum = ipParts.reduce((acc, octet) => {
    const num = parseInt(octet, 10);
    if (isNaN(num) || num < 0 || num > 255) return -1;
    return (acc << 8) + num;
  }, 0);

  const networkNum = networkParts.reduce((acc, octet) => {
    const num = parseInt(octet, 10);
    if (isNaN(num) || num < 0 || num > 255) return -1;
    return (acc << 8) + num;
  }, 0);

  if (ipNum === -1 || networkNum === -1) return false;

  // Create mask
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;

  // Check if network portions match
  return ((ipNum >>> 0) & mask) === ((networkNum >>> 0) & mask);
}

/**
 * Check if an IPv6 address is within a CIDR range.
 * Simple implementation that handles common cases.
 */
function isIPv6InCIDR(ip: string, network: string, prefix: number): boolean {
  if (prefix > 128) return false;

  try {
    const expandedIP = expandIPv6(ip);
    const expandedNetwork = expandIPv6(network);

    if (!expandedIP || !expandedNetwork) return false;

    // Convert to binary strings
    const ipBinary = ipv6ToBinary(expandedIP);
    const networkBinary = ipv6ToBinary(expandedNetwork);

    // Compare prefix bits
    return ipBinary.slice(0, prefix) === networkBinary.slice(0, prefix);
  } catch {
    return false;
  }
}

/**
 * Expand an IPv6 address to full format.
 */
function expandIPv6(ip: string): string | null {
  // Handle ::1 (loopback)
  if (ip === '::1') {
    return '0000:0000:0000:0000:0000:0000:0000:0001';
  }

  // Handle :: notation
  if (ip.includes('::')) {
    const parts = ip.split('::');
    if (parts.length > 2) return null;

    const before = parts[0] ? parts[0].split(':') : [];
    const after = parts[1] ? parts[1].split(':') : [];
    const missing = 8 - before.length - after.length;

    if (missing < 0) return null;

    const middle = new Array(missing).fill('0000');
    const full = [...before, ...middle, ...after];

    return full.map((part) => part.padStart(4, '0')).join(':');
  }

  const parts = ip.split(':');
  if (parts.length !== 8) return null;

  return parts.map((part) => part.padStart(4, '0')).join(':');
}

/**
 * Convert expanded IPv6 to binary string.
 */
function ipv6ToBinary(ip: string): string {
  return ip
    .split(':')
    .map((part) => parseInt(part, 16).toString(2).padStart(16, '0'))
    .join('');
}

/**
 * Check if an IP is in any of the whitelisted CIDRs.
 *
 * @param ip - IP address to check
 * @param whitelist - Array of CIDR notations
 * @returns true if IP is in any of the CIDRs
 */
export function isIPInWhitelist(ip: string, whitelist: string[]): boolean {
  if (!whitelist || whitelist.length === 0) return false;

  return whitelist.some((cidr) => isIPInCIDR(ip, cidr));
}

/**
 * Parse a comma-separated list of CIDR ranges.
 *
 * @param value - Comma-separated CIDR list
 * @returns Array of CIDR strings
 */
export function parseIPWhitelist(value: string | undefined | null): string[] {
  if (!value) return [];

  return value
    .split(',')
    .map((cidr) => cidr.trim())
    .filter((cidr) => cidr.length > 0);
}

/**
 * Get the client IP address from a request, handling X-Forwarded-For.
 *
 * @param request - Fastify request
 * @returns Client IP address
 */
export function getClientIP(request: FastifyRequest): string {
  // Check X-Forwarded-For header (set by proxies/load balancers)
  const forwardedFor = request.headers['x-forwarded-for'] as string | undefined;

  if (forwardedFor) {
    // X-Forwarded-For can contain multiple IPs: client, proxy1, proxy2, ...
    // The first IP is the original client
    const firstIP = forwardedFor.split(',')[0].trim();
    if (firstIP) return firstIP;
  }

  // Fall back to direct request IP
  return request.ip;
}

/**
 * Create an IP whitelist middleware for webhook endpoints.
 *
 * This middleware checks if the client IP is in the configured whitelist.
 * If not configured or disabled, it allows all requests (defense-in-depth,
 * not replacement for signature verification).
 *
 * @param config - Middleware configuration
 * @returns Fastify preHandler function
 */
export function createIPWhitelistMiddleware(
  config: IPWhitelistConfig
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const { providerName, whitelistEnvVar } = config;

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // Check if whitelisting is disabled globally
    if (process.env.WEBHOOK_IP_WHITELIST_DISABLED === 'true') {
      return;
    }

    // Get whitelist from environment
    const whitelistValue = process.env[whitelistEnvVar];
    const whitelist = parseIPWhitelist(whitelistValue);

    // If no whitelist configured, allow (rely on signature verification)
    if (whitelist.length === 0) {
      return;
    }

    // Get client IP
    const clientIP = getClientIP(request);

    // Check if IP is in whitelist
    if (isIPInWhitelist(clientIP, whitelist)) {
      return;
    }

    // Block request
    console.warn(`[${providerName}] Blocked request from IP not in whitelist`, {
      ip: clientIP,
      path: request.url,
      whitelist: whitelist.join(', '),
    });

    reply.code(403).send({ error: 'Forbidden' });
  };
}

/**
 * Pre-configured middleware for Twilio webhooks.
 */
export const twilioIPWhitelistMiddleware = createIPWhitelistMiddleware({
  providerName: 'Twilio',
  whitelistEnvVar: 'TWILIO_WEBHOOK_IP_WHITELIST',
});

/**
 * Pre-configured middleware for Postmark webhooks.
 */
export const postmarkIPWhitelistMiddleware = createIPWhitelistMiddleware({
  providerName: 'Postmark',
  whitelistEnvVar: 'POSTMARK_WEBHOOK_IP_WHITELIST',
});
