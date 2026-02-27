/**
 * @vitest-environment jsdom
 *
 * Tests for Home Assistant OAuth UI in the Add Provider dialog.
 * Verifies the auth method radio toggle, conditional field display,
 * and OAuth initiation flow.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

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
import { LocationSection } from '@/ui/components/settings/location-section';

const mockedApiClient = vi.mocked(apiClient);

// Suppress React error boundary noise
const originalConsoleError = console.error;
beforeEach(() => {
  vi.clearAllMocks();
  // Mock providers list (empty) and current location (null)
  mockedApiClient.get.mockImplementation((path: string) => {
    if (path === '/api/geolocation/providers') {
      return Promise.resolve({ providers: [] });
    }
    if (path === '/api/geolocation/current') {
      return Promise.resolve({ location: null });
    }
    return Promise.resolve({});
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  console.error = (...args: any[]) => {
    const msg = String(args[0]);
    if (msg.includes('Error: Uncaught') || msg.includes('The above error')) return;
    originalConsoleError(...args);
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  console.error = originalConsoleError;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderLocationSection() {
  return render(
    <LocationSection
      geoAutoInject={false}
      geoHighResRetentionHours={24}
      geoGeneralRetentionDays={30}
      onUpdate={vi.fn().mockResolvedValue(true)}
    />,
  );
}

async function openAddProviderDialog() {
  renderLocationSection();
  const addButton = await screen.findByTestId('add-provider-btn');
  fireEvent.click(addButton);
  await screen.findByTestId('add-provider-dialog');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HA OAuth UI — auth method toggle', () => {
  it('shows auth method radio when Home Assistant provider type is selected', async () => {
    await openAddProviderDialog();

    // Default provider type is home_assistant, so the auth method radio should be visible
    const authMethodGroup = screen.getByTestId('ha-auth-method');
    expect(authMethodGroup).toBeInTheDocument();

    // Should have both OAuth and Token options
    expect(screen.getByLabelText(/Connect with OAuth/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Long-lived Access Token/i)).toBeInTheDocument();
  });

  it('defaults to OAuth auth method', async () => {
    await openAddProviderDialog();

    const oauthRadio = screen.getByTestId('ha-auth-oauth') as HTMLInputElement;
    expect(oauthRadio).toBeChecked();
  });

  it('hides auth method radio when non-HA provider type is selected', async () => {
    await openAddProviderDialog();

    // Switch to MQTT
    const trigger = screen.getByTestId('provider-type-select');
    fireEvent.click(trigger);
    const mqttOption = await screen.findByText('MQTT');
    fireEvent.click(mqttOption);

    expect(screen.queryByTestId('ha-auth-method')).not.toBeInTheDocument();
  });

  it('shows access token input when Token method is selected', async () => {
    await openAddProviderDialog();

    // Initially, token input should be hidden (OAuth is default)
    expect(screen.queryByTestId('ha-token-input')).not.toBeInTheDocument();

    // Select token auth method
    const tokenRadio = screen.getByTestId('ha-auth-token');
    fireEvent.click(tokenRadio);

    // Now token input should be visible
    expect(screen.getByTestId('ha-token-input')).toBeInTheDocument();
  });

  it('hides access token input when OAuth method is selected', async () => {
    await openAddProviderDialog();

    // Select token first
    fireEvent.click(screen.getByTestId('ha-auth-token'));
    expect(screen.getByTestId('ha-token-input')).toBeInTheDocument();

    // Switch back to OAuth
    fireEvent.click(screen.getByTestId('ha-auth-oauth'));
    expect(screen.queryByTestId('ha-token-input')).not.toBeInTheDocument();
  });

  it('always shows HA URL input regardless of auth method', async () => {
    await openAddProviderDialog();

    // OAuth mode
    expect(screen.getByTestId('ha-url-input')).toBeInTheDocument();

    // Switch to token
    fireEvent.click(screen.getByTestId('ha-auth-token'));
    expect(screen.getByTestId('ha-url-input')).toBeInTheDocument();
  });
});

describe('HA OAuth UI — OAuth initiation', () => {
  it('calls initiate HA OAuth API endpoint on submit with OAuth method', async () => {
    mockedApiClient.get.mockImplementation((path: string) => {
      if (path === '/api/geolocation/providers') {
        return Promise.resolve({ providers: [] });
      }
      if (path === '/api/geolocation/current') {
        return Promise.resolve({ location: null });
      }
      return Promise.resolve({});
    });

    mockedApiClient.post.mockImplementation((path: string) => {
      if (path === '/api/geolocation/providers/ha/authorize') {
        return Promise.resolve({
          url: 'https://ha.example.com/auth/authorize?client_id=test',
          provider_id: 'test-provider-id',
        });
      }
      return Promise.resolve({});
    });

    // Mock window.location.href assignment
    const originalLocation = window.location;
    const locationMock = { ...originalLocation, href: '' };
    Object.defineProperty(window, 'location', {
      value: locationMock,
      writable: true,
    });

    await openAddProviderDialog();

    // Fill in HA URL and label
    const urlInput = screen.getByTestId('ha-url-input');
    fireEvent.change(urlInput, { target: { value: 'https://ha.example.com' } });

    const labelInput = screen.getByTestId('provider-label-input');
    fireEvent.change(labelInput, { target: { value: 'My HA' } });

    // Submit the form (OAuth is default)
    const submitBtn = screen.getByTestId('submit-provider-btn');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      // Should have called the authorize endpoint via POST
      const postCalls = mockedApiClient.post.mock.calls;
      const authCall = postCalls.find(
        (call) => typeof call[0] === 'string' && call[0] === '/api/geolocation/providers/ha/authorize',
      );
      expect(authCall).toBeDefined();
      expect(authCall![1]).toEqual({ instance_url: 'https://ha.example.com', label: 'My HA' });
    });

    // Restore
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
    });
  });

  it('shows error when HA URL is missing for OAuth submission', async () => {
    await openAddProviderDialog();

    // Fill only label
    const labelInput = screen.getByTestId('provider-label-input');
    fireEvent.change(labelInput, { target: { value: 'My HA' } });

    // Submit without URL
    fireEvent.click(screen.getByTestId('submit-provider-btn'));

    const errorEl = await screen.findByTestId('add-provider-error');
    expect(errorEl).toHaveTextContent('Home Assistant URL is required');
  });

  it('shows error when access token is missing for token submission', async () => {
    await openAddProviderDialog();

    // Switch to token auth
    fireEvent.click(screen.getByTestId('ha-auth-token'));

    // Fill URL and label but not token
    fireEvent.change(screen.getByTestId('ha-url-input'), {
      target: { value: 'https://ha.example.com' },
    });
    fireEvent.change(screen.getByTestId('provider-label-input'), {
      target: { value: 'My HA' },
    });

    fireEvent.click(screen.getByTestId('submit-provider-btn'));

    const errorEl = await screen.findByTestId('add-provider-error');
    expect(errorEl).toHaveTextContent('Access token is required');
  });

  it('submits token flow normally when token method is selected', async () => {
    mockedApiClient.post.mockResolvedValue({
      provider: {
        id: 'test-id',
        ownerEmail: 'test@example.com',
        providerType: 'home_assistant',
        authType: 'access_token',
        label: 'My HA',
        status: 'pending',
        statusMessage: null,
        config: {},
        credentials: null,
        pollIntervalSeconds: null,
        maxAgeSeconds: 300,
        isShared: false,
        lastSeenAt: null,
        deleted_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });

    await openAddProviderDialog();

    // Switch to token
    fireEvent.click(screen.getByTestId('ha-auth-token'));

    // Fill all fields
    fireEvent.change(screen.getByTestId('ha-url-input'), {
      target: { value: 'https://ha.example.com' },
    });
    fireEvent.change(screen.getByTestId('provider-label-input'), {
      target: { value: 'My HA' },
    });
    fireEvent.change(screen.getByTestId('ha-token-input'), {
      target: { value: 'my-long-lived-token' },
    });

    fireEvent.click(screen.getByTestId('submit-provider-btn'));

    await waitFor(() => {
      expect(mockedApiClient.post).toHaveBeenCalledWith(
        '/api/geolocation/providers',
        expect.objectContaining({
          providerType: 'home_assistant',
          label: 'My HA',
          authType: 'access_token',
          config: {
            url: 'https://ha.example.com',
            access_token: 'my-long-lived-token',
          },
        }),
      );
    });
  });
});
