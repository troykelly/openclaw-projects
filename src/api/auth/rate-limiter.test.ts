import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { consumeRateLimit, exchangeRateLimit, refreshRateLimit, requestLinkRateLimit, revokeRateLimit } from './rate-limiter.ts';

/** Creates a minimal mock Fastify request with the given IP and optional body. */
function mockRequest(ip: string, body?: Record<string, unknown>): FastifyRequest {
  return { ip, body: body ?? null } as unknown as FastifyRequest;
}

describe('Auth rate limiter configurations', () => {
  describe('requestLinkRateLimit', () => {
    it('should allow 5 requests per 15 minutes', () => {
      const config = requestLinkRateLimit();
      expect(config.max).toBe(5);
      expect(config.timeWindow).toBe('15 minutes');
    });

    it('should key by IP + email', () => {
      const config = requestLinkRateLimit();
      const req = mockRequest('192.168.1.1', { email: 'User@Example.Com' });
      const key = config.keyGenerator(req);

      expect(key).toBe('auth:request-link:192.168.1.1:user@example.com');
    });

    it('should normalize email to lowercase and trim', () => {
      const config = requestLinkRateLimit();
      const req = mockRequest('10.0.0.1', { email: '  Admin@Test.IO  ' });
      const key = config.keyGenerator(req);

      expect(key).toBe('auth:request-link:10.0.0.1:admin@test.io');
    });

    it('should use "unknown" when no email is provided', () => {
      const config = requestLinkRateLimit();
      const req = mockRequest('10.0.0.1', {});
      const key = config.keyGenerator(req);

      expect(key).toBe('auth:request-link:10.0.0.1:unknown');
    });

    it('should use "unknown" when body is null', () => {
      const config = requestLinkRateLimit();
      const req = mockRequest('10.0.0.1');
      const key = config.keyGenerator(req);

      expect(key).toBe('auth:request-link:10.0.0.1:unknown');
    });

    it('should produce different keys for different IPs with same email', () => {
      const config = requestLinkRateLimit();
      const req1 = mockRequest('10.0.0.1', { email: 'user@test.com' });
      const req2 = mockRequest('10.0.0.2', { email: 'user@test.com' });

      expect(config.keyGenerator(req1)).not.toBe(config.keyGenerator(req2));
    });

    it('should produce different keys for same IP with different emails', () => {
      const config = requestLinkRateLimit();
      const req1 = mockRequest('10.0.0.1', { email: 'a@test.com' });
      const req2 = mockRequest('10.0.0.1', { email: 'b@test.com' });

      expect(config.keyGenerator(req1)).not.toBe(config.keyGenerator(req2));
    });
  });

  describe('consumeRateLimit', () => {
    it('should allow 10 requests per 15 minutes', () => {
      const config = consumeRateLimit();
      expect(config.max).toBe(10);
      expect(config.timeWindow).toBe('15 minutes');
    });

    it('should key by IP only', () => {
      const config = consumeRateLimit();
      const req = mockRequest('192.168.1.1', { token: 'some-token' });
      const key = config.keyGenerator(req);

      expect(key).toBe('auth:consume:192.168.1.1');
    });
  });

  describe('refreshRateLimit', () => {
    it('should allow 30 requests per 1 minute', () => {
      const config = refreshRateLimit();
      expect(config.max).toBe(30);
      expect(config.timeWindow).toBe('1 minute');
    });

    it('should key by IP only', () => {
      const config = refreshRateLimit();
      const req = mockRequest('10.0.0.5');
      const key = config.keyGenerator(req);

      expect(key).toBe('auth:refresh:10.0.0.5');
    });
  });

  describe('revokeRateLimit', () => {
    it('should allow 10 requests per 1 minute', () => {
      const config = revokeRateLimit();
      expect(config.max).toBe(10);
      expect(config.timeWindow).toBe('1 minute');
    });

    it('should key by IP only', () => {
      const config = revokeRateLimit();
      const req = mockRequest('172.16.0.1');
      const key = config.keyGenerator(req);

      expect(key).toBe('auth:revoke:172.16.0.1');
    });
  });

  describe('exchangeRateLimit', () => {
    it('should allow 10 requests per 1 minute', () => {
      const config = exchangeRateLimit();
      expect(config.max).toBe(10);
      expect(config.timeWindow).toBe('1 minute');
    });

    it('should key by IP only', () => {
      const config = exchangeRateLimit();
      const req = mockRequest('10.0.0.99', { code: 'auth-code' });
      const key = config.keyGenerator(req);

      expect(key).toBe('auth:exchange:10.0.0.99');
    });
  });
});
