/**
 * Tests for HA provider credential parsing and refresh.
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';

describe('parseHaCredentials', () => {
  it('parses plain string as long-lived token', async () => {
    const { parseHaCredentials } = await import('@/api/geolocation/providers/home-assistant');
    const result = parseHaCredentials('my-long-lived-token');
    expect(result.accessToken).toBe('my-long-lived-token');
    expect(result.refreshToken).toBeUndefined();
    expect(result.isOAuth).toBe(false);
  });

  it('parses JSON string as OAuth credentials', async () => {
    const { parseHaCredentials } = await import('@/api/geolocation/providers/home-assistant');
    const json = JSON.stringify({
      access_token: 'oauth-access',
      refresh_token: 'oauth-refresh',
      expires_at: '2026-02-25T12:00:00Z',
      token_type: 'Bearer',
    });
    const result = parseHaCredentials(json);
    expect(result.accessToken).toBe('oauth-access');
    expect(result.refreshToken).toBe('oauth-refresh');
    expect(result.isOAuth).toBe(true);
    expect(result.expiresAt).toBeInstanceOf(Date);
  });

  it('detects expired tokens', async () => {
    const { parseHaCredentials } = await import('@/api/geolocation/providers/home-assistant');
    const json = JSON.stringify({
      access_token: 'expired',
      refresh_token: 'refresh',
      expires_at: '2020-01-01T00:00:00Z',
      token_type: 'Bearer',
    });
    const result = parseHaCredentials(json);
    expect(result.isExpired).toBe(true);
  });

  it('handles invalid JSON gracefully', async () => {
    const { parseHaCredentials } = await import('@/api/geolocation/providers/home-assistant');
    const result = parseHaCredentials('{not valid json');
    expect(result.accessToken).toBe('{not valid json');
    expect(result.isOAuth).toBe(false);
  });
});
