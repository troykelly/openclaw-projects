// NOTE: Intentionally unwired — pending #1603 (HA Connector Container)

/**
 * LLM-based observation scorer for Home Assistant state changes.
 *
 * Sends observation batches to a local LLM (Anthropic Messages API compatible
 * endpoint) for richer triage scoring and scene detection. Falls back to the
 * rule-based scorer when the LLM is unavailable, times out, or returns a
 * malformed response.
 *
 * Issue #1468, Epic #1440.
 */

import type { EntityTier } from '../ha-entity-tiers.ts';
import type { HaStateChange } from '../ha-event-processor.ts';
import type {
  BatchScoreResult,
  ObservationContext,
  ObservationScorer,
  SceneLabel,
  ScoreBreakdown,
  ScoredObservation,
} from '../ha-observation-scorer.ts';
import { RuleBasedScorer } from './rule-based-scorer.ts';

// ---------- config ----------

/** Configuration for the LLM scorer. */
export interface LlmScorerConfig {
  /** LLM endpoint base URL (e.g., "http://mst001.company.sy3.aperim.net:10240"). */
  endpoint: string;
  /** Model identifier (e.g., "mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit"). */
  model: string;
  /** Request timeout in milliseconds. Default: 10000. */
  timeoutMs: number;
  /** Maximum tokens for LLM response. Default: 500. */
  maxTokens: number;
  /** Whether to fall back to rule-based scorer on LLM errors. Default: true. */
  fallbackOnError: boolean;
  /** Maximum concurrent LLM requests (semaphore). Default: 2. */
  maxConcurrent: number;
}

// ---------- LLM response types ----------

/** Shape of the inner JSON the LLM returns in its text content. */
interface LlmScoringResponse {
  scores: Record<string, number>;
  scene: string | null;
}

/** A single content block from the Anthropic Messages API response. */
interface ContentBlock {
  type: string;
  text?: string;
}

/** Top-level Anthropic Messages API response shape. */
interface MessagesApiResponse {
  content: ContentBlock[];
}

// ---------- prompts ----------

const SYSTEM_PROMPT = `You are a home state change triage agent. Your job is to score Home Assistant state change observations for importance on a scale of 0 to 10.

Scoring guide:
- 0-2: Routine activity. Expected state changes that require no attention (lights on during day, motion sensors in high-traffic areas).
- 3-5: Notable activity. Worth recording but not urgent (doors opening during normal hours, climate adjustments).
- 6-8: Significant activity. Unusual or security-relevant changes (doors/locks at unusual hours, garage opening late at night).
- 9-10: Critical activity. Immediate attention required (alarm triggered, smoke/gas detected, water leak).

You may also detect "scenes" — coordinated patterns of state changes that indicate a household activity (e.g., "bedtime", "morning_routine", "leaving_home", "arriving_home").

Respond with ONLY a JSON object in this exact format (no markdown, no explanation):
{"scores": {"entity_id": score, ...}, "scene": "scene_label_or_null"}`;

// ---------- semaphore ----------

/**
 * Simple counting semaphore for limiting concurrent async operations.
 *
 * Callers acquire a slot before performing work, and release it when done.
 * If all slots are taken, acquire() waits until one becomes available.
 */
class Semaphore {
  private current = 0;
  private readonly waitQueue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  /** Acquire a semaphore slot. Resolves when a slot is available. */
  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waitQueue.push(() => {
        this.current++;
        resolve();
      });
    });
  }

  /** Release a semaphore slot, waking the next waiter if any. */
  release(): void {
    this.current--;
    const next = this.waitQueue.shift();
    if (next) {
      next();
    }
  }
}

// ---------- helpers ----------

/** Allowed URL schemes for the LLM endpoint. */
const ALLOWED_LLM_SCHEMES = new Set(['http:', 'https:']);

/**
 * Validate that a URL string is well-formed and uses an allowed scheme (http/https).
 * Prevents SSRF via exotic schemes (file:, ftp:, data:, etc.).
 *
 * @param url - URL string to validate
 * @returns The parsed URL if valid
 * @throws Error if the URL is invalid or uses a disallowed scheme
 */
function validateLlmEndpointUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid LLM endpoint URL: ${url}`);
  }

  if (!ALLOWED_LLM_SCHEMES.has(parsed.protocol)) {
    throw new Error(
      `LLM endpoint scheme "${parsed.protocol.replace(':', '')}" is not allowed; use http or https`,
    );
  }

  return parsed;
}

/** Clamp and round a score to the valid 0..10 integer range. Returns 0 for NaN/non-finite. */
function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(10, Math.round(score)));
}

/** Tiers that are resolved before the LLM is consulted. */
const PRE_RESOLVED_TIERS = new Set<EntityTier>(['escalate', 'log_only', 'ignore', 'geo']);

// ---------- LlmScorer ----------

/**
 * Scores HA observations by sending batches to a local LLM endpoint.
 *
 * The LLM receives structured context about each state change and returns
 * scores (0-10) with optional scene detection. When the LLM is unavailable
 * or returns an unparseable response, the scorer falls back to the
 * RuleBasedScorer for consistent availability.
 *
 * Rate limiting uses a simple semaphore to cap concurrent LLM requests,
 * preventing overload on the inference server.
 */
export class LlmScorer implements ObservationScorer {
  readonly id = 'llm';

  private readonly config: LlmScorerConfig;
  private readonly fallbackScorer: RuleBasedScorer;
  private readonly semaphore: Semaphore;

  constructor(config: LlmScorerConfig) {
    this.config = config;
    this.fallbackScorer = new RuleBasedScorer();
    this.semaphore = new Semaphore(config.maxConcurrent);
  }

  /**
   * Score a single observation.
   *
   * The LLM scorer operates on batches for efficiency, so single-observation
   * scoring delegates to the rule-based fallback scorer.
   */
  score(change: HaStateChange, context: ObservationContext, tier: EntityTier): ScoredObservation {
    return this.fallbackScorer.score(change, context, tier);
  }

  /**
   * Score a batch of state changes using the LLM.
   *
   * Pre-resolved tiers (escalate, log_only, ignore, geo) are handled
   * locally without consulting the LLM. Only triage-tier entities are
   * sent to the LLM for scoring.
   *
   * @param changes - Array of HA state changes
   * @param context - Temporal context (shared across the batch)
   * @param tiers - Map of entity_id to resolved tier
   * @returns Batch score result with triage filtering
   */
  async scoreBatch(changes: HaStateChange[], context: ObservationContext, tiers: Map<string, EntityTier>): Promise<BatchScoreResult> {
    if (changes.length === 0) {
      return { scored: [], triaged: [], scenes: [] };
    }

    // Partition changes into pre-resolved and LLM-eligible
    const preResolved: ScoredObservation[] = [];
    const llmEligible: HaStateChange[] = [];

    for (const change of changes) {
      const tier = tiers.get(change.entity_id) ?? 'log_only';
      if (PRE_RESOLVED_TIERS.has(tier)) {
        preResolved.push(this.fallbackScorer.score(change, context, tier));
      } else {
        llmEligible.push(change);
      }
    }

    // If no LLM-eligible entities, skip the LLM call entirely
    if (llmEligible.length === 0) {
      const triaged = preResolved.filter((s) => s.score >= 4);
      const scenes = this.collectScenes(preResolved);
      return { scored: preResolved, triaged, scenes };
    }

    // Attempt LLM scoring for eligible entities
    let llmScored: ScoredObservation[];
    try {
      llmScored = await this.scoreBatchViaLlm(llmEligible, context, tiers);
    } catch (err: unknown) {
      if (!this.config.fallbackOnError) {
        throw err;
      }
      // Fall back to rule-based scoring
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.warn(`[llm-scorer] LLM request failed, falling back to rule-based: ${errorMessage}`);
      llmScored = llmEligible.map((change) => {
        const tier = tiers.get(change.entity_id) ?? 'log_only';
        return this.fallbackScorer.score(change, context, tier);
      });
    }

    // Merge pre-resolved and LLM-scored in original order
    const allScored = this.mergeInOrder(changes, preResolved, llmScored);
    const triaged = allScored.filter((s) => s.score >= 4);
    const scenes = this.collectScenes(allScored);

    return { scored: allScored, triaged, scenes };
  }

  /**
   * Check whether the LLM endpoint is reachable.
   *
   * Sends a lightweight GET request to the endpoint base URL.
   *
   * @returns true if the endpoint responds with a 2xx status
   */
  async healthCheck(): Promise<boolean> {
    try {
      const validatedUrl = validateLlmEndpointUrl(this.config.endpoint);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5_000);
      try {
        const response = await fetch(validatedUrl.href, {
          method: 'GET',
          signal: controller.signal,
        });
        return response.ok;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch {
      return false;
    }
  }

  // ---------- private ----------

  /**
   * Send the LLM-eligible batch to the inference endpoint and parse the response.
   *
   * Uses a semaphore to limit concurrent requests to the LLM server.
   */
  private async scoreBatchViaLlm(
    changes: HaStateChange[],
    context: ObservationContext,
    tiers: Map<string, EntityTier>,
  ): Promise<ScoredObservation[]> {
    await this.semaphore.acquire();
    const startTime = Date.now();

    try {
      const userPrompt = this.formatUserPrompt(changes, context);
      const requestBody = {
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      };

      const validatedUrl = validateLlmEndpointUrl(`${this.config.endpoint}/v1/messages`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

      let response: Response;
      try {
        response = await fetch(validatedUrl.href, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      const durationMs = Date.now() - startTime;

      if (!response.ok) {
        console.warn(`[llm-scorer] LLM returned HTTP ${String(response.status)} in ${String(durationMs)}ms`);
        throw new Error(`LLM endpoint returned HTTP ${String(response.status)}`);
      }

      const responseText = await response.text();
      if (!responseText) {
        console.warn(`[llm-scorer] LLM returned empty response in ${String(durationMs)}ms`);
        throw new Error('LLM endpoint returned empty response');
      }

      const parsed = this.parseResponse(responseText);
      if (!parsed) {
        console.warn(`[llm-scorer] Failed to parse LLM response in ${String(durationMs)}ms`);
        throw new Error('Failed to parse LLM response');
      }

      console.info(`[llm-scorer] LLM scored ${String(changes.length)} entities in ${String(durationMs)}ms`);

      return this.buildScoredObservations(changes, context, tiers, parsed);
    } finally {
      this.semaphore.release();
    }
  }

  /**
   * Format the user prompt with structured batch data for the LLM.
   *
   * Includes entity_id, from_state, to_state, timestamp, day_of_week, and time.
   */
  private formatUserPrompt(changes: HaStateChange[], context: ObservationContext): string {
    const observations = changes.map((change) => ({
      entity_id: change.entity_id,
      from_state: change.old_state,
      to_state: change.new_state,
      timestamp: change.last_changed,
      day_of_week: context.day_of_week,
      time: context.time_bucket,
    }));

    return `Score these Home Assistant state changes:\n${JSON.stringify(observations, null, 2)}`;
  }

  /**
   * Parse the Anthropic Messages API response to extract scores and scene.
   *
   * Defensively handles malformed responses, missing fields, and invalid JSON.
   *
   * @returns Parsed scoring response, or null if parsing fails
   */
  private parseResponse(responseText: string): LlmScoringResponse | null {
    try {
      const apiResponse = JSON.parse(responseText) as MessagesApiResponse;

      if (!apiResponse.content || !Array.isArray(apiResponse.content) || apiResponse.content.length === 0) {
        return null;
      }

      const textBlock = apiResponse.content.find((block) => block.type === 'text');
      if (!textBlock?.text) {
        return null;
      }

      const inner = JSON.parse(textBlock.text) as Record<string, unknown>;

      // Validate the scores field exists and is an object
      if (!inner.scores || typeof inner.scores !== 'object' || Array.isArray(inner.scores)) {
        return null;
      }

      // Filter out NaN/non-finite score values
      const rawScores = inner.scores as Record<string, unknown>;
      const validScores: Record<string, number> = {};
      for (const [key, value] of Object.entries(rawScores)) {
        if (typeof value === 'number' && Number.isFinite(value)) {
          validScores[key] = value;
        }
      }

      return {
        scores: validScores,
        scene: typeof inner.scene === 'string' ? inner.scene : null,
      };
    } catch {
      return null;
    }
  }

  /**
   * Build ScoredObservation array from LLM response, falling back to
   * rule-based for entities the LLM did not score.
   */
  private buildScoredObservations(
    changes: HaStateChange[],
    context: ObservationContext,
    tiers: Map<string, EntityTier>,
    llmResponse: LlmScoringResponse,
  ): ScoredObservation[] {
    return changes.map((change) => {
      const tier = tiers.get(change.entity_id) ?? 'log_only';
      const llmScore = llmResponse.scores[change.entity_id];

      // If LLM didn't return a valid finite score for this entity, fall back
      if (llmScore === undefined || typeof llmScore !== 'number' || !Number.isFinite(llmScore)) {
        return this.fallbackScorer.score(change, context, tier);
      }

      const clamped = clampScore(llmScore);
      const scene: SceneLabel | null = llmResponse.scene ?? null;

      const breakdown: ScoreBreakdown = {
        base: clamped,
        modifiers: [{ reason: 'llm-scored', delta: 0 }],
        final: clamped,
      };

      return {
        change,
        score: clamped,
        scene_label: scene,
        score_breakdown: breakdown,
      };
    });
  }

  /**
   * Merge pre-resolved and LLM-scored observations in the original
   * change order for deterministic output.
   *
   * Uses the change object reference (identity) to match observations
   * back to their original position, preserving all entries even when
   * the same entity_id appears multiple times in a batch.
   */
  private mergeInOrder(
    originalChanges: HaStateChange[],
    preResolved: ScoredObservation[],
    llmScored: ScoredObservation[],
  ): ScoredObservation[] {
    // Key by change object reference to handle duplicate entity_ids
    const byChangeRef = new Map<HaStateChange, ScoredObservation>();
    for (const obs of preResolved) {
      byChangeRef.set(obs.change, obs);
    }
    for (const obs of llmScored) {
      byChangeRef.set(obs.change, obs);
    }

    return originalChanges.map((change) => {
      const obs = byChangeRef.get(change);
      if (!obs) {
        // Should not happen, but handle defensively
        return {
          change,
          score: 0,
          scene_label: null,
          score_breakdown: { base: 0, modifiers: [{ reason: 'missing from merge', delta: 0 }], final: 0 },
        };
      }
      return obs;
    });
  }

  /**
   * Collect unique scene labels from scored observations.
   */
  private collectScenes(scored: ScoredObservation[]): SceneLabel[] {
    const scenes = new Set<SceneLabel>();
    for (const obs of scored) {
      if (obs.scene_label) {
        scenes.add(obs.scene_label);
      }
    }
    return [...scenes];
  }
}
