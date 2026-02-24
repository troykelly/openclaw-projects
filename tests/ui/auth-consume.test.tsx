/**
 * @vitest-environment jsdom
 *
 * Tests for the auth consumption page (issues #1333, #1335).
 *
 * Covers: loading state, success flow with redirect, error flow,
 * missing credentials, deep link preservation via sessionStorage,
 * and OAuth code exchange via POST /api/auth/exchange.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock auth-manager module
const mockSetAccessToken = vi.fn();
vi.mock('@/ui/lib/auth-manager', () => ({
  setAccessToken: (...args: unknown[]) => mockSetAccessToken(...args),
}));

// Mock api-config module
vi.mock('@/ui/lib/api-config', () => ({
  getApiBaseUrl: () => '',
}));

// Mock user context — AuthConsumePage calls signalAuthenticated() after token exchange
const mockSignalAuthenticated = vi.fn();
vi.mock('@/ui/contexts/user-context', () => ({
  useUser: () => ({
    email: null,
    isLoading: false,
    isAuthenticated: false,
    logout: vi.fn(),
    signalAuthenticated: mockSignalAuthenticated,
  }),
}));

// Capture navigation
let navigatedTo: string | null = null;

// Track sessionStorage reads
const sessionStorageMock: Record<string, string> = {};

const WAIT_OPTS = { timeout: 5_000 };

/**
 * Render the AuthConsumePage within a memory router.
 * The route is defined at `/auth/consume` to match the real route config.
 */
async function renderConsumePage(search = '') {
  // Dynamic import to get the actual component (not cached)
  const { AuthConsumePage } = await import('../../src/ui/pages/AuthConsumePage');

  navigatedTo = null;

  const routes = [
    {
      path: '/auth/consume',
      element: <AuthConsumePage />,
    },
    {
      path: '/dashboard',
      element: <div data-testid="dashboard-page">Dashboard</div>,
    },
    {
      path: '/work-items',
      element: <div data-testid="work-items-page">Work Items</div>,
    },
    {
      path: '/contacts',
      element: <div data-testid="contacts-page">Contacts</div>,
    },
  ];

  const router = createMemoryRouter(routes, {
    initialEntries: [`/auth/consume${search}`],
  });

  // Track navigation changes
  router.subscribe((state) => {
    if (state.location.pathname !== '/auth/consume') {
      navigatedTo = state.location.pathname;
    }
  });

  return render(<RouterProvider router={router} />);
}

