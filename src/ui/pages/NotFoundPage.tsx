import { useLocation, Link } from 'react-router';

/**
 * 404 Not Found page.
 * Shown when no route matches the current URL.
 */
export function NotFoundPage(): React.JSX.Element {
  const location = useLocation();
  return (
    <div data-testid="page-not-found" className="flex flex-col items-center justify-center p-6">
      <h1 className="text-4xl font-bold text-muted-foreground">404</h1>
      <p className="mt-2 text-lg text-muted-foreground">Page not found: {location.pathname}</p>
      <Link to="/activity" className="mt-4 text-primary underline hover:text-primary/80">
        Go to Activity
      </Link>
    </div>
  );
}
