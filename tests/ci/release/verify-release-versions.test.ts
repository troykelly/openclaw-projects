/**
 * Tests for the verify-release-versions.sh script (#2528)
 *
 * Validates the CI verification script behavior:
 * - Release mode: positive version matching
 * - Dev mode: :edge consistency
 * - CI mode: graceful skip when VERSION not set
 * - Error reporting for mismatches
 * - Documentation verification
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

const ROOT = resolve(import.meta.dirname, '../../..');
const VERIFY_SCRIPT = resolve(ROOT, 'scripts/verify-release-versions.sh');
const CHECK_SCRIPT = resolve(ROOT, 'scripts/check-version-consistency.sh');

/** Image prefix for project images */
const IMAGE_PREFIX = 'ghcr.io/troykelly/openclaw-projects-';

/** Create a temp directory for test fixtures */
function createTempDir(): string {
  const dir = join(tmpdir(), `release-test-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Create a minimal compose file with given image tags */
function createComposeFile(dir: string, filename: string, imageTag: string, images: string[] = ['db', 'api', 'app']): void {
  const services = images.map(name =>
    `  ${name}:\n    image: ${IMAGE_PREFIX}${name}:${imageTag}`
  ).join('\n');
  const content = `services:\n${services}\n`;
  writeFileSync(join(dir, filename), content);
}

/** Create a minimal package.json */
function createPackageJson(dir: string, version: string, subpath = ''): void {
  const fullDir = subpath ? join(dir, subpath) : dir;
  mkdirSync(fullDir, { recursive: true });
  writeFileSync(join(fullDir, 'package.json'), JSON.stringify({ name: 'test', version }, null, 2) + '\n');
}

/** Create an openclaw.plugin.json */
function createPluginJson(dir: string, version: string): void {
  const pluginDir = join(dir, 'packages/openclaw-plugin');
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, 'openclaw.plugin.json'), JSON.stringify({ version }, null, 2) + '\n');
}

/**
 * Run the verify script and return result.
 * When cwd differs from ROOT, uses the script copy at cwd/scripts/verify-release-versions.sh
 * so that REPO_ROOT resolves correctly relative to the script's own location.
 */
function runVerifyScript(args: string[], cwd: string): { stdout: string; stderr: string; status: number } {
  const scriptPath = cwd === ROOT ? VERIFY_SCRIPT : join(cwd, 'scripts/verify-release-versions.sh');
  try {
    const stdout = execFileSync('bash', [scriptPath, ...args], {
      cwd,
      encoding: 'utf-8',
      env: { ...process.env, PATH: process.env.PATH },
      timeout: 10000,
    });
    return { stdout, stderr: '', status: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      status: e.status ?? 1,
    };
  }
}

/** Run the check-version-consistency.sh script */
function runCheckScript(cwd: string, env: Record<string, string> = {}): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync('bash', [CHECK_SCRIPT], {
      cwd,
      encoding: 'utf-8',
      env: { ...process.env, PATH: process.env.PATH, ...env },
      timeout: 10000,
    });
    return { stdout, stderr: '', status: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      status: e.status ?? 1,
    };
  }
}

describe('verify-release-versions.sh', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('script existence and executability', () => {
    it('should exist at scripts/verify-release-versions.sh', () => {
      expect(existsSync(VERIFY_SCRIPT)).toBe(true);
    });

    it('should show help with --help flag', () => {
      const result = runVerifyScript(['--help'], ROOT);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Usage');
      expect(result.stdout).toContain('--version');
      expect(result.stdout).toContain('--mode');
    });
  });

  describe('dev mode — current repo state', () => {
    it('should pass in dev mode on main branch (all :edge)', () => {
      const result = runVerifyScript(['--mode', 'dev'], ROOT);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('PASSED');
    });
  });

  describe('release mode — simulated fixtures', () => {
    it('should pass when all compose files have correct version', () => {
      // Create fixture files
      const version = '0.0.60';
      createComposeFile(tempDir, 'docker-compose.yml', version);
      createComposeFile(tempDir, 'docker-compose.traefik.yml', version);
      createComposeFile(tempDir, 'docker-compose.quickstart.yml', version);
      createComposeFile(tempDir, 'docker-compose.full.yml', version);
      createPackageJson(tempDir, version);
      createPackageJson(tempDir, version, 'packages/openclaw-plugin');
      createPluginJson(tempDir, version);

      // Create a scripts dir and copy the verify script
      mkdirSync(join(tempDir, 'scripts'), { recursive: true });
      copyFileSync(VERIFY_SCRIPT, join(tempDir, 'scripts/verify-release-versions.sh'));

      const result = runVerifyScript(['--version', version, '--mode', 'release'], tempDir);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('PASSED');
    });

    it('should fail when one compose file has :edge in release mode', () => {
      const version = '0.0.60';
      createComposeFile(tempDir, 'docker-compose.yml', version);
      createComposeFile(tempDir, 'docker-compose.traefik.yml', version);
      createComposeFile(tempDir, 'docker-compose.quickstart.yml', 'edge'); // Bad!
      createComposeFile(tempDir, 'docker-compose.full.yml', version);
      createPackageJson(tempDir, version);
      createPackageJson(tempDir, version, 'packages/openclaw-plugin');
      createPluginJson(tempDir, version);

      mkdirSync(join(tempDir, 'scripts'), { recursive: true });
      copyFileSync(VERIFY_SCRIPT, join(tempDir, 'scripts/verify-release-versions.sh'));

      const result = runVerifyScript(['--version', version, '--mode', 'release'], tempDir);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('FAIL');
      expect(result.stdout).toContain('docker-compose.quickstart.yml');
    });

    it('should fail when compose file has wrong version (not just :edge)', () => {
      const version = '0.0.60';
      createComposeFile(tempDir, 'docker-compose.yml', version);
      createComposeFile(tempDir, 'docker-compose.traefik.yml', '0.0.59'); // Wrong version!
      createComposeFile(tempDir, 'docker-compose.quickstart.yml', version);
      createComposeFile(tempDir, 'docker-compose.full.yml', version);
      createPackageJson(tempDir, version);
      createPackageJson(tempDir, version, 'packages/openclaw-plugin');
      createPluginJson(tempDir, version);

      mkdirSync(join(tempDir, 'scripts'), { recursive: true });
      copyFileSync(VERIFY_SCRIPT, join(tempDir, 'scripts/verify-release-versions.sh'));

      const result = runVerifyScript(['--version', version, '--mode', 'release'], tempDir);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('FAIL');
      expect(result.stdout).toContain('docker-compose.traefik.yml');
    });

    it('should fail when package.json version mismatches', () => {
      const version = '0.0.60';
      createComposeFile(tempDir, 'docker-compose.yml', version);
      createComposeFile(tempDir, 'docker-compose.traefik.yml', version);
      createComposeFile(tempDir, 'docker-compose.quickstart.yml', version);
      createComposeFile(tempDir, 'docker-compose.full.yml', version);
      createPackageJson(tempDir, '0.0.59'); // Wrong version!
      createPackageJson(tempDir, version, 'packages/openclaw-plugin');
      createPluginJson(tempDir, version);

      mkdirSync(join(tempDir, 'scripts'), { recursive: true });
      copyFileSync(VERIFY_SCRIPT, join(tempDir, 'scripts/verify-release-versions.sh'));

      const result = runVerifyScript(['--version', version, '--mode', 'release'], tempDir);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('FAIL');
      expect(result.stdout).toContain('package.json');
    });

    it('should not check third-party images with different versions', () => {
      const version = '0.0.60';
      // Include third-party images that should be ignored
      const content = [
        'services:',
        '  db:',
        `    image: ${IMAGE_PREFIX}db:${version}`,
        '  traefik:',
        '    image: traefik:v3.1.2',
        '  seaweedfs:',
        '    image: chrislusf/seaweedfs:3.71',
      ].join('\n');
      writeFileSync(join(tempDir, 'docker-compose.yml'), content);

      // Create minimal other files
      createComposeFile(tempDir, 'docker-compose.traefik.yml', version);
      createComposeFile(tempDir, 'docker-compose.quickstart.yml', version);
      createComposeFile(tempDir, 'docker-compose.full.yml', version);
      createPackageJson(tempDir, version);
      createPackageJson(tempDir, version, 'packages/openclaw-plugin');
      createPluginJson(tempDir, version);

      mkdirSync(join(tempDir, 'scripts'), { recursive: true });
      copyFileSync(VERIFY_SCRIPT, join(tempDir, 'scripts/verify-release-versions.sh'));

      const result = runVerifyScript(['--version', version, '--mode', 'release'], tempDir);
      expect(result.status).toBe(0);
    });

    it('should handle mixed :edge and versioned tags in same file as failure', () => {
      const version = '0.0.60';
      const content = [
        'services:',
        '  db:',
        `    image: ${IMAGE_PREFIX}db:${version}`,
        '  api:',
        `    image: ${IMAGE_PREFIX}api:edge`,
      ].join('\n');
      writeFileSync(join(tempDir, 'docker-compose.yml'), content);

      createComposeFile(tempDir, 'docker-compose.traefik.yml', version);
      createComposeFile(tempDir, 'docker-compose.quickstart.yml', version);
      createComposeFile(tempDir, 'docker-compose.full.yml', version);
      createPackageJson(tempDir, version);
      createPackageJson(tempDir, version, 'packages/openclaw-plugin');
      createPluginJson(tempDir, version);

      mkdirSync(join(tempDir, 'scripts'), { recursive: true });
      copyFileSync(VERIFY_SCRIPT, join(tempDir, 'scripts/verify-release-versions.sh'));

      const result = runVerifyScript(['--version', version, '--mode', 'release'], tempDir);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('FAIL');
    });
  });

  describe('ci mode', () => {
    it('should skip gracefully when VERSION cannot be determined', () => {
      // Empty temp dir with no package.json
      mkdirSync(join(tempDir, 'scripts'), { recursive: true });
      copyFileSync(VERIFY_SCRIPT, join(tempDir, 'scripts/verify-release-versions.sh'));

      const result = runVerifyScript(['--mode', 'ci'], tempDir);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Skipping');
    });
  });

  describe('invalid arguments', () => {
    it('should reject invalid mode', () => {
      const result = runVerifyScript(['--mode', 'invalid'], ROOT);
      expect(result.status).toBe(2);
      expect(result.stdout).toContain('Invalid mode');
    });

    it('should reject unknown arguments', () => {
      const result = runVerifyScript(['--unknown-flag'], ROOT);
      expect(result.status).toBe(2);
    });
  });
});

describe('check-version-consistency.sh (Phase 1 script)', () => {
  it('should exist at scripts/check-version-consistency.sh', () => {
    expect(existsSync(CHECK_SCRIPT)).toBe(true);
  });

  it('should pass on main branch without VERSION set', () => {
    const result = runCheckScript(ROOT);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('PASSED');
  });

  it('should fail on main branch with VERSION set (compose files have :edge)', () => {
    const result = runCheckScript(ROOT, { VERSION: '0.0.60' });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('FAIL');
  });
});

describe('Verification script integration with compose files', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should pass verification on versioned files', () => {
    const version = '0.0.60';
    // Copy and modify real compose files
    for (const file of ['docker-compose.yml', 'docker-compose.traefik.yml', 'docker-compose.quickstart.yml', 'docker-compose.full.yml']) {
      const original = readFileSync(resolve(ROOT, file), 'utf-8');
      const versioned = original.replace(
        new RegExp(`(${IMAGE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^:]*):edge`, 'g'),
        `$1:${version}`,
      );
      writeFileSync(join(tempDir, file), versioned);
    }

    // Copy package files
    createPackageJson(tempDir, version);
    createPackageJson(tempDir, version, 'packages/openclaw-plugin');
    createPluginJson(tempDir, version);

    mkdirSync(join(tempDir, 'scripts'), { recursive: true });
    copyFileSync(VERIFY_SCRIPT, join(tempDir, 'scripts/verify-release-versions.sh'));

    const result = runVerifyScript(['--version', version, '--mode', 'release'], tempDir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('PASSED');
  });

  it('should fail verification on :edge files in release mode', () => {
    // Copy real compose files as-is (with :edge)
    for (const file of ['docker-compose.yml', 'docker-compose.traefik.yml', 'docker-compose.quickstart.yml', 'docker-compose.full.yml']) {
      copyFileSync(resolve(ROOT, file), join(tempDir, file));
    }

    createPackageJson(tempDir, '0.0.60');
    createPackageJson(tempDir, '0.0.60', 'packages/openclaw-plugin');
    createPluginJson(tempDir, '0.0.60');

    mkdirSync(join(tempDir, 'scripts'), { recursive: true });
    copyFileSync(VERIFY_SCRIPT, join(tempDir, 'scripts/verify-release-versions.sh'));

    const result = runVerifyScript(['--version', '0.0.60', '--mode', 'release'], tempDir);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('FAIL');
  });

  it('should pass verification on :edge files in dev mode', () => {
    // Copy real compose files as-is (with :edge)
    for (const file of ['docker-compose.yml', 'docker-compose.traefik.yml', 'docker-compose.quickstart.yml', 'docker-compose.full.yml']) {
      copyFileSync(resolve(ROOT, file), join(tempDir, file));
    }

    mkdirSync(join(tempDir, 'scripts'), { recursive: true });
    copyFileSync(VERIFY_SCRIPT, join(tempDir, 'scripts/verify-release-versions.sh'));

    const result = runVerifyScript(['--mode', 'dev'], tempDir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('PASSED');
  });
});
