/**
 * Event router for Home Assistant state_changed events.
 *
 * Dispatches events to registered processors based on their entity filters.
 * Supports individual (per-event) and batched dispatch modes with error isolation.
 *
 * Issue #1443.
 */

import type { HaEventProcessor, HaStateChange } from './ha-event-processor.ts';
import { matchesFilter } from './ha-event-processor.ts';

/** Pending batch entry keyed by namespace for a single processor. */
interface BatchEntry {
  changes: HaStateChange[];
  namespace: string;
}

/**
 * Routes HA state_changed events to registered HaEventProcessor plugins.
 *
 * Key behaviours:
 * - `dispatch()` evaluates each processor's entity filter via matchesFilter()
 * - Individual-mode processors receive events immediately via onStateChange()
 * - Batched-mode processors accumulate events and flush on a timer
 * - Error isolation: one processor throwing does not affect others
 * - shutdown() flushes pending batches before calling processor.shutdown()
 */
export class HaEventRouter {
  private processors: Map<string, HaEventProcessor> = new Map();
  private batchBuffers: Map<string, BatchEntry[]> = new Map();
  private batchTimers: Map<string, NodeJS.Timeout> = new Map();

  /** Register a processor. Throws if a processor with the same ID already exists. */
  register(processor: HaEventProcessor): void {
    const config = processor.getConfig();
    if (this.processors.has(config.id)) {
      throw new Error(`Processor already registered: ${config.id}`);
    }
    this.processors.set(config.id, processor);
  }

  /** Unregister a processor by ID. Clears any pending batch and timer. */
  unregister(processorId: string): void {
    this.processors.delete(processorId);
    this.clearBatch(processorId);
  }

  /**
   * Dispatch a state_changed event to all matching processors.
   * Uses Promise.allSettled for error isolation.
   */
  async dispatch(event: HaStateChange, namespace: string): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const [id, processor] of this.processors) {
      const config = processor.getConfig();
      if (!matchesFilter(event.entity_id, config.filter)) {
        continue;
      }

      if (config.mode === 'batched') {
        this.bufferEvent(id, event, namespace, config.batchWindowMs ?? 1000);
      } else {
        if (processor.onStateChange) {
          promises.push(processor.onStateChange(event, namespace));
        }
      }
    }

    if (promises.length > 0) {
      await Promise.allSettled(promises);
    }
  }

  /** Notify all processors that a WebSocket connection was established. */
  async notifyConnect(haUrl: string): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const processor of this.processors.values()) {
      if (processor.onConnect) {
        promises.push(processor.onConnect(haUrl));
      }
    }
    await Promise.allSettled(promises);
  }

  /** Notify all processors that the WebSocket connection was lost. */
  async notifyDisconnect(reason: string): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const processor of this.processors.values()) {
      if (processor.onDisconnect) {
        promises.push(processor.onDisconnect(reason));
      }
    }
    await Promise.allSettled(promises);
  }

  /** Run health checks on all processors. Returns per-processor status. */
  async healthCheck(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    const entries = [...this.processors.entries()];

    const checks = entries.map(async ([id, processor]) => {
      try {
        const healthy = await processor.healthCheck();
        results.set(id, healthy);
      } catch {
        results.set(id, false);
      }
    });

    await Promise.allSettled(checks);
    return results;
  }

  /** Flush all pending batches and shut down all processors. */
  async shutdown(): Promise<void> {
    // Flush all pending batches first
    const flushPromises: Promise<void>[] = [];
    for (const [processorId] of this.batchBuffers) {
      flushPromises.push(this.flushBatch(processorId));
    }
    await Promise.allSettled(flushPromises);

    // Then shut down all processors
    const shutdownPromises: Promise<void>[] = [];
    for (const processor of this.processors.values()) {
      shutdownPromises.push(processor.shutdown());
    }
    await Promise.allSettled(shutdownPromises);

    this.processors.clear();
    this.batchBuffers.clear();
    // Timers already cleared by flushBatch
  }

  // ---------- private batch management ----------

  private bufferEvent(
    processorId: string,
    event: HaStateChange,
    namespace: string,
    windowMs: number,
  ): void {
    let entries = this.batchBuffers.get(processorId);
    if (!entries) {
      entries = [];
      this.batchBuffers.set(processorId, entries);
    }

    entries.push({ changes: [event], namespace });

    // Start timer if not already running
    if (!this.batchTimers.has(processorId)) {
      const timer = setTimeout(() => {
        void this.flushBatch(processorId);
      }, windowMs);
      this.batchTimers.set(processorId, timer);
    }
  }

  private async flushBatch(processorId: string): Promise<void> {
    // Clear the timer
    const timer = this.batchTimers.get(processorId);
    if (timer) {
      clearTimeout(timer);
      this.batchTimers.delete(processorId);
    }

    const entries = this.batchBuffers.get(processorId);
    if (!entries || entries.length === 0) {
      this.batchBuffers.delete(processorId);
      return;
    }

    // Collect all changes, grouped by the first entry's namespace
    // (in practice, all events in a batch share the same namespace context)
    const allChanges = entries.flatMap((e) => e.changes);
    const namespace = entries[0].namespace;
    this.batchBuffers.delete(processorId);

    const processor = this.processors.get(processorId);
    if (!processor?.onStateChangeBatch) return;

    try {
      await processor.onStateChangeBatch(allChanges, namespace);
    } catch {
      // Error isolation — batch flush failure is logged but does not propagate
    }
  }

  private clearBatch(processorId: string): void {
    const timer = this.batchTimers.get(processorId);
    if (timer) {
      clearTimeout(timer);
      this.batchTimers.delete(processorId);
    }
    this.batchBuffers.delete(processorId);
  }
}
