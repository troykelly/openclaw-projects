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

/** Composite key for batch buffers: (processorId, namespace). */
function batchKey(processorId: string, namespace: string): string {
  return `${processorId}\0${namespace}`;
}

/** Parse a batch key back into its components. */
function parseBatchKey(key: string): { processorId: string; namespace: string } {
  const sep = key.indexOf('\0');
  return { processorId: key.slice(0, sep), namespace: key.slice(sep + 1) };
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
  private batchBuffers: Map<string, HaStateChange[]> = new Map();
  private batchTimers: Map<string, NodeJS.Timeout> = new Map();

  /** Register a processor. Throws if a processor with the same ID already exists. */
  register(processor: HaEventProcessor): void {
    const config = processor.getConfig();
    if (this.processors.has(config.id)) {
      throw new Error(`Processor already registered: ${config.id}`);
    }
    this.processors.set(config.id, processor);
  }

  /** Unregister a processor by ID. Clears any pending batches and timers. */
  unregister(processorId: string): void {
    this.processors.delete(processorId);
    // Clear all batch keys belonging to this processor (any namespace)
    for (const key of [...this.batchBuffers.keys()]) {
      if (parseBatchKey(key).processorId === processorId) {
        this.clearBatch(key);
      }
    }
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
    for (const key of this.batchBuffers.keys()) {
      flushPromises.push(this.flushBatch(key));
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
    const key = batchKey(processorId, namespace);
    let changes = this.batchBuffers.get(key);
    if (!changes) {
      changes = [];
      this.batchBuffers.set(key, changes);
    }

    changes.push(event);

    // Start timer if not already running for this (processor, namespace) pair
    if (!this.batchTimers.has(key)) {
      const timer = setTimeout(() => {
        void this.flushBatch(key);
      }, windowMs);
      this.batchTimers.set(key, timer);
    }
  }

  private async flushBatch(key: string): Promise<void> {
    // Clear the timer
    const timer = this.batchTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.batchTimers.delete(key);
    }

    const changes = this.batchBuffers.get(key);
    if (!changes || changes.length === 0) {
      this.batchBuffers.delete(key);
      return;
    }

    const { processorId, namespace } = parseBatchKey(key);
    this.batchBuffers.delete(key);

    const processor = this.processors.get(processorId);
    if (!processor?.onStateChangeBatch) return;

    try {
      await processor.onStateChangeBatch(changes, namespace);
    } catch (err) {
      console.error(`[HaEventRouter] Batch flush failed for ${processorId}:`, (err as Error).message);
    }
  }

  private clearBatch(key: string): void {
    const timer = this.batchTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.batchTimers.delete(key);
    }
    this.batchBuffers.delete(key);
  }
}
