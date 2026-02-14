/**
 * SPA-side login form component.
 *
 * Renders a magic link login form inside the SPA when the auth guard
 * determines the user is unauthenticated. This avoids the broken state
 * where the SPA loads from CDN cache but the user has no session.
 */
import type React from 'react';
import { useState } from 'react';
import { apiClient } from '@/ui/lib/api-client';

type FormState = 'idle' | 'submitting' | 'sent' | 'error';

export function LoginForm(): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [formState, setFormState] = useState<FormState>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setFormState('submitting');
    setErrorMessage('');

    try {
      await apiClient.post('/api/auth/request-link', { email: email.trim() });
      setFormState('sent');
    } catch (err: unknown) {
      setFormState('error');
      setErrorMessage(err instanceof Error ? err.message : 'Failed to send magic link. Please try again.');
    }
  };

  if (formState === 'sent') {
    return (
      <div data-testid="auth-required" className="flex min-h-screen flex-col items-center justify-center px-4">
        <div className="w-full max-w-md text-center">
          <div className="mb-4 text-4xl">&#x2709;&#xFE0F;</div>
          <h1 className="text-2xl font-bold tracking-tight">Check your email</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            We sent a magic link to <strong>{email}</strong>. Click the link in the email to sign in.
          </p>
          <button
            type="button"
            onClick={() => {
              setFormState('idle');
              setEmail('');
            }}
            className="mt-6 text-sm text-primary hover:underline"
          >
            Use a different email
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="auth-required" className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">OpenClaw Projects</h1>
          <p className="mt-2 text-sm text-muted-foreground">Sign in with your email to continue.</p>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <div>
            <label htmlFor="login-email" className="block text-sm font-medium">
              Email address
            </label>
            <input
              id="login-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              disabled={formState === 'submitting'}
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
            />
          </div>

          {formState === 'error' && errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}

          <button
            type="submit"
            disabled={formState === 'submitting' || !email.trim()}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {formState === 'submitting' ? 'Sending...' : 'Send magic link'}
          </button>
        </form>
      </div>
    </div>
  );
}
