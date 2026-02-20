/**
 * Tests for LLM-based observation scorer.
 *
 * Covers prompt formatting, response parsing, fallback behaviour,
 * rate limiting, health checks, and score clamping.
 *
 * Issue #1468, Epic #1440.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntityTier } from '../ha-entity-tiers.ts';
import type { HaStateChange } from '../ha-event-processor.ts';
import type { ObservationContext, TimeBucket } from '../ha-observation-scorer.ts';
import { LlmScorer, type LlmScorerConfig } from './llm-scorer.ts';

// ---------- helpers ----------

function makeChange(entityId: string, newState: string = 'on', attrs: Record<string, unknown> = {}, oldState: string | null = null): HaStateChange {
  const domain = entityId.split('.')[0];
  return {
    entity_id: entityId,
    domain,
    old_state: oldState,
    new_state: newState,
    old_attributes: {},
    new_attributes: attrs,
    last_changed: '2026-02-20T10:00:00Z',
    last_updated: '2026-02-20T10:00:00Z',
    context: { id: 'ctx-1', parent_id: null, user_id: null },
  };
}

function makeContext(timeBucket: TimeBucket = 'afternoon', dayOfWeek: string = 'wednesday', isWeekend: boolean = false): ObservationContext {
  return { day_of_week: dayOfWeek, time_bucket: timeBucket, is_weekend: isWeekend };
}

function defaultConfig(overrides: Partial<LlmScorerConfig> = {}): LlmScorerConfig {
  return {
    endpoint: 'http://localhost:10240',
    model: 'mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit',
    timeoutMs: 10_000,
    maxTokens: 500,
    fallbackOnError: true,
    maxConcurrent: 2,
    ...overrides,
  };
}

/** Build a valid LLM JSON response body for given entity scores and optional scene. */
function makeLlmResponse(scores: Record<string, number>, scene?: string): string {
  const content = JSON.stringify({ scores, scene: scene ?? null });
  return JSON.stringify({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: content }],
    model: 'test-model',
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 50 },
  });
}

