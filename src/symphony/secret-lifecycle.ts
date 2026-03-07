/**
 * Symphony Secret Lifecycle Management
 *
 * Manages the full lifecycle of secrets deployed to Symphony workspaces:
 * - Deployment tracking: host, secret_ref, version, file_path, deployed_at, last_used_at
 * - Version comparison with 1Password for staleness detection
 * - Pre-provisioning validation: verify expected vars present, reject dangerous patterns
 * - Rotation detection: configurable polling interval (5min default per P6-4)
 * - Redaction pattern registry: exports getRedactionPatterns() for P2-4 (#2198)
 *
 * Ownership boundary with #2213 (Cleanup Queue):
 * - This module (#2214) maintains symphony_secret_deployment records
 *   (insert on deploy, update last_used_at, mark as stale on rotation)
 * - Actual .env file deletion from hosts is performed by #2213's cleanup worker
 * - This module does NOT delete files — it provides the data
 *
 * Issue #2214, Epic #2186
 */

import { parseEnvFile } from './provisioning.js';

// ─── Constants ───────────────────────────────────────────────

/** Default rotation polling interval in milliseconds (5 minutes per P6-4). */
export const DEFAULT_ROTATION_POLL_INTERVAL_MS = 5 * 60 * 1000;

// ─── Types ───────────────────────────────────────────────────

/** Secret deployment record. */
export interface SecretDeployment {
  id?: string;
  namespace: string;
  connectionId: string;
  secretName: string;
  secretVersion: string;
  deployedPath: string;
  deployedAt: Date;
  lastUsedAt?: Date;
  staleness: 'current' | 'stale' | 'rotating' | 'cleaned';
  runId: string | null;
  expectedVars: string[];
  validationStatus: 'pending' | 'valid' | 'invalid' | 'skipped';
  previousVersionId?: string;
}

/** Input for creating a deployment. */
export interface CreateDeploymentInput {
  namespace: string;
  connectionId: string;
  secretName: string;
  secretVersion: string;
  deployedPath: string;
  runId: string | null;
  expectedVars: string[];
}

/** Secret rotation detection input. */
export interface RotationCheckInput {
  deployedVersion: string;
  currentVersion: string | null;
}

/** Result of rotation detection. */
export interface SecretRotationResult {
  rotated: boolean;
  action: 'redeploy' | 'none';
  error?: string;
}

/** Pre-provisioning validation result. */
export interface ValidationResult {
  valid: boolean;
  missingVars: string[];
  securityViolation?: boolean;
  securityError?: string;
}

/** Redaction pattern for I/O filtering. */
export interface RedactionPattern {
  pattern: RegExp;
  label: string;
}

// ─── Secret Deployment Tracker ───────────────────────────────

/**
 * Tracks secret deployments with version history.
 *
 * This class manages the in-memory lifecycle of deployment records.
 * Database persistence is handled by the caller.
 */
export class SecretDeploymentTracker {
  /** Create a new deployment record. */
  createDeployment(input: CreateDeploymentInput): SecretDeployment {
    return {
      namespace: input.namespace,
      connectionId: input.connectionId,
      secretName: input.secretName,
      secretVersion: input.secretVersion,
      deployedPath: input.deployedPath,
      deployedAt: new Date(),
      staleness: 'current',
      runId: input.runId,
      expectedVars: input.expectedVars,
      validationStatus: 'pending',
    };
  }

  /** Mark a deployment as stale (version mismatch detected). */
  markStale(deployment: SecretDeployment): SecretDeployment {
    return { ...deployment, staleness: 'stale' };
  }

  /** Mark a deployment as rotating (redeployment in progress). */
  markRotating(deployment: SecretDeployment): SecretDeployment {
    return { ...deployment, staleness: 'rotating' };
  }

  /** Update last_used_at timestamp. */
  touchLastUsed(deployment: SecretDeployment): SecretDeployment {
    return { ...deployment, lastUsedAt: new Date() };
  }
}

// ─── Pre-Provisioning Validation ─────────────────────────────

