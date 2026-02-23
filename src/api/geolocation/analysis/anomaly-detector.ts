// NOTE: Intentionally unwired — pending #1603 (HA Connector Container)

/**
 * Anomaly detector for Home Assistant observation patterns.
 *
 * Evaluates current observations and known routines to detect anomalies:
 * - missing_routine: a confirmed routine did not fire when expected
 * - unexpected_activity: activity at an unusual time/context
 * - routine_deviation: a routine fired with significant differences
 * - escalation: a critical entity changed state unexpectedly
 *
 * Notification thresholds:
 * - Score 1-4: log only
 * - Score 5-7: opt-in notify
 * - Score 8-10: always notify
 *
 * Graceful cold-start: produces no anomalies when no confirmed routines exist.
 *
 * Issue #1458, Epic #1440.
 */

import type { Pool } from 'pg';
import type { ObservationContext } from '../ha-observation-scorer.ts';

// ---------- public types ----------

/** Anomaly classification types. */
export type AnomalyType =
  | 'missing_routine'
  | 'unexpected_activity'
  | 'routine_deviation'
  | 'escalation';

/** A detected anomaly. */
export interface DetectedAnomaly {
  /** The type of anomaly. */
  type: AnomalyType;
  /** Severity score 0-10. */
  score: number;
  /** Human-readable explanation. */
  reason: string;
  /** Involved entity IDs. */
  entities: string[];
  /** Related routine ID (if applicable). */
  routine_id: string | null;
  /** Whether this anomaly should trigger a notification. */
  should_notify: boolean;
  /** Additional context. */
  context: Record<string, unknown>;
}

/** A routine row from ha_routines (confirmed status only). */
export interface RoutineRow {
  id: string;
  namespace: string;
  key: string;
  title: string;
  confidence: number;
  time_window: { start_hour: number; end_hour: number; avg_duration_minutes: number };
  days: string[];
  sequence: Array<{
    entity_id: string;
    domain: string;
    to_state: string;
    offset_minutes: number;
  }>;
}

/** A simplified observation for anomaly evaluation. */
export interface ObservationInput {
  entity_id: string;
  domain: string;
  to_state: string;
  score: number;
  scene_label: string | null;
  timestamp: Date;
}

// ---------- constants ----------

/** Minimum anomaly score to trigger opt-in notification. */
const NOTIFY_OPT_IN_THRESHOLD = 5;
/** Minimum anomaly score to always notify. */
const NOTIFY_ALWAYS_THRESHOLD = 8;

/** High-severity domains that trigger escalation anomalies. */
const ESCALATION_DOMAINS = new Set([
  'alarm_control_panel',
  'lock',
]);

/** High-severity states that trigger escalation anomalies. */
const ESCALATION_STATES = new Set([
  'triggered',
  'unlocked',
  'disarmed',
]);

// ---------- AnomalyDetector ----------

export class AnomalyDetector {
  constructor(private readonly pool: Pool) {}

  /**
   * Evaluate a set of observations against confirmed routines to detect anomalies.
   *
   * Escalation-tier events (alarm/lock) are ALWAYS checked, even during cold-start.
   * Other anomaly types require confirmed routines.
   */
  async evaluate(
    observations: ObservationInput[],
    context: ObservationContext,
    namespace: string,
  ): Promise<DetectedAnomaly[]> {
    const anomalies: DetectedAnomaly[] = [];

    // Always check for escalations (critical entity changes), even with no routines
    anomalies.push(...this.checkEscalations(observations, context));

    const routines = await this.fetchConfirmedRoutines(namespace);

    // Cold-start: no routines → skip routine-dependent anomaly checks
    if (routines.length > 0) {
      // Check for unexpected activity
      anomalies.push(...this.checkUnexpectedActivity(observations, routines, context));

      // Check for routine deviations
      anomalies.push(...this.checkRoutineDeviations(observations, routines, context));
    }

    // Store detected anomalies
    if (anomalies.length > 0) {
      await this.storeAnomalies(anomalies, namespace);
    }

    return anomalies;
  }

