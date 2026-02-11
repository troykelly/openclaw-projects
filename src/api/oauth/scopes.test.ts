/**
 * Tests for feature-to-scope mapping.
 * Part of Issue #1050.
 */

import { describe, it, expect } from 'vitest';
import { getRequiredScopes, getMissingScopes } from './scopes.ts';

describe('getRequiredScopes', () => {
  describe('Google provider', () => {
    it('returns base scopes when no features requested', () => {
      const scopes = getRequiredScopes('google', []);
      expect(scopes).toEqual(['https://www.googleapis.com/auth/userinfo.email']);
    });

    it('returns contacts readonly scopes', () => {
      const scopes = getRequiredScopes('google', ['contacts'], 'read');
      expect(scopes).toContain('https://www.googleapis.com/auth/contacts.readonly');
      expect(scopes).toContain('https://www.googleapis.com/auth/userinfo.email');
      expect(scopes).not.toContain('https://www.googleapis.com/auth/contacts');
    });

    it('returns contacts read_write scopes', () => {
      const scopes = getRequiredScopes('google', ['contacts'], 'read_write');
      expect(scopes).toContain('https://www.googleapis.com/auth/contacts');
      expect(scopes).toContain('https://www.googleapis.com/auth/userinfo.email');
    });

    it('returns email readonly scopes', () => {
      const scopes = getRequiredScopes('google', ['email'], 'read');
      expect(scopes).toContain('https://www.googleapis.com/auth/gmail.readonly');
    });

    it('returns email read_write scopes with send', () => {
      const scopes = getRequiredScopes('google', ['email'], 'read_write');
      expect(scopes).toContain('https://www.googleapis.com/auth/gmail.readonly');
      expect(scopes).toContain('https://www.googleapis.com/auth/gmail.send');
    });

    it('returns files readonly scopes', () => {
      const scopes = getRequiredScopes('google', ['files'], 'read');
      expect(scopes).toContain('https://www.googleapis.com/auth/drive.readonly');
    });

    it('returns files read_write scopes', () => {
      const scopes = getRequiredScopes('google', ['files'], 'read_write');
      expect(scopes).toContain('https://www.googleapis.com/auth/drive.file');
    });

    it('returns calendar readonly scopes', () => {
      const scopes = getRequiredScopes('google', ['calendar'], 'read');
      expect(scopes).toContain('https://www.googleapis.com/auth/calendar.readonly');
    });

    it('returns calendar read_write scopes', () => {
      const scopes = getRequiredScopes('google', ['calendar'], 'read_write');
      expect(scopes).toContain('https://www.googleapis.com/auth/calendar');
    });

    it('combines multiple features without duplicates', () => {
      const scopes = getRequiredScopes('google', ['contacts', 'email', 'calendar'], 'read');
      expect(scopes).toContain('https://www.googleapis.com/auth/contacts.readonly');
      expect(scopes).toContain('https://www.googleapis.com/auth/gmail.readonly');
      expect(scopes).toContain('https://www.googleapis.com/auth/calendar.readonly');
      expect(scopes).toContain('https://www.googleapis.com/auth/userinfo.email');
      // No duplicates
      expect(new Set(scopes).size).toBe(scopes.length);
    });

    it('defaults to read permission level', () => {
      const scopes = getRequiredScopes('google', ['contacts']);
      expect(scopes).toContain('https://www.googleapis.com/auth/contacts.readonly');
      expect(scopes).not.toContain('https://www.googleapis.com/auth/contacts');
    });
  });

  describe('Microsoft provider', () => {
    it('returns base scopes when no features requested', () => {
      const scopes = getRequiredScopes('microsoft', []);
      expect(scopes).toContain('https://graph.microsoft.com/User.Read');
      expect(scopes).toContain('offline_access');
    });

    it('returns contacts readonly scopes', () => {
      const scopes = getRequiredScopes('microsoft', ['contacts'], 'read');
      expect(scopes).toContain('https://graph.microsoft.com/Contacts.Read');
      expect(scopes).not.toContain('https://graph.microsoft.com/Contacts.ReadWrite');
    });

    it('returns contacts read_write scopes', () => {
      const scopes = getRequiredScopes('microsoft', ['contacts'], 'read_write');
      expect(scopes).toContain('https://graph.microsoft.com/Contacts.ReadWrite');
    });

    it('returns email readonly scopes', () => {
      const scopes = getRequiredScopes('microsoft', ['email'], 'read');
      expect(scopes).toContain('https://graph.microsoft.com/Mail.Read');
    });

    it('returns email read_write scopes', () => {
      const scopes = getRequiredScopes('microsoft', ['email'], 'read_write');
      expect(scopes).toContain('https://graph.microsoft.com/Mail.ReadWrite');
    });

    it('returns files readonly scopes', () => {
      const scopes = getRequiredScopes('microsoft', ['files'], 'read');
      expect(scopes).toContain('https://graph.microsoft.com/Files.Read');
    });

    it('returns files read_write scopes', () => {
      const scopes = getRequiredScopes('microsoft', ['files'], 'read_write');
      expect(scopes).toContain('https://graph.microsoft.com/Files.ReadWrite');
    });

    it('returns calendar readonly scopes', () => {
      const scopes = getRequiredScopes('microsoft', ['calendar'], 'read');
      expect(scopes).toContain('https://graph.microsoft.com/Calendars.Read');
    });

    it('returns calendar read_write scopes', () => {
      const scopes = getRequiredScopes('microsoft', ['calendar'], 'read_write');
      expect(scopes).toContain('https://graph.microsoft.com/Calendars.ReadWrite');
    });

    it('combines multiple features with base scopes', () => {
      const scopes = getRequiredScopes('microsoft', ['contacts', 'email', 'files', 'calendar'], 'read');
      expect(scopes).toContain('https://graph.microsoft.com/User.Read');
      expect(scopes).toContain('offline_access');
      expect(scopes).toContain('https://graph.microsoft.com/Contacts.Read');
      expect(scopes).toContain('https://graph.microsoft.com/Mail.Read');
      expect(scopes).toContain('https://graph.microsoft.com/Files.Read');
      expect(scopes).toContain('https://graph.microsoft.com/Calendars.Read');
      expect(new Set(scopes).size).toBe(scopes.length);
    });
  });
});

describe('getMissingScopes', () => {
  it('returns empty array when all scopes are present', () => {
    const current = ['scope-a', 'scope-b', 'scope-c'];
    const required = ['scope-a', 'scope-b'];
    expect(getMissingScopes(current, required)).toEqual([]);
  });

  it('returns scopes that are not in current set', () => {
    const current = ['scope-a'];
    const required = ['scope-a', 'scope-b', 'scope-c'];
    expect(getMissingScopes(current, required)).toEqual(['scope-b', 'scope-c']);
  });

  it('returns all required scopes when current is empty', () => {
    const required = ['scope-a', 'scope-b'];
    expect(getMissingScopes([], required)).toEqual(['scope-a', 'scope-b']);
  });

  it('returns empty array when both are empty', () => {
    expect(getMissingScopes([], [])).toEqual([]);
  });
});
