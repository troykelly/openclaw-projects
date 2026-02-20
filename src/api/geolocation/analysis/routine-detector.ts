/**
 * Routine detector for Home Assistant observation patterns.
 *
 * Analyses ha_observations grouped by scene_label and time windows to find
 * recurring sequences of entity state changes. Uses Jaccard similarity to
 * identify and merge overlapping patterns, producing DetectedRoutine records
 * stored in the ha_routines table.
 *
 * Issue #1456, Epic #1440.
 */

import type { Pool } from 'pg';

// ---------- public types ----------

/** Represents a time window for a routine occurrence. */
export interface TimeWindow {
  /** Hour of day (0-23) when the routine typically starts. */
  start_hour: number;
  /** Hour of day (0-23) when the routine typically ends. */
  end_hour: number;
  /** Average duration in minutes. */
  avg_duration_minutes: number;
}

/** An entity action within a routine sequence. */
export interface SequenceStep {
  /** The HA entity ID. */
  entity_id: string;
  /** The HA domain. */
  domain: string;
  /** The target state. */
  to_state: string;
  /** Relative offset in minutes from routine start. */
  offset_minutes: number;
}

/** A detected routine pattern. */
export interface DetectedRoutine {
  /** Unique key for this routine (hash of core attributes). */
  key: string;
  /** Human-readable title derived from scene + time. */
  title: string;
  /** Longer description of the routine. */
  description: string;
  /** Confidence score 0..1. */
  confidence: number;
  /** Number of observed occurrences. */
  occurrences: number;
  /** First time this pattern was seen. */
  first_seen: Date;
  /** Most recent time this pattern was seen. */
  last_seen: Date;
  /** Time window of the routine. */
  time_window: TimeWindow;
  /** Days of week when this routine occurs (e.g. ['monday','tuesday']). */
  days: string[];
  /** Ordered entity sequence within the routine. */
  sequence: SequenceStep[];
}

/** Options for the analyze() method. */
export interface AnalyzeOptions {
  /** Minimum number of occurrences to consider a pattern a routine. Default: 3. */
  min_occurrences?: number;
  /** Jaccard similarity threshold for merging sequences. Default: 0.7. */
  merge_threshold?: number;
  /** Lookback period in days. Default: 14. */
  lookback_days?: number;
  /** Only analyse a specific scene label. */
  scene_label?: string;
}

// ---------- internal types ----------

/** Raw observation row from a DB query. */
interface ObservationRow {
  entity_id: string;
  domain: string;
  to_state: string;
  score: number;
  scene_label: string | null;
  timestamp: Date;
}

/** A group of observations in the same time window. */
interface WindowGroup {
  scene_label: string;
  day_of_week: string;
  hour: number;
  date: string;
  observations: ObservationRow[];
}

/** A candidate routine before storage. */
interface CandidateRoutine {
  scene_label: string;
  day_of_week: string;
  hour: number;
  entity_set: Set<string>;
  sequence: SequenceStep[];
  dates: Date[];
}

// ---------- constants ----------

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const DEFAULT_MIN_OCCURRENCES = 3;
const DEFAULT_MERGE_THRESHOLD = 0.7;
const DEFAULT_LOOKBACK_DAYS = 14;

// ---------- RoutineDetector ----------

export class RoutineDetector {
  constructor(private readonly pool: Pool) {}

  /**
   * Analyse observations within the given namespace to detect recurring patterns.
   *
   * Steps:
   * 1. Query observations within the lookback window
   * 2. Group by scene_label + day_of_week + hour
   * 3. Extract ordered entity sequences per group
   * 4. Find recurring patterns (appear >= min_occurrences)
   * 5. Merge similar sequences (Jaccard > merge_threshold)
   * 6. Calculate confidence: occurrences / expected
   * 7. Upsert into ha_routines
   */
  async analyze(namespace: string, options?: AnalyzeOptions): Promise<DetectedRoutine[]> {
    const minOccurrences = options?.min_occurrences ?? DEFAULT_MIN_OCCURRENCES;
    const mergeThreshold = options?.merge_threshold ?? DEFAULT_MERGE_THRESHOLD;
    const lookbackDays = options?.lookback_days ?? DEFAULT_LOOKBACK_DAYS;
    const sceneFilter = options?.scene_label;

    // Step 1: query observations
    const observations = await this.fetchObservations(namespace, lookbackDays, sceneFilter);
    if (observations.length === 0) return [];

    // Step 2: group by scene + day + hour
    const groups = this.groupObservations(observations);

    // Step 3 + 4: extract sequences and find recurring patterns
    const candidates = this.findCandidates(groups, minOccurrences);
    if (candidates.length === 0) return [];

    // Step 5: merge similar sequences
    const merged = this.mergeSimilar(candidates, mergeThreshold);

    // Step 6: calculate confidence and build DetectedRoutine objects
    const routines = this.buildRoutines(merged, lookbackDays);

    // Step 7: upsert into ha_routines
    await this.upsertRoutines(routines, namespace);

    return routines;
  }

