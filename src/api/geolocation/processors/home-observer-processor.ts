/**
 * Home observer event processor.
 *
 * Subscribes to actionable HA entity domains, batches state changes in
 * configurable windows, scores each observation, and bulk-inserts into
 * the `ha_observations` TimescaleDB hypertable.
 *
 * Issue #1449, Epic #1440.
 */

import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import type {
  HaEventProcessor,
  HaEventProcessorConfig,
  HaStateChange,
} from '../ha-event-processor.ts';
import type { EntityTierResolver, EntityTier } from '../ha-entity-tiers.ts';
import type { ObservationScorer, BatchScoreResult } from '../ha-observation-scorer.ts';
import { buildObservationContext } from '../ha-observation-scorer.ts';
import { RuleBasedScorer } from '../scorers/rule-based-scorer.ts';

// ---------- constants ----------

/** Domains the home observer subscribes to. */
const OBSERVED_DOMAINS: readonly string[] = [
  'light',
  'switch',
  'binary_sensor',
  'climate',
  'media_player',
  'lock',
  'cover',
  'alarm_control_panel',
  'fan',
  'vacuum',
  'input_boolean',
];

/** Default batch window: 15 seconds. */
const DEFAULT_BATCH_WINDOW_MS = 15_000;

// ---------- logger (minimal, structured) ----------

interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

const defaultLogger: Logger = {
  debug() {},
  info() {},
  warn(msg, meta) {
    console.warn(`[home-observer] ${msg}`, meta ?? '');
  },
  error(msg, meta) {
    console.error(`[home-observer] ${msg}`, meta ?? '');
  },
};

// ---------- constructor options ----------

export interface HomeObserverProcessorOptions {
  pool: Pool;
  tierResolver: EntityTierResolver;
  scorer?: ObservationScorer;
  batchWindowMs?: number;
  logger?: Logger;
}

// ---------- HomeObserverProcessor ----------

/**
 * Event processor that observes actionable HA domains, scores state changes,
 * and bulk-inserts observations into the `ha_observations` hypertable.
 */
export class HomeObserverProcessor implements HaEventProcessor {
  private readonly pool: Pool;
  private readonly tierResolver: EntityTierResolver;
  private readonly scorer: ObservationScorer;
  private readonly batchWindowMs: number;
  private readonly log: Logger;

  constructor(opts: HomeObserverProcessorOptions) {
    this.pool = opts.pool;
    this.tierResolver = opts.tierResolver;
    this.scorer = opts.scorer ?? new RuleBasedScorer();
    this.batchWindowMs = opts.batchWindowMs ?? DEFAULT_BATCH_WINDOW_MS;
    this.log = opts.logger ?? defaultLogger;
  }

  getConfig(): HaEventProcessorConfig {
    return {
      id: 'home-observer',
      name: 'Home Observer',
      filter: {
        domains: [...OBSERVED_DOMAINS],
      },
      mode: 'batched',
      batchWindowMs: this.batchWindowMs,
    };
  }

  async onConnect(_haUrl: string): Promise<void> {
    this.log.info('Connected to HA', { haUrl: _haUrl });
  }

  async onDisconnect(_reason: string): Promise<void> {
    this.log.info('Disconnected from HA', { reason: _reason });
  }