  /**
   * Check for missing routines that should have occurred but did not.
   *
   * Scans confirmed routines to see if any were expected in recent hours
   * but have no matching observations.
   */
  async checkMissing(namespace: string): Promise<DetectedAnomaly[]> {
    const routines = await this.fetchConfirmedRoutines(namespace);
    if (routines.length === 0) return [];

    const now = new Date();
    const currentHour = now.getUTCHours();
    const currentDay = [
      'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
    ][now.getUTCDay()];

    const anomalies: DetectedAnomaly[] = [];

    for (const routine of routines) {
      // Only check routines expected today
      if (!routine.days.includes(currentDay)) continue;

      // Only check routines whose window has fully passed (end_hour < currentHour)
      if (routine.time_window.end_hour >= currentHour) continue;

      // Check if there are observations matching this routine's entities in the window
      const hasMatch = await this.hasRecentObservations(
        namespace,
        routine,
        now,
      );

      if (!hasMatch) {
        const score = Math.min(10, Math.round(routine.confidence * 6 + 2));
        anomalies.push({
          type: 'missing_routine',
          score,
          reason: `Expected routine "${routine.title}" did not occur during ${routine.time_window.start_hour}:00-${routine.time_window.end_hour}:00`,
          entities: routine.sequence.map((s) => s.entity_id),
          routine_id: routine.id,
          should_notify: score >= NOTIFY_OPT_IN_THRESHOLD,
          context: {
            expected_window: routine.time_window,
            expected_day: currentDay,
            routine_confidence: routine.confidence,
          },
        });
      }
    }

    if (anomalies.length > 0) {
      await this.storeAnomalies(anomalies, namespace);
    }

    return anomalies;
  }

  // ---------- private: routine fetching ----------

  private async fetchConfirmedRoutines(namespace: string): Promise<RoutineRow[]> {
    const result = await this.pool.query<RoutineRow>(
      `SELECT id, namespace, key, title, confidence, time_window, days, sequence
       FROM ha_routines
       WHERE namespace = $1 AND status = 'confirmed'
       ORDER BY confidence DESC`,
      [namespace],
    );
    return result.rows;
  }

  // ---------- private: anomaly checks ----------

  private checkUnexpectedActivity(
    observations: ObservationInput[],
    routines: RoutineRow[],
    context: ObservationContext,
  ): DetectedAnomaly[] {
    const anomalies: DetectedAnomaly[] = [];

    // Build a set of entity+state combinations expected from active routines
    const expectedEntities = new Set<string>();
    for (const routine of routines) {
      if (!this.isRoutineActive(routine, context)) continue;
      for (const step of routine.sequence) {
        expectedEntities.add(`${step.entity_id}:${step.to_state}`);
      }
    }

    // If no routines are active now, no unexpected activity can be flagged
    if (expectedEntities.size === 0) return anomalies;

    // Find observations not matching any active routine
    const unexpectedObs = observations.filter(
      (o) => o.score >= 3 && !expectedEntities.has(`${o.entity_id}:${o.to_state}`),
    );

    if (unexpectedObs.length === 0) return anomalies;

    // Group by domain for cleaner reporting
    const entityIds = [...new Set(unexpectedObs.map((o) => o.entity_id))];
    const maxScore = Math.max(...unexpectedObs.map((o) => o.score));
    const anomalyScore = Math.min(10, maxScore + 1);

    anomalies.push({
      type: 'unexpected_activity',
      score: anomalyScore,
      reason: `${unexpectedObs.length} unexpected entity changes detected during ${context.time_bucket}`,
      entities: entityIds,
      routine_id: null,
      should_notify: anomalyScore >= NOTIFY_OPT_IN_THRESHOLD,
      context: {
        time_bucket: context.time_bucket,
        day_of_week: context.day_of_week,
        observation_count: unexpectedObs.length,
      },
    });

    return anomalies;
  }

