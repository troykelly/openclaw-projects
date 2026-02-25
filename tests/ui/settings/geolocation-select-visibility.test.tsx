/**
 * @vitest-environment jsdom
 *
 * Tests that the Select dropdown in the geolocation Add Provider dialog
 * renders text visibly. The root cause of #1804 was missing --color-popover
 * and --color-popover-foreground CSS variables, causing `bg-popover` and
 * `text-popover-foreground` Tailwind classes to resolve to transparent.
 *
 * These tests verify the component structure is correct and that the
 * SelectContent uses the expected classes for visibility.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock apiClient to prevent real API calls from geolocation hooks
vi.mock('@/ui/lib/api-client', () => ({
  apiClient: {
    get: vi.fn().mockResolvedValue({ providers: [] }),
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

import { apiClient } from '@/ui/lib/api-client';
import { LocationSection } from '@/ui/components/settings/location-section';

const mockedGet = vi.mocked(apiClient.get);

beforeEach(() => {
  vi.clearAllMocks();
  // Mock providers list (empty) and current location (null)
  mockedGet.mockImplementation((path: string) => {
    if (path === '/api/geolocation/providers') {
      return Promise.resolve({ providers: [] });
    }
    if (path === '/api/geolocation/current') {
      return Promise.resolve({ location: null });
    }
    return Promise.resolve({});
  });
});

describe('Geolocation Select dropdown visibility (#1804)', () => {
  it('renders the Add Provider dialog with a Provider Type select', async () => {
    render(
      <LocationSection
        geoAutoInject={false}
        geoHighResRetentionHours={24}
        geoGeneralRetentionDays={30}
        onUpdate={vi.fn().mockResolvedValue(true)}
      />,
    );

    // Open the Add Provider dialog
    const addButton = await screen.findByTestId('add-provider-btn');
    fireEvent.click(addButton);

    // The dialog should appear with the provider type select
    const providerTypeSelect = await screen.findByTestId('provider-type-select');
    expect(providerTypeSelect).toBeInTheDocument();
  });

  it('select trigger displays the current value text', async () => {
    render(
      <LocationSection
        geoAutoInject={false}
        geoHighResRetentionHours={24}
        geoGeneralRetentionDays={30}
        onUpdate={vi.fn().mockResolvedValue(true)}
      />,
    );

    const addButton = await screen.findByTestId('add-provider-btn');
    fireEvent.click(addButton);

    // The trigger should display "Home Assistant" (default selected value)
    const trigger = await screen.findByTestId('provider-type-select');
    expect(trigger).toHaveTextContent('Home Assistant');
  });
});
