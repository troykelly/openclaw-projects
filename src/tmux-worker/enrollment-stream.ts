/**
 * Enrollment event streaming bridge for gRPC.
 * Issue #1855 — GetEnrollmentListener server stream.
 *
 * Bridges SSH enrollment events from the enrollment-ssh-server.ts
 * to gRPC server-side streams. Uses an EventEmitter as the internal
 * transport mechanism.
 *
 * When a device connects via the enrollment SSH port and registers
 * successfully, an EnrollmentEvent is emitted. All connected gRPC
 * stream clients receive the event.
 */

import { EventEmitter } from 'node:events';
import type {
  EnrollmentEvent,
} from './types.ts';
import { toTimestamp } from './types.ts';

/**
 * Typed enrollment event data emitted by the SSH enrollment server.
 */
export interface EnrollmentEventData {
  connectionId: string;
  host: string;
  port: number;
  label: string;
  tags: string[];
  enrolledAt: Date;
}

/**
 * Event emitter for enrollment events.
 * Shared singleton — the SSH enrollment server emits events here,
 * and gRPC stream handlers subscribe to them.
 */
class EnrollmentEventBus extends EventEmitter {
  /** Maximum listeners (one per connected gRPC stream client). */
  constructor() {
    super();
    // Allow many concurrent gRPC stream clients
    this.setMaxListeners(100);
  }

  /**
   * Emit an enrollment event. Called by the SSH enrollment server
   * after a successful enrollment.
   */
  emitEnrollment(event: EnrollmentEventData): void {
    this.emit('enrollment', event);
  }

  /**
   * Subscribe to enrollment events.
   * Returns a cleanup function that removes the listener.
   */
  onEnrollment(handler: (event: EnrollmentEventData) => void): () => void {
    this.on('enrollment', handler);
    return () => {
      this.removeListener('enrollment', handler);
    };
  }
}

/** Singleton enrollment event bus. */
export const enrollmentEventBus = new EnrollmentEventBus();

/**
 * Convert an EnrollmentEventData to the gRPC EnrollmentEvent message format.
 */
export function toEnrollmentEvent(data: EnrollmentEventData): EnrollmentEvent {
  return {
    connection_id: data.connectionId,
    host: data.host,
    port: data.port,
    label: data.label,
    tags: data.tags,
    enrolled_at: toTimestamp(data.enrolledAt),
  };
}