/** Build a fetch Response mock from a body string. */
function mockFetchResponse(body: string, status: number = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------- tests ----------

describe('LlmScorer', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('scorer identity', () => {
    it('has the correct id', () => {
      const scorer = new LlmScorer(defaultConfig());
      expect(scorer.id).toBe('llm');
    });
  });

  describe('single score (falls back to rule-based)', () => {
    it('score() delegates to RuleBasedScorer since LLM is batch-only', () => {
      const scorer = new LlmScorer(defaultConfig());
      const change = makeChange('lock.front_door', 'locked');
      const ctx = makeContext();

      const result = scorer.score(change, ctx, 'triage');

      // RuleBasedScorer gives lock base score 7
      expect(result.score_breakdown.base).toBe(7);
      expect(result.score).toBe(7);
    });

    it('escalate tier returns score 10 via fallback', () => {
      const scorer = new LlmScorer(defaultConfig());
      const change = makeChange('sensor.water_leak', 'on');
      const ctx = makeContext();

      const result = scorer.score(change, ctx, 'escalate');
      expect(result.score).toBe(10);
    });
  });

  describe('prompt formatting', () => {
    it('sends correctly structured request to LLM endpoint', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse(
          makeLlmResponse({ 'lock.front_door': 8, 'light.kitchen': 2 }),
        ),
      );

      const scorer = new LlmScorer(defaultConfig());
      const changes = [
        makeChange('lock.front_door', 'unlocked', {}, 'locked'),
        makeChange('light.kitchen', 'on', {}, 'off'),
      ];
      const ctx = makeContext('evening', 'friday', false);
      const tiers = new Map<string, EntityTier>([
        ['lock.front_door', 'triage'],
        ['light.kitchen', 'triage'],
      ]);

      await scorer.scoreBatch(changes, ctx, tiers);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://localhost:10240/v1/messages');

      const body = JSON.parse(options.body as string);
      expect(body.model).toBe('mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit');
      expect(body.max_tokens).toBe(500);
      expect(body.system).toBeDefined();
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].role).toBe('user');

      // User message should contain entity data
      const userContent = body.messages[0].content;
      expect(userContent).toContain('lock.front_door');
      expect(userContent).toContain('light.kitchen');
      expect(userContent).toContain('friday');
      expect(userContent).toContain('evening');
    });

    it('includes from_state and to_state in user prompt', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse(makeLlmResponse({ 'cover.garage': 7 })),
      );

      const scorer = new LlmScorer(defaultConfig());
      const changes = [makeChange('cover.garage', 'open', {}, 'closed')];
      const ctx = makeContext();
      const tiers = new Map<string, EntityTier>([['cover.garage', 'triage']]);

      await scorer.scoreBatch(changes, ctx, tiers);

      const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string);
      const userContent = body.messages[0].content;
      expect(userContent).toContain('open');
      expect(userContent).toContain('closed');
    });
  });

  describe('response parsing', () => {
    it('parses valid JSON response into scored observations', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse(
          makeLlmResponse(
            { 'lock.front_door': 8, 'light.kitchen': 2 },
            'arriving_home',
          ),
        ),
      );

      const scorer = new LlmScorer(defaultConfig());
      const changes = [
        makeChange('lock.front_door', 'unlocked', {}, 'locked'),
        makeChange('light.kitchen', 'on', {}, 'off'),
      ];
      const ctx = makeContext('evening');
      const tiers = new Map<string, EntityTier>([
        ['lock.front_door', 'triage'],
        ['light.kitchen', 'triage'],
      ]);

      const result = await scorer.scoreBatch(changes, ctx, tiers);

      const lockObs = result.scored.find((s) => s.change.entity_id === 'lock.front_door');
      expect(lockObs?.score).toBe(8);
      expect(lockObs?.scene_label).toBe('arriving_home');

      const lightObs = result.scored.find((s) => s.change.entity_id === 'light.kitchen');
      expect(lightObs?.score).toBe(2);
      expect(lightObs?.scene_label).toBe('arriving_home');

      expect(result.scenes).toContain('arriving_home');
    });

    it('handles response with no scene', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse(makeLlmResponse({ 'light.kitchen': 3 })),
      );

      const scorer = new LlmScorer(defaultConfig());
      const changes = [makeChange('light.kitchen', 'on')];
      const ctx = makeContext();
      const tiers = new Map<string, EntityTier>([['light.kitchen', 'triage']]);

      const result = await scorer.scoreBatch(changes, ctx, tiers);

      expect(result.scored[0].scene_label).toBeNull();
      expect(result.scenes).toHaveLength(0);
    });

    it('falls back to rule-based for entities missing from LLM response', async () => {
      // LLM only returns score for one of two entities
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse(makeLlmResponse({ 'lock.front_door': 9 })),
      );

      const scorer = new LlmScorer(defaultConfig());
      const changes = [
        makeChange('lock.front_door', 'unlocked'),
        makeChange('light.kitchen', 'on'),
      ];
      const ctx = makeContext();
      const tiers = new Map<string, EntityTier>([
        ['lock.front_door', 'triage'],
        ['light.kitchen', 'triage'],
      ]);

      const result = await scorer.scoreBatch(changes, ctx, tiers);

      // lock gets LLM score
      const lockObs = result.scored.find((s) => s.change.entity_id === 'lock.front_door');
      expect(lockObs?.score).toBe(9);

      // light falls back to rule-based (base 3)
      const lightObs = result.scored.find((s) => s.change.entity_id === 'light.kitchen');
      expect(lightObs?.score).toBe(3);
    });

    it('falls back on malformed JSON in LLM text content', async () => {
      const badResponse = JSON.stringify({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'This is not valid JSON at all!' }],
        model: 'test-model',
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      });
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(badResponse));

      const scorer = new LlmScorer(defaultConfig());
      const changes = [makeChange('lock.front_door', 'unlocked')];
      const ctx = makeContext();
      const tiers = new Map<string, EntityTier>([['lock.front_door', 'triage']]);

      const result = await scorer.scoreBatch(changes, ctx, tiers);

      // Should fall back to rule-based: lock base 7 + uncommon state +1 = 8
      const lockObs = result.scored.find((s) => s.change.entity_id === 'lock.front_door');
      expect(lockObs?.score).toBe(8);
    });

    it('falls back when LLM response is missing scores field', async () => {
      const noScoresResponse = JSON.stringify({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: JSON.stringify({ scene: 'bedtime' }) }],
        model: 'test-model',
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      });
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(noScoresResponse));

      const scorer = new LlmScorer(defaultConfig());
      const changes = [makeChange('light.kitchen', 'off')];
      const ctx = makeContext();
      const tiers = new Map<string, EntityTier>([['light.kitchen', 'triage']]);

      const result = await scorer.scoreBatch(changes, ctx, tiers);

      // Falls back to rule-based: light base 3
      expect(result.scored[0].score).toBe(3);
    });

    it('falls back when LLM response content array is empty', async () => {
      const emptyContentResponse = JSON.stringify({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        content: [],
        model: 'test-model',
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      });
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(emptyContentResponse));

      const scorer = new LlmScorer(defaultConfig());
      const changes = [makeChange('light.kitchen', 'off')];
      const ctx = makeContext();
      const tiers = new Map<string, EntityTier>([['light.kitchen', 'triage']]);

      const result = await scorer.scoreBatch(changes, ctx, tiers);

      expect(result.scored[0].score).toBe(3);
    });
  });

  describe('score clamping', () => {
    it('clamps LLM scores above 10 to 10', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse(makeLlmResponse({ 'lock.front_door': 15 })),
      );

      const scorer = new LlmScorer(defaultConfig());
      const changes = [makeChange('lock.front_door', 'unlocked')];
      const ctx = makeContext();
      const tiers = new Map<string, EntityTier>([['lock.front_door', 'triage']]);

      const result = await scorer.scoreBatch(changes, ctx, tiers);

      expect(result.scored[0].score).toBe(10);
    });

    it('clamps LLM scores below 0 to 0', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse(makeLlmResponse({ 'light.kitchen': -3 })),
      );

      const scorer = new LlmScorer(defaultConfig());
      const changes = [makeChange('light.kitchen', 'on')];
      const ctx = makeContext();
      const tiers = new Map<string, EntityTier>([['light.kitchen', 'triage']]);

      const result = await scorer.scoreBatch(changes, ctx, tiers);

      expect(result.scored[0].score).toBe(0);
    });

    it('rounds fractional LLM scores', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse(makeLlmResponse({ 'light.kitchen': 3.7 })),
      );

      const scorer = new LlmScorer(defaultConfig());
      const changes = [makeChange('light.kitchen', 'on')];
      const ctx = makeContext();
      const tiers = new Map<string, EntityTier>([['light.kitchen', 'triage']]);

      const result = await scorer.scoreBatch(changes, ctx, tiers);

      expect(result.scored[0].score).toBe(4);
      expect(Number.isInteger(result.scored[0].score)).toBe(true);
    });
  });

  describe('tier overrides are preserved', () => {
    it('escalate tier always returns 10 regardless of LLM score', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse(makeLlmResponse({ 'sensor.water_leak': 3 })),
      );

      const scorer = new LlmScorer(defaultConfig());
      const changes = [makeChange('sensor.water_leak', 'on')];
      const ctx = makeContext();
      const tiers = new Map<string, EntityTier>([['sensor.water_leak', 'escalate']]);

      const result = await scorer.scoreBatch(changes, ctx, tiers);

      expect(result.scored[0].score).toBe(10);
    });

    it('log_only tier always returns 0 regardless of LLM score', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse(makeLlmResponse({ 'sensor.battery': 8 })),
      );

      const scorer = new LlmScorer(defaultConfig());
      const changes = [makeChange('sensor.battery', '85')];
      const ctx = makeContext();
      const tiers = new Map<string, EntityTier>([['sensor.battery', 'log_only']]);

      const result = await scorer.scoreBatch(changes, ctx, tiers);

      expect(result.scored[0].score).toBe(0);
    });

    it('ignore tier always returns 0', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse(makeLlmResponse({ 'automation.test': 5 })),
      );

      const scorer = new LlmScorer(defaultConfig());
      const changes = [makeChange('automation.test', 'on')];
      const ctx = makeContext();
      const tiers = new Map<string, EntityTier>([['automation.test', 'ignore']]);

      const result = await scorer.scoreBatch(changes, ctx, tiers);

      expect(result.scored[0].score).toBe(0);
    });
  });

  describe('fallback behaviour', () => {
    it('falls back on network error', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const scorer = new LlmScorer(defaultConfig());
      const changes = [makeChange('lock.front_door', 'unlocked')];
      const ctx = makeContext();
      const tiers = new Map<string, EntityTier>([['lock.front_door', 'triage']]);

      const result = await scorer.scoreBatch(changes, ctx, tiers);

      // Falls back to rule-based: lock base 7 + uncommon state +1 = 8
      expect(result.scored[0].score).toBe(8);
    });

    it('falls back on HTTP 500 error', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse('Internal Server Error', 500),
      );

      const scorer = new LlmScorer(defaultConfig());
      const changes = [makeChange('lock.front_door', 'locked')];
      const ctx = makeContext();
      const tiers = new Map<string, EntityTier>([['lock.front_door', 'triage']]);

      const result = await scorer.scoreBatch(changes, ctx, tiers);

      // Falls back to rule-based: lock base 7
      expect(result.scored[0].score).toBe(7);
    });

    it('falls back on abort/timeout', async () => {
      fetchSpy.mockRejectedValueOnce(new DOMException('The operation was aborted', 'AbortError'));

      const scorer = new LlmScorer(defaultConfig({ timeoutMs: 100 }));
      const changes = [makeChange('light.kitchen', 'on')];
      const ctx = makeContext();
      const tiers = new Map<string, EntityTier>([['light.kitchen', 'triage']]);

      const result = await scorer.scoreBatch(changes, ctx, tiers);

      // Falls back to rule-based: light base 3
      expect(result.scored[0].score).toBe(3);
    });

    it('throws when fallbackOnError is false and LLM fails', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const scorer = new LlmScorer(defaultConfig({ fallbackOnError: false }));
      const changes = [makeChange('lock.front_door', 'unlocked')];
      const ctx = makeContext();
      const tiers = new Map<string, EntityTier>([['lock.front_door', 'triage']]);

      await expect(scorer.scoreBatch(changes, ctx, tiers)).rejects.toThrow();
    });

    it('falls back on empty response body', async () => {
      fetchSpy.mockResolvedValueOnce(mockFetchResponse('', 200));

      const scorer = new LlmScorer(defaultConfig());
      const changes = [makeChange('light.kitchen', 'on')];
      const ctx = makeContext();
      const tiers = new Map<string, EntityTier>([['light.kitchen', 'triage']]);

      const result = await scorer.scoreBatch(changes, ctx, tiers);

      expect(result.scored[0].score).toBe(3);
    });
  });

  describe('rate limiting', () => {
    it('respects maxConcurrent limit', async () => {
      let concurrentCount = 0;
      let maxConcurrentSeen = 0;

      fetchSpy.mockImplementation(async () => {
        concurrentCount++;
        if (concurrentCount > maxConcurrentSeen) {
          maxConcurrentSeen = concurrentCount;
        }
        // Simulate some delay
        await new Promise((resolve) => setTimeout(resolve, 50));
        concurrentCount--;
        return mockFetchResponse(makeLlmResponse({ 'light.a': 3 }));
      });

      const scorer = new LlmScorer(defaultConfig({ maxConcurrent: 2 }));

      // Fire off 4 concurrent batch requests
      const promises = Array.from({ length: 4 }, (_, i) => {
        const changes = [makeChange(`light.${String.fromCharCode(97 + i)}`, 'on')];
        const ctx = makeContext();
        const tiers = new Map<string, EntityTier>([[`light.${String.fromCharCode(97 + i)}`, 'triage']]);
        return scorer.scoreBatch(changes, ctx, tiers);
      });

      await Promise.all(promises);

      expect(maxConcurrentSeen).toBeLessThanOrEqual(2);
    });
  });

  describe('health check', () => {
    it('returns healthy when endpoint responds with 200', async () => {
      fetchSpy.mockResolvedValueOnce(mockFetchResponse('OK', 200));

      const scorer = new LlmScorer(defaultConfig());
      const healthy = await scorer.healthCheck();

      expect(healthy).toBe(true);
    });

    it('returns unhealthy on network error', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const scorer = new LlmScorer(defaultConfig());
      const healthy = await scorer.healthCheck();

      expect(healthy).toBe(false);
    });

    it('returns unhealthy on HTTP error status', async () => {
      fetchSpy.mockResolvedValueOnce(mockFetchResponse('', 503));

      const scorer = new LlmScorer(defaultConfig());
      const healthy = await scorer.healthCheck();

      expect(healthy).toBe(false);
    });
  });

  describe('batch scoring', () => {
    it('handles empty batch', async () => {
      const scorer = new LlmScorer(defaultConfig());
      const ctx = makeContext();
      const tiers = new Map<string, EntityTier>();

      const result = await scorer.scoreBatch([], ctx, tiers);

      expect(result.scored).toHaveLength(0);
      expect(result.triaged).toHaveLength(0);
      expect(result.scenes).toHaveLength(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('filters triaged observations (score >= 4)', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse(
          makeLlmResponse({ 'lock.front_door': 8, 'light.kitchen': 2 }),
        ),
      );

      const scorer = new LlmScorer(defaultConfig());
      const changes = [
        makeChange('lock.front_door', 'unlocked'),
        makeChange('light.kitchen', 'on'),
      ];
      const ctx = makeContext();
      const tiers = new Map<string, EntityTier>([
        ['lock.front_door', 'triage'],
        ['light.kitchen', 'triage'],
      ]);

      const result = await scorer.scoreBatch(changes, ctx, tiers);

      expect(result.triaged).toHaveLength(1);
      expect(result.triaged[0].change.entity_id).toBe('lock.front_door');
    });

    it('defaults missing tiers to log_only (score 0)', async () => {
      const scorer = new LlmScorer(defaultConfig());
      const changes = [makeChange('sensor.unknown', '42')];
      const ctx = makeContext();
      const tiers = new Map<string, EntityTier>();

      // log_only tier is handled before LLM call, so no fetch
      const result = await scorer.scoreBatch(changes, ctx, tiers);

      expect(result.scored[0].score).toBe(0);
    });

    it('skips LLM call when all entities are non-triage tiers', async () => {
      const scorer = new LlmScorer(defaultConfig());
      const changes = [
        makeChange('sensor.water_leak', 'on'),
        makeChange('sensor.battery', '85'),
      ];
      const ctx = makeContext();
      const tiers = new Map<string, EntityTier>([
        ['sensor.water_leak', 'escalate'],
        ['sensor.battery', 'log_only'],
      ]);

      const result = await scorer.scoreBatch(changes, ctx, tiers);

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.scored[0].score).toBe(10); // escalate
      expect(result.scored[1].score).toBe(0); // log_only
    });
  });

  describe('score breakdown for LLM-scored observations', () => {
    it('includes LLM source in score breakdown', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse(makeLlmResponse({ 'lock.front_door': 7 })),
      );

      const scorer = new LlmScorer(defaultConfig());
      const changes = [makeChange('lock.front_door', 'unlocked')];
      const ctx = makeContext();
      const tiers = new Map<string, EntityTier>([['lock.front_door', 'triage']]);

      const result = await scorer.scoreBatch(changes, ctx, tiers);

      const obs = result.scored[0];
      expect(obs.score_breakdown.base).toBe(7);
      expect(obs.score_breakdown.final).toBe(7);
      expect(obs.score_breakdown.modifiers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ reason: expect.stringContaining('llm') }),
        ]),
      );
    });
  });
});
