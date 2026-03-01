/**
 * Unit tests for push subscription validation (#1956).
 *
 * Tests the validatePushSubscription function.
 * Pure unit tests — no database required.
 *
 * Epic #1940 — Agent Chat.
 */

import { describe, it, expect } from 'vitest';
import { validatePushSubscription } from '../../src/api/chat/push-subscription.ts';

describe('Push Subscription Validation (#1956)', () => {
  it('accepts valid subscription', () => {
    expect(validatePushSubscription({
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
      keys: {
        p256dh: 'BNz...base64',
        auth: 'abc...base64',
      },
    })).toBe(true);
  });

  it('rejects null', () => {
    expect(validatePushSubscription(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(validatePushSubscription(undefined)).toBe(false);
  });

  it('rejects non-object', () => {
    expect(validatePushSubscription('string')).toBe(false);
    expect(validatePushSubscription(123)).toBe(false);
  });

  it('rejects missing endpoint', () => {
    expect(validatePushSubscription({
      keys: { p256dh: 'a', auth: 'b' },
    })).toBe(false);
  });

  it('rejects non-https endpoint', () => {
    expect(validatePushSubscription({
      endpoint: 'http://example.com/push',
      keys: { p256dh: 'a', auth: 'b' },
    })).toBe(false);
  });

  it('rejects missing keys', () => {
    expect(validatePushSubscription({
      endpoint: 'https://example.com/push',
    })).toBe(false);
  });

  it('rejects missing p256dh key', () => {
    expect(validatePushSubscription({
      endpoint: 'https://example.com/push',
      keys: { auth: 'b' },
    })).toBe(false);
  });

  it('rejects missing auth key', () => {
    expect(validatePushSubscription({
      endpoint: 'https://example.com/push',
      keys: { p256dh: 'a' },
    })).toBe(false);
  });

  it('rejects non-string keys', () => {
    expect(validatePushSubscription({
      endpoint: 'https://example.com/push',
      keys: { p256dh: 123, auth: 'b' },
    })).toBe(false);
  });
});
