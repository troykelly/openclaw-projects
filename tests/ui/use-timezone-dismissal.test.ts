/**
 * @vitest-environment jsdom
 */
/**
 * Tests for useTimezoneDismissal hook (Epic #2509, Issue #2512).
 *
 * Verifies: localStorage read/write, malformed JSON handling,
 * QuotaExceededError fallback, per-timezone dismissal tracking.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTimezoneDismissal } from '@/ui/hooks/use-timezone-dismissal';

const STORAGE_KEY = 'tz_mismatch_dismiss_v1';

describe('useTimezoneDismissal', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns isDismissed: false when no localStorage entry exists', () => {
    const { result } = renderHook(() => useTimezoneDismissal('Europe/London'));

    expect(result.current.isDismissed).toBe(false);
  });

  it('returns isDismissed: true after calling dismiss()', () => {
    const { result } = renderHook(() => useTimezoneDismissal('Europe/London'));

    act(() => {
      result.current.dismiss('Europe/London');
    });

    expect(result.current.isDismissed).toBe(true);
  });

  it('returns isDismissed: false for a timezone not in dismissed array', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ dismissedBrowserTimezones: ['Europe/London'] }),
    );

    const { result } = renderHook(() => useTimezoneDismissal('America/New_York'));

    expect(result.current.isDismissed).toBe(false);
  });

  it('returns isDismissed: true for a timezone in dismissed array', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ dismissedBrowserTimezones: ['Europe/London'] }),
    );

    const { result } = renderHook(() => useTimezoneDismissal('Europe/London'));

    expect(result.current.isDismissed).toBe(true);
  });

  it('treats malformed JSON as empty — does not throw', () => {
    localStorage.setItem(STORAGE_KEY, '{{not valid json}}');

    const { result } = renderHook(() => useTimezoneDismissal('Europe/London'));

    expect(result.current.isDismissed).toBe(false);
  });

  it('falls back to in-memory state when localStorage.setItem throws QuotaExceededError', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const originalSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = vi.fn().mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });

    const { result } = renderHook(() => useTimezoneDismissal('Europe/London'));

    act(() => {
      result.current.dismiss('Europe/London');
    });

    // Should still be dismissed in-memory for this session
    expect(result.current.isDismissed).toBe(true);
    expect(warnSpy).toHaveBeenCalled();

    // Restore
    localStorage.setItem = originalSetItem;
  });

  it('writes dismiss to localStorage correctly', () => {
    const { result } = renderHook(() => useTimezoneDismissal('Europe/London'));

    act(() => {
      result.current.dismiss('Europe/London');
    });

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    expect(stored.dismissedBrowserTimezones).toContain('Europe/London');
  });

  it('preserves previously dismissed timezones when adding new ones', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ dismissedBrowserTimezones: ['America/New_York'] }),
    );

    const { result } = renderHook(() => useTimezoneDismissal('Europe/London'));

    act(() => {
      result.current.dismiss('Europe/London');
    });

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    expect(stored.dismissedBrowserTimezones).toContain('America/New_York');
    expect(stored.dismissedBrowserTimezones).toContain('Europe/London');
  });
});
