/**
 * Unit tests for Home Assistant OAuth module.
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Tests for:
// 1. buildAuthorizationUrl — correct URL construction
// 2. exchangeCodeForTokens — form-encoded POST, response parsing
// 3. refreshAccessToken — form-encoded POST with refresh_token grant

describe('HA OAuth: buildAuthorizationUrl', () => {
  it('constructs correct authorize URL with all params', async () => {
    const { buildAuthorizationUrl } = await import('@/api/oauth/home-assistant');
    const result = buildAuthorizationUrl(
      'https://ha.example.com',
      'https://myapp.example.com',
      'https://myapp.example.com/api/oauth/callback',
      'test-state-123',
    );
    expect(result.url).toBe(
      'https://ha.example.com/auth/authorize?' +
      'client_id=https%3A%2F%2Fmyapp.example.com&' +
      'redirect_uri=https%3A%2F%2Fmyapp.example.com%2Fapi%2Foauth%2Fcallback&' +
      'state=test-state-123'
    );
  });

  it('strips trailing slash from instance URL', async () => {
    const { buildAuthorizationUrl } = await import('@/api/oauth/home-assistant');
    const result = buildAuthorizationUrl(
      'https://ha.example.com/',
      'https://myapp.example.com',
      'https://myapp.example.com/api/oauth/callback',
      'state',
    );
    expect(result.url).toContain('https://ha.example.com/auth/authorize?');
  });
});

describe('HA OAuth: exchangeCodeForTokens', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('sends form-encoded POST and parses response', async () => {
    const mockResponse = {
      access_token: 'ha-access-token',
      token_type: 'Bearer',
      refresh_token: 'ha-refresh-token',
      expires_in: 1800,
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    const { exchangeCodeForTokens } = await import('@/api/oauth/home-assistant');
    const tokens = await exchangeCodeForTokens(
      'https://ha.example.com',
      'auth-code-123',
      'https://myapp.example.com',
    );

    expect(tokens.access_token).toBe('ha-access-token');
    expect(tokens.refresh_token).toBe('ha-refresh-token');
    expect(tokens.token_type).toBe('Bearer');
    expect(tokens.expires_at).toBeInstanceOf(Date);

    // Verify fetch was called with correct params
    const [url, opts] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://ha.example.com/auth/token');
    expect(opts?.method).toBe('POST');
    expect(opts?.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' });
    const body = opts?.body as string;
    expect(body).toContain('grant_type=authorization_code');
    expect(body).toContain('code=auth-code-123');
    expect(body).toContain('client_id=https%3A%2F%2Fmyapp.example.com');
  });

  it('throws on HTTP error from HA', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Forbidden', { status: 403 }),
    );

    const { exchangeCodeForTokens } = await import('@/api/oauth/home-assistant');
    await expect(
      exchangeCodeForTokens('https://ha.example.com', 'bad-code', 'https://app.com'),
    ).rejects.toThrow(/403/);
  });
});

describe('HA OAuth: refreshAccessToken', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('sends refresh_token grant and returns new tokens', async () => {
    const mockResponse = {
      access_token: 'new-access-token',
      token_type: 'Bearer',
      expires_in: 1800,
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    const { refreshAccessToken } = await import('@/api/oauth/home-assistant');
    const tokens = await refreshAccessToken(
      'https://ha.example.com',
      'old-refresh-token',
      'https://myapp.example.com',
    );

    expect(tokens.access_token).toBe('new-access-token');
    expect(tokens.expires_at).toBeInstanceOf(Date);

    const [, opts] = vi.mocked(fetch).mock.calls[0];
    const body = opts?.body as string;
    expect(body).toContain('grant_type=refresh_token');
    expect(body).toContain('refresh_token=old-refresh-token');
  });
});
