/**
 * Rule-based observation scorer for Home Assistant state changes.
 *
 * Assigns base scores by domain/entity type, applies contextual modifiers
 * (unusual time, uncommon state, high frequency), and detects scene patterns
 * across batches of observations.
 *
 * Score range: 0 (no interest) to 10 (immediate attention).
 *
 * Issue #1453, Epic #1440.
 */

import type { EntityTier } from '../ha-entity-tiers.ts';
import type { HaStateChange } from '../ha-event-processor.ts';
import type { BatchScoreResult, ObservationContext, ObservationScorer, SceneLabel, ScoredObservation, ScoreModifier } from '../ha-observation-scorer.ts';

// ---------- domain base scores ----------

/**
 * Base scores by domain.
 *
 * Domains not listed here default to 1.
 */
const DOMAIN_BASE_SCORES: ReadonlyMap<string, number> = new Map([
  ['alarm_control_panel', 9],
  ['lock', 7],
  ['binary_sensor', 3],
  ['cover', 5],
  ['climate', 4],
  ['light', 3],
  ['switch', 3],
  ['media_player', 2],
  ['fan', 2],
  ['vacuum', 2],
  ['input_boolean', 1],
]);

/**
 * Binary sensor device class overrides.
 *
 * Specific device classes get higher base scores than the generic binary_sensor default.
 */
const BINARY_SENSOR_CLASS_SCORES: ReadonlyMap<string, number> = new Map([
  ['motion', 2],
  ['occupancy', 2],
  ['door', 5],
  ['window', 5],
  ['garage_door', 6],
  ['lock', 7],
  ['smoke', 9],
  ['gas', 9],
  ['moisture', 8],
  ['problem', 4],
  ['tamper', 7],
  ['vibration', 3],
]);

// ---------- unusual time detection ----------

/**
 * Time buckets considered "unusual" for certain domain activity.
 *
 * Activity during these time windows gets a +2 modifier.
 */
const UNUSUAL_TIME_DOMAINS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  // Doors/locks opening at night or late night is unusual
  ['lock', new Set(['night', 'night_late'])],
  ['cover', new Set(['night', 'night_late'])],
  // Lights turning on during the day is unremarkable; turning on at 3am is unusual
  ['light', new Set(['night'])],
  // Alarm changes outside normal arrival/departure times
  ['alarm_control_panel', new Set(['night', 'night_late'])],
]);

// ---------- uncommon states ----------

/**
 * States considered uncommon (hence more noteworthy) per domain.
 *
 * Transitioning to these states triggers a +1 modifier.
 */
const UNCOMMON_STATES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['lock', new Set(['unlocked', 'jammed'])],
  ['alarm_control_panel', new Set(['triggered', 'pending'])],
  ['cover', new Set(['open', 'opening'])],
  ['climate', new Set(['heat', 'cool', 'heat_cool', 'dry', 'fan_only'])],
  ['binary_sensor', new Set(['on'])], // "on" for motion/door sensors = triggered
]);

// ---------- scene detection ----------

/**
 * Scene pattern definitions.
 *
 * Each scene has a set of indicator entity patterns (domain + state criteria).
 * A scene is detected when enough indicators fire within the same batch.
 */
interface SceneIndicator {
  domain: string;
  /** Required new_state values. */
  states?: string[];
  /** Device class for binary_sensors. */
  deviceClasses?: string[];
}

interface SceneDefinition {
  label: SceneLabel;
  /** Minimum indicators that must match to detect the scene. */
  minIndicators: number;
  indicators: SceneIndicator[];
  /** Time buckets where this scene is most likely. */
  likelyTimeBuckets?: string[];
}

