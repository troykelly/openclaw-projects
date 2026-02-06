/**
 * User context for authentication state.
 *
 * Fetches and provides the current user's email from /api/me.
 * Used by hooks that need to pass user identity to API endpoints.
 */
import React, { createContext, useContext, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';

interface MeResponse {
  email: string;
}

interface UserContextValue {
  /** Current user's email, or null if not authenticated */
  email: string | null;
  /** Whether the user query is loading */
  isLoading: boolean;
  /** Whether the user is authenticated */
  isAuthenticated: boolean;
}

const UserContext = createContext<UserContextValue | null>(null);

/**
 * Provider component that fetches and provides user authentication state.
 */
export function UserProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const { data, isLoading, isError } = useQuery({
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
  });

  const value = useMemo<UserContextValue>(
    () => ({
      email: data?.email ?? null,
      isLoading,
      isAuthenticated: !isError && !!data?.email,
    }),
    [data?.email, isLoading, isError]
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

/**
 * Hook to access the current user's authentication state.
 *
 * @returns User context value with email, loading state, and auth status
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
