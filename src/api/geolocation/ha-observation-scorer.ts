/**
 * Observation scorer interface for Home Assistant state changes.
 *
 * Defines the pluggable contract for scoring HA observations. Scores range
 * from 0 (no interest) to 10 (immediate attention required). Implementations
 * can use rule-based, ML, or hybrid approaches.
 *
 * Issue #1453, Epic #1440.
 */

import type { EntityTier } from './ha-entity-tiers.ts';
import type { HaStateChange } from './ha-event-processor.ts';

// ---------- context types ----------

/**
 * Time bucket labels for temporal scoring context.
 * - night: 0:00 - 5:59
 * - morning_early: 6:00 - 8:59
 * - morning: 9:00 - 11:59
 * - afternoon: 12:00 - 16:59
 * - evening: 17:00 - 20:59
 * - night_late: 21:00 - 23:59
 */
export type TimeBucket = 'night' | 'morning_early' | 'morning' | 'afternoon' | 'evening' | 'night_late';

/** Contextual information about when an observation was recorded. */
export interface ObservationContext {
  /** Day of week, lowercase (e.g. "monday", "saturday"). */
  day_of_week: string;
  /** Time bucket categorisation. */
  time_bucket: TimeBucket;
  /** Whether the observation occurred on a weekend (Saturday or Sunday). */
  is_weekend: boolean;
}

// ---------- scored result types ----------

/** A detected scene label from pattern matching. */
export type SceneLabel = 'bedtime' | 'morning_routine' | 'leaving_home' | 'arriving_home' | string;

/** Result of scoring a single observation. */
export interface ScoredObservation {
  /** The original state change. */
  change: HaStateChange;
  /** Assigned score 0..10. */
  score: number;
  /** Detected scene label, if any. */
  scene_label: SceneLabel | null;
  /** Breakdown of how the score was computed. */
  score_breakdown: ScoreBreakdown;
}

/** Breakdown showing base score and applied modifiers. */
export interface ScoreBreakdown {
  /** Base score from domain/entity type. */
  base: number;
  /** Individual modifier adjustments. */
  modifiers: ScoreModifier[];
  /** Final clamped score. */
  final: number;
}

/** A single scoring modifier with reason and delta. */
export interface ScoreModifier {
  /** Human-readable reason for the adjustment. */
  reason: string;
  /** Score delta (positive or negative). */
  delta: number;
}

/** Result of scoring a batch of observations. */
export interface BatchScoreResult {
  /** All scored observations. */
  scored: ScoredObservation[];
  /** Observations that scored at or above the triage threshold (score >= 4). */
  triaged: ScoredObservation[];
  /** Detected scenes across the batch. */
  scenes: SceneLabel[];
}

// ---------- scorer interface ----------

/**
 * Pluggable interface for scoring HA state change observations.
 *
 * Implementations receive the state change, temporal context, and the
 * entity's resolved tier. They return a score (0-10) with breakdown
 * and optional scene detection.
 */
export interface ObservationScorer {
  /** Unique identifier for this scorer implementation. */
  readonly id: string;

  /**
   * Score a single state change observation.
   *
   * @param change - The HA state change event
   * @param context - Temporal context (time of day, day of week)
   * @param tier - The entity's resolved tier classification
   * @returns Scored observation with breakdown
   */
  score(change: HaStateChange, context: ObservationContext, tier: EntityTier): ScoredObservation;

  /**
   * Score a batch of state changes.
   *
   * Default implementations should call score() per item, but implementations
   * may optimise for cross-event pattern detection (scene detection, etc.).
   *
   * @param changes - Array of HA state changes
   * @param context - Temporal context (shared across the batch)
   * @param tiers - Map of entity_id to resolved tier
   * @returns Batch score result with triage filtering
   */
  scoreBatch(changes: HaStateChange[], context: ObservationContext, tiers: Map<string, EntityTier>): BatchScoreResult | Promise<BatchScoreResult>;
}

// ---------- utility: build context ----------

/**
 * Derive an ObservationContext from a Date.
 *
 * Useful for callers that need to construct context from a timestamp.
 */
export function buildObservationContext(date: Date): ObservationContext {
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayOfWeek = dayNames[date.getDay()];
  const hour = date.getHours();
  const isWeekend = date.getDay() === 0 || date.getDay() === 6;

  let timeBucket: TimeBucket;
  if (hour < 6) {
    timeBucket = 'night';
  } else if (hour < 9) {
    timeBucket = 'morning_early';
  } else if (hour < 12) {
    timeBucket = 'morning';
  } else if (hour < 17) {
    timeBucket = 'afternoon';
  } else if (hour < 21) {
    timeBucket = 'evening';
  } else {
    timeBucket = 'night_late';
  }

  return { day_of_week: dayOfWeek, time_bucket: timeBucket, is_weekend: isWeekend };
}
