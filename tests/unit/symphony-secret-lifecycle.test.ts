/**
 * Unit tests for Symphony Secret Lifecycle Management.
 * Issue #2214, Epic #2186 — Phase 6 Observability & Operations.
 *
 * Tests secret deployment tracking, version comparison, pre-provisioning
 * validation, rotation detection, and redaction pattern registry.
 */
import { describe, expect, it } from 'vitest';
import {
  SecretDeploymentTracker,
  validateSecretPreProvisioning,
  detectSecretRotation,
  getRedactionPatterns,
  type SecretDeployment,
  type SecretRotationResult,
  type RedactionPattern,
  type ValidationResult,
  DEFAULT_ROTATION_POLL_INTERVAL_MS,
} from '../../src/symphony/secret-lifecycle.js';

// ─── Constants ───────────────────────────────────────────────
describe('Secret lifecycle constants', () => {
  it('has 5-minute default rotation poll interval', () => {
    expect(DEFAULT_ROTATION_POLL_INTERVAL_MS).toBe(5 * 60 * 1000);
  });
});

// ─── SecretDeploymentTracker ─────────────────────────────────
describe('SecretDeploymentTracker', () => {
  it('creates a deployment record with version', () => {
    const tracker = new SecretDeploymentTracker();
    const deployment = tracker.createDeployment({
      namespace: 'testns',
      connectionId: 'conn-1',
      secretName: '.env',
      secretVersion: 'v1-abc123',
      deployedPath: '/home/user/repo/.env',
      runId: 'run-1',
      expectedVars: ['DATABASE_URL', 'API_KEY'],
    });

    expect(deployment.namespace).toBe('testns');
    expect(deployment.secretVersion).toBe('v1-abc123');
    expect(deployment.staleness).toBe('current');
    expect(deployment.deployedAt).toBeInstanceOf(Date);
    expect(deployment.expectedVars).toEqual(['DATABASE_URL', 'API_KEY']);
  });

  it('marks deployment as stale on version mismatch', () => {
    const tracker = new SecretDeploymentTracker();
    const deployment = tracker.createDeployment({
      namespace: 'testns',
      connectionId: 'conn-1',
      secretName: '.env',
      secretVersion: 'v1-abc123',
      deployedPath: '/home/user/repo/.env',
      runId: 'run-1',
      expectedVars: [],
    });

    const updated = tracker.markStale(deployment);
    expect(updated.staleness).toBe('stale');
  });

  it('marks deployment as rotating during redeployment', () => {
    const tracker = new SecretDeploymentTracker();
    const deployment = tracker.createDeployment({
      namespace: 'testns',
      connectionId: 'conn-1',
      secretName: '.env',
      secretVersion: 'v1-abc123',
      deployedPath: '/home/user/repo/.env',
      runId: 'run-1',
      expectedVars: [],
    });

    const updated = tracker.markRotating(deployment);
    expect(updated.staleness).toBe('rotating');
  });

  it('tracks last_used_at updates', () => {
    const tracker = new SecretDeploymentTracker();
    const deployment = tracker.createDeployment({
      namespace: 'testns',
      connectionId: 'conn-1',
      secretName: '.env',
      secretVersion: 'v1-abc123',
      deployedPath: '/home/user/repo/.env',
      runId: 'run-1',
      expectedVars: [],
    });

    expect(deployment.lastUsedAt).toBeUndefined();
    const used = tracker.touchLastUsed(deployment);
    expect(used.lastUsedAt).toBeInstanceOf(Date);
  });
});

