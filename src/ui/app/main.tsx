/**
 * Application entry point.
 *
 * Creates the React root, sets up the TanStack Query client, and renders
 * the application with React Router. All page components are defined in
 * `src/ui/pages/` and lazy-loaded via the route configuration in
 * `src/ui/routes.tsx`. The AppLayout (sidebar, header, command palette)
 * is rendered as a layout route wrapping all page routes.
 *
 * ThemeProvider wraps the entire tree to manage light/dark/oled/system
 * themes with no flash of wrong theme on page load.
 *
 * Sentry is initialized conditionally when VITE_SENTRY_DSN is set (#2002).
 */
import '../app.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/ui/providers/ThemeProvider';
import { UserProvider } from '@/ui/contexts/user-context';
import { NamespaceProvider } from '@/ui/contexts/namespace-context';
import { ErrorBoundary } from '@/ui/components/error-boundary';
import { routes } from '@/ui/routes';
import { initSentry } from '@/ui/lib/sentry';

// Initialize Sentry — no-op when DSN is unset (#2002)
initSentry({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.VITE_SENTRY_ENVIRONMENT,
  release: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : undefined,
  tracesSampleRate: import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE
    ? Number.parseFloat(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE)
    : undefined,
});

/** Shared QueryClient instance with default stale time and retry policy. */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

/** Browser router with all application routes, using /app as basename. */
const router = createBrowserRouter(routes, {
  basename: '/app',
});

// Mount the application
const el = document.getElementById('root');
if (!el) throw new Error('Missing #root element');

createRoot(el).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <UserProvider>
            <NamespaceProvider>
              <RouterProvider router={router} />
            </NamespaceProvider>
          </UserProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
