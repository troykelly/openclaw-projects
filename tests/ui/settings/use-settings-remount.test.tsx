/**
 * Tests for issue #1738: mountedRef must be reset on remount.
 *
 * When `useSettings` unmounts and remounts (e.g. React StrictMode double-fire,
 * or route navigation), `mountedRef.current` stays `false` because the cleanup
 * sets it to `false` but the effect body never resets it to `true`. This causes
 * `updateSettings` to silently drop state updates after the PATCH resolves:
 *   - setState (line 53) is skipped
 *   - setIsSaving(false) (line 61) is skipped
 *   - The save appears to succeed (returns true) but state is never updated
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor, act } from '@testing-library/react';
import * as React from 'react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/ui/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiRequestError: class extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock('@/ui/lib/auth-manager', () => ({
  getAccessToken: vi.fn(() => 'test-token'),
  clearAccessToken: vi.fn(),
  refreshAccessToken: vi.fn(),
}));

vi.mock('@/ui/lib/api-config', () => ({
  getApiBaseUrl: vi.fn(() => 'http://localhost:3000'),
}));

vi.mock('@/ui/lib/version', () => ({
  APP_VERSION: '0.0.0-test',
}));

import { apiClient } from '@/ui/lib/api-client';

const mockedApiClient = vi.mocked(apiClient);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useSettings mountedRef reset on remount (#1738)', () => {
  it('updateSettings updates state after StrictMode double-fire', async () => {
    /**
     * React 18 StrictMode calls effects, then cleanup, then effects again.
     * Without the fix, the cleanup sets mountedRef=false and the second
     * effect run doesn't reset it to true, so updateSettings skips
     * setState and setIsSaving after the PATCH resolves.
     */
    const settingsData = {
      id: 's1',
      email: 'user@example.com',
      theme: 'dark' as const,
      default_view: 'activity' as const,
      default_project_id: null,
      sidebar_collapsed: false,
      show_completed_items: true,
      items_per_page: 25,
      email_notifications: true,
      email_digest_frequency: 'daily' as const,
      timezone: 'UTC',
      geo_auto_inject: false,
      geo_high_res_retention_hours: 24,
      geo_general_retention_days: 30,
      geo_high_res_threshold_m: 50,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    const updatedData = { ...settingsData, theme: 'light' as const, updated_at: '2026-02-01T00:00:00Z' };

    mockedApiClient.get.mockResolvedValue(settingsData);
    mockedApiClient.patch.mockResolvedValue(updatedData);

    const { useSettings } = await import('@/ui/components/settings/use-settings');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let capturedState: any = null;
    let capturedIsSaving = false;
    let capturedUpdateSettings: ((updates: Record<string, unknown>) => Promise<boolean>) | null = null;

    function TestComponent() {
      const { state, isSaving, updateSettings } = useSettings();
      capturedUpdateSettings = updateSettings as (updates: Record<string, unknown>) => Promise<boolean>;
      capturedIsSaving = isSaving;
      capturedState = state;
      return <div>{state.kind}</div>;
    }

    // Render in StrictMode to trigger double-fire of effects
    render(
      <React.StrictMode>
        <TestComponent />
      </React.StrictMode>,
    );

    // Wait for settings to load
    await waitFor(() => {
      expect(capturedState?.kind).toBe('loaded');
    });

    // Call updateSettings — without the fix, this silently drops state updates
    let result = false;
    await act(async () => {
      result = await capturedUpdateSettings!({ theme: 'light' });
    });

    // PATCH should have been called
    expect(mockedApiClient.patch).toHaveBeenCalledWith('/api/settings', { theme: 'light' });

    // The save should succeed
    expect(result).toBe(true);

    // After save completes, isSaving MUST be false
    // Without the fix, setIsSaving(false) is skipped because mountedRef.current === false
    expect(capturedIsSaving).toBe(false);

    // State should be updated to the server response
    // Without the fix, setState is skipped because mountedRef.current === false
    expect(capturedState.kind).toBe('loaded');
    expect(capturedState.data.theme).toBe('light');
    expect(capturedState.data.updated_at).toBe('2026-02-01T00:00:00Z');
  });

  it('updateSettings reverts state on error after StrictMode double-fire', async () => {
    const settingsData = {
      id: 's1',
      email: 'user@example.com',
      theme: 'dark' as const,
      default_view: 'activity' as const,
      default_project_id: null,
      sidebar_collapsed: false,
      show_completed_items: true,
      items_per_page: 25,
      email_notifications: true,
      email_digest_frequency: 'daily' as const,
      timezone: 'UTC',
      geo_auto_inject: false,
      geo_high_res_retention_hours: 24,
      geo_general_retention_days: 30,
      geo_high_res_threshold_m: 50,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    mockedApiClient.get.mockResolvedValue(settingsData);
    mockedApiClient.patch.mockRejectedValue(new Error('Server error'));

    const { useSettings } = await import('@/ui/components/settings/use-settings');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let capturedState: any = null;
    let capturedIsSaving = false;
    let capturedUpdateSettings: ((updates: Record<string, unknown>) => Promise<boolean>) | null = null;

    function TestComponent() {
      const { state, isSaving, updateSettings } = useSettings();
      capturedUpdateSettings = updateSettings as (updates: Record<string, unknown>) => Promise<boolean>;
      capturedIsSaving = isSaving;
      capturedState = state;
      return <div>{state.kind}</div>;
    }

    render(
      <React.StrictMode>
        <TestComponent />
      </React.StrictMode>,
    );

    await waitFor(() => {
      expect(capturedState?.kind).toBe('loaded');
    });

    // Call updateSettings — the PATCH will fail
    let result = false;
    await act(async () => {
      result = await capturedUpdateSettings!({ theme: 'light' });
    });

    // Save should return false on error
    expect(result).toBe(false);

    // State should be reverted to the original data
    // Without the fix, setState (revert) is skipped because mountedRef.current === false
    expect(capturedState.data.theme).toBe('dark');

    // isSaving should be false
    expect(capturedIsSaving).toBe(false);
  });
});
