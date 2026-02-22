import { describe, it, expect } from 'vitest';
import { hasPermission, getPermissions, type PlatformConfig } from './permissions.ts';

const testConfig: PlatformConfig = {
  permissions: {
    platform_admin: { namespace: 'admins', description: 'Full platform administration' },
    ha_admin: { namespace: 'home-assistant-admins', description: 'Configure HA integrations' },
    contacts_admin: { namespace: 'contacts-admins', description: 'Merge contacts, manage tags' },
  },
};

describe('Namespace-based permissions (#1581)', () => {
  describe('hasPermission', () => {
    it('returns true when user has the permission namespace', () => {
      const namespaces = new Set(['admins', 'troy']);
      expect(hasPermission(namespaces, 'platform_admin', testConfig)).toBe(true);
    });

    it('returns false when user lacks the permission namespace', () => {
      const namespaces = new Set(['troy', 'team-alpha']);
      expect(hasPermission(namespaces, 'platform_admin', testConfig)).toBe(false);
    });

    it('returns false for undefined permission', () => {
      const namespaces = new Set(['admins']);
      expect(hasPermission(namespaces, 'nonexistent', testConfig)).toBe(false);
    });

    it('accepts array input', () => {
      expect(hasPermission(['admins'], 'platform_admin', testConfig)).toBe(true);
    });

    it('returns false with empty config', () => {
      expect(hasPermission(['admins'], 'platform_admin', {})).toBe(false);
    });
  });

  describe('getPermissions', () => {
    it('returns all permissions for matching namespaces', () => {
      const namespaces = new Set(['admins', 'contacts-admins', 'troy']);
      const perms = getPermissions(namespaces, testConfig);
      expect(perms).toEqual(new Set(['platform_admin', 'contacts_admin']));
    });

    it('returns empty set when no namespaces match', () => {
      const namespaces = new Set(['troy']);
      const perms = getPermissions(namespaces, testConfig);
      expect(perms.size).toBe(0);
    });

    it('returns empty set with empty config', () => {
      const perms = getPermissions(['admins'], {});
      expect(perms.size).toBe(0);
    });
  });
});
