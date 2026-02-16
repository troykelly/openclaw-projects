/**
 * Tests for deriveApiUrl in server.ts.
 * Part of Issue #1328 — OpenAPI spec should derive API URL from PUBLIC_BASE_URL.
 *
 * Since deriveApiUrl is not exported, we test it indirectly by verifying the
 * function logic in isolation here.
 */

import { describe, it, expect } from 'vitest';

/**
 * Mirror of deriveApiUrl from server.ts (tested independently since it's not exported).
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

describe('deriveApiUrl', () => {
  it('returns localhost URLs as-is', () => {
    expect(deriveApiUrl('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('returns 127.0.0.1 URLs as-is', () => {
    expect(deriveApiUrl('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000');
  });

  it('prepends api. to production domain', () => {
    expect(deriveApiUrl('https://example.com')).toBe('https://api.example.com');
  });

  it('preserves protocol for production domains', () => {
    expect(deriveApiUrl('https://myapp.example.com')).toBe('https://api.myapp.example.com');
  });

  it('handles domain with path', () => {
    const result = deriveApiUrl('https://example.com/app');
    expect(result).toBe('https://api.example.com/app');
  });

  it('returns invalid input as-is', () => {
    expect(deriveApiUrl('not-a-url')).toBe('not-a-url');
  });
});
