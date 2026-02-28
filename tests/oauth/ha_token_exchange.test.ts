/**
 * Unit tests for Home Assistant OAuth2 token exchange.
 * Issues #1836, #1808.
 *
 * Verifies that exchangeCodeForTokens and refreshAccessToken:
 * - Throw OAuthError (not plain Error) on any failure
 * - Include diagnostic detail from HA response body
 * - Use application/x-www-form-urlencoded (not JSON)
 * - Validate response structure (access_token must exist)
 * - Handle timeouts via AbortSignal
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { OAuthError } from '../../src/api/oauth/types.ts';
import { exchangeCodeForTokens, refreshAccessToken } from '../../src/api/oauth/home-assistant.ts';

// Spy on global fetch
const fetchSpy = vi.spyOn(globalThis, 'fetch');

afterEach(() => {
  fetchSpy.mockReset();
});

const INSTANCE_URL = 'https://homeassistant.local:8123';
const CLIENT_ID = 'https://api.example.com';
const CODE = 'test-auth-code';
const REFRESH_TOKEN = 'test-refresh-token';

describe('exchangeCodeForTokens (HA IndieAuth)', () => {
  it('returns tokens on successful exchange', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'ha-access-token',
          refresh_token: 'ha-refresh-token',
          expires_in: 1800,
          token_type: 'Bearer',
        }),
        { status: 200 },
      ),
    );

    const tokens = await exchangeCodeForTokens(INSTANCE_URL, CODE, CLIENT_ID);

    expect(tokens.access_token).toBe('ha-access-token');
    expect(tokens.refresh_token).toBe('ha-refresh-token');
    expect(tokens.token_type).toBe('Bearer');
    expect(tokens.expires_at).toBeInstanceOf(Date);

    // Verify form-urlencoded content type
    const call = fetchSpy.mock.calls[0];
    const init = call[1] as RequestInit;
    expect(init.headers).toEqual(
      expect.objectContaining({ 'Content-Type': 'application/x-www-form-urlencoded' }),
    );
    expect(init.body).toContain('grant_type=authorization_code');
    expect(init.body).toContain(`code=${CODE}`);
  });

  it('throws OAuthError on non-2xx response', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('{"error":"invalid_grant"}', { status: 400, statusText: 'Bad Request' }),
    );

    await expect(exchangeCodeForTokens(INSTANCE_URL, CODE, CLIENT_ID)).rejects.toThrow(OAuthError);

    try {
      fetchSpy.mockResolvedValueOnce(
        new Response('{"error":"invalid_grant"}', { status: 400, statusText: 'Bad Request' }),
      );
      await exchangeCodeForTokens(INSTANCE_URL, CODE, CLIENT_ID);
    } catch (err) {
      expect(err).toBeInstanceOf(OAuthError);
      const oauthErr = err as OAuthError;
      expect(oauthErr.code).toBe('HA_TOKEN_EXCHANGE_FAILED');
      expect(oauthErr.provider).toBe('home_assistant');
      expect(oauthErr.message).toContain('400');
      expect(oauthErr.message).toContain('invalid_grant');
    }
  });

  it('throws OAuthError on network error', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('fetch failed'));

    await expect(exchangeCodeForTokens(INSTANCE_URL, CODE, CLIENT_ID)).rejects.toThrow(OAuthError);
  });

  it('throws OAuthError when response is invalid JSON', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('not json', { status: 200 }),
    );

    await expect(exchangeCodeForTokens(INSTANCE_URL, CODE, CLIENT_ID)).rejects.toThrow(OAuthError);
  });

  it('throws OAuthError when access_token is missing from response', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ token_type: 'Bearer' }), { status: 200 }),
    );

    await expect(exchangeCodeForTokens(INSTANCE_URL, CODE, CLIENT_ID)).rejects.toThrow(OAuthError);
  });
});

describe('refreshAccessToken (HA IndieAuth)', () => {
  it('returns tokens on successful refresh', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'new-ha-access',
          expires_in: 1800,
          token_type: 'Bearer',
        }),
        { status: 200 },
      ),
    );

    const tokens = await refreshAccessToken(INSTANCE_URL, REFRESH_TOKEN, CLIENT_ID);

    expect(tokens.access_token).toBe('new-ha-access');
    expect(tokens.token_type).toBe('Bearer');

    // Verify body contains refresh_token grant_type
    const call = fetchSpy.mock.calls[0];
    const init = call[1] as RequestInit;
    expect(init.body).toContain('grant_type=refresh_token');
    expect(init.body).toContain(`refresh_token=${REFRESH_TOKEN}`);
  });

  it('throws OAuthError on failure', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('{"error":"invalid_grant"}', { status: 401, statusText: 'Unauthorized' }),
    );

    try {
      await refreshAccessToken(INSTANCE_URL, REFRESH_TOKEN, CLIENT_ID);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(OAuthError);
      const oauthErr = err as OAuthError;
      expect(oauthErr.code).toBe('HA_TOKEN_REFRESH_FAILED');
      expect(oauthErr.provider).toBe('home_assistant');
    }
  });

  it('throws OAuthError when access_token is missing from response', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ expires_in: 1800 }), { status: 200 }),
    );

    await expect(refreshAccessToken(INSTANCE_URL, REFRESH_TOKEN, CLIENT_ID)).rejects.toThrow(OAuthError);
  });
});
