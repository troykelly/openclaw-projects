/**
 * Tests for reAuthUrl validation — issues #1619, #1623, #1624.
 *
 * #1619: Basic allowlist + scheme validation
 * #1623: Provider-scoped hostname validation (Google URL rejected for Microsoft)
 * #1624: Non-default port rejection, userinfo, trailing-dot, whitespace edge cases
 */
import { describe, it, expect } from 'vitest';
import { validateReAuthUrl, validateReAuthUrlForProvider } from '@/ui/lib/validation';

// ---------------------------------------------------------------------------
// validateReAuthUrl (backwards-compatible global allowlist)
// ---------------------------------------------------------------------------

describe('validateReAuthUrl', () => {
  // Valid URLs
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

  // Rejected: wrong scheme
  it('rejects javascript: URL', () => {
    expect(validateReAuthUrl('javascript:alert(document.cookie)')).toBeNull();
  });

  it('rejects data: URL', () => {
    expect(validateReAuthUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('rejects http: URL (non-TLS)', () => {
    expect(validateReAuthUrl('http://accounts.google.com/o/oauth2/auth')).toBeNull();
  });

  it('rejects vbscript: URL', () => {
    expect(validateReAuthUrl('vbscript:MsgBox(1)')).toBeNull();
  });

  // Rejected: wrong domain
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

  // Rejected: malformed / empty
  it('rejects a malformed URL (throws on parse)', () => {
    expect(validateReAuthUrl('not a url at all')).toBeNull();
  });

  it('rejects an empty string', () => {
    expect(validateReAuthUrl('')).toBeNull();
  });

  it('rejects a bare path', () => {
    expect(validateReAuthUrl('/api/oauth/authorize/google')).toBeNull();
  });

  // #1624: Non-default port
  it('rejects URL with non-default port', () => {
    expect(validateReAuthUrl('https://accounts.google.com:444/o/oauth2/auth')).toBeNull();
  });

  it('rejects URL with port 8443', () => {
    expect(validateReAuthUrl('https://login.microsoftonline.com:8443/auth')).toBeNull();
  });

  // #1624: Userinfo
  it('rejects URL with userinfo (username)', () => {
    expect(validateReAuthUrl('https://user@accounts.google.com/o/oauth2/auth')).toBeNull();
  });

  it('rejects URL with userinfo (username:password)', () => {
    expect(validateReAuthUrl('https://user:pass@login.microsoftonline.com/auth')).toBeNull();
  });

  // #1624: Trailing-dot hostname
  it('accepts trailing-dot hostname by normalising it', () => {
    const url = 'https://accounts.google.com./o/oauth2/auth';
    // URL constructor normalises trailing dot — result should still validate
    const result = validateReAuthUrl(url);
    expect(result).not.toBeNull();
  });

  // #1624: Whitespace
  it('trims leading whitespace and validates', () => {
    const url = '  https://accounts.google.com/o/oauth2/auth';
    expect(validateReAuthUrl(url)).not.toBeNull();
  });

  it('trims trailing whitespace and validates', () => {
    const url = 'https://accounts.google.com/o/oauth2/auth  ';
    expect(validateReAuthUrl(url)).not.toBeNull();
  });

  it('trims surrounding whitespace and validates', () => {
    const url = '  https://login.live.com/oauth20_authorize.srf  ';
    expect(validateReAuthUrl(url)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateReAuthUrlForProvider (provider-scoped validation — #1623)
// ---------------------------------------------------------------------------

describe('validateReAuthUrlForProvider', () => {
  // Valid: correct provider
  it('accepts Google URL for google provider', () => {
    const url = 'https://accounts.google.com/o/oauth2/auth?scope=email';
    expect(validateReAuthUrlForProvider(url, 'google')).toBe(url);
  });

  it('accepts login.microsoftonline.com URL for microsoft provider', () => {
    const url = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?scope=openid';
    expect(validateReAuthUrlForProvider(url, 'microsoft')).toBe(url);
  });

  it('accepts login.live.com URL for microsoft provider', () => {
    const url = 'https://login.live.com/oauth20_authorize.srf?client_id=abc';
    expect(validateReAuthUrlForProvider(url, 'microsoft')).toBe(url);
  });

  // #1623: Cross-provider rejection
  it('rejects Google URL for microsoft provider', () => {
    const url = 'https://accounts.google.com/o/oauth2/auth?scope=email';
    expect(validateReAuthUrlForProvider(url, 'microsoft')).toBeNull();
  });

  it('rejects Microsoft URL for google provider', () => {
    const url = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
    expect(validateReAuthUrlForProvider(url, 'google')).toBeNull();
  });

  it('rejects login.live.com URL for google provider', () => {
    const url = 'https://login.live.com/oauth20_authorize.srf';
    expect(validateReAuthUrlForProvider(url, 'google')).toBeNull();
  });

  // Unknown provider
  it('rejects any URL for unknown provider', () => {
    const url = 'https://accounts.google.com/o/oauth2/auth';
    expect(validateReAuthUrlForProvider(url, 'github')).toBeNull();
  });

  // Scheme checks
  it('rejects http: URL', () => {
    expect(validateReAuthUrlForProvider('http://accounts.google.com/auth', 'google')).toBeNull();
  });

  it('rejects javascript: URL', () => {
    expect(validateReAuthUrlForProvider('javascript:alert(1)', 'google')).toBeNull();
  });

  // #1624: Non-default port
  it('rejects URL with non-default port', () => {
    expect(validateReAuthUrlForProvider('https://accounts.google.com:444/auth', 'google')).toBeNull();
  });

  it('rejects Microsoft URL with non-default port', () => {
    expect(validateReAuthUrlForProvider('https://login.microsoftonline.com:8443/auth', 'microsoft')).toBeNull();
  });

  // #1624: Userinfo
  it('rejects URL with userinfo', () => {
    expect(validateReAuthUrlForProvider('https://user@accounts.google.com/auth', 'google')).toBeNull();
  });

  it('rejects URL with username:password', () => {
    expect(validateReAuthUrlForProvider('https://user:pass@login.live.com/auth', 'microsoft')).toBeNull();
  });

  // #1624: Trailing-dot hostname
  it('normalises trailing-dot hostname and accepts', () => {
    const url = 'https://accounts.google.com./o/oauth2/auth';
    expect(validateReAuthUrlForProvider(url, 'google')).not.toBeNull();
  });

  // #1624: Whitespace
  it('trims whitespace before parsing', () => {
    const url = '  https://accounts.google.com/o/oauth2/auth  ';
    expect(validateReAuthUrlForProvider(url, 'google')).not.toBeNull();
  });

  // Empty / malformed
  it('rejects empty string', () => {
    expect(validateReAuthUrlForProvider('', 'google')).toBeNull();
  });

  it('rejects malformed URL', () => {
    expect(validateReAuthUrlForProvider('not a url', 'google')).toBeNull();
  });

  // Off-domain
  it('rejects unknown domain for google', () => {
    expect(validateReAuthUrlForProvider('https://evil.example.com/auth', 'google')).toBeNull();
  });

  it('rejects unknown domain for microsoft', () => {
    expect(validateReAuthUrlForProvider('https://evil.example.com/auth', 'microsoft')).toBeNull();
  });
});