/**
 * Validate a .env file before provisioning.
 *
 * Checks:
 * 1. All expected variables are present
 * 2. No dangerous patterns (command substitutions, shell injection)
 *
 * If validation fails, caller should redeploy previous known-good version.
 */
export function validateSecretPreProvisioning(
  envContent: string,
  expectedVars: string[],
): ValidationResult {
  // Parse safely using the shared parser
  let envVars: Map<string, string>;
  try {
    envVars = parseEnvFile(envContent);
  } catch (err) {
    return {
      valid: false,
      missingVars: expectedVars,
      securityViolation: true,
      securityError: err instanceof Error ? err.message : String(err),
    };
  }

  // Check expected variables
  const missingVars = expectedVars.filter((v) => !envVars.has(v));

  return {
    valid: missingVars.length === 0,
    missingVars,
  };
}

// ─── Rotation Detection ──────────────────────────────────────

/**
 * Detect if a secret has been rotated in 1Password.
 *
 * Compares the deployed version against the current version.
 * If they differ, the secret needs redeployment.
 *
 * Polling interval is configurable via symphony_orchestrator_config
 * (default: 5 minutes per P6-4 acceptance criterion).
 */
export function detectSecretRotation(
  input: RotationCheckInput,
): SecretRotationResult {
  // If current version is null, 1Password was unavailable
  if (input.currentVersion === null) {
    return {
      rotated: false,
      action: 'none',
      error: '1Password version check unavailable — skipping rotation detection',
    };
  }

  if (input.deployedVersion !== input.currentVersion) {
    return {
      rotated: true,
      action: 'redeploy',
    };
  }

  return {
    rotated: false,
    action: 'none',
  };
}

// ─── Redaction Pattern Registry ──────────────────────────────

/**
 * Built-in redaction pattern sources.
 * Stored as [source, flags, label] tuples so we can create fresh RegExp
 * instances on each call, avoiding stateful lastIndex issues with global regexes.
 */
const BUILTIN_PATTERN_SOURCES: Array<[string, string, string]> = [
  ['op:\\/\\/[^\\s\'"]+', 'g', '1Password reference'],
  ['ghp_[A-Za-z0-9_]{36,}', 'g', 'GitHub PAT (ghp_)'],
  ['github_pat_[A-Za-z0-9_]{22,}', 'g', 'GitHub PAT (github_pat_)'],
  ['sk-ant-[A-Za-z0-9_-]{40,}', 'g', 'Anthropic API key (sk-ant-)'],
  ['sk-[A-Za-z0-9]{40,}', 'g', 'OpenAI API key (sk-)'],
  ['Bearer\\s+[A-Za-z0-9._~+/=-]{20,}', 'gi', 'Bearer token'],
  ['[A-Z_]*(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)=[^\\s\'"]+', 'g', 'credential assignment'],
];

/**
 * Get redaction patterns for a project.
 *
 * Returns built-in patterns plus project-specific patterns derived from
 * the deployed .env file values.
 *
 * Ownership note (P6-5):
 * - This module (#2214) owns the redaction pattern registry
 * - P2-4 (#2198) applies these patterns at I/O capture time
 *
 * @param envValues Map of env variable names to values (from deployed .env)
 * @param additionalPatterns Extra patterns to include
 */
export function getRedactionPatterns(
  envValues?: Map<string, string>,
  additionalPatterns?: RedactionPattern[],
): RedactionPattern[] {
  // Create fresh RegExp instances each call to avoid stateful lastIndex issues
  const patterns: RedactionPattern[] = BUILTIN_PATTERN_SOURCES.map(
    ([source, flags, label]) => ({
      pattern: new RegExp(source, flags),
      label,
    }),
  );

  // Add project-specific patterns from env values
  if (envValues) {
    for (const [key, value] of envValues) {
      // Only redact non-trivial values (8+ chars)
      if (value.length >= 8) {
        patterns.push({
          pattern: new RegExp(escapeRegex(value), 'g'),
          label: `env:${key}`,
        });
      }
    }
  }

  // Add additional custom patterns
  if (additionalPatterns) {
    patterns.push(...additionalPatterns);
  }

  return patterns;
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
