/**
 * Hook that manages the OAuth callback flow.
 *
 * Reads code/state/error from the current URL, calls the backend
 * callback API, and manages loading/success/error state.
 * On success, auto-redirects to settings after 3 seconds.
 */
import { useState, useEffect, useRef } from 'react';
import { apiClient, ApiRequestError } from '@/ui/lib/api-client';

interface OAuthCallbackResult {
  status: 'loading' | 'success' | 'error';
  provider?: string;
  userEmail?: string;
  errorMessage?: string;
}

interface CallbackResponse {
  status: string;
  provider: string;
  userEmail: string;
  connectionId: string;
  scopes: string[];
}

interface ErrorResponse {
  error: string;
  code?: string;
  details?: string;
}

function getErrorMessage(error: string | undefined, code: string | undefined, details: string | undefined): string {
  if (error === 'access_denied' || details === 'access_denied') {
    return 'You denied access to your account. You can try again from Connected Accounts settings.';
  }
  if (code === 'INVALID_STATE') {
    return 'The authorization session has expired or was already used. Please start over from Connected Accounts settings.';
  }
  if (error) {
    return error;
  }
  return 'An unexpected error occurred while connecting your account.';
}

export function useOAuthCallback(): OAuthCallbackResult {
  const [result, setResult] = useState<OAuthCallbackResult>({ status: 'loading' });
  const calledRef = useRef(false);

  useEffect(() => {
    if (calledRef.current) return;
    calledRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const error = params.get('error');
    const code = params.get('code');
    const state = params.get('state');

    // OAuth provider returned an error
    if (error) {
      setResult({
        status: 'error',
        errorMessage: getErrorMessage(undefined, undefined, error),
      });
      return;
    }

    // Missing required params
    if (!code || !state) {
      setResult({
        status: 'error',
        errorMessage: 'Missing authorization code or state. Please start over from Connected Accounts settings.',
      });
      return;
    }

    // Call the backend callback API
    const controller = new AbortController();

    apiClient
      .get<CallbackResponse>(`/api/oauth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`, {
        signal: controller.signal,
      })
      .then((body) => {
        setResult({
          status: 'success',
          provider: body.provider,
          userEmail: body.userEmail,
        });

        // Auto-redirect after 3 seconds
        setTimeout(() => {
          window.location.href = '/app/settings';
        }, 3000);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (err instanceof ApiRequestError) {
          const details = err.details as ErrorResponse | undefined;
          setResult({
            status: 'error',
            errorMessage: getErrorMessage(details?.error, details?.code, details?.details),
          });
          return;
        }
        setResult({
          status: 'error',
          errorMessage: 'Network error. Please check your connection and try again.',
        });
      });

    return () => {
      controller.abort();
    };
  }, []);

  return result;
}
