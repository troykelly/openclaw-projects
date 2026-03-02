/**
 * Unit tests for HA OAuth redirect URI construction.
 * Issue #1836 — redirect URI must point to API domain, not SPA domain.
 *
 * The redirect URI logic lives inline in server.ts (route handler). We test
 * the construction logic in isolation here, mirroring the actual code path:
 *
 *   const rawBase = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
 *   const clientId = rawBase.replace(/\/+$/, '');
 *   const redirectUri = process.env.OAUTH_REDIRECT_URI
 *     || `${deriveApiUrl(rawBase).replace(/\/+$/, '')}/oauth/callback`;
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';

/**
 * Mirror of deriveApiUrl from server.ts (not exported, so tested independently).
 */
function deriveApiUrl(publicBaseUrl: string): string {
  try {
    const parsed = new URL(publicBaseUrl);
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      return publicBaseUrl;
    }
    parsed.hostname = `api.${parsed.hostname}`;
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return publicBaseUrl;
  }
}

/**
 * Mirror of the redirect URI construction from the HA OAuth authorize handler
 * in server.ts. This is the code path we're testing.
 */
function buildHaOAuthParams(publicBaseUrl: string, oauthRedirectUri?: string) {
  const rawBase = publicBaseUrl || 'http://localhost:3000';
  const clientId = rawBase.replace(/\/+$/, '');
  const redirectUri = oauthRedirectUri
    || `${deriveApiUrl(rawBase).replace(/\/+$/, '')}/oauth/callback`;
  return { clientId, redirectUri };
}

describe('HA OAuth redirect URI (Issue #1836)', () => {
  describe('production domain — redirect URI uses API domain', () => {
    it('uses api. prefix for production domain', () => {
      const { redirectUri } = buildHaOAuthParams('https://example.com');
      expect(redirectUri).toBe('https://api.example.com/oauth/callback');
    });

    it('uses api. prefix for subdomain production domain', () => {
      const { redirectUri } = buildHaOAuthParams('https://myapp.example.com');
      expect(redirectUri).toBe('https://api.myapp.example.com/oauth/callback');
    });

    it('handles trailing slash in PUBLIC_BASE_URL', () => {
      const { redirectUri } = buildHaOAuthParams('https://example.com/');
      expect(redirectUri).toBe('https://api.example.com/oauth/callback');
    });
  });

  describe('localhost — redirect URI stays same-origin', () => {
    it('keeps localhost as-is (no api. prefix)', () => {
      const { redirectUri } = buildHaOAuthParams('http://localhost:3000');
      expect(redirectUri).toBe('http://localhost:3000/oauth/callback');
    });

    it('keeps 127.0.0.1 as-is (no api. prefix)', () => {
      const { redirectUri } = buildHaOAuthParams('http://127.0.0.1:3000');
      expect(redirectUri).toBe('http://127.0.0.1:3000/oauth/callback');
    });
  });

  describe('OAUTH_REDIRECT_URI env var override', () => {
    it('uses explicit OAUTH_REDIRECT_URI when set', () => {
      const { redirectUri } = buildHaOAuthParams(
        'https://example.com',
        'https://custom.example.com/oauth/callback',
      );
      expect(redirectUri).toBe('https://custom.example.com/oauth/callback');
    });

    it('overrides even for localhost', () => {
      const { redirectUri } = buildHaOAuthParams(
        'http://localhost:3000',
        'http://localhost:4000/oauth/callback',
      );
      expect(redirectUri).toBe('http://localhost:4000/oauth/callback');
    });
  });

  describe('clientId (IndieAuth) remains as PUBLIC_BASE_URL (app domain)', () => {
    it('clientId is the app domain, NOT the API domain', () => {
      const { clientId, redirectUri } = buildHaOAuthParams('https://example.com');
      // clientId must be the SPA/app URL for IndieAuth identification
      expect(clientId).toBe('https://example.com');
      // redirectUri must be the API domain
      expect(redirectUri).toBe('https://api.example.com/oauth/callback');
      // They must differ for production domains
      expect(clientId).not.toEqual(new URL(redirectUri).origin);
    });

    it('clientId and redirectUri share origin on localhost', () => {
      const { clientId, redirectUri } = buildHaOAuthParams('http://localhost:3000');
      expect(clientId).toBe('http://localhost:3000');
      expect(redirectUri).toBe('http://localhost:3000/oauth/callback');
    });

    it('clientId strips trailing slash from PUBLIC_BASE_URL', () => {
      const { clientId } = buildHaOAuthParams('https://example.com/');
      expect(clientId).toBe('https://example.com');
    });
  });
});
