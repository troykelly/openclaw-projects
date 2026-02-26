/**
 * @vitest-environment jsdom
 */
/**
 * Tests for the analytics section (#1734, #1839).
 *
 * Mock data matches actual API response shapes from server.ts.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Mock apiClient
vi.mock('@/ui/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

import { AnalyticsSection } from '@/ui/components/analytics/analytics-section';
import { apiClient } from '@/ui/lib/api-client';

/** Matches GET /api/analytics/velocity response. */
const mockVelocity = {
  weeks: [
    { week_start: '2026-02-02', completed_count: 8, estimated_minutes: 480 },
    { week_start: '2026-02-09', completed_count: 12, estimated_minutes: 720 },
    { week_start: '2026-02-16', completed_count: 10, estimated_minutes: 600 },
    { week_start: '2026-02-23', completed_count: 15, estimated_minutes: 900 },
  ],
};

/** Matches GET /api/analytics/project-health response. */
const mockHealth = {
  projects: [
    { id: 'p1', title: 'Project Alpha', open_count: 2, in_progress_count: 3, closed_count: 15, total_count: 20 },
    { id: 'p2', title: 'Project Beta', open_count: 12, in_progress_count: 3, closed_count: 5, total_count: 20 },
    { id: 'p3', title: 'Project Gamma', open_count: 25, in_progress_count: 0, closed_count: 5, total_count: 30 },
  ],
};

describe('AnalyticsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders loading state initially', () => {
    vi.mocked(apiClient.get).mockReturnValue(new Promise(() => {}));
    render(<AnalyticsSection />);
    expect(screen.getByTestId('analytics-section')).toBeInTheDocument();
  });

  it('renders velocity and project health after loading', async () => {
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce(mockVelocity)
      .mockResolvedValueOnce(mockHealth);

    render(<AnalyticsSection />);

    await waitFor(() => {
      expect(screen.getByText('Velocity')).toBeInTheDocument();
      expect(screen.getByText('Project Health')).toBeInTheDocument();
    });
  });

  it('renders velocity chart', async () => {
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce(mockVelocity)
      .mockResolvedValueOnce(mockHealth);

    render(<AnalyticsSection />);

    await waitFor(() => {
      expect(screen.getByTestId('velocity-chart')).toBeInTheDocument();
    });
  });

  it('renders project health cards with derived health status', async () => {
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce(mockVelocity)
      .mockResolvedValueOnce(mockHealth);

    render(<AnalyticsSection />);

    await waitFor(() => {
      const healthCards = screen.getAllByTestId('health-card');
      expect(healthCards).toHaveLength(3);
    });

    expect(screen.getByText('Project Alpha')).toBeInTheDocument();
    expect(screen.getByText('Project Beta')).toBeInTheDocument();
    expect(screen.getByText('Project Gamma')).toBeInTheDocument();
    // Project Alpha: 15/20 closed → Healthy
    expect(screen.getByText('Healthy')).toBeInTheDocument();
    // Project Beta: 12 open > 5 closed, in_progress > 0 → At Risk
    expect(screen.getByText('At Risk')).toBeInTheDocument();
    // Project Gamma: 25 open > 5 closed, in_progress = 0 → Behind
    expect(screen.getByText('Behind')).toBeInTheDocument();
  });

  it('handles partial data gracefully', async () => {
    // Only velocity succeeds
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce(mockVelocity)
      .mockRejectedValueOnce(new Error('Health unavailable'));

    render(<AnalyticsSection />);

    await waitFor(() => {
      expect(screen.getByTestId('velocity-chart')).toBeInTheDocument();
    });

    // Should still render, showing available data
    expect(screen.getByText('Velocity')).toBeInTheDocument();
  });

  it('shows error state when all fetches fail', async () => {
    vi.mocked(apiClient.get)
      .mockRejectedValueOnce(new Error('Failed'))
      .mockRejectedValueOnce(new Error('Failed'));

    render(<AnalyticsSection />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load analytics data')).toBeInTheDocument();
    });
  });

  it('renders empty state for charts with no data', async () => {
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({ weeks: [] })
      .mockResolvedValueOnce({ projects: [] });

    render(<AnalyticsSection />);

    await waitFor(() => {
      expect(screen.getByText('No velocity data available.')).toBeInTheDocument();
      expect(screen.getByText('No project health data available.')).toBeInTheDocument();
    });
  });
});
