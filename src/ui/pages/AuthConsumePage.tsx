/**
 * Authentication consumption page.
 *
 * Handles the final step of both magic link and OAuth login flows:
 *
 * 1. **Magic link** (`?token=<token>`): Sends the one-time token to
 *    `POST /api/auth/consume` to exchange it for a JWT access token.
 *
 * 2. **OAuth callback** (`?code=<code>`): After a successful OAuth provider
 *    callback, the API redirects here with a one-time authorization code.
 *    The code is exchanged for a JWT via `POST /api/auth/exchange`.
 *
 * Both flows store the JWT access token in memory and redirect to the app.
 * The API also sets an HttpOnly refresh cookie via the response.
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
    if (stored?.startsWith('/') && !stored.startsWith('//') && !stored.startsWith('/auth')) {
      return stored;
    }
  } catch {
    // sessionStorage may be unavailable (private browsing, etc.)
  }
  return DEFAULT_REDIRECT;
}

/**
 * Exchange a credential (magic link token or OAuth code) for a JWT.
 *
 * Calls the appropriate API endpoint based on the credential type:
 * - token -> POST /api/auth/consume
 * - code  -> POST /api/auth/exchange
 */
async function exchangeCredential(token: string | null, code: string | null, signal: AbortSignal): Promise<{ accessToken: string }> {
  let endpoint: string;
  let payload: Record<string, string>;

  if (token) {
    endpoint = `${getApiBaseUrl()}/api/auth/consume`;
    payload = { token };
  } else if (code) {
    endpoint = `${getApiBaseUrl()}/api/auth/exchange`;
    payload = { code };
  } else {
    throw new Error('No credential provided');
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    credentials: 'include',
    referrerPolicy: 'no-referrer',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const message = typeof body.error === 'string' ? body.error : `Authentication failed (${res.status})`;
    throw new Error(message);
  }

  const body = (await res.json()) as Record<string, unknown>;
  if (typeof body.accessToken !== 'string' || body.accessToken.length === 0) {
    throw new Error('Invalid response from server.');
  }

  return { accessToken: body.accessToken };
}

export function AuthConsumePage(): React.JSX.Element {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Extract credentials from URL query parameters.
  // Token (magic link) takes priority over code (OAuth) if both are present.
  const token = searchParams.get('token');
  const code = searchParams.get('code');
  const hasCredential = Boolean(token || code);

  const [state, setState] = useState<ConsumeState>(() => {
    if (!hasCredential) {
      return {
        status: 'error',
        errorMessage: 'Missing authentication credentials. Please request a new login link.',
      };
    }
    return { status: 'loading', errorMessage: null };
  });

  useEffect(() => {
    if (!token && !code) return;

    const controller = new AbortController();

    (async () => {
      try {
        const { accessToken } = await exchangeCredential(token, code, controller.signal);

        setAccessToken(accessToken);
        setState({ status: 'success', errorMessage: null });

        const returnPath = getReturnPath();
        navigate(returnPath, { replace: true });
      } catch (err) {
        if (controller.signal.aborted) return;
        const message =
          err instanceof TypeError
            ? 'Network error. Please check your connection and try again.'
            : err instanceof Error
              ? err.message
              : 'An unexpected error occurred.';
        setState({ status: 'error', errorMessage: message });
      }
    })();

    return () => controller.abort();
  }, [token, code, navigate]);

  return (
    <div data-testid="page-auth-consume" className="flex min-h-[60vh] items-center justify-center p-8">
      <div className="w-full max-w-md text-center">
        {state.status === 'loading' && (
          <div>
            <div className="mb-6 flex justify-center">
              <output className="size-12 animate-spin rounded-full border-4 border-primary border-t-transparent">
                <span className="sr-only">Signing you in...</span>
              </output>
            </div>
            <h1 className="text-xl font-semibold text-foreground">Signing you in...</h1>
            <p className="mt-2 text-sm text-muted-foreground">Please wait while we verify your credentials.</p>
          </div>
        )}

        {state.status === 'error' && (
          <div>
            <div className="mb-6 flex justify-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">
                <svg className="size-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
            </div>
            <h1 className="text-xl font-semibold text-foreground">Sign in failed</h1>
            <p className="mt-2 text-sm text-muted-foreground">{state.errorMessage}</p>
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
