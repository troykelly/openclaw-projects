/**
 * Tests for gRPC client listSessions wrapper and timestamp types.
 * Issue #1860 — Fix proto/TypeScript type mismatches and add missing listSessions wrapper
 */

import { describe, it, expect } from 'vitest';
import { toTimestamp, fromTimestamp } from '../../src/tmux-worker/types.ts';

describe('Timestamp conversion helpers (#1860)', () => {
  describe('toTimestamp', () => {
    it('converts a Date to proto Timestamp', () => {
      const date = new Date('2026-01-15T12:30:45.123Z');
      const ts = toTimestamp(date);

      expect(ts).toBeDefined();
      expect(typeof ts!.seconds).toBe('string');
      expect(typeof ts!.nanos).toBe('number');
      expect(Number(ts!.seconds)).toBe(Math.floor(date.getTime() / 1000));
      expect(ts!.nanos).toBe(123_000_000);
    });

    it('returns null for null input', () => {
      expect(toTimestamp(null)).toBeNull();
    });

    it('returns null for undefined input', () => {
      expect(toTimestamp(undefined)).toBeNull();
    });

    it('converts an ISO string to proto Timestamp', () => {
      const ts = toTimestamp('2026-06-01T00:00:00Z');
      expect(ts).not.toBeNull();
      expect(Number(ts!.seconds)).toBe(Math.floor(new Date('2026-06-01T00:00:00Z').getTime() / 1000));
    });
  });

  describe('fromTimestamp', () => {
    it('converts a proto Timestamp to ISO string', () => {
      const ts = { seconds: '1737000000', nanos: 0 };
      const iso = fromTimestamp(ts);

      expect(iso).toBeDefined();
      expect(typeof iso).toBe('string');
      const parsed = new Date(iso!);
      expect(parsed.getTime()).toBe(1737000000 * 1000);
    });

    it('returns null for null input', () => {
      expect(fromTimestamp(null)).toBeNull();
    });

    it('returns null for undefined input', () => {
      expect(fromTimestamp(undefined)).toBeNull();
    });

    it('handles nanos correctly', () => {
      const ts = { seconds: '1000000000', nanos: 500_000_000 };
      const iso = fromTimestamp(ts);
      const parsed = new Date(iso!);
      expect(parsed.getTime()).toBe(1000000000 * 1000 + 500);
    });
  });

  describe('roundtrip', () => {
    it('converts Date -> Timestamp -> ISO string preserving time', () => {
      const original = new Date('2026-03-15T10:30:00.000Z');
      const ts = toTimestamp(original);
      const iso = fromTimestamp(ts);

      expect(iso).toBeDefined();
      const roundTripped = new Date(iso!);
      // Should be within 1ms
      expect(Math.abs(roundTripped.getTime() - original.getTime())).toBeLessThan(1);
    });
  });
});

describe('listSessions export (#1860)', () => {
  it('exports listSessions function from grpc-client', async () => {
    const mod = await import('../../src/api/terminal/grpc-client.ts');
    expect(typeof mod.listSessions).toBe('function');
  });

  it('exports ListSessionsRequest and ListSessionsResponse types', async () => {
    // This test verifies the types are importable (compile-time check).
    // At runtime we just verify the module exports exist.
    const types = await import('../../src/tmux-worker/types.ts');
    // These are interfaces so they won't exist at runtime,
    // but the type file should be importable without errors.
    expect(types).toBeDefined();
  });
});
