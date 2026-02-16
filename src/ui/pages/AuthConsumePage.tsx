/**
 * Magic link consumption page.
 *
 * Handles the final step of magic link login: reads the one-time `token`
 * from the URL query string, sends it to `POST /api/auth/consume`, and
 * on success stores the JWT access token in memory and redirects to the
 * app. The API also sets an HttpOnly refresh cookie via the response.
 *
 * Deep link preservation: if the user was on a specific page before being
 * redirected to login, that path is stored in `sessionStorage` under
 * `auth_return_to` and used as the redirect target after successful login.
 *
 * This page lives outside the AppLayout auth guard since the user is not
 * yet authenticated when they arrive here.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { getApiBaseUrl } from '@/ui/lib/api-config';
import { setAccessToken } from '@/ui/lib/auth-manager';

/** Key used in sessionStorage to preserve the pre-auth deep link. */
const RETURN_TO_KEY = 'auth_return_to';

/** Default redirect target after successful login. */
const DEFAULT_REDIRECT = '/work-items';

type ConsumeStatus = 'loading' | 'success' | 'error';

interface ConsumeState {
  status: ConsumeStatus;
  errorMessage: string | null;
}

/**
 * Read and clear the preserved deep link from sessionStorage.
 * Returns the default redirect path if no deep link is stored or
 * if the stored path is an auth route (to prevent redirect loops).
 */
function getReturnPath(): string {
  try {
    const stored = sessionStorage.getItem(RETURN_TO_KEY);
    sessionStorage.removeItem(RETURN_TO_KEY);
    if (stored && !stored.startsWith('/auth')) {
      return stored;
    }
  } catch {
    // sessionStorage may be unavailable (private browsing, etc.)
  }
  return DEFAULT_REDIRECT;
}

export function AuthConsumePage(): React.JSX.Element {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');

  const [state, setState] = useState<ConsumeState>(() => {
    if (!token) {
      return { status: 'error', errorMessage: 'Missing authentication token. Please request a new magic link.' };
    }
    return { status: 'loading', errorMessage: null };
  });

  useEffect(() => {
    if (!token) return;

    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch(`${getApiBaseUrl()}/api/auth/consume`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify({ token }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as Record<string, unknown>;
          const message = typeof body.error === 'string'
            ? body.error
            : `Authentication failed (${res.status})`;
          setState({ status: 'error', errorMessage: message });
          return;
        }

        const body = await res.json() as Record<string, unknown>;
        if (typeof body.accessToken !== 'string' || body.accessToken.length === 0) {
          setState({ status: 'error', errorMessage: 'Invalid response from server.' });
          return;
        }

        setAccessToken(body.accessToken);
        setState({ status: 'success', errorMessage: null });

        const returnPath = getReturnPath();
        navigate(returnPath, { replace: true });
      } catch (err) {
        if (controller.signal.aborted) return;
        const message = err instanceof TypeError
          ? 'Network error. Please check your connection and try again.'
          : 'An unexpected error occurred.';
        setState({ status: 'error', errorMessage: message });
      }
    })();

    return () => controller.abort();
  }, [token, navigate]);

  return (
    <div data-testid="page-auth-consume" className="flex min-h-[60vh] items-center justify-center p-8">
      <div className="w-full max-w-md text-center">
        {state.status === 'loading' && (
          <div>
            <div className="mb-6 flex justify-center">
              <div className="size-12 animate-spin rounded-full border-4 border-primary border-t-transparent" role="status">
                <span className="sr-only">Signing you in...</span>
              </div>
            </div>
            <h1 className="text-xl font-semibold text-foreground">Signing you in...</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Please wait while we verify your magic link.
            </p>
          </div>
        )}

        {state.status === 'error' && (
          <div>
            <div className="mb-6 flex justify-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">
                <svg className="size-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
            </div>
            <h1 className="text-xl font-semibold text-foreground">Sign in failed</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {state.errorMessage}
            </p>
            <div className="mt-6">
              <a
                href="/app/login"
                className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Request a new link
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
