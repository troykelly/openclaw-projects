/**
 * Tests for validateReAuthUrl — issue #1619.
 *
 * Ensures only https: + known OAuth provider domains pass through,
 * blocking javascript:, data:, http:, and off-domain phishing URLs.
 */
import { describe, it, expect } from 'vitest';
import { validateReAuthUrl } from '@/ui/lib/validation';

describe('validateReAuthUrl', () => {
  // ---------------------------------------------------------------------------
  // Valid URLs
  // ---------------------------------------------------------------------------

  it('accepts a valid Google OAuth URL', () => {
    const url = 'https://accounts.google.com/o/oauth2/auth?scope=email&redirect_uri=https://example.com';
    expect(validateReAuthUrl(url)).toBe(url);
  });

  it('accepts a valid Microsoft OAuth URL (login.microsoftonline.com)', () => {
    const url = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?scope=openid';
    expect(validateReAuthUrl(url)).toBe(url);
  });

  it('accepts a valid Microsoft live login URL', () => {
    const url = 'https://login.live.com/oauth20_authorize.srf?client_id=abc';
    expect(validateReAuthUrl(url)).toBe(url);
  });

  // ---------------------------------------------------------------------------
  // Rejected: wrong scheme
  // ---------------------------------------------------------------------------

  it('rejects javascript: URL', () => {
    expect(validateReAuthUrl('javascript:alert(document.cookie)')).toBeNull();
  });

  it('rejects data: URL', () => {
    expect(validateReAuthUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('rejects http: URL (non-TLS)', () => {
    const url = 'http://accounts.google.com/o/oauth2/auth';
    expect(validateReAuthUrl(url)).toBeNull();
  });

  it('rejects vbscript: URL', () => {
    expect(validateReAuthUrl('vbscript:MsgBox(1)')).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Rejected: wrong domain
  // ---------------------------------------------------------------------------

  it('rejects unknown domain (phishing site)', () => {
    expect(validateReAuthUrl('https://evil.example.com/steal?token=abc')).toBeNull();
  });

  it('rejects subdomain spoofing (accounts.google.com.evil.com)', () => {
    expect(validateReAuthUrl('https://accounts.google.com.evil.com/auth')).toBeNull();
  });

  it('rejects prefix spoofing (fake-accounts.google.com)', () => {
    expect(validateReAuthUrl('https://fake-accounts.google.com/auth')).toBeNull();
  });

  it('rejects microsoft subdomain spoofing', () => {
    expect(validateReAuthUrl('https://login.microsoftonline.com.phish.io/auth')).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Rejected: malformed / empty
  // ---------------------------------------------------------------------------

  it('rejects a malformed URL (throws on parse)', () => {
    expect(validateReAuthUrl('not a url at all')).toBeNull();
  });

  it('rejects an empty string', () => {
    expect(validateReAuthUrl('')).toBeNull();
  });

  it('rejects a bare path', () => {
    expect(validateReAuthUrl('/api/oauth/authorize/google')).toBeNull();
  });
});
