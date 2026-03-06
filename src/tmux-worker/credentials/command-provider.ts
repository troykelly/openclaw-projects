/**
 * Command-based credential provider.
 *
 * Executes external commands (e.g., `op read op://vault/key` for 1Password)
 * to retrieve credentials at runtime. Supports timeout and optional caching.
 *
 * Issue #2189: Security hardening — allowlisted binaries, LRU cache, metrics.
 */

import { execFile } from 'node:child_process';

/**
 * Allowlisted credential tool binaries.
 * Only these executables may be invoked by the credential provider.
 * Adding a new binary requires a code change + review.
 */
export const ALLOWED_BINARIES: ReadonlySet<string> = new Set([
  'op',       // 1Password CLI
  'aws',      // AWS CLI (for Secrets Manager)
  'gcloud',   // Google Cloud CLI (for Secret Manager)
  'vault',    // HashiCorp Vault CLI
]);

/** Maximum number of cached credential entries (LRU eviction). */
const MAX_CACHE_SIZE = 100;

/** Maximum cache TTL in seconds (15 minutes). */
const MAX_TTL_SECONDS = 900;

/** Result of a command credential resolution. */
export interface CommandResult {
  value: string;
  resolvedAt: number; // Date.now() timestamp
}

/** Cache metrics for monitoring. */
export interface CacheMetrics {
  size: number;
  hits: number;
  misses: number;
  evictions: number;
  maxSize: number;
  maxTtlSeconds: number;
}

/**
 * LRU cache for command credential results.
 * Bounded by MAX_CACHE_SIZE entries with TTL enforcement.
 * Uses Map insertion order for LRU: delete + re-set moves key to end.
 */
const cache = new Map<string, CommandResult>();
let cacheHits = 0;
let cacheMisses = 0;
let cacheEvictions = 0;

/**
 * Execute an external command to retrieve a credential value.
 *
 * @param command - The shell command string to execute
 * @param timeoutMs - Maximum execution time in milliseconds
 * @returns The command's stdout (trimmed) as the credential value
 * @throws Error on non-zero exit code, timeout, execution failure, or disallowed binary
 */
export async function executeCredentialCommand(
  command: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    // Split command into executable and args for execFile (avoids shell injection)
    const parts = parseCommand(command);
    if (parts.length === 0) {
      reject(new Error('Empty credential command'));
      return;
    }

    const [executable, ...args] = parts;

    // Issue #2189: Validate executable against allowlist.
    // MUST be a bare command name (no path separators). This prevents
    // bypass via attacker-controlled paths like /tmp/op or ../../../bin/op.
    // The bare name is resolved via PATH by execFile, ensuring only
    // system-installed binaries are used.
    if (executable.includes('/') || executable.includes('\\')) {
      reject(
        new Error(
          `Credential command must use a bare binary name, not a path. ` +
          `Got: "${executable}". Allowed: ${[...ALLOWED_BINARIES].join(', ')}`,
        ),
      );
      return;
    }
    if (!ALLOWED_BINARIES.has(executable)) {
      reject(
        new Error(
          `Credential command binary "${executable}" is not in the allowlist. ` +
          `Allowed: ${[...ALLOWED_BINARIES].join(', ')}`,
        ),
      );
      return;
    }

    const child = execFile(
      executable,
      args,
      {
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024, // 1MB max output
        env: process.env,
      },
      (error, stdout, _stderr) => {
        if (error) {
          // Do not include stderr in error message — it may contain sensitive info
          if ('killed' in error && error.killed) {
            reject(
              new Error(
                `Credential command timed out after ${timeoutMs}ms`,
              ),
            );
          } else {
            reject(
              new Error(
                `Credential command failed with exit code ${error.code ?? 'unknown'}`,
              ),
            );
          }
          return;
        }

        const value = stdout.trim();
        if (value.length === 0) {
          reject(new Error('Credential command returned empty output'));
          return;
        }

        resolve(value);
      },
    );

    // Ensure child process is cleaned up on timeout
    child.on('error', (err) => {
      reject(new Error(`Credential command execution error: ${err.message}`));
    });
  });
}

/**
 * Resolve a command-based credential with optional caching.
 *
 * Issue #2189: Cache is bounded by LRU (max 100) + max TTL (15 min).
 *
 * @param credentialId - Unique identifier for cache key
 * @param command - The shell command to execute
 * @param timeoutMs - Maximum execution time in milliseconds
 * @param cacheTtlS - Cache TTL in seconds (0 = no cache, capped at MAX_TTL_SECONDS)
 * @returns The resolved credential value
 */
export async function resolveCommandCredential(
  credentialId: string,
  command: string,
  timeoutMs: number,
  cacheTtlS: number,
): Promise<string> {
  // Cap TTL to max allowed value
  const effectiveTtl = cacheTtlS > 0
    ? Math.min(cacheTtlS, MAX_TTL_SECONDS)
    : 0;

  // Check cache if TTL > 0
  if (effectiveTtl > 0) {
    const cached = cache.get(credentialId);
    if (cached) {
      const ageMs = Date.now() - cached.resolvedAt;
      if (ageMs < effectiveTtl * 1000) {
        // Move to end for LRU (delete + re-set)
        cache.delete(credentialId);
        cache.set(credentialId, cached);
        cacheHits++;
        return cached.value;
      }
      // Cache expired, remove it
      cache.delete(credentialId);
    }
    cacheMisses++;
  }

  const value = await executeCredentialCommand(command, timeoutMs);

  // Store in cache if TTL > 0
  if (effectiveTtl > 0) {
    // LRU eviction: remove oldest entry if at capacity
    if (cache.size >= MAX_CACHE_SIZE) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) {
        cache.delete(oldestKey);
        cacheEvictions++;
      }
    }
    cache.set(credentialId, { value, resolvedAt: Date.now() });
  }

  return value;
}

/**
 * Clear the credential cache. Useful for testing and shutdown.
 */
export function clearCredentialCache(): void {
  cache.clear();
  cacheHits = 0;
  cacheMisses = 0;
  cacheEvictions = 0;
}

/**
 * Get credential cache metrics for monitoring.
 * Issue #2189: Cache metrics exposure.
 */
export function getCredentialCacheMetrics(): CacheMetrics {
  return {
    size: cache.size,
    hits: cacheHits,
    misses: cacheMisses,
    evictions: cacheEvictions,
    maxSize: MAX_CACHE_SIZE,
    maxTtlSeconds: MAX_TTL_SECONDS,
  };
}

/**
 * Parse a command string into executable and arguments.
 * Handles basic quoting (single and double quotes).
 */
function parseCommand(command: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
    } else if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
    } else if (char === ' ' && !inSingleQuote && !inDoubleQuote) {
      if (current.length > 0) {
        parts.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current.length > 0) {
    parts.push(current);
  }

  return parts;
}