// ─── Pre-Provisioning Validation ─────────────────────────────
describe('validateSecretPreProvisioning', () => {
  it('passes when all expected vars are present', () => {
    const envContent = 'DATABASE_URL=postgres://localhost\nAPI_KEY=sk-123\n';
    const expectedVars = ['DATABASE_URL', 'API_KEY'];

    const result = validateSecretPreProvisioning(envContent, expectedVars);
    expect(result.valid).toBe(true);
    expect(result.missingVars).toHaveLength(0);
  });

  it('fails when expected vars are missing', () => {
    const envContent = 'DATABASE_URL=postgres://localhost\n';
    const expectedVars = ['DATABASE_URL', 'API_KEY', 'SECRET_TOKEN'];

    const result = validateSecretPreProvisioning(envContent, expectedVars);
    expect(result.valid).toBe(false);
    expect(result.missingVars).toContain('API_KEY');
    expect(result.missingVars).toContain('SECRET_TOKEN');
  });

  it('passes with empty expected vars', () => {
    const envContent = 'DATABASE_URL=postgres://localhost\n';
    const result = validateSecretPreProvisioning(envContent, []);
    expect(result.valid).toBe(true);
  });

  it('skips comments and blank lines', () => {
    const envContent = '# comment\nDATABASE_URL=postgres://localhost\n\n';
    const result = validateSecretPreProvisioning(envContent, ['DATABASE_URL']);
    expect(result.valid).toBe(true);
  });

  it('rejects dangerous patterns', () => {
    const envContent = 'EVIL=$(rm -rf /)\n';
    const result = validateSecretPreProvisioning(envContent, ['EVIL']);
    expect(result.valid).toBe(false);
    expect(result.securityViolation).toBe(true);
  });
});

// ─── Rotation Detection ──────────────────────────────────────
describe('detectSecretRotation', () => {
  it('detects rotation when versions differ', () => {
    const result = detectSecretRotation(
      { deployedVersion: 'v1-abc123', currentVersion: 'v2-def456' },
    );
    expect(result.rotated).toBe(true);
    expect(result.action).toBe('redeploy');
  });

  it('reports no rotation when versions match', () => {
    const result = detectSecretRotation(
      { deployedVersion: 'v1-abc123', currentVersion: 'v1-abc123' },
    );
    expect(result.rotated).toBe(false);
    expect(result.action).toBe('none');
  });

  it('handles null current version (1Password unavailable)', () => {
    const result = detectSecretRotation(
      { deployedVersion: 'v1-abc123', currentVersion: null },
    );
    expect(result.rotated).toBe(false);
    expect(result.action).toBe('none');
    expect(result.error).toBeDefined();
  });
});

// ─── Redaction Pattern Registry ──────────────────────────────
describe('getRedactionPatterns', () => {
  it('returns built-in patterns', () => {
    const patterns = getRedactionPatterns();
    expect(patterns.length).toBeGreaterThan(0);

    // Must include op://, ghp_, sk-ant-, bearer
    const labels = patterns.map((p) => p.label);
    expect(labels).toContainEqual(expect.stringContaining('1Password'));
    expect(labels).toContainEqual(expect.stringContaining('GitHub'));
    expect(labels).toContainEqual(expect.stringContaining('Anthropic'));
    expect(labels).toContainEqual(expect.stringContaining('Bearer'));
  });

  it('includes project-specific patterns from env values', () => {
    const envValues = new Map([
      ['DATABASE_URL', 'postgres://user:secret_password@localhost/db'],
      ['API_KEY', 'sk-very-secret-key-12345678'],
    ]);

    const patterns = getRedactionPatterns(envValues);
    // Should have built-in + env-derived patterns
    const envLabels = patterns.filter((p) => p.label.startsWith('env:'));
    expect(envLabels.length).toBe(2);
  });

  it('skips short env values (less than 8 chars)', () => {
    const envValues = new Map([
      ['SHORT', 'abc'],    // too short, skip
      ['LONG_KEY', 'this-is-a-long-secret-value'],
    ]);

    const patterns = getRedactionPatterns(envValues);
    const envLabels = patterns.filter((p) => p.label.startsWith('env:'));
    expect(envLabels.length).toBe(1);
    expect(envLabels[0].label).toBe('env:LONG_KEY');
  });

  it('includes additional custom patterns', () => {
    const additional: RedactionPattern[] = [
      { pattern: /custom-secret-\d+/g, label: 'custom secret' },
    ];

    const patterns = getRedactionPatterns(undefined, additional);
    const labels = patterns.map((p) => p.label);
    expect(labels).toContain('custom secret');
  });
});
