/**
 * Unit tests for src/instrument.ts — Sentry SDK preload module (#1999).
 *
 * Tests:
 * - No-op when SENTRY_DSN is unset
 * - Sentry.init() called with correct config when DSN is set
 * - PII scrubbing strips sensitive fields
 * - closeSentry() calls Sentry.close()
 *
 * Epic #1998 — GlitchTip/Sentry Error Tracking Integration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Event, Breadcrumb } from '@sentry/node';

/**
 * We test the PII scrubbing functions directly (exported from instrument.ts)
 * and mock Sentry.init / Sentry.close for initialization tests.
 */

// Mock @sentry/node before importing instrument helpers
const mockInit = vi.fn();
const mockClose = vi.fn().mockResolvedValue(true);

vi.mock('@sentry/node', () => ({
  init: (...args: unknown[]) => mockInit(...args),
  close: (...args: unknown[]) => mockClose(...args),
}));

// Import the testable functions from instrument module
// These are imported AFTER the mock is set up
import {
  scrubPii,
  scrubBreadcrumbs,
  initSentry,
  closeSentry,
  _resetForTesting,
} from '../../../src/instrument.ts';

describe('Sentry Instrument Module (#1999)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetForTesting();
  });

  afterEach(() => {
    // Restore env vars
    delete process.env.SENTRY_DSN;
    delete process.env.SENTRY_ENVIRONMENT;
    delete process.env.SENTRY_RELEASE;
    delete process.env.SENTRY_TRACES_SAMPLE_RATE;
    delete process.env.SENTRY_SAMPLE_RATE;
    delete process.env.SENTRY_DEBUG;
    delete process.env.SENTRY_SERVER_NAME;
  });

  describe('initSentry()', () => {
    it('is a no-op when SENTRY_DSN is unset', () => {
      delete process.env.SENTRY_DSN;
      initSentry();
      expect(mockInit).not.toHaveBeenCalled();
    });

    it('is a no-op when SENTRY_DSN is empty string', () => {
      process.env.SENTRY_DSN = '';
      initSentry();
      expect(mockInit).not.toHaveBeenCalled();
    });

    it('calls Sentry.init() with correct config when DSN is set', () => {
      process.env.SENTRY_DSN = 'https://key@glitchtip.example.com/1';
      process.env.SENTRY_ENVIRONMENT = 'production';
      process.env.SENTRY_RELEASE = 'v1.2.3';
      process.env.SENTRY_TRACES_SAMPLE_RATE = '0.5';
      process.env.SENTRY_SAMPLE_RATE = '0.8';
      process.env.SENTRY_SERVER_NAME = 'api';

      initSentry();

      expect(mockInit).toHaveBeenCalledTimes(1);
      const config = mockInit.mock.calls[0][0];

      expect(config.dsn).toBe('https://key@glitchtip.example.com/1');
      expect(config.environment).toBe('production');
      expect(config.release).toBe('v1.2.3');
      expect(config.tracesSampleRate).toBe(0.5);
      expect(config.sampleRate).toBe(0.8);
      expect(config.serverName).toBe('api');
      expect(config.debug).toBe(false);
    });

    it('uses default environment "development" when not set', () => {
      process.env.SENTRY_DSN = 'https://key@glitchtip.example.com/1';

      initSentry();

      const config = mockInit.mock.calls[0][0];
      expect(config.environment).toBe('development');
    });

    it('uses default sample rates when not set', () => {
      process.env.SENTRY_DSN = 'https://key@glitchtip.example.com/1';

      initSentry();

      const config = mockInit.mock.calls[0][0];
      expect(config.tracesSampleRate).toBe(0.1);
      expect(config.sampleRate).toBe(1.0);
    });

    it('auto-detects release from package.json version when SENTRY_RELEASE is unset', () => {
      process.env.SENTRY_DSN = 'https://key@glitchtip.example.com/1';
      delete process.env.SENTRY_RELEASE;

      initSentry();

      const config = mockInit.mock.calls[0][0];
      // Should be a string (the package.json version)
      expect(typeof config.release).toBe('string');
      expect(config.release).toBeTruthy();
    });

    it('sets debug: true when SENTRY_DEBUG=true', () => {
      process.env.SENTRY_DSN = 'https://key@glitchtip.example.com/1';
      process.env.SENTRY_DEBUG = 'true';

      initSentry();

      const config = mockInit.mock.calls[0][0];
      expect(config.debug).toBe(true);
    });

    it('does not set sendDefaultPii to true', () => {
      process.env.SENTRY_DSN = 'https://key@glitchtip.example.com/1';

      initSentry();

      const config = mockInit.mock.calls[0][0];
      // sendDefaultPii should be explicitly false or not set (defaults to false)
      expect(config.sendDefaultPii).not.toBe(true);
    });

    it('includes beforeSend and beforeSendTransaction hooks', () => {
      process.env.SENTRY_DSN = 'https://key@glitchtip.example.com/1';

      initSentry();

      const config = mockInit.mock.calls[0][0];
      expect(typeof config.beforeSend).toBe('function');
      expect(typeof config.beforeSendTransaction).toBe('function');
    });

    it('does not set serverName when SENTRY_SERVER_NAME is unset', () => {
      process.env.SENTRY_DSN = 'https://key@glitchtip.example.com/1';
      delete process.env.SENTRY_SERVER_NAME;

      initSentry();

      const config = mockInit.mock.calls[0][0];
      expect(config.serverName).toBeUndefined();
    });

    it('prevents double initialization', () => {
      process.env.SENTRY_DSN = 'https://key@glitchtip.example.com/1';

      initSentry();
      initSentry();

      expect(mockInit).toHaveBeenCalledTimes(1);
    });

    it('falls back to default sample rates when env values are invalid', () => {
      process.env.SENTRY_DSN = 'https://key@glitchtip.example.com/1';
      process.env.SENTRY_TRACES_SAMPLE_RATE = 'not-a-number';
      process.env.SENTRY_SAMPLE_RATE = '2.5'; // out of range

      initSentry();

      const config = mockInit.mock.calls[0][0];
      expect(config.tracesSampleRate).toBe(0.1);
      expect(config.sampleRate).toBe(1.0);
    });

    it('falls back to default when sample rate is negative', () => {
      process.env.SENTRY_DSN = 'https://key@glitchtip.example.com/1';
      process.env.SENTRY_TRACES_SAMPLE_RATE = '-0.5';

      initSentry();

      const config = mockInit.mock.calls[0][0];
      expect(config.tracesSampleRate).toBe(0.1);
    });
  });

  describe('closeSentry()', () => {
    it('calls Sentry.close(5000)', async () => {
      await closeSentry();
      expect(mockClose).toHaveBeenCalledWith(5000);
    });
  });

  describe('scrubPii()', () => {
    it('strips Authorization header values from request data', () => {
      const event: Event = {
        request: {
          headers: {
            Authorization: 'Bearer secret-token-value',
            'Content-Type': 'application/json',
          },
        },
      };

      const result = scrubPii(event);
      expect(result?.request?.headers?.Authorization).toBe('[Filtered]');
      expect(result?.request?.headers?.['Content-Type']).toBe('application/json');
    });

    it('strips Cookie header values from request data', () => {
      const event: Event = {
        request: {
          headers: {
            Cookie: 'session=abc123; refresh=xyz789',
          },
        },
      };

      const result = scrubPii(event);
      expect(result?.request?.headers?.Cookie).toBe('[Filtered]');
    });

    it('strips Set-Cookie header values from request data', () => {
      const event: Event = {
        request: {
          headers: {
            'Set-Cookie': 'session=abc123; HttpOnly',
          },
        },
      };

      const result = scrubPii(event);
      expect(result?.request?.headers?.['Set-Cookie']).toBe('[Filtered]');
    });

    it('is case-insensitive for header names', () => {
      const event: Event = {
        request: {
          headers: {
            authorization: 'Bearer secret',
            cookie: 'session=abc',
            'set-cookie': 'token=xyz',
          },
        },
      };

      const result = scrubPii(event);
      expect(result?.request?.headers?.authorization).toBe('[Filtered]');
      expect(result?.request?.headers?.cookie).toBe('[Filtered]');
      expect(result?.request?.headers?.['set-cookie']).toBe('[Filtered]');
    });

    it('strips query parameters containing token, key, secret, code', () => {
      const event: Event = {
        request: {
          query_string: 'token=abc123&api_key=secret&secret=hidden&code=xyz&page=1',
        },
      };

      const result = scrubPii(event);
      const qs = result?.request?.query_string as string;
      expect(qs).toContain('token=[Filtered]');
      expect(qs).toContain('api_key=[Filtered]');
      expect(qs).toContain('secret=[Filtered]');
      expect(qs).toContain('code=[Filtered]');
      expect(qs).toContain('page=1');
    });

    it('strips request body fields named password, token, secret, refresh_token', () => {
      const event: Event = {
        request: {
          data: {
            username: 'john',
            password: 'my-secret-password',
            token: 'auth-token',
            secret: 'api-secret',
            refresh_token: 'refresh-value',
          },
        },
      };

      const result = scrubPii(event);
      const data = result?.request?.data as Record<string, string>;
      expect(data.username).toBe('john');
      expect(data.password).toBe('[Filtered]');
      expect(data.token).toBe('[Filtered]');
      expect(data.secret).toBe('[Filtered]');
      expect(data.refresh_token).toBe('[Filtered]');
    });

    it('returns the event unchanged when no request data exists', () => {
      const event: Event = {
        message: 'Test error',
      };

      const result = scrubPii(event);
      expect(result).toEqual(event);
    });

    it('handles null event by returning null', () => {
      const result = scrubPii(null);
      expect(result).toBeNull();
    });
  });

  describe('scrubBreadcrumbs()', () => {
    it('redacts email message bodies from breadcrumbs', () => {
      const event: Event = {
        breadcrumbs: [
          {
            category: 'email',
            message: 'Dear user, your password reset code is 123456',
            data: {
              body: 'Here is your sensitive email body content',
            },
          },
          {
            category: 'http',
            message: 'GET /api/health',
          },
        ],
      };

      const result = scrubBreadcrumbs(event);
      const crumbs = result?.breadcrumbs as Breadcrumb[];
      expect(crumbs[0].message).toBe('[Filtered]');
      expect(crumbs[0].data?.body).toBe('[Filtered]');
      // Non-sensitive breadcrumbs are preserved
      expect(crumbs[1].message).toBe('GET /api/health');
    });

    it('redacts SMS message bodies from breadcrumbs', () => {
      const event: Event = {
        breadcrumbs: [
          {
            category: 'sms',
            message: 'Your verification code is 654321',
            data: {
              body: 'Sensitive SMS content',
            },
          },
        ],
      };

      const result = scrubBreadcrumbs(event);
      const crumbs = result?.breadcrumbs as Breadcrumb[];
      expect(crumbs[0].message).toBe('[Filtered]');
      expect(crumbs[0].data?.body).toBe('[Filtered]');
    });

    it('redacts message breadcrumbs (generic messaging)', () => {
      const event: Event = {
        breadcrumbs: [
          {
            category: 'message',
            message: 'User sent: Hello, here is private info',
          },
        ],
      };

      const result = scrubBreadcrumbs(event);
      const crumbs = result?.breadcrumbs as Breadcrumb[];
      expect(crumbs[0].message).toBe('[Filtered]');
    });

    it('returns the event unchanged when no breadcrumbs exist', () => {
      const event: Event = { message: 'No breadcrumbs here' };
      const result = scrubBreadcrumbs(event);
      expect(result).toEqual(event);
    });

    it('handles null event by returning null', () => {
      const result = scrubBreadcrumbs(null);
      expect(result).toBeNull();
    });
  });
});
