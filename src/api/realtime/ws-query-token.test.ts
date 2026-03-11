/**
 * Unit tests for WebSocket query-string token extraction.
 * Issue #2404: req.query is undefined in @fastify/websocket handlers.
 */

import { describe, it, expect } from 'vitest';
import { extractWsQueryToken } from './ws-query-token.ts';

describe('extractWsQueryToken (Issue #2404)', () => {
  it('extracts token from a URL with query params', () => {
    const req = { url: '/yjs/some-note-id?token=abc123' };
    expect(extractWsQueryToken(req)).toBe('abc123');
  });

  it('extracts token when multiple query params exist', () => {
    const req = { url: '/yjs/some-note-id?foo=bar&token=jwt-here&baz=qux' };
    expect(extractWsQueryToken(req)).toBe('jwt-here');
  });

  it('returns null when token param is missing', () => {
    const req = { url: '/yjs/some-note-id?foo=bar' };
    expect(extractWsQueryToken(req)).toBeNull();
  });

  it('returns null when no query string present', () => {
    const req = { url: '/yjs/some-note-id' };
    expect(extractWsQueryToken(req)).toBeNull();
  });

  it('returns null when url is undefined', () => {
    const req = { url: undefined };
    expect(extractWsQueryToken(req)).toBeNull();
  });

  it('returns empty string for empty token value', () => {
    const req = { url: '/yjs/some-note-id?token=' };
    expect(extractWsQueryToken(req)).toBe('');
  });

  it('handles URL-encoded token values', () => {
    const req = { url: '/ws?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.test' };
    expect(extractWsQueryToken(req)).toBe('eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.test');
  });

  it('handles token with special characters (base64url)', () => {
    const encoded = encodeURIComponent('abc+def/ghi=');
    const req = { url: `/yjs/id?token=${encoded}` };
    expect(extractWsQueryToken(req)).toBe('abc+def/ghi=');
  });
});
