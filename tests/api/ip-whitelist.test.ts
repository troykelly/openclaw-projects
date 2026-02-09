/**
 * Tests for webhook IP whitelist middleware.
 * Part of Epic #310, Issue #318.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  isIPInCIDR,
  isIPInWhitelist,
  parseIPWhitelist,
  getClientIP,
  createIPWhitelistMiddleware,
  type IPWhitelistConfig,
} from '../../src/api/webhooks/ip-whitelist.ts';

// Mock request
function createMockRequest(ip: string, xForwardedFor?: string): FastifyRequest {
  return {
    ip,
    headers: xForwardedFor ? { 'x-forwarded-for': xForwardedFor } : {},
    url: '/test',
  } as unknown as FastifyRequest;
}

// Mock reply
function createMockReply(): FastifyReply {
  const reply = {
    code: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  return reply as unknown as FastifyReply;
}

describe('IP Whitelist', () => {
  describe('isIPInCIDR', () => {
    it('should match exact IP address', () => {
      expect(isIPInCIDR('192.168.1.1', '192.168.1.1/32')).toBe(true);
      expect(isIPInCIDR('192.168.1.2', '192.168.1.1/32')).toBe(false);
    });

    it('should match IP in /24 subnet', () => {
      expect(isIPInCIDR('192.168.1.1', '192.168.1.0/24')).toBe(true);
      expect(isIPInCIDR('192.168.1.255', '192.168.1.0/24')).toBe(true);
      expect(isIPInCIDR('192.168.2.1', '192.168.1.0/24')).toBe(false);
    });

    it('should match IP in /16 subnet', () => {
      expect(isIPInCIDR('192.168.0.1', '192.168.0.0/16')).toBe(true);
      expect(isIPInCIDR('192.168.255.255', '192.168.0.0/16')).toBe(true);
      expect(isIPInCIDR('192.169.0.1', '192.168.0.0/16')).toBe(false);
    });

    it('should match IP in /8 subnet', () => {
      expect(isIPInCIDR('10.0.0.1', '10.0.0.0/8')).toBe(true);
      expect(isIPInCIDR('10.255.255.255', '10.0.0.0/8')).toBe(true);
      expect(isIPInCIDR('11.0.0.1', '10.0.0.0/8')).toBe(false);
    });

    it('should handle invalid CIDR notation', () => {
      expect(isIPInCIDR('192.168.1.1', 'invalid')).toBe(false);
      expect(isIPInCIDR('192.168.1.1', '192.168.1.0')).toBe(false);
      expect(isIPInCIDR('192.168.1.1', '192.168.1.0/abc')).toBe(false);
    });

    it('should handle invalid IP address', () => {
      expect(isIPInCIDR('invalid', '192.168.1.0/24')).toBe(false);
      expect(isIPInCIDR('', '192.168.1.0/24')).toBe(false);
    });

    it('should match IPv6 addresses', () => {
      expect(isIPInCIDR('::1', '::1/128')).toBe(true);
      expect(isIPInCIDR('2001:db8::1', '2001:db8::/32')).toBe(true);
      expect(isIPInCIDR('2001:db9::1', '2001:db8::/32')).toBe(false);
    });
  });

  describe('isIPInWhitelist', () => {
    it('should match IP against multiple CIDRs', () => {
      const whitelist = ['192.168.1.0/24', '10.0.0.0/8'];
      expect(isIPInWhitelist('192.168.1.100', whitelist)).toBe(true);
      expect(isIPInWhitelist('10.50.25.1', whitelist)).toBe(true);
      expect(isIPInWhitelist('172.16.0.1', whitelist)).toBe(false);
    });

    it('should return false for empty whitelist', () => {
      expect(isIPInWhitelist('192.168.1.1', [])).toBe(false);
    });

    it('should match specific IPs in whitelist', () => {
      const whitelist = ['1.2.3.4/32', '5.6.7.8/32'];
      expect(isIPInWhitelist('1.2.3.4', whitelist)).toBe(true);
      expect(isIPInWhitelist('5.6.7.8', whitelist)).toBe(true);
      expect(isIPInWhitelist('1.2.3.5', whitelist)).toBe(false);
    });
  });

  describe('parseIPWhitelist', () => {
    it('should parse comma-separated CIDR list', () => {
      const result = parseIPWhitelist('192.168.1.0/24,10.0.0.0/8');
      expect(result).toEqual(['192.168.1.0/24', '10.0.0.0/8']);
    });

    it('should trim whitespace', () => {
      const result = parseIPWhitelist('192.168.1.0/24 , 10.0.0.0/8 ');
      expect(result).toEqual(['192.168.1.0/24', '10.0.0.0/8']);
    });

    it('should filter empty entries', () => {
      const result = parseIPWhitelist('192.168.1.0/24,,10.0.0.0/8');
      expect(result).toEqual(['192.168.1.0/24', '10.0.0.0/8']);
    });

    it('should return empty array for empty string', () => {
      const result = parseIPWhitelist('');
      expect(result).toEqual([]);
    });

    it('should return empty array for null/undefined', () => {
      expect(parseIPWhitelist(null as unknown as string)).toEqual([]);
      expect(parseIPWhitelist(undefined as unknown as string)).toEqual([]);
    });
  });

  describe('getClientIP', () => {
    it('should return request.ip when no X-Forwarded-For', () => {
      const req = createMockRequest('192.168.1.1');
      expect(getClientIP(req)).toBe('192.168.1.1');
    });

    it('should return first IP from X-Forwarded-For when present', () => {
      const req = createMockRequest('127.0.0.1', '203.0.113.50, 70.41.3.18');
      expect(getClientIP(req)).toBe('203.0.113.50');
    });

    it('should trim whitespace from X-Forwarded-For', () => {
      const req = createMockRequest('127.0.0.1', '  203.0.113.50  ');
      expect(getClientIP(req)).toBe('203.0.113.50');
    });

    it('should handle single IP in X-Forwarded-For', () => {
      const req = createMockRequest('127.0.0.1', '203.0.113.50');
      expect(getClientIP(req)).toBe('203.0.113.50');
    });
  });

  describe('createIPWhitelistMiddleware', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      vi.clearAllMocks();
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should allow request when whitelist is disabled', async () => {
      process.env.WEBHOOK_IP_WHITELIST_DISABLED = 'true';
      const config: IPWhitelistConfig = {
        providerName: 'test',
        whitelistEnvVar: 'TEST_WHITELIST',
      };
      const middleware = createIPWhitelistMiddleware(config);
      const req = createMockRequest('1.2.3.4');
      const reply = createMockReply();

      await middleware(req, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('should allow request when no whitelist configured', async () => {
      delete process.env.WEBHOOK_IP_WHITELIST_DISABLED;
      delete process.env.TEST_WHITELIST;
      const config: IPWhitelistConfig = {
        providerName: 'test',
        whitelistEnvVar: 'TEST_WHITELIST',
      };
      const middleware = createIPWhitelistMiddleware(config);
      const req = createMockRequest('1.2.3.4');
      const reply = createMockReply();

      await middleware(req, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('should allow request when IP is in whitelist', async () => {
      delete process.env.WEBHOOK_IP_WHITELIST_DISABLED;
      process.env.TEST_WHITELIST = '192.168.1.0/24';
      const config: IPWhitelistConfig = {
        providerName: 'test',
        whitelistEnvVar: 'TEST_WHITELIST',
      };
      const middleware = createIPWhitelistMiddleware(config);
      const req = createMockRequest('192.168.1.100');
      const reply = createMockReply();

      await middleware(req, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('should block request when IP is not in whitelist', async () => {
      delete process.env.WEBHOOK_IP_WHITELIST_DISABLED;
      process.env.TEST_WHITELIST = '192.168.1.0/24';
      const config: IPWhitelistConfig = {
        providerName: 'test',
        whitelistEnvVar: 'TEST_WHITELIST',
      };
      const middleware = createIPWhitelistMiddleware(config);
      const req = createMockRequest('10.0.0.1');
      const reply = createMockReply();

      await middleware(req, reply);

      expect(reply.code).toHaveBeenCalledWith(403);
      expect(reply.send).toHaveBeenCalledWith({ error: 'Forbidden' });
    });

    it('should log blocked requests', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      delete process.env.WEBHOOK_IP_WHITELIST_DISABLED;
      process.env.TEST_WHITELIST = '192.168.1.0/24';
      const config: IPWhitelistConfig = {
        providerName: 'TestProvider',
        whitelistEnvVar: 'TEST_WHITELIST',
      };
      const middleware = createIPWhitelistMiddleware(config);
      const req = createMockRequest('10.0.0.1');
      const reply = createMockReply();

      await middleware(req, reply);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[TestProvider]'), expect.objectContaining({ ip: '10.0.0.1' }));
      warnSpy.mockRestore();
    });

    it('should use X-Forwarded-For when available', async () => {
      delete process.env.WEBHOOK_IP_WHITELIST_DISABLED;
      process.env.TEST_WHITELIST = '203.0.113.0/24';
      const config: IPWhitelistConfig = {
        providerName: 'test',
        whitelistEnvVar: 'TEST_WHITELIST',
      };
      const middleware = createIPWhitelistMiddleware(config);
      const req = createMockRequest('127.0.0.1', '203.0.113.50');
      const reply = createMockReply();

      await middleware(req, reply);

      // Should allow because X-Forwarded-For IP is in whitelist
      expect(reply.code).not.toHaveBeenCalled();
    });
  });
});
