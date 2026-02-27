/**
 * Unit tests for enrollment event streaming bridge.
 * Issue #1855 — GetEnrollmentListener server stream.
 *
 * Tests the EventEmitter-based bridge between SSH enrollment events
 * and gRPC stream consumers.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  enrollmentEventBus,
  toEnrollmentEvent,
  type EnrollmentEventData,
} from './enrollment-stream.ts';

describe('enrollment-stream', () => {
  afterEach(() => {
    enrollmentEventBus.removeAllListeners('enrollment');
  });

  describe('enrollmentEventBus', () => {
    it('emits enrollment events to subscribers', () => {
      const handler = vi.fn();
      enrollmentEventBus.onEnrollment(handler);

      const event: EnrollmentEventData = {
        connectionId: 'conn-1',
        host: '192.168.1.100',
        port: 22,
        label: 'test-token',
        tags: ['web', 'production'],
        enrolledAt: new Date('2026-02-26T10:00:00Z'),
      };

      enrollmentEventBus.emitEnrollment(event);

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(event);
    });

    it('supports multiple subscribers', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      enrollmentEventBus.onEnrollment(handler1);
      enrollmentEventBus.onEnrollment(handler2);

      const event: EnrollmentEventData = {
        connectionId: 'conn-1',
        host: '10.0.0.1',
        port: 22,
        label: 'multi-test',
        tags: [],
        enrolledAt: new Date(),
      };

      enrollmentEventBus.emitEnrollment(event);

      expect(handler1).toHaveBeenCalledOnce();
      expect(handler2).toHaveBeenCalledOnce();
    });

    it('cleanup function removes the listener', () => {
      const handler = vi.fn();
      const cleanup = enrollmentEventBus.onEnrollment(handler);

      cleanup();

      enrollmentEventBus.emitEnrollment({
        connectionId: 'conn-1',
        host: '10.0.0.1',
        port: 22,
        label: 'test',
        tags: [],
        enrolledAt: new Date(),
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('does not receive events after cleanup', () => {
      const handler = vi.fn();
      const cleanup = enrollmentEventBus.onEnrollment(handler);

      const event: EnrollmentEventData = {
        connectionId: 'conn-1',
        host: '10.0.0.1',
        port: 22,
        label: 'test',
        tags: [],
        enrolledAt: new Date(),
      };

      // First event should be received
      enrollmentEventBus.emitEnrollment(event);
      expect(handler).toHaveBeenCalledOnce();

      // After cleanup, no more events
      cleanup();
      enrollmentEventBus.emitEnrollment(event);
      expect(handler).toHaveBeenCalledOnce(); // still 1
    });
  });

  describe('toEnrollmentEvent', () => {
    it('converts EnrollmentEventData to gRPC EnrollmentEvent', () => {
      const data: EnrollmentEventData = {
        connectionId: 'conn-abc',
        host: '192.168.1.50',
        port: 2222,
        label: 'my-server',
        tags: ['dev', 'staging'],
        enrolledAt: new Date('2026-02-26T12:30:00Z'),
      };

      const result = toEnrollmentEvent(data);

      expect(result.connection_id).toBe('conn-abc');
      expect(result.host).toBe('192.168.1.50');
      expect(result.port).toBe(2222);
      expect(result.label).toBe('my-server');
      expect(result.tags).toEqual(['dev', 'staging']);
      expect(result.enrolled_at).toBeDefined();
      expect(result.enrolled_at!.seconds).toBeDefined();
    });

    it('handles empty tags', () => {
      const data: EnrollmentEventData = {
        connectionId: 'conn-1',
        host: '10.0.0.1',
        port: 22,
        label: 'no-tags',
        tags: [],
        enrolledAt: new Date(),
      };

      const result = toEnrollmentEvent(data);
      expect(result.tags).toEqual([]);
    });
  });
});