  /**
   * Process a batch of state changes.
   *
   * Steps:
   * 1. Filter attribute-only changes (old_state === new_state)
   * 2. Resolve entity tiers for the batch
   * 3. Build temporal context
   * 4. Score each change via the observation scorer
   * 5. Generate a batch_id
   * 6. Bulk insert into ha_observations
   */
  async onStateChangeBatch(changes: HaStateChange[], namespace: string): Promise<void> {
    // Step 1: filter attribute-only changes
    const meaningful = changes.filter(
      (c) => c.old_state === null || c.old_state !== c.new_state,
    );

    if (meaningful.length === 0) {
      this.log.debug('Batch fully filtered — no meaningful state changes', {
        namespace,
        originalCount: changes.length,
      });
      return;
    }

    // Step 2: resolve entity tiers
    const entityIds = [...new Set(meaningful.map((c) => c.entity_id))];
    const tierMap = await this.tierResolver.resolveBatch(entityIds, namespace);

    // Build a plain EntityTier map for the scorer
    const tiers = new Map<string, EntityTier>();
    for (const [eid, resolved] of tierMap) {
      tiers.set(eid, resolved.tier);
    }

    // Step 3: build temporal context from the first event's timestamp
    const referenceTime = new Date(meaningful[0].last_changed);
    const context = buildObservationContext(referenceTime);

    // Step 4: score the batch
    const batchResult: BatchScoreResult = await this.scorer.scoreBatch(meaningful, context, tiers);

    // Step 5: generate batch_id
    const batchId = randomUUID();

    // Determine the primary scene label for the batch (if any)
    const primaryScene = batchResult.scenes.length > 0 ? batchResult.scenes[0] : null;

    // Step 6: bulk insert
    await this.bulkInsert(batchResult, batchId, primaryScene, namespace, context);

    // Step 7: dispatch high-scoring observations via webhook (Issue #1610)
    // Fire-and-forget — dispatch failure must not prevent batch recording.
    try {
      const { dispatchHaObservations } = await import('../../ha-dispatch/service.ts');
      await dispatchHaObservations(this.pool, {
        observations: batchResult.scored.map((obs) => ({
          entity_id: obs.change.entity_id,
          state: obs.change.new_state,
          old_state: obs.change.old_state ?? undefined,
          score: obs.score,
          reason: obs.scene_label ?? undefined,
          attributes: obs.change.new_attributes,
        })),
        batchScene: primaryScene ?? undefined,
        namespace,
      });
    } catch (err) {
      this.log.warn('Dispatch failed', { error: err instanceof Error ? err.message : String(err) });
    }

    this.log.info('Batch processed', {
      namespace,
      batchId,
      total: changes.length,
      meaningful: meaningful.length,
      scored: batchResult.scored.length,
      triaged: batchResult.triaged.length,
      scenes: batchResult.scenes,
    });
  }

  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.pool.query('SELECT 1');
      return result.rowCount === 1;
    } catch {
      return false;
    }
  }

  async shutdown(): Promise<void> {
    // No resources to release; pool is owned externally
    this.log.info('Shutting down home observer processor');
  }

  // ---------- private ----------

  /**
   * Bulk insert scored observations into ha_observations using parameterized
   * INSERT with multiple value tuples, chunked to stay within PostgreSQL's
   * ~65535 parameter limit (11 columns per row, max 1000 rows per chunk).
   */
  private async bulkInsert(
    result: BatchScoreResult,
    batchId: string,
    primaryScene: string | null,
    namespace: string,
    observationContext: { day_of_week: string; time_bucket: string; is_weekend: boolean },
  ): Promise<void> {
    const { scored } = result;
    if (scored.length === 0) return;

    const COLS_PER_ROW = 11;
    const MAX_ROWS_PER_CHUNK = 1000;

    for (let chunkStart = 0; chunkStart < scored.length; chunkStart += MAX_ROWS_PER_CHUNK) {
      const chunk = scored.slice(chunkStart, chunkStart + MAX_ROWS_PER_CHUNK);
      const values: unknown[] = [];
      const tuples: string[] = [];

      for (let i = 0; i < chunk.length; i++) {
        const obs = chunk[i];
        const change = obs.change;
        const offset = i * COLS_PER_ROW;

        // Use per-observation scene_label if assigned, otherwise batch-level primary scene
        const sceneLabel = obs.scene_label ?? primaryScene;

        values.push(
          namespace,                                        // $1
          new Date(change.last_changed),                    // $2 timestamp
          batchId,                                          // $3 batch_id
          change.entity_id,                                 // $4 entity_id
          change.domain,                                    // $5 domain
          change.old_state,                                 // $6 from_state
          change.new_state,                                 // $7 to_state
          JSON.stringify(change.new_attributes),             // $8 attributes
          obs.score,                                        // $9 score
          sceneLabel,                                       // $10 scene_label
          JSON.stringify(observationContext),                // $11 context
        );

        const placeholders = Array.from(
          { length: COLS_PER_ROW },
          (_, j) => `$${offset + j + 1}`,
        ).join(', ');
        tuples.push(`(${placeholders})`);
      }

      const sql = `
        INSERT INTO ha_observations (
          namespace, timestamp, batch_id, entity_id, domain,
          from_state, to_state, attributes, score, scene_label, context
        ) VALUES ${tuples.join(', ')}
      `;

      await this.pool.query(sql, values);
    }
  }
}
