/**
 * Flexible secret resolution module.
 *
 * Supports three methods for loading secrets (in priority order):
 * 1. Command execution (e.g., 1Password CLI: `op read op://...`)
 * 2. File reference (e.g., ~/.secrets/api_key)
 * 3. Direct value (least secure, for development only)
 *
 * Security note: Command execution intentionally uses execSync with shell
 * because the command comes from trusted configuration, not user input.
 * This is required to support shell commands like `op read 'op://...'`
 * for secret managers.
 *
 * @module secrets
 */

import { execSync } from 'node:child_process'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Default timeout for command execution in milliseconds */
const DEFAULT_COMMAND_TIMEOUT = 5000

/** Secret resolution configuration */
export interface SecretConfig {
  /** Direct secret value (least secure, for development) */
  direct?: string
  /** Path to file containing the secret */
  file?: string
  /** Command to execute to retrieve the secret */
  command?: string
  /** Timeout for command execution in milliseconds (default: 5000) */
  commandTimeout?: number
}

/** Cache for resolved secrets */
const secretCache = new Map<string, string>()

/**
 * Expands ~ to the user's home directory.
 */
function expandTilde(filePath: string): string {
  if (filePath.startsWith('~/')) {
    return join(homedir(), filePath.slice(2))
  }
  if (filePath === '~') {
    return homedir()
  }
  return filePath
}

/**
 * Checks file permissions and warns if world-readable.
 */
function checkFilePermissions(filePath: string): void {
  try {
    const stats = statSync(filePath)
    const mode = stats.mode & 0o777
    if (mode & 0o004) {
      console.warn(
        `[Secrets] Warning: Secret file ${filePath} is world-readable (mode ${mode.toString(8)}). ` +
          'Consider restricting permissions with: chmod 600 ' +
          filePath
      )
    }
  } catch {
    // Ignore permission check errors - file read will fail if there's an issue
  }
}

/**
 * Resolves a secret from command execution.
 *
 * Security note: This uses execSync intentionally because:
 * 1. The command comes from plugin configuration set by system administrators
 * 2. It must support shell commands like `op read 'op://...'` for secret managers
 * 3. This is NOT user input - it's trusted configuration
 */
function resolveFromCommand(command: string, timeout: number): string {
  try {
    // eslint-disable-next-line security/detect-child-process
    const result = execSync(command, {
      encoding: 'utf-8',
      timeout,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return result.trim()
  } catch (error) {
    const err = error as Error & { killed?: boolean; signal?: string }
    if (err.killed && err.signal === 'SIGTERM') {
      throw new Error(`Secret command timed out after ${timeout}ms`)
    }
    if (err.killed) {
      throw new Error(
        `Secret command was killed (signal: ${err.signal ?? 'unknown'})`
      )
    }
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Secret command failed: ${message}`)
  }
}

/**
 * Resolves a secret from a file.
 */
function resolveFromFile(filePath: string): string {
  const expandedPath = expandTilde(filePath)

  if (!existsSync(expandedPath)) {
    throw new Error(`Secret file does not exist: ${expandedPath}`)
  }

  checkFilePermissions(expandedPath)

  try {
    const content = readFileSync(expandedPath, 'utf-8')
    return content.trim()
  } catch (error) {
    throw new Error(`Failed to read secret file: ${(error as Error).message}`)
  }
}

/**
 * Resolves a secret using the configured method.
 *
 * Priority order (highest first):
 * 1. Command - Execute shell command and use output
 * 2. File - Read from file path
 * 3. Direct - Use direct value from config
 *
 * @param config - Secret configuration
 * @param cacheKey - Optional key to cache the resolved secret
 * @returns The resolved secret, or undefined if not configured
 */
export async function resolveSecret(
  config: SecretConfig,
  cacheKey?: string
): Promise<string | undefined> {
  // Check cache first
  if (cacheKey && secretCache.has(cacheKey)) {
    return secretCache.get(cacheKey)
  }

  let resolved: string | undefined

  // Priority 1: Command
  if (config.command && config.command.trim()) {
    const timeout = config.commandTimeout ?? DEFAULT_COMMAND_TIMEOUT
    resolved = resolveFromCommand(config.command, timeout)
  }
  // Priority 2: File
  else if (config.file && config.file.trim()) {
    resolved = resolveFromFile(config.file)
  }
  // Priority 3: Direct
  else if (config.direct !== undefined) {
    const trimmed = config.direct.trim()
    resolved = trimmed.length > 0 ? trimmed : undefined
  }

  // Cache if resolved and cacheKey provided
  if (resolved && cacheKey) {
    secretCache.set(cacheKey, resolved)
  }

  return resolved
}

/**
 * Resolves a secret synchronously using the configured method.
 *
 * Same priority and behavior as resolveSecret, but fully synchronous.
 * Used during plugin registration where blocking I/O is acceptable
 * and the caller (OpenClaw loader) does not await the result.
 *
 * @param config - Secret configuration
 * @param cacheKey - Optional key to cache the resolved secret
 * @returns The resolved secret, or undefined if not configured
 */
export function resolveSecretSync(
  config: SecretConfig,
  cacheKey?: string
): string | undefined {
  // Check cache first
  if (cacheKey && secretCache.has(cacheKey)) {
    return secretCache.get(cacheKey)
  }

  let resolved: string | undefined

  // Priority 1: Command
  if (config.command && config.command.trim()) {
    const timeout = config.commandTimeout ?? DEFAULT_COMMAND_TIMEOUT
    resolved = resolveFromCommand(config.command, timeout)
  }
  // Priority 2: File
  else if (config.file && config.file.trim()) {
    resolved = resolveFromFile(config.file)
  }
  // Priority 3: Direct
  else if (config.direct !== undefined) {
    const trimmed = config.direct.trim()
    resolved = trimmed.length > 0 ? trimmed : undefined
  }

  // Cache if resolved and cacheKey provided
  if (resolved && cacheKey) {
    secretCache.set(cacheKey, resolved)
  }

  return resolved
}

/**
 * Resolves multiple secrets in parallel.
 *
 * @param configs - Map of secret names to configurations
 * @returns Map of secret names to resolved values
 */
export async function resolveSecrets(
  configs: Record<string, SecretConfig>
): Promise<Record<string, string | undefined>> {
  const entries = Object.entries(configs)
  const results = await Promise.all(
    entries.map(async ([key, config]) => {
      const value = await resolveSecret(config, key)
      return [key, value] as const
    })
  )

  return Object.fromEntries(results)
}

/**
 * Clears the secret cache.
 * Call this when configuration is reloaded or on SIGHUP.
 */
export function clearSecretCache(): void {
  secretCache.clear()
}

/**
 * Clears a specific secret from the cache.
 */
export function clearCachedSecret(key: string): void {
  secretCache.delete(key)
}
