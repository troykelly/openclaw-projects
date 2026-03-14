/**
 * @vitest-environment jsdom
 */
/**
 * Tests for useTimezoneDetection hook (Epic #2509, Issue #2512).
 *
 * Verifies: mismatch detection, canonicalization, loading/error states,
 * Intl failure handling.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// Mock the useSettings hook
const mockUseSettings = vi.fn();
vi.mock('@/ui/components/settings/use-settings', () => ({
  useSettings: () => mockUseSettings(),
}));

import { useTimezoneDetection } from '@/ui/hooks/use-timezone-detection';

describe('useTimezoneDetection', () => {
  const originalIntl = globalThis.Intl;

  beforeEach(() => {
    mockUseSettings.mockReset();
  });

  afterEach(() => {
    globalThis.Intl = originalIntl;
    vi.restoreAllMocks();
  });

  it('returns mismatch: false and isLoading: true while settings are loading', () => {
    mockUseSettings.mockReturnValue({
      state: { kind: 'loading' },
      isSaving: false,
      updateSettings: vi.fn(),
    });

    const { result } = renderHook(() => useTimezoneDetection());

    expect(result.current.mismatch).toBe(false);
    expect(result.current.isLoading).toBe(true);
  });

  it('returns mismatch: false with error when settings fetch fails', () => {
    mockUseSettings.mockReturnValue({
      state: { kind: 'error', message: 'Network error' },
      isSaving: false,
      updateSettings: vi.fn(),
    });

    const { result } = renderHook(() => useTimezoneDetection());

    expect(result.current.mismatch).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('Network error');
  });

  it('returns mismatch: false when browser tz equals stored tz', () => {
    // Mock Intl to return a specific timezone
    const mockResolvedOptions = vi.fn().mockReturnValue({ timeZone: 'America/New_York' });
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
      () => ({ resolvedOptions: mockResolvedOptions }) as unknown as Intl.DateTimeFormat,
    );

    mockUseSettings.mockReturnValue({
      state: { kind: 'loaded', data: { timezone: 'America/New_York' } },
      isSaving: false,
      updateSettings: vi.fn(),
    });

    const { result } = renderHook(() => useTimezoneDetection());

    expect(result.current.mismatch).toBe(false);
    expect(result.current.browserTimezone).toBe('America/New_York');
    expect(result.current.storedTimezone).toBe('America/New_York');
  });

  it('returns mismatch: true when browser tz differs from stored tz', () => {
    const mockResolvedOptions = vi.fn().mockReturnValue({ timeZone: 'Europe/London' });
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
      () => ({ resolvedOptions: mockResolvedOptions }) as unknown as Intl.DateTimeFormat,
    );

    mockUseSettings.mockReturnValue({
      state: { kind: 'loaded', data: { timezone: 'America/New_York' } },
      isSaving: false,
      updateSettings: vi.fn(),
    });

    const { result } = renderHook(() => useTimezoneDetection());

    expect(result.current.mismatch).toBe(true);
    expect(result.current.browserTimezone).toBe('Europe/London');
    expect(result.current.storedTimezone).toBe('America/New_York');
  });

  it('returns browserTimezone: null and mismatch: false when Intl throws', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
      throw new Error('Intl not supported');
    });

    mockUseSettings.mockReturnValue({
      state: { kind: 'loaded', data: { timezone: 'America/New_York' } },
      isSaving: false,
      updateSettings: vi.fn(),
    });

    const { result } = renderHook(() => useTimezoneDetection());

    expect(result.current.mismatch).toBe(false);
    expect(result.current.browserTimezone).toBeNull();
  });

  it('canonicalizes alias US/Pacific to America/Los_Angeles — no mismatch with stored America/Los_Angeles', () => {
    // First call (no args) returns the alias; second call (with timeZone option) returns canonical
    let callCount = 0;
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation((_locale?: string | string[], options?: Intl.DateTimeFormatOptions) => {
      callCount++;
      if (options?.timeZone) {
        // Canonicalization call
        return { resolvedOptions: () => ({ timeZone: 'America/Los_Angeles' }) } as unknown as Intl.DateTimeFormat;
      }
      // Initial detection call
      return { resolvedOptions: () => ({ timeZone: 'US/Pacific' }) } as unknown as Intl.DateTimeFormat;
    });

    mockUseSettings.mockReturnValue({
      state: { kind: 'loaded', data: { timezone: 'America/Los_Angeles' } },
      isSaving: false,
      updateSettings: vi.fn(),
    });

    const { result } = renderHook(() => useTimezoneDetection());

    expect(result.current.mismatch).toBe(false);
    expect(result.current.browserTimezone).toBe('America/Los_Angeles');
  });

  it('canonicalizes alias US/Pacific — mismatch: true when stored is UTC', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation((_locale?: string | string[], options?: Intl.DateTimeFormatOptions) => {
      if (options?.timeZone) {
        return { resolvedOptions: () => ({ timeZone: 'America/Los_Angeles' }) } as unknown as Intl.DateTimeFormat;
      }
      return { resolvedOptions: () => ({ timeZone: 'US/Pacific' }) } as unknown as Intl.DateTimeFormat;
    });

    mockUseSettings.mockReturnValue({
      state: { kind: 'loaded', data: { timezone: 'UTC' } },
      isSaving: false,
      updateSettings: vi.fn(),
    });

    const { result } = renderHook(() => useTimezoneDetection());

    expect(result.current.mismatch).toBe(true);
    expect(result.current.browserTimezone).toBe('America/Los_Angeles');
    expect(result.current.storedTimezone).toBe('UTC');
  });
});
