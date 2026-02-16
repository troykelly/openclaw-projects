/**
 * Setup file for API tests.
 * Configures JWT auth so tests can use Bearer tokens via signTestJwt().
 * Also disables the auth-required gate on API routes so legacy tests
 * that don't send tokens still work for non-dashboard endpoints.
 */

// Disable the global auth gate so API routes work without tokens.
process.env.OPENCLAW_PROJECTS_AUTH_DISABLED = 'true';

// Provide a well-known JWT secret so signTestJwt() tokens are verifiable.
// Must be ≥32 bytes to satisfy the jwt.ts requireSecret() guard.
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'integration-test-jwt-secret-at-least-32-bytes!!';
}
