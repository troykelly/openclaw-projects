/**
 * Setup file for API tests.
 * Disables bearer token authentication by default for existing tests.
 */

// Disable auth for API tests by default
// This allows existing tests to continue working after bearer token auth was added.
// Tests that specifically test auth behavior (like secret-auth.test.ts) will
// manage their own environment variables.
process.env.CLAWDBOT_AUTH_DISABLED = 'true';