const SCENE_DEFINITIONS: readonly SceneDefinition[] = [
  {
    label: 'bedtime',
    minIndicators: 2,
    likelyTimeBuckets: ['evening', 'night_late'],
    indicators: [
      { domain: 'light', states: ['off'] },
      { domain: 'lock', states: ['locked'] },
      { domain: 'cover', states: ['closed'] },
      { domain: 'media_player', states: ['off', 'idle', 'paused'] },
      { domain: 'climate', states: ['heat', 'cool', 'auto'] },
    ],
  },
  {
    label: 'morning_routine',
    minIndicators: 2,
    likelyTimeBuckets: ['morning_early', 'morning'],
    indicators: [
      { domain: 'light', states: ['on'] },
      { domain: 'cover', states: ['open', 'opening'] },
      { domain: 'media_player', states: ['playing'] },
      { domain: 'climate', states: ['heat', 'cool', 'auto'] },
    ],
  },
  {
    label: 'leaving_home',
    minIndicators: 2,
    likelyTimeBuckets: ['morning_early', 'morning', 'afternoon'],
    indicators: [
      { domain: 'lock', states: ['locked'] },
      { domain: 'light', states: ['off'] },
      { domain: 'alarm_control_panel', states: ['armed_away', 'armed_home'] },
      { domain: 'cover', states: ['closed'] },
    ],
  },
  {
    label: 'arriving_home',
    minIndicators: 2,
    likelyTimeBuckets: ['afternoon', 'evening'],
    indicators: [
      { domain: 'lock', states: ['unlocked'] },
      { domain: 'light', states: ['on'] },
      { domain: 'alarm_control_panel', states: ['disarmed'] },
      { domain: 'cover', states: ['open', 'opening'] },
    ],
  },
];

// ---------- helpers ----------

/** Extract the domain from an entity_id. */
function extractDomain(entityId: string): string {
  const dotIndex = entityId.indexOf('.');
  return dotIndex > 0 ? entityId.slice(0, dotIndex) : entityId;
}

/** Clamp a score to the valid 0..10 range. */
function clampScore(score: number): number {
  return Math.max(0, Math.min(10, Math.round(score)));
}

/** Extract device_class from attributes, if present. */
function getDeviceClass(attrs: Record<string, unknown>): string | undefined {
  return typeof attrs.device_class === 'string' ? attrs.device_class : undefined;
}

// ---------- RuleBasedScorer ----------

/**
 * Scores HA observations using configurable domain-based rules,
 * temporal modifiers, and scene pattern detection.
 */
export class RuleBasedScorer implements ObservationScorer {
  readonly id = 'rule-based';

  /**
   * Score a single state change observation.
   */
  score(change: HaStateChange, context: ObservationContext, tier: EntityTier): ScoredObservation {
    // Escalate-tier entities always get score 10
    if (tier === 'escalate') {
      return {
        change,
        score: 10,
        scene_label: null,
        score_breakdown: {
          base: 10,
          modifiers: [{ reason: 'escalate tier', delta: 0 }],
          final: 10,
        },
      };
    }

    // Log-only tier always gets score 0
    if (tier === 'log_only') {
      return {
        change,
        score: 0,
        scene_label: null,
        score_breakdown: {
          base: 0,
          modifiers: [{ reason: 'log_only tier', delta: 0 }],
          final: 0,
        },
      };
    }

    // Ignore and geo tiers should not normally reach the scorer,
    // but handle gracefully with score 0
    if (tier === 'ignore' || tier === 'geo') {
      return {
        change,
        score: 0,
        scene_label: null,
        score_breakdown: {
          base: 0,
          modifiers: [{ reason: `${tier} tier — not scored`, delta: 0 }],
          final: 0,
        },
      };
    }

    // --- Triage scoring ---
    const domain = extractDomain(change.entity_id);
    const deviceClass = getDeviceClass(change.new_attributes);

    // Base score
    const base = this.getBaseScore(domain, deviceClass);
    const modifiers: ScoreModifier[] = [];

    // Modifier: unusual time (+2)
    const unusualTimes = UNUSUAL_TIME_DOMAINS.get(domain);
    if (unusualTimes?.has(context.time_bucket)) {
      modifiers.push({ reason: 'unusual time of day', delta: 2 });
    }

    // Modifier: uncommon state (+1)
    const uncommon = UNCOMMON_STATES.get(domain);
    if (uncommon?.has(change.new_state)) {
      modifiers.push({ reason: 'uncommon state transition', delta: 1 });
    }

    // Compute final
    const modifierSum = modifiers.reduce((sum, m) => sum + m.delta, 0);
    const final = clampScore(base + modifierSum);

    return {
      change,
      score: final,
      scene_label: null,
      score_breakdown: { base, modifiers, final },
    };
  }

