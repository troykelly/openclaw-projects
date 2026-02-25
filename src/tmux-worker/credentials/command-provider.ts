/**
 * Command-based credential provider.
 *
 * Executes external commands (e.g., `op read op://vault/key` for 1Password)
 * to retrieve credentials at runtime. Supports timeout and optional caching.
 */

import { execFile } from 'node:child_process';

/** Result of a command credential resolution. */
export interface CommandResult {
  value: string;
  resolvedAt: number; // Date.now() timestamp
}

/** In-memory cache for command credential results. */
const cache = new Map<string, CommandResult>();

/**
 * Execute an external command to retrieve a credential value.
 *
 * @param command - The shell command string to execute
 * @param timeoutMs - Maximum execution time in milliseconds
 * @returns The command's stdout (trimmed) as the credential value
 * @throws Error on non-zero exit code, timeout, or execution failure
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
 * @param credentialId - Unique identifier for cache key
 * @param command - The shell command to execute
 * @param timeoutMs - Maximum execution time in milliseconds
 * @param cacheTtlS - Cache TTL in seconds (0 = no cache)
 * @returns The resolved credential value
 */
export async function resolveCommandCredential(
  credentialId: string,
  command: string,
  timeoutMs: number,
  cacheTtlS: number,
): Promise<string> {
  // Check cache if TTL > 0
  if (cacheTtlS > 0) {
    const cached = cache.get(credentialId);
    if (cached) {
      const ageMs = Date.now() - cached.resolvedAt;
      if (ageMs < cacheTtlS * 1000) {
        return cached.value;
      }
      // Cache expired, remove it
      cache.delete(credentialId);
    }
  }

  const value = await executeCredentialCommand(command, timeoutMs);

  // Store in cache if TTL > 0
  if (cacheTtlS > 0) {
    cache.set(credentialId, { value, resolvedAt: Date.now() });
  }

  return value;
}

/**
 * Clear the credential cache. Useful for testing and shutdown.
 */
export function clearCredentialCache(): void {
  cache.clear();
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
