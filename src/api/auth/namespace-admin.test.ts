/**
 * Unit tests for requireNamespaceAdmin() — M2M api:full bypass.
 * Issue #2364, Epic #2345.
 *
 * Tests three authorization paths:
 * 1. M2M + api:full → bypasses DB, returns null (allowed)
 * 2. M2M without api:full → requires readwrite grant in DB
 * 3. User tokens → requires readwrite grant in DB (unchanged)
 */

import { describe, it, expect, vi } from 'vitest';
import type { AuthIdentity } from './middleware.ts';
import { requireNamespaceAdmin } from './namespace-admin.ts';

function mockPool(rows: Record<string, unknown>[]) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

describe('requireNamespaceAdmin (Issue #2364)', () => {
  const namespace = 'test-ns';

  describe('M2M token with api:full scope', () => {
    const identity: AuthIdentity = {
      email: 'gateway@openclaw.ai',
      type: 'm2m',
      scopes: ['api:full'],
    };

    it('should return null (allowed) without querying the database', async () => {
      const pool = mockPool([]);
      const result = await requireNamespaceAdmin(identity, namespace, pool);
      expect(result).toBeNull();
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('should return null even with additional scopes', async () => {
      const multiScopeIdentity: AuthIdentity = {
        email: 'gateway@openclaw.ai',
        type: 'm2m',
        scopes: ['read:agents', 'api:full', 'write:hooks'],
      };
      const pool = mockPool([]);
      const result = await requireNamespaceAdmin(multiScopeIdentity, namespace, pool);
      expect(result).toBeNull();
      expect(pool.query).not.toHaveBeenCalled();
    });
  });

  describe('M2M token WITHOUT api:full scope', () => {
    const identity: AuthIdentity = {
      email: 'service@openclaw.ai',
      type: 'm2m',
      scopes: ['read:agents'],
    };

    it('should return error when no grant row exists', async () => {
      const pool = mockPool([]);
      const result = await requireNamespaceAdmin(identity, namespace, pool);
      expect(result).toBe('No access to namespace');
      expect(pool.query).toHaveBeenCalledOnce();
    });

    it('should return error when grant is read-only', async () => {
      const pool = mockPool([{ access: 'read' }]);
      const result = await requireNamespaceAdmin(identity, namespace, pool);
      expect(result).toBe('Requires readwrite access to manage grants');
    });

    it('should return null when grant is readwrite', async () => {
      const pool = mockPool([{ access: 'readwrite' }]);
      const result = await requireNamespaceAdmin(identity, namespace, pool);
      expect(result).toBeNull();
    });

    it('should still require grant when scopes is empty array', async () => {
      const noScopeIdentity: AuthIdentity = {
        email: 'service@openclaw.ai',
        type: 'm2m',
        scopes: [],
      };
      const pool = mockPool([]);
      const result = await requireNamespaceAdmin(noScopeIdentity, namespace, pool);
      expect(result).toBe('No access to namespace');
      expect(pool.query).toHaveBeenCalledOnce();
    });

    it('should still require grant when scopes is undefined', async () => {
      const undefinedScopeIdentity: AuthIdentity = {
        email: 'service@openclaw.ai',
        type: 'm2m',
      };
      const pool = mockPool([]);
      const result = await requireNamespaceAdmin(undefinedScopeIdentity, namespace, pool);
      expect(result).toBe('No access to namespace');
      expect(pool.query).toHaveBeenCalledOnce();
    });
  });

  describe('User token', () => {
    const identity: AuthIdentity = {
      email: 'user@example.com',
      type: 'user',
    };

    it('should return error when no grant row exists', async () => {
      const pool = mockPool([]);
      const result = await requireNamespaceAdmin(identity, namespace, pool);
      expect(result).toBe('No access to namespace');
      expect(pool.query).toHaveBeenCalledOnce();
    });

    it('should return error when grant is read-only', async () => {
      const pool = mockPool([{ access: 'read' }]);
      const result = await requireNamespaceAdmin(identity, namespace, pool);
      expect(result).toBe('Requires readwrite access to manage grants');
    });

    it('should return null when grant is readwrite', async () => {
      const pool = mockPool([{ access: 'readwrite' }]);
      const result = await requireNamespaceAdmin(identity, namespace, pool);
      expect(result).toBeNull();
    });

    it('should NOT bypass even if user token somehow has api:full scope', async () => {
      const userWithScope: AuthIdentity = {
        email: 'user@example.com',
        type: 'user',
        scopes: ['api:full'],
      };
      const pool = mockPool([]);
      const result = await requireNamespaceAdmin(userWithScope, namespace, pool);
      expect(result).toBe('No access to namespace');
      expect(pool.query).toHaveBeenCalledOnce();
    });
  });

  describe('SQL query correctness', () => {
    it('should query with correct email and namespace parameters', async () => {
      const identity: AuthIdentity = { email: 'test@example.com', type: 'user' };
      const pool = mockPool([{ access: 'readwrite' }]);
      await requireNamespaceAdmin(identity, 'my-namespace', pool);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('namespace_grant'),
        ['test@example.com', 'my-namespace'],
      );
    });
  });
});
