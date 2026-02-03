/**
 * Tests for per-user rate limiting functionality.
 * Part of Epic #310, Issue #323.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { FastifyRequest } from 'fastify';
import {
  extractUserIdForRateLimit,
  getRateLimitConfig,
  getEndpointRateLimitCategory,
  type RateLimitCategory,
} from '../../src/api/rate-limit/per-user.ts';

// Mock request creator
function createMockRequest(options: {
  ip?: string;
  sessionEmail?: string | null;
  bearerToken?: string;
  url?: string;
  method?: string;
}): FastifyRequest {
  const { ip = '127.0.0.1', sessionEmail, bearerToken, url = '/api/test', method = 'GET' } = options;

  return {
    ip,
    url,
    method,
    headers: bearerToken ? { authorization: `Bearer ${bearerToken}` } : {},
    // Mock for session email extraction (will be called by middleware)
    _sessionEmail: sessionEmail,
  } as unknown as FastifyRequest;
}

describe('Per-User Rate Limiting', () => {
  describe('extractUserIdForRateLimit', () => {
    it('should return session email when available', async () => {
      const mockGetSessionEmail = vi.fn().mockResolvedValue('user@example.com');
      const req = createMockRequest({ ip: '192.168.1.1' });

      const userId = await extractUserIdForRateLimit(req, mockGetSessionEmail);

      expect(userId).toBe('user:user@example.com');
      expect(mockGetSessionEmail).toHaveBeenCalledWith(req);
    });

    it('should fall back to IP when no session', async () => {
      const mockGetSessionEmail = vi.fn().mockResolvedValue(null);
      const req = createMockRequest({ ip: '192.168.1.100' });

      const userId = await extractUserIdForRateLimit(req, mockGetSessionEmail);

      expect(userId).toBe('ip:192.168.1.100');
    });

    it('should handle session lookup errors gracefully', async () => {
      const mockGetSessionEmail = vi.fn().mockRejectedValue(new Error('DB error'));
      const req = createMockRequest({ ip: '10.0.0.1' });

      const userId = await extractUserIdForRateLimit(req, mockGetSessionEmail);

      expect(userId).toBe('ip:10.0.0.1');
    });

    it('should prefix user IDs to distinguish from IP keys', async () => {
      const mockGetSessionEmail = vi.fn().mockResolvedValue('admin@example.com');
      const req = createMockRequest({ ip: '127.0.0.1' });

      const userId = await extractUserIdForRateLimit(req, mockGetSessionEmail);

      expect(userId.startsWith('user:')).toBe(true);
    });
  });

  describe('getEndpointRateLimitCategory', () => {
    it('should categorize read operations', () => {
      expect(getEndpointRateLimitCategory('GET', '/api/contacts')).toBe('read');
      expect(getEndpointRateLimitCategory('GET', '/api/work-items')).toBe('read');
      expect(getEndpointRateLimitCategory('GET', '/api/memories')).toBe('read');
    });

    it('should categorize write operations', () => {
      expect(getEndpointRateLimitCategory('POST', '/api/contacts')).toBe('write');
      expect(getEndpointRateLimitCategory('PUT', '/api/work-items/123')).toBe('write');
      expect(getEndpointRateLimitCategory('PATCH', '/api/memories/456')).toBe('write');
      expect(getEndpointRateLimitCategory('DELETE', '/api/contacts/789')).toBe('write');
    });

    it('should categorize search operations', () => {
      expect(getEndpointRateLimitCategory('GET', '/api/search')).toBe('search');
      expect(getEndpointRateLimitCategory('GET', '/api/memories/search')).toBe('search');
      expect(getEndpointRateLimitCategory('POST', '/api/search/hybrid')).toBe('search');
    });

    it('should categorize message sending operations', () => {
      expect(getEndpointRateLimitCategory('POST', '/api/twilio/sms/send')).toBe('send');
      expect(getEndpointRateLimitCategory('POST', '/api/email/send')).toBe('send');
    });

    it('should categorize admin operations', () => {
      expect(getEndpointRateLimitCategory('POST', '/api/admin/users')).toBe('admin');
      expect(getEndpointRateLimitCategory('DELETE', '/api/admin/cache')).toBe('admin');
    });

    it('should categorize webhook operations', () => {
      expect(getEndpointRateLimitCategory('POST', '/api/twilio/sms')).toBe('webhook');
      expect(getEndpointRateLimitCategory('POST', '/api/postmark/inbound')).toBe('webhook');
      expect(getEndpointRateLimitCategory('POST', '/api/cloudflare/email')).toBe('webhook');
    });

    it('should default to read for health endpoints', () => {
      expect(getEndpointRateLimitCategory('GET', '/api/health')).toBe('read');
    });
  });

  describe('getRateLimitConfig', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should return default limits for read category', () => {
      const config = getRateLimitConfig('read');

      expect(config.max).toBe(100);
      expect(config.timeWindow).toBe(60000);
    });

    it('should return stricter limits for write category', () => {
      const config = getRateLimitConfig('write');

      expect(config.max).toBe(30);
      expect(config.timeWindow).toBe(60000);
    });

    it('should return moderate limits for search category', () => {
      const config = getRateLimitConfig('search');

      expect(config.max).toBe(20);
      expect(config.timeWindow).toBe(60000);
    });

    it('should return strict limits for send category', () => {
      const config = getRateLimitConfig('send');

      expect(config.max).toBe(10);
      expect(config.timeWindow).toBe(60000);
    });

    it('should return strictest limits for admin category', () => {
      const config = getRateLimitConfig('admin');

      expect(config.max).toBe(5);
      expect(config.timeWindow).toBe(60000);
    });

    it('should return higher limits for webhook category', () => {
      const config = getRateLimitConfig('webhook');

      expect(config.max).toBe(60);
      expect(config.timeWindow).toBe(60000);
    });

    it('should allow override via environment variables', () => {
      process.env.RATE_LIMIT_SEARCH_MAX = '50';
      process.env.RATE_LIMIT_SEND_MAX = '5';

      expect(getRateLimitConfig('search').max).toBe(50);
      expect(getRateLimitConfig('send').max).toBe(5);
    });

    it('should use global window override', () => {
      process.env.RATE_LIMIT_WINDOW_MS = '30000';

      const config = getRateLimitConfig('read');

      expect(config.timeWindow).toBe(30000);
    });
  });

  describe('Rate limit key generation', () => {
    it('should generate different keys for different users', async () => {
      const mockGetSessionEmail1 = vi.fn().mockResolvedValue('user1@example.com');
      const mockGetSessionEmail2 = vi.fn().mockResolvedValue('user2@example.com');

      const req1 = createMockRequest({ ip: '192.168.1.1' });
      const req2 = createMockRequest({ ip: '192.168.1.1' });

      const key1 = await extractUserIdForRateLimit(req1, mockGetSessionEmail1);
      const key2 = await extractUserIdForRateLimit(req2, mockGetSessionEmail2);

      expect(key1).not.toBe(key2);
    });

    it('should generate same key for same user from different IPs', async () => {
      const email = 'consistent@example.com';
      const mockGetSessionEmail = vi.fn().mockResolvedValue(email);

      const req1 = createMockRequest({ ip: '192.168.1.1' });
      const req2 = createMockRequest({ ip: '10.0.0.1' });

      const key1 = await extractUserIdForRateLimit(req1, mockGetSessionEmail);
      const key2 = await extractUserIdForRateLimit(req2, mockGetSessionEmail);

      expect(key1).toBe(key2);
      expect(key1).toBe(`user:${email}`);
    });

    it('should generate different keys for different IPs when unauthenticated', async () => {
      const mockGetSessionEmail = vi.fn().mockResolvedValue(null);

      const req1 = createMockRequest({ ip: '192.168.1.1' });
      const req2 = createMockRequest({ ip: '10.0.0.1' });

      const key1 = await extractUserIdForRateLimit(req1, mockGetSessionEmail);
      const key2 = await extractUserIdForRateLimit(req2, mockGetSessionEmail);

      expect(key1).not.toBe(key2);
      expect(key1).toBe('ip:192.168.1.1');
      expect(key2).toBe('ip:10.0.0.1');
    });
  });
});