  /**
   * Score a batch of state changes with scene detection.
   */
  scoreBatch(changes: HaStateChange[], context: ObservationContext, tiers: Map<string, EntityTier>): BatchScoreResult {
    // Score each observation individually
    const scored: ScoredObservation[] = changes.map((change) => {
      const tier = tiers.get(change.entity_id) ?? 'log_only';
      return this.score(change, context, tier);
    });

    // Detect scenes across the batch
    const detectedScenes = this.detectScenes(changes, context);

    // Tag observations that are part of a detected scene
    if (detectedScenes.length > 0) {
      const primaryScene = detectedScenes[0];
      for (const obs of scored) {
        if (obs.scene_label === null && this.isPartOfScene(obs.change, primaryScene)) {
          obs.scene_label = primaryScene;
        }
      }
    }

    // Filter for triage threshold
    const triaged = scored.filter((s) => s.score >= 4);

    return { scored, triaged, scenes: detectedScenes };
  }

  // ---------- private ----------

  /**
   * Get the base score for a domain, with device_class overrides for binary_sensor.
   */
  private getBaseScore(domain: string, deviceClass?: string): number {
    // Binary sensor device class overrides
    if (domain === 'binary_sensor' && deviceClass) {
      const classScore = BINARY_SENSOR_CLASS_SCORES.get(deviceClass);
      if (classScore !== undefined) return classScore;
    }

    return DOMAIN_BASE_SCORES.get(domain) ?? 1;
  }

  /**
   * Detect scene patterns across a batch of changes.
   */
  private detectScenes(changes: HaStateChange[], context: ObservationContext): SceneLabel[] {
    const scenes: SceneLabel[] = [];

    for (const sceneDef of SCENE_DEFINITIONS) {
      // Check time bucket plausibility
      if (sceneDef.likelyTimeBuckets && !sceneDef.likelyTimeBuckets.includes(context.time_bucket)) {
        continue;
      }

      let matchedIndicators = 0;

      for (const indicator of sceneDef.indicators) {
        const indicatorMatched = changes.some((change) => {
          const domain = extractDomain(change.entity_id);
          if (domain !== indicator.domain) return false;

          // Check state match
          if (indicator.states && !indicator.states.includes(change.new_state)) {
            return false;
          }

          // Check device class match (for binary_sensor)
          if (indicator.deviceClasses) {
            const dc = getDeviceClass(change.new_attributes);
            if (!dc || !indicator.deviceClasses.includes(dc)) return false;
          }

          return true;
        });

        if (indicatorMatched) matchedIndicators++;
      }

      if (matchedIndicators >= sceneDef.minIndicators) {
        scenes.push(sceneDef.label);
      }
    }

    return scenes;
  }

  /**
   * Check if a state change is part of a specific scene.
   */
  private isPartOfScene(change: HaStateChange, scene: SceneLabel): boolean {
    const sceneDef = SCENE_DEFINITIONS.find((s) => s.label === scene);
    if (!sceneDef) return false;

    const domain = extractDomain(change.entity_id);
    return sceneDef.indicators.some((indicator) => {
      if (domain !== indicator.domain) return false;
      if (indicator.states && !indicator.states.includes(change.new_state)) return false;
      return true;
    });
  }
}
