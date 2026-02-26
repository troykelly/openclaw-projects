/**
 * @vitest-environment jsdom
 */
/**
 * Tests for the analytics section (#1734).
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

const mockBurndown = {
  data: [
    { date: '2026-02-15', ideal: 20, actual: 20 },
    { date: '2026-02-16', ideal: 16, actual: 18 },
    { date: '2026-02-17', ideal: 12, actual: 15 },
    { date: '2026-02-18', ideal: 8, actual: 12 },
    { date: '2026-02-19', ideal: 4, actual: 9 },
    { date: '2026-02-20', ideal: 0, actual: 5 },
  ],
};

const mockVelocity = {
  data: [
    { period: '2026-W06', completed: 8 },
    { period: '2026-W07', completed: 12 },
    { period: '2026-W08', completed: 10 },
    { period: '2026-W09', completed: 15 },
  ],
};

const mockHealth = {
  projects: [
    { project_id: 'p1', project_title: 'Project Alpha', health: 'healthy', completion_pct: 75, open_items: 5, blocked_items: 0, overdue_items: 0 },
    { project_id: 'p2', project_title: 'Project Beta', health: 'at_risk', completion_pct: 45, open_items: 12, blocked_items: 3, overdue_items: 2 },
    { project_id: 'p3', project_title: 'Project Gamma', health: 'behind', completion_pct: 20, open_items: 25, blocked_items: 5, overdue_items: 8 },
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

  it('renders all analytics components after loading', async () => {
    // Component fetches velocity + health (burndown removed — no project context)
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce(mockVelocity)
      .mockResolvedValueOnce(mockHealth);

    render(<AnalyticsSection />);

    await waitFor(() => {
      expect(screen.getByText('Burndown')).toBeInTheDocument();
      expect(screen.getByText('Velocity')).toBeInTheDocument();
      expect(screen.getByText('Project Health')).toBeInTheDocument();
    });
  });

  it('renders burndown as empty (no API call)', async () => {
    // Burndown API call was removed — burndown always renders empty state
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce(mockVelocity)
      .mockResolvedValueOnce(mockHealth);

    render(<AnalyticsSection />);

    await waitFor(() => {
      expect(screen.getByText('No burndown data available.')).toBeInTheDocument();
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

  it('renders project health cards', async () => {
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce(mockVelocity)
      .mockResolvedValueOnce(mockHealth);

    render(<AnalyticsSection />);

    await waitFor(() => {
      const healthCards = screen.getAllByTestId('health-card');
      expect(healthCards).toHaveLength(3);
    });

    expect(screen.getByText('Project Alpha')).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
    expect(screen.getByText('At Risk')).toBeInTheDocument();
    expect(screen.getByText('Behind')).toBeInTheDocument();
  });

  it('handles partial data gracefully', async () => {
    // Only velocity succeeds, health fails
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
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ projects: [] });

    render(<AnalyticsSection />);

    await waitFor(() => {
      expect(screen.getByText('No burndown data available.')).toBeInTheDocument();
      expect(screen.getByText('No velocity data available.')).toBeInTheDocument();
      expect(screen.getByText('No project health data available.')).toBeInTheDocument();
    });
  });
});