  private checkRoutineDeviations(
    observations: ObservationInput[],
    routines: RoutineRow[],
    context: ObservationContext,
  ): DetectedAnomaly[] {
    const anomalies: DetectedAnomaly[] = [];

    for (const routine of routines) {
      if (!this.isRoutineActive(routine, context)) continue;

      // Find observations that match this routine's entities
      const routineEntityIds = new Set(routine.sequence.map((s) => s.entity_id));
      const matchingObs = observations.filter((o) => routineEntityIds.has(o.entity_id));

      if (matchingObs.length === 0) continue;

      // Check for state deviations: entity changed to different state than expected
      const deviations: string[] = [];
      for (const step of routine.sequence) {
        const match = matchingObs.find((o) => o.entity_id === step.entity_id);
        if (match && match.to_state !== step.to_state) {
          deviations.push(
            `${step.entity_id}: expected ${step.to_state}, got ${match.to_state}`,
          );
        }
      }

      if (deviations.length > 0) {
        const deviationRatio = deviations.length / routine.sequence.length;
        const score = Math.min(10, Math.round(deviationRatio * 6 + 2));

        anomalies.push({
          type: 'routine_deviation',
          score,
          reason: `Routine "${routine.title}" deviated: ${deviations.join('; ')}`,
          entities: deviations.map((d) => d.split(':')[0]),
          routine_id: routine.id,
          should_notify: score >= NOTIFY_OPT_IN_THRESHOLD,
          context: {
            routine_key: routine.key,
            deviation_count: deviations.length,
            total_steps: routine.sequence.length,
            deviations,
          },
        });
      }
    }

    return anomalies;
  }

  private checkEscalations(
    observations: ObservationInput[],
    context: ObservationContext,
  ): DetectedAnomaly[] {
    const anomalies: DetectedAnomaly[] = [];

    for (const o of observations) {
      const isDomain = ESCALATION_DOMAINS.has(o.domain);
      const isState = ESCALATION_STATES.has(o.to_state);

      if (!isDomain || !isState) continue;

      // Higher scores at night
      const isNight = context.time_bucket === 'night' || context.time_bucket === 'night_late';
      const score = isNight ? 10 : 8;

      anomalies.push({
        type: 'escalation',
        score,
        reason: `Critical entity ${o.entity_id} changed to ${o.to_state} during ${context.time_bucket}`,
        entities: [o.entity_id],
        routine_id: null,
        should_notify: score >= NOTIFY_ALWAYS_THRESHOLD,
        context: {
          domain: o.domain,
          to_state: o.to_state,
          time_bucket: context.time_bucket,
          is_night: isNight,
        },
      });
    }

    return anomalies;
  }

  // ---------- private: helpers ----------

  private isRoutineActive(routine: RoutineRow, context: ObservationContext): boolean {
    if (!routine.days.includes(context.day_of_week)) return false;

    // Map time_bucket to approximate hour range
    const hourRanges: Record<string, [number, number]> = {
      night: [0, 5],
      morning_early: [6, 8],
      morning: [9, 11],
      afternoon: [12, 16],
      evening: [17, 20],
      night_late: [21, 23],
    };

    const range = hourRanges[context.time_bucket];
    if (!range) return false;

    const [rangeStart, rangeEnd] = range;
    return routine.time_window.start_hour <= rangeEnd && routine.time_window.end_hour >= rangeStart;
  }

  private async hasRecentObservations(
    namespace: string,
    routine: RoutineRow,
    now: Date,
  ): Promise<boolean> {
    const entityIds = routine.sequence.map((s) => s.entity_id);
    if (entityIds.length === 0) return false;

    // Look for observations today within the routine's time window
    const todayStart = new Date(now);
    todayStart.setUTCHours(routine.time_window.start_hour, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setUTCHours(routine.time_window.end_hour, 59, 59, 999);

    const result = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM ha_observations
       WHERE namespace = $1
         AND entity_id = ANY($2)
         AND timestamp BETWEEN $3 AND $4`,
      [namespace, entityIds, todayStart, todayEnd],
    );

    return parseInt(result.rows[0]?.count ?? '0', 10) > 0;
  }

  // ---------- private: persistence ----------

  private async storeAnomalies(anomalies: DetectedAnomaly[], namespace: string): Promise<void> {
    for (const a of anomalies) {
      await this.pool.query(
        `INSERT INTO ha_anomalies (
          namespace, timestamp, routine_id, score, reason,
          entities, notified, resolved, context
        ) VALUES ($1, NOW(), $2, $3, $4, $5, $6, FALSE, $7)`,
        [
          namespace,
          a.routine_id,
          a.score,
          a.reason,
          a.entities,
          a.should_notify,
          JSON.stringify(a.context),
        ],
      );
    }
  }
}
