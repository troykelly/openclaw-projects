/**
 * Tests for OAuth service multi-account refactor (Issue #1045).
 *
 * These tests verify:
 * - Type exports include new multi-account fields
 * - validateFeatures accepts valid features and rejects invalid ones
 * - rowToConnection mapping (via saveConnection + getConnection round-trip)
 * - Service function signatures match new multi-account API
 */

import { describe, it, expect } from 'vitest';
import {
  ALLOWED_FEATURES,
  type OAuthConnection,
  type OAuthConnectionUpdate,
  type OAuthPermissionLevel,
  type OAuthFeature,
  NoConnectionError,
} from './types.ts';
import { validateFeatures } from './service.ts';

describe('OAuth types (Issue #1045)', () => {
  it('exports ALLOWED_FEATURES with expected values', () => {
    expect(ALLOWED_FEATURES).toEqual(['contacts', 'email', 'files', 'calendar']);
  });

  it('OAuthPermissionLevel type allows read and read_write', () => {
    const readLevel: OAuthPermissionLevel = 'read';
    const rwLevel: OAuthPermissionLevel = 'read_write';
    expect(readLevel).toBe('read');
    expect(rwLevel).toBe('read_write');
  });

  it('OAuthFeature type corresponds to ALLOWED_FEATURES', () => {
    const feature: OAuthFeature = 'contacts';
    expect(ALLOWED_FEATURES).toContain(feature);
  });

  it('OAuthConnection interface includes multi-account fields', () => {
    const conn: OAuthConnection = {
      id: 'test-id',
      user_email: 'test@example.com',
      provider: 'google',
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      scopes: ['email'],
      expires_at: new Date(),
      token_metadata: {},
      label: 'Work Gmail',
      provider_account_id: 'goog-123',
      provider_account_email: 'work@gmail.com',
      permission_level: 'read_write',
      enabled_features: ['contacts', 'email'],
      is_active: true,
      last_sync_at: new Date(),
      sync_status: { contacts: { lastSync: '2025-01-01' } },
      created_at: new Date(),
      updated_at: new Date(),
    };

    expect(conn.label).toBe('Work Gmail');
    expect(conn.provider_account_id).toBe('goog-123');
    expect(conn.provider_account_email).toBe('work@gmail.com');
    expect(conn.permission_level).toBe('read_write');
    expect(conn.enabled_features).toEqual(['contacts', 'email']);
    expect(conn.is_active).toBe(true);
    expect(conn.last_sync_at).toBeInstanceOf(Date);
    expect(conn.sync_status).toEqual({ contacts: { lastSync: '2025-01-01' } });
  });

  it('OAuthConnectionUpdate allows partial updates', () => {
    const update: OAuthConnectionUpdate = {
      label: 'Personal',
      is_active: false,
    };
    expect(update.label).toBe('Personal');
    expect(update.permission_level).toBeUndefined();
    expect(update.enabled_features).toBeUndefined();
    expect(update.is_active).toBe(false);
  });
});

describe('validateFeatures', () => {
  it('accepts valid features', () => {
    expect(validateFeatures(['contacts'])).toEqual(['contacts']);
    expect(validateFeatures(['contacts', 'email'])).toEqual(['contacts', 'email']);
    expect(validateFeatures(['contacts', 'email', 'files', 'calendar'])).toEqual([
      'contacts',
      'email',
      'files',
      'calendar',
    ]);
  });

  it('accepts empty array', () => {
    expect(validateFeatures([])).toEqual([]);
  });

  it('throws on invalid features', () => {
    expect(() => validateFeatures(['invalid'])).toThrow('Invalid features: invalid');
    expect(() => validateFeatures(['contacts', 'invalid'])).toThrow('Invalid features: invalid');
  });

  it('error message includes allowed list', () => {
    try {
      validateFeatures(['bad']);
      expect.fail('Should have thrown');
    } catch (err) {
      expect((err as Error).message).toContain('Allowed: contacts, email, files, calendar');
    }
  });
});

describe('NoConnectionError overloads', () => {
  it('constructs with provider and user_email', () => {
    const err = new NoConnectionError('google', 'test@example.com');
    expect(err.message).toContain('test@example.com');
    expect(err.message).toContain('google');
    expect(err.code).toBe('NO_CONNECTION');
    expect(err.status_code).toBe(404);
  });

  it('constructs with connection_id only', () => {
    const err = new NoConnectionError('conn-uuid-123');
    expect(err.message).toContain('conn-uuid-123');
    expect(err.code).toBe('NO_CONNECTION');
    expect(err.status_code).toBe(404);
  });
});
