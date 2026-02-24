/**
 * User context for authentication state.
 *
 * On mount, attempts to refresh the access token (the HttpOnly refresh
 * cookie is sent automatically). If refresh succeeds, fetches `/api/me`
 * to populate user data. If refresh fails, the user is not authenticated.
 *
 * Provides a `logout()` function that revokes the refresh token server-side,
 * clears the in-memory access token, and redirects to the login page.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type React from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/ui/lib/api-client.ts';
import { clearAccessToken, getAccessToken, refreshAccessToken } from '@/ui/lib/auth-manager.ts';

interface MeResponse {
  email: string;
}

interface UserContextValue {
  /** Current user's email, or null if not authenticated */
  email: string | null;
  /** Whether the initial auth bootstrap is in progress */
  isLoading: boolean;
  /** Whether the user is authenticated */
  isAuthenticated: boolean;
  /** Log out: revoke refresh token, clear access token, redirect to login */
  logout: () => Promise<void>;
  /**
   * Signal that an access token was acquired externally (e.g. by the
   * AuthConsumePage). Resets the bootstrap failure state and triggers
   * a /api/me fetch so the auth guard lets the user through.
   */
  signalAuthenticated: () => void;
}

const UserContext = createContext<UserContextValue | null>(null);

/**
 * Provider component that bootstraps authentication and provides user state.
 *
 * On mount, calls refreshAccessToken() to establish a session from the
 * HttpOnly refresh cookie. If the refresh succeeds, fetches /api/me for
 * user data. If it fails, the user is unauthenticated.
 */
export function UserProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const queryClient = useQueryClient();
  const [authReady, setAuthReady] = useState(false);
  const [authFailed, setAuthFailed] = useState(false);

  // Bootstrap: try to refresh the access token on mount
  useEffect(() => {
    let cancelled = false;

    refreshAccessToken()
      .then(() => {
        if (!cancelled) setAuthReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setAuthReady(true);
          setAuthFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch /api/me only after auth bootstrap succeeds
  const { data, isLoading: isMeLoading } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await apiClient.get<MeResponse>('/api/me');
      } catch {
        return null;
      }
    },
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: authReady && !authFailed && !!getAccessToken(),
  });

  const isLoading = !authReady || (authReady && !authFailed && isMeLoading);

  const signalAuthenticated = useCallback(() => {
    setAuthFailed(false);
    setAuthReady(true);
    // Invalidate the 'me' query so it re-fetches with the new token
    queryClient.invalidateQueries({ queryKey: ['me'] });
  }, [queryClient]);

  const logout = useCallback(async () => {
    try {
      await apiClient.post('/api/auth/revoke', {});
    } catch {
      // Best-effort revocation — continue with local cleanup even if server call fails
    }
    clearAccessToken();
    queryClient.clear();
    window.location.href = '/app/login';
  }, [queryClient]);

  const value = useMemo<UserContextValue>(
    () => ({
      email: data?.email ?? null,
      isLoading,
      isAuthenticated: !authFailed && !!data?.email,
      logout,
      signalAuthenticated,
    }),
    [data?.email, isLoading, authFailed, logout, signalAuthenticated],
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

/**
 * Hook to access the current user's authentication state.
 *
 * @returns User context value with email, loading state, auth status, and logout
 * @throws Error if used outside UserProvider
 */
export function useUser(): UserContextValue {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
}

/**
 * Hook to get just the current user's email.
 * Returns null if not authenticated, still loading, or outside UserProvider.
 *
 * Unlike useUser(), this hook does NOT throw if used outside a UserProvider.
 * This allows query/mutation hooks to be mounted safely and just disable
 * themselves when there's no authenticated user context.
 */
export function useUserEmail(): string | null {
  const context = useContext(UserContext);
  if (process.env.NODE_ENV === 'development' && !context) {
    console.warn('[useUserEmail] Called outside UserProvider - returning null');
  }
  return context?.email ?? null;
}
