/**
 * @vitest-environment jsdom
 *
 * Tests for OAuth callback page.
 * Part of Issue #1052.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { OAuthCallbackPage } from '../../src/ui/pages/OAuthCallbackPage';

// Save original location
const originalLocation = window.location;

function mockLocation(search: string): void {
  Object.defineProperty(window, 'location', {
    value: { ...originalLocation, search, href: originalLocation.href },
    writable: true,
    configurable: true,
  });
}

function restoreLocation(): void {
  Object.defineProperty(window, 'location', {
    value: originalLocation,
    writable: true,
    configurable: true,
  });
}

describe('OAuthCallbackPage', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.useRealTimers();
    fetchSpy.mockRestore();
    restoreLocation();
  });

  it('shows loading state initially during token exchange', () => {
    mockLocation('?code=test-code&state=test-state');
    // Keep fetch pending
    fetchSpy.mockReturnValue(new Promise(() => {}));

    render(<OAuthCallbackPage />);

    expect(screen.getByTestId('page-oauth-callback')).toBeDefined();
    expect(screen.getByText('Connecting your account...')).toBeDefined();
    expect(screen.getByRole('status')).toBeDefined();
  });

  it('shows success state after successful token exchange', async () => {
    mockLocation('?code=auth-code&state=valid-state');
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'connected',
          provider: 'microsoft',
          userEmail: 'user@example.com',
          connectionId: 'test-id',
          scopes: ['contacts'],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    render(<OAuthCallbackPage />);

    await waitFor(() => {
      expect(screen.getByText('Account connected')).toBeDefined();
    });

    expect(screen.getByText(/Microsoft 365/)).toBeDefined();
    expect(screen.getByText(/user@example.com/)).toBeDefined();
    expect(screen.getByText('Go now')).toBeDefined();
  });

  it('shows error state when provider returns error', () => {
    mockLocation('?error=access_denied');

    render(<OAuthCallbackPage />);

    expect(screen.getByText('Connection failed')).toBeDefined();
    expect(screen.getByText(/denied access/)).toBeDefined();
    expect(screen.getByText('Try again')).toBeDefined();
  });

  it('shows error when code or state is missing', () => {
    mockLocation('');

    render(<OAuthCallbackPage />);

    expect(screen.getByText('Connection failed')).toBeDefined();
    expect(screen.getByText(/Missing authorization code/)).toBeDefined();
  });

  it('shows error when code is present but state is missing', () => {
    mockLocation('?code=some-code');

    render(<OAuthCallbackPage />);

    expect(screen.getByText('Connection failed')).toBeDefined();
    expect(screen.getByText(/Missing authorization code/)).toBeDefined();
  });

  it('shows error when API returns invalid state', async () => {
    mockLocation('?code=test-code&state=expired-state');
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'Invalid or expired OAuth state',
          code: 'INVALID_STATE',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    render(<OAuthCallbackPage />);

    await waitFor(() => {
      expect(screen.getByText('Connection failed')).toBeDefined();
    });

    expect(screen.getByText(/expired or was already used/)).toBeDefined();
  });

  it('shows error on network failure', async () => {
    mockLocation('?code=test-code&state=valid-state');
    fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));

    render(<OAuthCallbackPage />);

    await waitFor(() => {
      expect(screen.getByText('Connection failed')).toBeDefined();
    });

    expect(screen.getByText(/Network error/)).toBeDefined();
  });

  it('shows Google provider label correctly', async () => {
    mockLocation('?code=auth-code&state=valid-state');
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'connected',
          provider: 'google',
          userEmail: 'user@gmail.com',
          connectionId: 'test-id',
          scopes: ['contacts'],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    render(<OAuthCallbackPage />);

    await waitFor(() => {
      expect(screen.getByText('Account connected')).toBeDefined();
    });

    expect(screen.getByText(/Google/)).toBeDefined();
    expect(screen.getByText(/user@gmail.com/)).toBeDefined();
  });

  it('calls the correct API endpoint with code and state', async () => {
    mockLocation('?code=my-code&state=my-state');
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'connected',
          provider: 'microsoft',
          userEmail: 'test@test.com',
          connectionId: 'id',
          scopes: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    render(<OAuthCallbackPage />);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/oauth/callback?code=my-code&state=my-state',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  it('shows generic API error message', async () => {
    mockLocation('?code=test-code&state=valid-state');
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'Token exchange failed: invalid_grant',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    render(<OAuthCallbackPage />);

    await waitFor(() => {
      expect(screen.getByText('Connection failed')).toBeDefined();
    });

    expect(screen.getByText(/Token exchange failed/)).toBeDefined();
  });
});
