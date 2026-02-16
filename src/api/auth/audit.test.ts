import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type AuthAuditEvent, hashEmail, logAuthEvent, maskEmail } from './audit.ts';

describe('Auth audit logging', () => {
  describe('hashEmail', () => {
    it('should produce a hex SHA-256 hash', () => {
      const hash = hashEmail('user@example.com');
      // SHA-256 hex output is 64 characters
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]+$/);
    });

    it('should be deterministic for the same email', () => {
      const h1 = hashEmail('user@example.com');
      const h2 = hashEmail('user@example.com');
      expect(h1).toBe(h2);
    });

    it('should normalize to lowercase before hashing', () => {
      const h1 = hashEmail('User@Example.COM');
      const h2 = hashEmail('user@example.com');
      expect(h1).toBe(h2);
    });

    it('should trim whitespace before hashing', () => {
      const h1 = hashEmail('  user@example.com  ');
      const h2 = hashEmail('user@example.com');
      expect(h1).toBe(h2);
    });

    it('should produce different hashes for different emails', () => {
      const h1 = hashEmail('alice@example.com');
      const h2 = hashEmail('bob@example.com');
      expect(h1).not.toBe(h2);
    });
  });

  describe('maskEmail', () => {
    it('should mask local part keeping only first character', () => {
      expect(maskEmail('user@example.com')).toBe('u***@example.com');
    });

    it('should handle single-character local part', () => {
      expect(maskEmail('u@example.com')).toBe('u***@example.com');
    });

    it('should handle long local parts', () => {
      expect(maskEmail('longusername@example.com')).toBe('l***@example.com');
    });

    it('should return "***" for invalid email without @', () => {
      expect(maskEmail('noemail')).toBe('***');
    });

    it('should handle email starting with @', () => {
      expect(maskEmail('@example.com')).toBe('***');
    });
  });

  describe('logAuthEvent', () => {
    let mockPool: { query: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      mockPool = {
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
      };
    });

    it('should insert a row into audit_log using existing schema', async () => {
      await logAuthEvent(mockPool as unknown as import('pg').Pool, 'auth.magic_link_requested', '192.168.1.1', 'user@example.com');

      expect(mockPool.query).toHaveBeenCalledOnce();
      const [sql, params] = mockPool.query.mock.calls[0];

      expect(sql).toContain('INSERT INTO audit_log');
      expect(sql).toContain('actor_type');
      expect(sql).toContain("'system'");
      expect(sql).toContain("'auth'");
      // $1 = actor_id (hashed email)
      expect(params[0]).toHaveLength(64);
      expect(params[0]).toMatch(/^[0-9a-f]+$/);
      // $2 = entity_type (event name)
      expect(params[1]).toBe('auth.magic_link_requested');
      // $3 = metadata JSON
      const metadata = JSON.parse(params[2]);
      expect(metadata.masked_email).toBe('u***@example.com');
      expect(metadata.ip).toBe('192.168.1.1');
    });

    it('should handle null email', async () => {
      await logAuthEvent(mockPool as unknown as import('pg').Pool, 'auth.token_revoked', '10.0.0.1', null);

      const [, params] = mockPool.query.mock.calls[0];
      expect(params[0]).toBeNull(); // actor_id
    });

    it('should handle null IP', async () => {
      await logAuthEvent(mockPool as unknown as import('pg').Pool, 'auth.token_refresh', null, 'user@example.com');

      const [, params] = mockPool.query.mock.calls[0];
      const metadata = JSON.parse(params[2]);
      expect(metadata.ip).toBeUndefined();
    });

    it('should include additional metadata', async () => {
      await logAuthEvent(mockPool as unknown as import('pg').Pool, 'auth.token_consumed', '10.0.0.1', 'user@example.com', {
        success: true,
        family_id: 'abc-123',
      });

      const [, params] = mockPool.query.mock.calls[0];
      const metadata = JSON.parse(params[2]);
      expect(metadata.success).toBe(true);
      expect(metadata.family_id).toBe('abc-123');
      expect(metadata.masked_email).toBe('u***@example.com');
    });

    it('should not overwrite caller-provided masked_email', async () => {
      await logAuthEvent(mockPool as unknown as import('pg').Pool, 'auth.refresh_reuse_detected', '10.0.0.1', 'user@example.com', {
        masked_email: 'custom-mask',
      });

      const [, params] = mockPool.query.mock.calls[0];
      const metadata = JSON.parse(params[2]);
      expect(metadata.masked_email).toBe('custom-mask');
    });

    it('should accept all defined event types', async () => {
      const events: AuthAuditEvent[] = [
        'auth.magic_link_requested',
        'auth.token_consumed',
        'auth.token_refresh',
        'auth.token_revoked',
        'auth.refresh_reuse_detected',
      ];

      for (const event of events) {
        mockPool.query.mockClear();
        await logAuthEvent(mockPool as unknown as import('pg').Pool, event, '10.0.0.1', 'user@example.com');
        const [, params] = mockPool.query.mock.calls[0];
        expect(params[1]).toBe(event);
      }
    });

    it('should not throw when pool.query fails (best-effort)', async () => {
      mockPool.query.mockRejectedValue(new Error('connection refused'));
      // Should not throw
      await logAuthEvent(mockPool as unknown as import('pg').Pool, 'auth.token_consumed', '10.0.0.1', 'user@example.com');
    });
  });
});
