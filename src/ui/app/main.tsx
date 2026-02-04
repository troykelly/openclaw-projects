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
 */
import '../app.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/ui/providers/ThemeProvider';
import { routes } from '@/ui/routes';

/** Shared QueryClient instance with default stale time and retry policy. */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

/** Browser router with all application routes, using /static/app as basename. */
const router = createBrowserRouter(routes, {
  basename: '/static/app',
});

// Mount the application
const el = document.getElementById('root');
if (!el) throw new Error('Missing #root element');

createRoot(el).render(
  <React.StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