describe('AuthConsumePage (issues #1333, #1335)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    mockSetAccessToken.mockClear();
    mockSignalAuthenticated.mockClear();
    navigatedTo = null;
    // Clear sessionStorage mock
    for (const key of Object.keys(sessionStorageMock)) {
      delete sessionStorageMock[key];
    }
    // Mock sessionStorage
    Object.defineProperty(window, 'sessionStorage', {
      value: {
        getItem: (key: string) => sessionStorageMock[key] ?? null,
        setItem: (key: string, value: string) => {
          sessionStorageMock[key] = value;
        },
        removeItem: (key: string) => {
          delete sessionStorageMock[key];
        },
        clear: () => {
          for (const k of Object.keys(sessionStorageMock)) delete sessionStorageMock[k];
        },
        get length() {
          return Object.keys(sessionStorageMock).length;
        },
        key: (i: number) => Object.keys(sessionStorageMock)[i] ?? null,
      },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('shows loading state while consuming token', async () => {
    // Keep fetch pending so we stay in loading state
    fetchSpy.mockReturnValue(new Promise(() => {}));

    await renderConsumePage('?token=abc123');

    expect(screen.getByTestId('page-auth-consume')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /signing you in/i })).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument(); // <output> element
  });

  it('calls POST /api/auth/consume with the token', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'jwt.token.here' }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    await renderConsumePage('?token=magic-token-123');

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/auth/consume',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          body: JSON.stringify({ token: 'magic-token-123' }),
        }),
      );
    }, WAIT_OPTS);
  });

  it('stores access token, signals auth, and redirects to /dashboard on success', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'jwt.access.token' }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    await renderConsumePage('?token=valid-token');

    await waitFor(() => {
      expect(mockSetAccessToken).toHaveBeenCalledWith('jwt.access.token');
    }, WAIT_OPTS);

    await waitFor(() => {
      expect(mockSignalAuthenticated).toHaveBeenCalledTimes(1);
    }, WAIT_OPTS);

    await waitFor(() => {
      expect(navigatedTo).toBe('/dashboard');
    }, WAIT_OPTS);
  });

  it('redirects to preserved deep link after success', async () => {
    // Simulate a preserved deep link
    sessionStorageMock.auth_return_to = '/contacts';

    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'jwt.access.token' }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    await renderConsumePage('?token=valid-token');

    await waitFor(() => {
      expect(mockSetAccessToken).toHaveBeenCalledWith('jwt.access.token');
    }, WAIT_OPTS);

    await waitFor(() => {
      expect(navigatedTo).toBe('/contacts');
    }, WAIT_OPTS);

    // Deep link should be cleared after use
    expect(sessionStorageMock.auth_return_to).toBeUndefined();
  });

  it('scrubs credentials from URL bar via history.replaceState', async () => {
    fetchSpy.mockReturnValue(new Promise(() => {})); // Keep pending

    const replaceStateSpy = vi.spyOn(window.history, 'replaceState');

    await renderConsumePage('?code=secret-oauth-code');

    // The component calls replaceState with the current pathname to remove
    // the query string. In jsdom with MemoryRouter the actual window.location
    // pathname is '/', but the important thing is that replaceState is called
    // with the pathname (no query string containing the secret code).
    expect(replaceStateSpy).toHaveBeenCalledTimes(1);
    const [, , url] = replaceStateSpy.mock.calls[0];
    expect(typeof url).toBe('string');
    expect((url as string)).not.toContain('code=');
    expect((url as string)).not.toContain('token=');
    replaceStateSpy.mockRestore();
  });

  it('shows error when neither token nor code is in URL', async () => {
    await renderConsumePage('');

    expect(screen.getByTestId('page-auth-consume')).toBeInTheDocument();
    expect(screen.getByText(/missing/i)).toBeInTheDocument();
    // Should not call the API
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // ── OAuth code exchange flow (issue #1335) ───────────────────────

  it('calls POST /api/auth/exchange with the code parameter', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'jwt.oauth.token' }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    await renderConsumePage('?code=oauth-code-123');

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/auth/exchange',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          body: JSON.stringify({ code: 'oauth-code-123' }),
        }),
      );
    }, WAIT_OPTS);
  });

  it('stores access token, signals auth, and redirects on OAuth code exchange success', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'jwt.oauth.access' }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    await renderConsumePage('?code=valid-oauth-code');

    await waitFor(() => {
      expect(mockSetAccessToken).toHaveBeenCalledWith('jwt.oauth.access');
    }, WAIT_OPTS);

    await waitFor(() => {
      expect(mockSignalAuthenticated).toHaveBeenCalledTimes(1);
    }, WAIT_OPTS);

    await waitFor(() => {
      expect(navigatedTo).toBe('/dashboard');
    }, WAIT_OPTS);
  });

  it('shows error when OAuth code exchange fails', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid or expired code' }), { status: 400, headers: { 'Content-Type': 'application/json' } }),
    );

    await renderConsumePage('?code=bad-code');

    await waitFor(() => {
      expect(screen.getByText(/invalid or expired/i)).toBeInTheDocument();
    }, WAIT_OPTS);
  });

  it('prefers token over code when both are present', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'jwt.token.here' }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    await renderConsumePage('?token=magic-token&code=oauth-code');

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/auth/consume',
        expect.objectContaining({
          body: JSON.stringify({ token: 'magic-token' }),
        }),
      );
    }, WAIT_OPTS);
  });

  it('shows error when API returns failure', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid or expired token' }), { status: 400, headers: { 'Content-Type': 'application/json' } }),
    );

    await renderConsumePage('?token=expired-token');

    await waitFor(() => {
      expect(screen.getByText(/invalid or expired/i)).toBeInTheDocument();
    }, WAIT_OPTS);

    // Should show a link to request a new magic link
    expect(screen.getByText(/request a new link/i)).toBeInTheDocument();
  });

  it('shows error on network failure', async () => {
    fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));

    await renderConsumePage('?token=some-token');

    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument();
    }, WAIT_OPTS);
  });

  it('does not store token on API error', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid or expired token' }), { status: 400, headers: { 'Content-Type': 'application/json' } }),
    );

    await renderConsumePage('?token=bad-token');

    await waitFor(() => {
      expect(screen.getByText(/invalid or expired/i)).toBeInTheDocument();
    }, WAIT_OPTS);

    expect(mockSetAccessToken).not.toHaveBeenCalled();
  });

  it('ignores deep links to auth paths for redirect', async () => {
    // Prevent redirect loops: don't redirect back to auth pages
    sessionStorageMock.auth_return_to = '/auth/consume';

    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'jwt.access.token' }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    await renderConsumePage('?token=valid-token');

    await waitFor(() => {
      expect(navigatedTo).toBe('/dashboard');
    }, WAIT_OPTS);
  });
});
