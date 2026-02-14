/**
 * Tests for token budget tracking utility.
 * Covers daily/monthly caps on token spend for inbound processing.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  createTokenBudget,
  type TokenBudgetConfig,
} from '../../src/utils/token-budget.js';

describe('token-budget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Set a known date: 2026-02-14 12:00:00 UTC
    vi.setSystemTime(new Date('2026-02-14T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('disabled budget', () => {
    it('should always allow when budget is disabled', () => {
      const config: TokenBudgetConfig = {
        enabled: false,
      };
      const budget = createTokenBudget(config);

      const result = budget.check(10000);
      expect(result.allowed).toBe(true);
    });
  });

  describe('daily budget', () => {
    it('should allow tokens under daily limit', () => {
      const config: TokenBudgetConfig = {
        enabled: true,
        dailyTokenLimit: 100_000,
      };
      const budget = createTokenBudget(config);

      budget.record(50_000);
      const result = budget.check(10_000);
      expect(result.allowed).toBe(true);
      expect(result.remainingDaily).toBe(50_000);
    });

    it('should deny when daily limit would be exceeded', () => {
      const config: TokenBudgetConfig = {
        enabled: true,
        dailyTokenLimit: 100_000,
      };
      const budget = createTokenBudget(config);

      budget.record(95_000);
      const result = budget.check(10_000);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('daily');
    });

    it('should reset daily budget at midnight UTC', () => {
      const config: TokenBudgetConfig = {
        enabled: true,
        dailyTokenLimit: 100_000,
      };
      const budget = createTokenBudget(config);

      budget.record(100_000);
      expect(budget.check(1).allowed).toBe(false);

      // Advance to next day
      vi.setSystemTime(new Date('2026-02-15T00:00:01Z'));

      expect(budget.check(1).allowed).toBe(true);
      expect(budget.check(100_000).allowed).toBe(true);
    });
  });

  describe('monthly budget', () => {
    it('should allow tokens under monthly limit', () => {
      const config: TokenBudgetConfig = {
        enabled: true,
        monthlyTokenLimit: 1_000_000,
      };
      const budget = createTokenBudget(config);

      budget.record(500_000);
      const result = budget.check(100_000);
      expect(result.allowed).toBe(true);
      expect(result.remainingMonthly).toBe(500_000);
    });

    it('should deny when monthly limit would be exceeded', () => {
      const config: TokenBudgetConfig = {
        enabled: true,
        monthlyTokenLimit: 1_000_000,
      };
      const budget = createTokenBudget(config);

      budget.record(999_000);
      const result = budget.check(10_000);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('monthly');
    });

    it('should reset monthly budget at the start of a new month', () => {
      const config: TokenBudgetConfig = {
        enabled: true,
        monthlyTokenLimit: 1_000_000,
      };
      const budget = createTokenBudget(config);

      budget.record(1_000_000);
      expect(budget.check(1).allowed).toBe(false);

      // Advance to next month
      vi.setSystemTime(new Date('2026-03-01T00:00:01Z'));

      expect(budget.check(1).allowed).toBe(true);
    });
  });

  describe('combined daily and monthly budgets', () => {
    it('should enforce whichever limit is reached first', () => {
      const config: TokenBudgetConfig = {
        enabled: true,
        dailyTokenLimit: 50_000,
        monthlyTokenLimit: 1_000_000,
      };
      const budget = createTokenBudget(config);

      budget.record(50_000);

      // Daily limit hit, but monthly is fine
      const result = budget.check(1);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('daily');
    });

    it('should enforce monthly limit even if daily has room', () => {
      const config: TokenBudgetConfig = {
        enabled: true,
        dailyTokenLimit: 50_000,
        monthlyTokenLimit: 100_000,
      };
      const budget = createTokenBudget(config);

      // Use up monthly budget over two days
      budget.record(50_000);
      vi.setSystemTime(new Date('2026-02-15T12:00:00Z'));
      budget.record(50_000);

      // Daily has room (reset), but monthly is exhausted
      vi.setSystemTime(new Date('2026-02-16T12:00:00Z'));
      const result = budget.check(1);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('monthly');
    });
  });

  describe('getStats', () => {
    it('should return current usage statistics', () => {
      const config: TokenBudgetConfig = {
        enabled: true,
        dailyTokenLimit: 100_000,
        monthlyTokenLimit: 1_000_000,
      };
      const budget = createTokenBudget(config);

      budget.record(25_000);

      const stats = budget.getStats();
      expect(stats.dailyUsed).toBe(25_000);
      expect(stats.monthlyUsed).toBe(25_000);
      expect(stats.dailyLimit).toBe(100_000);
      expect(stats.monthlyLimit).toBe(1_000_000);
    });
  });

  describe('edge cases', () => {
    it('should handle zero token requests', () => {
      const config: TokenBudgetConfig = {
        enabled: true,
        dailyTokenLimit: 100_000,
      };
      const budget = createTokenBudget(config);

      const result = budget.check(0);
      expect(result.allowed).toBe(true);
    });

    it('should handle requests exactly at the limit', () => {
      const config: TokenBudgetConfig = {
        enabled: true,
        dailyTokenLimit: 100_000,
      };
      const budget = createTokenBudget(config);

      const result = budget.check(100_000);
      expect(result.allowed).toBe(true);

      budget.record(100_000);
      expect(budget.check(1).allowed).toBe(false);
    });
  });
});