  // ---------- private: data fetching ----------

  private async fetchObservations(
    namespace: string,
    lookbackDays: number,
    sceneFilter?: string,
  ): Promise<ObservationRow[]> {
    const params: unknown[] = [namespace, lookbackDays];
    let sceneClause = '';
    if (sceneFilter) {
      sceneClause = ' AND scene_label = $3';
      params.push(sceneFilter);
    }

    const sql = `
      SELECT entity_id, domain, to_state, score, scene_label, timestamp
      FROM ha_observations
      WHERE namespace = $1
        AND timestamp >= NOW() - ($2 || ' days')::interval
        AND scene_label IS NOT NULL
        AND score >= 2
        ${sceneClause}
      ORDER BY timestamp ASC
    `;

    const result = await this.pool.query<ObservationRow>(sql, params);
    return result.rows;
  }

  // ---------- private: grouping ----------

  private groupObservations(observations: ObservationRow[]): WindowGroup[] {
    const groupMap = new Map<string, WindowGroup>();

    for (const obs of observations) {
      const ts = new Date(obs.timestamp);
      const dayOfWeek = DAY_NAMES[ts.getUTCDay()];
      const hour = ts.getUTCHours();
      const dateStr = ts.toISOString().slice(0, 10);
      const scene = obs.scene_label ?? 'unknown';

      const key = `${scene}|${dayOfWeek}|${hour}|${dateStr}`;
      let group = groupMap.get(key);
      if (!group) {
        group = { scene_label: scene, day_of_week: dayOfWeek, hour, date: dateStr, observations: [] };
        groupMap.set(key, group);
      }
      group.observations.push(obs);
    }

    return [...groupMap.values()];
  }

  // ---------- private: candidate extraction ----------

  private findCandidates(groups: WindowGroup[], minOccurrences: number): CandidateRoutine[] {
    // Aggregate across dates: group by scene + dayOfWeek + hour
    const patternMap = new Map<string, { groups: WindowGroup[] }>();

    for (const g of groups) {
      const pKey = `${g.scene_label}|${g.day_of_week}|${g.hour}`;
      let entry = patternMap.get(pKey);
      if (!entry) {
        entry = { groups: [] };
        patternMap.set(pKey, entry);
      }
      entry.groups.push(g);
    }

    const candidates: CandidateRoutine[] = [];

    for (const [pKey, entry] of patternMap) {
      if (entry.groups.length < minOccurrences) continue;

      const [sceneLabel, dayOfWeek, hourStr] = pKey.split('|');
      const hour = parseInt(hourStr, 10);

      // Build entity sets per occurrence to find the intersection
      const entitySetsPerOccurrence = entry.groups.map((g) =>
        new Set(g.observations.map((o) => `${o.entity_id}:${o.to_state}`)),
      );

      // Find entities common to at least 50% of occurrences
      const entityCounts = new Map<string, number>();
      for (const eset of entitySetsPerOccurrence) {
        for (const e of eset) {
          entityCounts.set(e, (entityCounts.get(e) ?? 0) + 1);
        }
      }

      const threshold = Math.ceil(entry.groups.length * 0.5);
      const commonEntities = new Set<string>();
      for (const [entity, count] of entityCounts) {
        if (count >= threshold) {
          commonEntities.add(entity);
        }
      }

      if (commonEntities.size === 0) continue;

      // Build representative sequence from the most recent occurrence
      const latestGroup = entry.groups[entry.groups.length - 1];
      const startTime = Math.min(
        ...latestGroup.observations.map((o) => new Date(o.timestamp).getTime()),
      );

      const sequence: SequenceStep[] = latestGroup.observations
        .filter((o) => commonEntities.has(`${o.entity_id}:${o.to_state}`))
        .map((o) => ({
          entity_id: o.entity_id,
          domain: o.domain,
          to_state: o.to_state,
          offset_minutes: Math.round((new Date(o.timestamp).getTime() - startTime) / 60000),
        }));

      const dates = entry.groups.map((g) => new Date(g.date));

      candidates.push({
        scene_label: sceneLabel,
        day_of_week: dayOfWeek,
        hour,
        entity_set: commonEntities,
        sequence,
        dates,
      });
    }

    return candidates;
  }

  // ---------- private: merging ----------

  private mergeSimilar(
    candidates: CandidateRoutine[],
    mergeThreshold: number,
  ): CandidateRoutine[] {
    const merged: CandidateRoutine[] = [];
    const consumed = new Set<number>();

    for (let i = 0; i < candidates.length; i++) {
      if (consumed.has(i)) continue;

      let current = candidates[i];
      consumed.add(i);

      for (let j = i + 1; j < candidates.length; j++) {
        if (consumed.has(j)) continue;

        const other = candidates[j];
        if (current.scene_label !== other.scene_label) continue;

        const similarity = jaccardSimilarity(current.entity_set, other.entity_set);
        if (similarity >= mergeThreshold) {
          current = this.mergeCandidates(current, other);
          consumed.add(j);
        }
      }

      merged.push(current);
    }

    return merged;
  }

