/**
 * Token budget tracking utility for inbound message processing.
 *
 * Provides configurable daily and monthly caps on token expenditure
 * to protect against cost overruns from bulk inbound messages.
 *
 * Part of Issue #1225 — rate limiting and spam protection.
 */

/** Configuration for token budget tracking */
export interface TokenBudgetConfig {
  /** Whether token budget enforcement is enabled */
  enabled: boolean;
  /** Maximum tokens per day (optional, no limit if omitted) */
  dailyTokenLimit?: number;
  /** Maximum tokens per month (optional, no limit if omitted) */
  monthlyTokenLimit?: number;
}

/** Result of a token budget check */
export interface TokenBudgetResult {
  /** Whether the token request is allowed */
  allowed: boolean;
  /** Human-readable reason if denied, null if allowed */
  reason: string | null;
  /** Tokens remaining in daily budget (undefined if no daily limit) */
  remainingDaily?: number;
  /** Tokens remaining in monthly budget (undefined if no monthly limit) */
  remainingMonthly?: number;
}

/** Token budget usage statistics */
export interface TokenBudgetStats {
  /** Tokens used today */
  dailyUsed: number;
  /** Tokens used this month */
  monthlyUsed: number;
  /** Daily token limit (undefined if not set) */
  dailyLimit?: number;
  /** Monthly token limit (undefined if not set) */
  monthlyLimit?: number;
}

/** Token budget instance */
export interface TokenBudget {
  /** Check if a token expenditure is allowed (read-only, does not record) */
  check(tokens: number): TokenBudgetResult;
  /** Record actual token usage */
  record(tokens: number): void;
  /**
   * Atomically check and record token usage.
   * Prevents TOCTOU races where concurrent check() calls both pass
   * before either records, allowing the budget to be exceeded.
   * Returns the check result; if allowed, tokens are already recorded.
   */
  tryConsume(tokens: number): TokenBudgetResult;
  /** Get current usage statistics */
  getStats(): TokenBudgetStats;
}

/** Default configuration (budget disabled) */
export const DEFAULT_TOKEN_BUDGET_CONFIG: TokenBudgetConfig = {
  enabled: false,
};

/**
 * Create a token budget tracker.
 *
 * Tracks daily and monthly token usage with automatic reset at
 * UTC midnight (daily) and UTC month boundary (monthly).
 *
 * @param config - Token budget configuration
 * @returns TokenBudget instance
 */
export function createTokenBudget(config: TokenBudgetConfig = DEFAULT_TOKEN_BUDGET_CONFIG): TokenBudget {
  let dailyUsed = 0;
  let monthlyUsed = 0;
  let currentDay = getCurrentDay();
  let currentMonth = getCurrentMonth();

  /**
   * Get the current UTC day as YYYY-MM-DD string.
   */
  function getCurrentDay(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /**
   * Get the current UTC month as YYYY-MM string.
   */
  function getCurrentMonth(): string {
    return new Date().toISOString().slice(0, 7);
  }

  /**
   * Reset counters if the day or month has changed.
   */
  function maybeReset(): void {
    const today = getCurrentDay();
    const thisMonth = getCurrentMonth();

    if (today !== currentDay) {
      dailyUsed = 0;
      currentDay = today;
    }

    if (thisMonth !== currentMonth) {
      monthlyUsed = 0;
      currentMonth = thisMonth;
    }
  }

  return {
    check(tokens: number): TokenBudgetResult {
      if (!config.enabled) {
        return { allowed: true, reason: null };
      }

      maybeReset();

      // Check daily limit
      if (config.dailyTokenLimit !== undefined) {
        if (dailyUsed + tokens > config.dailyTokenLimit) {
          return {
            allowed: false,
            reason: `daily token budget exceeded (${dailyUsed}/${config.dailyTokenLimit} used, requested ${tokens})`,
            remainingDaily: Math.max(0, config.dailyTokenLimit - dailyUsed),
            remainingMonthly: config.monthlyTokenLimit !== undefined ? Math.max(0, config.monthlyTokenLimit - monthlyUsed) : undefined,
          };
        }
      }

      // Check monthly limit
      if (config.monthlyTokenLimit !== undefined) {
        if (monthlyUsed + tokens > config.monthlyTokenLimit) {
          return {
            allowed: false,
            reason: `monthly token budget exceeded (${monthlyUsed}/${config.monthlyTokenLimit} used, requested ${tokens})`,
            remainingDaily: config.dailyTokenLimit !== undefined ? Math.max(0, config.dailyTokenLimit - dailyUsed) : undefined,
            remainingMonthly: Math.max(0, config.monthlyTokenLimit - monthlyUsed),
          };
        }
      }

      return {
        allowed: true,
        reason: null,
        remainingDaily: config.dailyTokenLimit !== undefined ? config.dailyTokenLimit - dailyUsed : undefined,
        remainingMonthly: config.monthlyTokenLimit !== undefined ? config.monthlyTokenLimit - monthlyUsed : undefined,
      };
    },

    record(tokens: number): void {
      maybeReset();
      dailyUsed += tokens;
      monthlyUsed += tokens;
    },

    tryConsume(tokens: number): TokenBudgetResult {
      if (!config.enabled) {
        return { allowed: true, reason: null };
      }

      maybeReset();

      // Check daily limit
      if (config.dailyTokenLimit !== undefined) {
        if (dailyUsed + tokens > config.dailyTokenLimit) {
          return {
            allowed: false,
            reason: `daily token budget exceeded (${dailyUsed}/${config.dailyTokenLimit} used, requested ${tokens})`,
            remainingDaily: Math.max(0, config.dailyTokenLimit - dailyUsed),
            remainingMonthly: config.monthlyTokenLimit !== undefined ? Math.max(0, config.monthlyTokenLimit - monthlyUsed) : undefined,
          };
        }
      }

      // Check monthly limit
      if (config.monthlyTokenLimit !== undefined) {
        if (monthlyUsed + tokens > config.monthlyTokenLimit) {
          return {
            allowed: false,
            reason: `monthly token budget exceeded (${monthlyUsed}/${config.monthlyTokenLimit} used, requested ${tokens})`,
            remainingDaily: config.dailyTokenLimit !== undefined ? Math.max(0, config.dailyTokenLimit - dailyUsed) : undefined,
            remainingMonthly: Math.max(0, config.monthlyTokenLimit - monthlyUsed),
          };
        }
      }

      // Atomically record usage since check passed
      dailyUsed += tokens;
      monthlyUsed += tokens;

      return {
        allowed: true,
        reason: null,
        remainingDaily: config.dailyTokenLimit !== undefined ? config.dailyTokenLimit - dailyUsed : undefined,
        remainingMonthly: config.monthlyTokenLimit !== undefined ? config.monthlyTokenLimit - monthlyUsed : undefined,
      };
    },

    getStats(): TokenBudgetStats {
      maybeReset();
      return {
        dailyUsed,
        monthlyUsed,
        dailyLimit: config.dailyTokenLimit,
        monthlyLimit: config.monthlyTokenLimit,
      };
    },
  };
}
