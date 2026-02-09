import { describe, it, expect } from 'vitest';
import { validateSsrf, redactWebhookHeaders, isAbsoluteUrl } from '../src/api/webhooks/ssrf.ts';

/**
 * Tests for SSRF protection and credential redaction utilities (Issue #823).
 */
describe('SSRF Protection (Issue #823)', () => {
  describe('validateSsrf', () => {
    describe('allows legitimate external URLs', () => {
      const allowedUrls = [
        'https://example.com/hook',
        'https://api.stripe.com/v1/webhooks',
        'https://hooks.slack.com/services/xxx',
        'http://203.0.113.1/callback', // TEST-NET, but public
        'https://8.8.8.8/dns',
        'https://subdomain.example.org:8443/path',
      ];

      for (const url of allowedUrls) {
        it(`allows ${url}`, () => {
          expect(validateSsrf(url)).toBeNull();
        });
      }
    });

    describe('blocks loopback addresses', () => {
      const blocked = ['http://127.0.0.1/secret', 'http://127.0.0.2/secret', 'http://127.255.255.255/secret', 'https://[::1]/secret'];

      for (const url of blocked) {
        it(`blocks ${url}`, () => {
          const result = validateSsrf(url);
          expect(result).not.toBeNull();
          expect(result).toContain('loopback');
        });
      }
    });

    describe('blocks private IP ranges', () => {
      const blocked = [
        { url: 'http://10.0.0.1/internal', label: '10/8' },
        { url: 'http://10.255.255.255/internal', label: '10/8' },
        { url: 'http://172.16.0.1/internal', label: '172.16/12' },
        { url: 'http://172.31.255.255/internal', label: '172.16/12' },
        { url: 'http://192.168.0.1/internal', label: '192.168/16' },
        { url: 'http://192.168.255.255/internal', label: '192.168/16' },
      ];

      for (const { url, label } of blocked) {
        it(`blocks ${url} (${label})`, () => {
          const result = validateSsrf(url);
          expect(result).not.toBeNull();
          expect(result).toContain('private');
        });
      }
    });

    describe('blocks link-local and metadata endpoints', () => {
      it('blocks 169.254.169.254 (cloud metadata)', () => {
        const result = validateSsrf('http://169.254.169.254/latest/meta-data/');
        expect(result).not.toBeNull();
        expect(result).toContain('link-local');
      });

      it('blocks 169.254.0.1', () => {
        const result = validateSsrf('http://169.254.0.1/');
        expect(result).not.toBeNull();
        expect(result).toContain('link-local');
      });
    });

    describe('blocks known internal hostnames', () => {
      const blocked = [
        'http://localhost/secret',
        'http://localhost:3000/api',
        'https://localhost.localdomain/api',
        'http://metadata.google.internal/computeMetadata/v1/',
        'http://metadata.google/computeMetadata/v1/',
      ];

      for (const url of blocked) {
        it(`blocks ${url}`, () => {
          const result = validateSsrf(url);
          expect(result).not.toBeNull();
          expect(result).toContain('blocked hostname');
        });
      }
    });

    describe('blocks hostname suffixes', () => {
      const blocked = ['http://service.internal/api', 'http://app.local/api', 'http://host.localhost/api'];

      for (const url of blocked) {
        it(`blocks ${url}`, () => {
          const result = validateSsrf(url);
          expect(result).not.toBeNull();
          expect(result).toContain('blocked hostname');
        });
      }
    });

    describe('blocks IPv6 private addresses', () => {
      it('blocks IPv6 unique local (fc00::/7)', () => {
        const result = validateSsrf('http://[fc00::1]/api');
        expect(result).not.toBeNull();
        expect(result).toContain('private');
      });

      it('blocks IPv6 unique local (fd prefix)', () => {
        const result = validateSsrf('http://[fd12:3456::1]/api');
        expect(result).not.toBeNull();
        expect(result).toContain('private');
      });

      it('blocks IPv6 link-local (fe80::/10)', () => {
        const result = validateSsrf('http://[fe80::1]/api');
        expect(result).not.toBeNull();
        expect(result).toContain('link-local');
      });
    });

    describe('blocks IPv4-mapped IPv6 addresses', () => {
      it('blocks ::ffff:127.0.0.1 (loopback)', () => {
        const result = validateSsrf('http://[::ffff:127.0.0.1]/secret');
        expect(result).not.toBeNull();
        expect(result).toContain('loopback');
      });

      it('blocks ::ffff:10.0.0.1 (private)', () => {
        const result = validateSsrf('http://[::ffff:10.0.0.1]/api');
        expect(result).not.toBeNull();
        expect(result).toContain('private');
      });

      it('blocks ::ffff:192.168.1.1 (private)', () => {
        const result = validateSsrf('http://[::ffff:192.168.1.1]/api');
        expect(result).not.toBeNull();
        expect(result).toContain('private');
      });

      it('blocks ::ffff:169.254.169.254 (link-local/metadata)', () => {
        const result = validateSsrf('http://[::ffff:169.254.169.254]/');
        expect(result).not.toBeNull();
        expect(result).toContain('link-local');
      });
    });

    describe('blocks unspecified addresses', () => {
      it('blocks 0.0.0.0', () => {
        const result = validateSsrf('http://0.0.0.0/api');
        expect(result).not.toBeNull();
        expect(result).toContain('unspecified');
      });
    });

    it('rejects invalid URLs', () => {
      expect(validateSsrf('not-a-url')).toBe('Invalid URL');
    });

    it('allows non-IP hostnames that are not blocked', () => {
      expect(validateSsrf('https://my-webhook-service.com/hook')).toBeNull();
    });

    it('does not block 172.32.0.1 (outside 172.16/12 range)', () => {
      expect(validateSsrf('http://172.32.0.1/api')).toBeNull();
    });
  });

  describe('redactWebhookHeaders', () => {
    it('redacts all header values', () => {
      const headers = {
        Authorization: 'Bearer secret-token',
        'X-API-Key': 'my-api-key',
        'Content-Type': 'application/json',
      };

      const result = redactWebhookHeaders(headers);
      expect(result).toEqual({
        Authorization: '***',
        'X-API-Key': '***',
        'Content-Type': '***',
      });
    });

    it('preserves header names', () => {
      const headers = { Authorization: 'Bearer xxx', 'X-Custom': 'value' };
      const result = redactWebhookHeaders(headers);
      expect(Object.keys(result!)).toEqual(['Authorization', 'X-Custom']);
    });

    it('returns null for null input', () => {
      expect(redactWebhookHeaders(null)).toBeNull();
    });

    it('returns null for undefined input', () => {
      expect(redactWebhookHeaders(undefined)).toBeNull();
    });

    it('preserves empty string values as-is', () => {
      const headers = { 'X-Empty': '' };
      const result = redactWebhookHeaders(headers);
      expect(result).toEqual({ 'X-Empty': '' });
    });
  });

  describe('isAbsoluteUrl', () => {
    it('returns true for https:// URLs', () => {
      expect(isAbsoluteUrl('https://example.com/hook')).toBe(true);
    });

    it('returns true for http:// URLs', () => {
      expect(isAbsoluteUrl('http://example.com/hook')).toBe(true);
    });

    it('returns false for relative paths', () => {
      expect(isAbsoluteUrl('/hooks/agent')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isAbsoluteUrl('')).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(isAbsoluteUrl('HTTPS://example.com')).toBe(true);
    });
  });
});