  private mergeCandidates(a: CandidateRoutine, b: CandidateRoutine): CandidateRoutine {
    const mergedEntities = new Set([...a.entity_set, ...b.entity_set]);
    const mergedDates = [...new Set([...a.dates, ...b.dates].map((d) => d.getTime()))].map(
      (t) => new Date(t),
    );
    mergedDates.sort((x, y) => x.getTime() - y.getTime());

    // Keep the longer sequence
    const sequence = a.sequence.length >= b.sequence.length ? a.sequence : b.sequence;

    return {
      scene_label: a.scene_label,
      day_of_week: a.day_of_week,
      hour: Math.min(a.hour, b.hour),
      entity_set: mergedEntities,
      sequence,
      dates: mergedDates,
    };
  }

  // ---------- private: build routines ----------

  private buildRoutines(candidates: CandidateRoutine[], lookbackDays: number): DetectedRoutine[] {
    return candidates.map((c) => {
      const occurrences = c.dates.length;
      // Expected = number of weeks in the lookback period that include this day
      const expectedWeeks = Math.max(1, Math.floor(lookbackDays / 7));
      const confidence = Math.min(1, occurrences / expectedWeeks);

      const firstSeen = c.dates[0];
      const lastSeen = c.dates[c.dates.length - 1];

      // Collect unique days of week across all occurrence dates
      const daysSet = new Set<string>();
      for (const d of c.dates) {
        daysSet.add(DAY_NAMES[d.getUTCDay()]);
      }

      const avgDuration =
        c.sequence.length > 0
          ? Math.max(1, c.sequence[c.sequence.length - 1].offset_minutes)
          : 0;

      const key = generateRoutineKey(c.scene_label, c.hour, [...daysSet].sort());
      const title = formatTitle(c.scene_label, c.hour);
      const description = formatDescription(c.scene_label, c.hour, [...daysSet].sort(), occurrences);

      return {
        key,
        title,
        description,
        confidence,
        occurrences,
        first_seen: firstSeen,
        last_seen: lastSeen,
        time_window: {
          start_hour: c.hour,
          end_hour: Math.min(23, c.hour + Math.max(1, Math.ceil(avgDuration / 60))),
          avg_duration_minutes: avgDuration,
        },
        days: [...daysSet].sort(),
        sequence: c.sequence,
      };
    });
  }

  // ---------- private: persistence ----------

  private async upsertRoutines(routines: DetectedRoutine[], namespace: string): Promise<void> {
    for (const r of routines) {
      await this.pool.query(
        `INSERT INTO ha_routines (
          namespace, key, title, description, confidence,
          observations_count, first_seen, last_seen,
          time_window, days, sequence, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'tentative')
        ON CONFLICT (namespace, key) DO UPDATE SET
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          confidence = EXCLUDED.confidence,
          observations_count = EXCLUDED.observations_count,
          last_seen = EXCLUDED.last_seen,
          time_window = EXCLUDED.time_window,
          days = EXCLUDED.days,
          sequence = EXCLUDED.sequence,
          updated_at = NOW()
        WHERE ha_routines.status != 'rejected'`,
        [
          namespace,
          r.key,
          r.title,
          r.description,
          r.confidence,
          r.occurrences,
          r.first_seen,
          r.last_seen,
          JSON.stringify(r.time_window),
          r.days,
          JSON.stringify(r.sequence),
        ],
      );
    }
  }
}

// ---------- utility functions (exported for testing) ----------

/**
 * Compute the Jaccard similarity coefficient between two sets.
 * Returns 0 if both sets are empty.
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;

  let intersectionSize = 0;
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;

  for (const item of smaller) {
    if (larger.has(item)) intersectionSize++;
  }

  const unionSize = a.size + b.size - intersectionSize;
  return unionSize === 0 ? 0 : intersectionSize / unionSize;
}

/**
 * Generate a deterministic key for a routine based on scene, hour, and days.
 */
export function generateRoutineKey(scene: string, hour: number, days: string[]): string {
  return `${scene}:${hour}:${days.join(',')}`;
}

/**
 * Format a human-readable title for a routine.
 */
export function formatTitle(scene: string, hour: number): string {
  const period = hour < 6 ? 'Night' : hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening';
  const sceneTitle = scene.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return `${period} ${sceneTitle}`;
}

/**
 * Format a description for a detected routine.
 */
export function formatDescription(
  scene: string,
  hour: number,
  days: string[],
  occurrences: number,
): string {
  const daysStr = days.length === 7 ? 'every day' : days.join(', ');
  const timeStr = `${hour.toString().padStart(2, '0')}:00`;
  return `Detected ${scene.replace(/_/g, ' ')} pattern around ${timeStr} on ${daysStr} (observed ${occurrences} times)`;
}
