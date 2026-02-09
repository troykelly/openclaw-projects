import { execSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';

/**
 * Loads the shared secret from environment variables, file, or command.
 *
 * Priority order (highest first):
 * 1. OPENCLAW_PROJECTS_AUTH_SECRET_COMMAND - Execute command and use output
 * 2. OPENCLAW_PROJECTS_AUTH_SECRET_FILE - Read from file
 * 3. OPENCLAW_PROJECTS_AUTH_SECRET - Direct value from environment
 *
 * @returns The secret string, or empty string if not configured
 */
export function loadSecret(): string {
  // Priority 1: Command (e.g., 1Password CLI)
  const command = process.env.OPENCLAW_PROJECTS_AUTH_SECRET_COMMAND;
  if (command && command.trim()) {
    try {
      // Security note: This uses execSync intentionally because:
      // 1. The command comes from environment variables set by system administrators
      // 2. It must support shell commands like `op read 'op://...'` for secret managers
      // 3. This is NOT user input - it's server-side configuration
      // eslint-disable-next-line security/detect-child-process
      const result = execSync(command, {
        encoding: 'utf-8',
        timeout: 10000, // 10 second timeout
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return result.trim();
    } catch (error) {
      // Log error but don't throw - fall through to other methods
      console.error('[Auth] Failed to execute secret command:', (error as Error).message);
    }
  }

  // Priority 2: File
  const file = process.env.OPENCLAW_PROJECTS_AUTH_SECRET_FILE;
  if (file && file.trim()) {
    try {
      // Check file permissions - warn if world-readable
      const stats = statSync(file);
      const mode = stats.mode & 0o777;
      if (mode & 0o004) {
        console.warn(`[Auth] Warning: Secret file ${file} is world-readable (mode ${mode.toString(8)})`);
      }

      const content = readFileSync(file, 'utf-8');
      return content.trim();
    } catch (error) {
      console.error('[Auth] Failed to read secret file:', (error as Error).message);
    }
  }

  // Priority 3: Direct environment variable
  const directValue = process.env.OPENCLAW_PROJECTS_AUTH_SECRET;
  if (directValue) {
    return directValue.trim();
  }

  return '';
}

/**
 * Compares two secrets using constant-time comparison to prevent timing attacks.
 *
 * @param provided - The secret provided by the client
 * @param expected - The expected secret
 * @returns true if the secrets match
 */
export function compareSecrets(provided: string, expected: string): boolean {
  if (!provided || !expected) {
    return false;
  }

  // Convert to buffers for timing-safe comparison
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);

  // If lengths differ, we still need to do the comparison to avoid timing leak
  // We pad the shorter buffer to match the longer one
  if (providedBuf.length !== expectedBuf.length) {
    // Create a buffer of the same length as expected and compare
    // This ensures timing doesn't leak length information
    const paddedProvided = Buffer.alloc(expectedBuf.length);
    providedBuf.copy(paddedProvided, 0, 0, Math.min(providedBuf.length, expectedBuf.length));

    // Always compare to avoid timing leak, but result is always false if lengths differ
    try {
      timingSafeEqual(paddedProvided, expectedBuf);
    } catch {
      // Ignore - just ensuring constant time
    }
    return false;
  }

  try {
    return timingSafeEqual(providedBuf, expectedBuf);
  } catch {
    return false;
  }
}

/**
 * Checks if authentication is disabled via environment variable.
 * This should only be used in development.
 */
export function isAuthDisabled(): boolean {
  const disabled = process.env.OPENCLAW_PROJECTS_AUTH_DISABLED;
  if (disabled === 'true' || disabled === '1') {
    console.warn('[Auth] WARNING: Authentication is disabled. Do not use in production!');
    return true;
  }
  return false;
}

/**
 * Validates that a secret is configured (for production startup checks).
 * Throws if no secret is available and auth is not disabled.
 */
export function requireSecretOrDisabled(): void {
  if (isAuthDisabled()) {
    return;
  }

  const secret = loadSecret();
  if (!secret) {
    throw new Error(
      '[Auth] No authentication secret configured. ' +
        'Set OPENCLAW_PROJECTS_AUTH_SECRET, OPENCLAW_PROJECTS_AUTH_SECRET_FILE, or OPENCLAW_PROJECTS_AUTH_SECRET_COMMAND. ' +
        'For development, you can set OPENCLAW_PROJECTS_AUTH_DISABLED=true.',
    );
  }
}

// Cache the loaded secret to avoid re-reading on every request
let cachedSecret: string | null = null;

/**
 * Gets the cached secret, loading it if necessary.
 * Call clearCachedSecret() to force reload (e.g., on SIGHUP).
 */
export function getCachedSecret(): string {
  if (cachedSecret === null) {
    cachedSecret = loadSecret();
  }
  return cachedSecret;
}

/**
 * Clears the cached secret, forcing a reload on next access.
 */
export function clearCachedSecret(): void {
  cachedSecret = null;
}
