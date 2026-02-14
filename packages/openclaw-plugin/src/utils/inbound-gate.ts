/**
 * Inbound message gate — unified pre-processing gate for inbound messages.
 *
 * Orchestrates spam filter, rate limiter, and token budget as a single
 * evaluation point before any message processing (embedding, linking, etc.).
 *
 * NOTE: All state (rate limiter windows, token budget counters) is held
 * in-memory and does not persist across process restarts or span multiple
 * instances. This is acceptable for single-instance deployments. For
 * multi-instance deployments, the rate limiter and token budget would need
 * to be backed by skill_store or an external store (e.g. Redis) to share
 * state across processes.
 *
 * Part of Issue #1225 — rate limiting and spam protection.
 */

import { isSpam, type SpamFilterConfig, type InboundMessage } from './spam-filter.js';
import { createRateLimiter, type RateLimiterConfig, type RateLimiter, type SenderTrust } from './rate-limiter.js';
import { createTokenBudget, type TokenBudgetConfig, type TokenBudget } from './token-budget.js';
import type { Logger } from '../logger.js';

/** Re-export InboundMessage for convenience */
export type { InboundMessage } from './spam-filter.js';

/** Actions the gate can take on a message */
export type GateAction = 'allow' | 'reject' | 'rate_limited' | 'budget_exceeded' | 'defer';

/** Result of the inbound gate evaluation */
export interface InboundGateDecision {
  /** Action to take on the message */
  action: GateAction;
  /** Human-readable reason for the decision, null if allowed */
  reason: string | null;
  /** Whether to skip embedding for this message */
  skipEmbedding: boolean;
}

/** Configuration for the inbound gate */
export interface InboundGateConfig {
  /** Spam filter configuration */
  spamFilter: SpamFilterConfig;
  /** Rate limiter configuration */
  rateLimiter: RateLimiterConfig;
  /** Token budget configuration */
  tokenBudget: TokenBudgetConfig;
  /** Whether to defer processing for unknown senders */
  deferUnknownSenders?: boolean;
}

/** Aggregate gate statistics */
export interface InboundGateStats {
  /** Total messages evaluated */
  totalEvaluated: number;
  /** Messages allowed through */
  allowed: number;
  /** Messages rejected as spam */
  rejected: number;
  /** Messages rate-limited */
  rateLimited: number;
  /** Messages denied due to budget */
  budgetExceeded: number;
  /** Messages deferred */
  deferred: number;
}

/** Inbound gate instance */
export interface InboundGate {
  /**
   * Evaluate a message and return a gate decision.
   * When estimatedTokens > 0 and the message is allowed, the token budget
   * is atomically consumed during evaluation — callers must NOT separately
   * record token usage or the budget will be double-counted.
   */
  evaluate(message: InboundMessage, trust: SenderTrust, estimatedTokens?: number): InboundGateDecision;
  /** Get aggregate statistics */
  getStats(): InboundGateStats;
}

/**
 * Create an inbound message gate.
 *
 * Checks are applied in this order:
 * 1. Spam filter (reject bulk/marketing/known spam)
 * 2. Rate limiter (per-sender and per-recipient caps)
 * 3. Token budget (cost protection)
 * 4. Deferred processing (unknown senders, if configured)
 *
 * @param config - Gate configuration
 * @param logger - Logger for recording decisions
 * @returns InboundGate instance
 */
export function createInboundGate(config: InboundGateConfig, logger: Logger): InboundGate {
  const rateLimiter: RateLimiter = createRateLimiter(config.rateLimiter);
  const tokenBudget: TokenBudget = createTokenBudget(config.tokenBudget);

  let totalEvaluated = 0;
  let allowed = 0;
  let rejected = 0;
  let rateLimited = 0;
  let budgetExceeded = 0;
  let deferred = 0;

  return {
    evaluate(message: InboundMessage, trust: SenderTrust, estimatedTokens = 0): InboundGateDecision {
      totalEvaluated++;

      // Step 1: Spam filter
      const spamResult = isSpam(message, config.spamFilter);
      if (spamResult.isSpam) {
        rejected++;
        logger.info('inbound gate: spam rejected', {
          sender: message.sender,
          channel: message.channel,
          reason: spamResult.reason,
        });
        return {
          action: 'reject',
          reason: `spam: ${spamResult.reason}`,
          skipEmbedding: true,
        };
      }

      // Step 2: Rate limiter (pass channel for sender normalization)
      const rateResult = rateLimiter.check(message.sender, message.recipient, trust, message.channel);
      if (!rateResult.allowed) {
        rateLimited++;
        logger.warn('inbound gate: rate limited', {
          sender: message.sender,
          channel: message.channel,
          trust,
          reason: rateResult.reason,
          remaining: rateResult.remaining,
          retryAfterMs: rateResult.retryAfterMs,
        });
        return {
          action: 'rate_limited',
          reason: `rate limited: ${rateResult.reason}`,
          skipEmbedding: true,
        };
      }

      // Step 3: Token budget (uses tryConsume for atomic check-and-record)
      if (estimatedTokens > 0) {
        const budgetResult = tokenBudget.tryConsume(estimatedTokens);
        if (!budgetResult.allowed) {
          budgetExceeded++;
          logger.warn('inbound gate: token budget exceeded', {
            sender: message.sender,
            channel: message.channel,
            estimatedTokens,
            reason: budgetResult.reason,
          });
          return {
            action: 'budget_exceeded',
            reason: `budget exceeded: ${budgetResult.reason}`,
            skipEmbedding: true,
          };
        }
      }

      // Step 4: Deferred processing for unknown senders
      if (config.deferUnknownSenders && trust === 'unknown') {
        deferred++;
        logger.debug('inbound gate: deferring unknown sender', {
          sender: message.sender,
          channel: message.channel,
        });
        return {
          action: 'defer',
          reason: 'unknown sender deferred for batch processing',
          skipEmbedding: true,
        };
      }

      // Message is allowed
      allowed++;
      logger.debug('inbound gate: allowed', {
        sender: message.sender,
        channel: message.channel,
        trust,
      });
      return {
        action: 'allow',
        reason: null,
        skipEmbedding: false,
      };
    },

    getStats(): InboundGateStats {
      return {
        totalEvaluated,
        allowed,
        rejected,
        rateLimited,
        budgetExceeded,
        deferred,
      };
    },
  };
}
