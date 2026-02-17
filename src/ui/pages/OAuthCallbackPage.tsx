/**
 * OAuth callback page.
 *
 * Handles the redirect back from OAuth providers (Microsoft/Google).
 * Reads code, state, and error from query parameters, calls the
 * backend callback API, then shows success/error state and redirects
 * to Connected Accounts settings.
 */
import { useOAuthCallback } from '@/ui/hooks/use-oauth-callback';

type CallbackStatus = 'loading' | 'success' | 'error';

function StatusIcon({ status }: { status: CallbackStatus }): React.JSX.Element {
  if (status === 'loading') {
    return (
      <div className="size-12 animate-spin rounded-full border-4 border-primary border-t-transparent" role="status">
        <span className="sr-only">Connecting account...</span>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="flex size-12 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400">
        <svg className="size-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      </div>
    );
  }

  return (
    <div className="flex size-12 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">
      <svg className="size-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </div>
  );
}

function providerLabel(provider: string): string {
  switch (provider) {
    case 'microsoft':
      return 'Microsoft 365';
    case 'google':
      return 'Google';
    default:
      return provider;
  }
}

export function OAuthCallbackPage(): React.JSX.Element {
  const { status, provider, user_email, errorMessage } = useOAuthCallback();

  return (
    <div data-testid="page-oauth-callback" className="flex min-h-[60vh] items-center justify-center p-8">
      <div className="w-full max-w-md text-center">
        <div className="mb-6 flex justify-center">
          <StatusIcon status={status} />
        </div>

        {status === 'loading' && (
          <div>
            <h1 className="text-xl font-semibold text-foreground">Connecting your account...</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Please wait while we complete the authorization.
            </p>
          </div>
        )}

        {status === 'success' && (
          <div>
            <h1 className="text-xl font-semibold text-foreground">Account connected</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {provider && (
                <>
                  Your {providerLabel(provider)} account
                  {user_email && <> ({user_email})</>} has been connected.
                </>
              )}
            </p>
            <p className="mt-4 text-xs text-muted-foreground">
              Redirecting to settings...{' '}
              <a href="/app/settings" className="text-primary underline hover:no-underline">
                Go now
              </a>
            </p>
          </div>
        )}

        {status === 'error' && (
          <div>
            <h1 className="text-xl font-semibold text-foreground">Connection failed</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {errorMessage || 'An unexpected error occurred while connecting your account.'}
            </p>
            <div className="mt-6">
              <a
                href="/app/settings"
                className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Try again
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
