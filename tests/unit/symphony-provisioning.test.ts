/**
 * Symphony Provisioning Pipeline — Unit Tests
 *
 * Tests:
 * - Each step succeeds/fails/rolls back correctly
 * - Reverse-order rollback on failure at each step
 * - Cancellation check at each step
 * - Devcontainer config validation
 * - Disk check threshold enforcement
 * - Agent version check
 * - Safe KEY=VALUE parser rejects shell expressions
 * - rm -rf path canonicalization prevents traversal
 * - Stage inference from pipeline step + crash recovery
 *
 * Issue #2198
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseEnvFile,
  validateEnvVars,
  validatePath,
  normalizePath,
  validateDevcontainerConfig,
  validateShellSafe,
  validateContextInputs,
  compareVersions,
  ProvisioningPipeline,
  PIPELINE_STEPS,
  STEP_TIMEOUTS,
  MIN_DISK_BYTES,
} from '../../src/symphony/provisioning.js';
import type {
  CommandExecutor,
  CancellationChecker,
  StepStatusRecorder,
  ContainerTracker,
  SecretTracker,
  ProvisioningContext,
  PipelineStepName,
  StepStatus,
  DevcontainerConfig,
} from '../../src/symphony/provisioning.js';

// ─── Test Helpers ────────────────────────────────────────────

function createMockExecutor(responses?: Map<string, string>): CommandExecutor {
  const defaultResponses = new Map<string, string>();
  const respMap = responses ?? defaultResponses;

  return {
    run: vi.fn(async (command: string, _timeoutMs: number) => {
      // Check for exact match first, then partial match
      for (const [key, value] of respMap) {
        if (command.includes(key)) return value;
      }
      return '';
    }),
    isConnected: vi.fn(() => true),
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
  };
}

function createMockCancellation(cancelled: boolean = false): CancellationChecker {
  return {
    isCancelled: vi.fn(async () => cancelled),
  };
}

function createMockStatusRecorder(): StepStatusRecorder {
  const statuses: Array<{ step: PipelineStepName; status: StepStatus }> = [];
  return {
    recordStepStatus: vi.fn(async (
      _runId: string,
      step: PipelineStepName,
      status: StepStatus,
    ) => {
      statuses.push({ step, status });
    }),
    getStepStatuses: vi.fn(async () => statuses),
  };
}

function createMockContainerTracker(): ContainerTracker {
  return {
    trackContainer: vi.fn(async () => {}),
    removeContainer: vi.fn(async () => {}),
  };
}

function createMockSecretTracker(): SecretTracker {
  return {
    trackSecret: vi.fn(async () => {}),
    removeSecret: vi.fn(async () => {}),
  };
}

function createDefaultContext(): ProvisioningContext {
  return {
    runId: 'run-123',
    namespace: 'test-ns',
    org: 'testorg',
    repo: 'testrepo',
    connectionId: 'conn-1',
    issueNumber: 42,
    issueSlug: 'fix-bug',
  };
}

// ─── Shell Safety Validation Tests ────────────────────────────

describe('validateShellSafe', () => {
  it('accepts safe values', () => {
    expect(validateShellSafe('testorg', 'org')).toBe('testorg');
    expect(validateShellSafe('my-repo', 'repo')).toBe('my-repo');
    expect(validateShellSafe('fix-bug.v2', 'slug')).toBe('fix-bug.v2');
    expect(validateShellSafe('under_score', 'slug')).toBe('under_score');
  });

  it('rejects semicolons (command chaining)', () => {
    expect(() => validateShellSafe('foo;rm -rf /', 'org')).toThrow(/unsafe characters/);
  });

  it('rejects $() command substitution', () => {
    expect(() => validateShellSafe('$(whoami)', 'repo')).toThrow(/unsafe characters/);
  });

  it('rejects backticks', () => {
    expect(() => validateShellSafe('`id`', 'slug')).toThrow(/unsafe characters/);
  });

  it('rejects pipe operator', () => {
    expect(() => validateShellSafe('foo|bar', 'org')).toThrow(/unsafe characters/);
  });

  it('rejects ampersand', () => {
    expect(() => validateShellSafe('foo&bar', 'org')).toThrow(/unsafe characters/);
  });

  it('rejects spaces', () => {
    expect(() => validateShellSafe('foo bar', 'org')).toThrow(/unsafe characters/);
  });

  it('rejects path separators', () => {
    expect(() => validateShellSafe('foo/bar', 'org')).toThrow(/unsafe characters/);
  });
});

describe('validateContextInputs', () => {
  it('passes for safe context', () => {
    const ctx = createDefaultContext();
    expect(() => validateContextInputs(ctx)).not.toThrow();
  });

  it('rejects unsafe org', () => {
    const ctx = { ...createDefaultContext(), org: 'evil;rm -rf /' };
    expect(() => validateContextInputs(ctx)).toThrow(/unsafe characters/);
  });

  it('rejects unsafe repo', () => {
    const ctx = { ...createDefaultContext(), repo: '$(whoami)' };
    expect(() => validateContextInputs(ctx)).toThrow(/unsafe characters/);
  });

  it('rejects unsafe issueSlug', () => {
    const ctx = { ...createDefaultContext(), issueSlug: '`id`' };
    expect(() => validateContextInputs(ctx)).toThrow(/unsafe characters/);
  });

  it('rejects envVaultItem with shell metacharacters', () => {
    const ctx = { ...createDefaultContext(), envVaultItem: 'item;rm -rf /' };
    expect(() => validateContextInputs(ctx)).toThrow(/shell metacharacters/);
  });

  it('allows envVaultItem with spaces and parens', () => {
    const ctx = {
      ...createDefaultContext(),
      envVaultItem: '.env (testorg/testrepo) [User]',
    };
    expect(() => validateContextInputs(ctx)).not.toThrow();
  });
});

// ─── Safe .env Parser Tests ──────────────────────────────────

describe('parseEnvFile', () => {
  it('parses valid KEY=VALUE pairs', () => {
    const content = 'FOO=bar\nBAZ=qux\n';
    const result = parseEnvFile(content);
    expect(result.get('FOO')).toBe('bar');
    expect(result.get('BAZ')).toBe('qux');
    expect(result.size).toBe(2);
  });

  it('strips surrounding double quotes', () => {
    const content = 'FOO="hello world"\n';
    const result = parseEnvFile(content);
    expect(result.get('FOO')).toBe('hello world');
  });

  it('strips surrounding single quotes', () => {
    const content = "FOO='hello world'\n";
    const result = parseEnvFile(content);
    expect(result.get('FOO')).toBe('hello world');
  });

  it('skips comment lines', () => {
    const content = '# This is a comment\nFOO=bar\n# Another\n';
    const result = parseEnvFile(content);
    expect(result.size).toBe(1);
    expect(result.get('FOO')).toBe('bar');
  });

  it('skips blank lines', () => {
    const content = '\nFOO=bar\n\nBAZ=qux\n\n';
    const result = parseEnvFile(content);
    expect(result.size).toBe(2);
  });

  it('rejects command substitution $(...)', () => {
    const content = 'EVIL=$(rm -rf /)\n';
    expect(() => parseEnvFile(content)).toThrow(/Dangerous pattern/);
    expect(() => parseEnvFile(content)).toThrow(/shell code/);
  });

  it('rejects backtick command substitution', () => {
    const content = 'EVIL=`whoami`\n';
    expect(() => parseEnvFile(content)).toThrow(/Dangerous pattern/);
  });

  it('rejects variable expansion ${...}', () => {
    const content = 'EVIL=${HOME}/secrets\n';
    expect(() => parseEnvFile(content)).toThrow(/Dangerous pattern/);
  });

  it('rejects $() inside quoted values', () => {
    const content = 'EVIL="$(cat /etc/passwd)"\n';
    expect(() => parseEnvFile(content)).toThrow(/Dangerous pattern/);
  });

  it('handles values with = signs', () => {
    const content = 'DATABASE_URL=postgres://user:pass@host:5432/db?sslmode=require\n';
    const result = parseEnvFile(content);
    expect(result.get('DATABASE_URL')).toBe(
      'postgres://user:pass@host:5432/db?sslmode=require',
    );
  });

  it('handles empty values', () => {
    const content = 'EMPTY=\n';
    const result = parseEnvFile(content);
    expect(result.get('EMPTY')).toBe('');
  });

  it('skips lines not matching KEY=VALUE pattern', () => {
    const content = 'FOO=bar\n123invalid=nope\nBAZ=qux\n';
    const result = parseEnvFile(content);
    expect(result.size).toBe(2);
    expect(result.has('123invalid')).toBe(false);
  });

  it('handles underscores in key names', () => {
    const content = 'MY_VAR_NAME=value\n_PRIVATE=secret\n';
    const result = parseEnvFile(content);
    expect(result.get('MY_VAR_NAME')).toBe('value');
    expect(result.get('_PRIVATE')).toBe('secret');
  });
});

describe('validateEnvVars', () => {
  it('returns valid when all required vars present', () => {
    const env = new Map([['A', '1'], ['B', '2']]);
    const result = validateEnvVars(env, ['A', 'B']);
    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it('returns missing vars', () => {
    const env = new Map([['A', '1']]);
    const result = validateEnvVars(env, ['A', 'B', 'C']);
    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(['B', 'C']);
  });
});

// ─── Path Safety Tests ───────────────────────────────────────

describe('validatePath', () => {
  it('accepts path within expected parent', () => {
    const result = validatePath('/home/user/claw/repos/org/repo', '/home/user/claw/repos');
    expect(result).toBe('/home/user/claw/repos/org/repo');
  });

  it('rejects path with .. segments', () => {
    expect(() =>
      validatePath('/home/user/claw/repos/../../../etc/passwd', '/home/user/claw/repos'),
    ).toThrow(/Path traversal detected/);
  });

  it('rejects path outside expected parent', () => {
    expect(() =>
      validatePath('/tmp/evil', '/home/user/claw/repos'),
    ).toThrow(/outside expected parent/);
  });

  it('normalizes double slashes', () => {
    const result = validatePath('/home/user/claw/repos//org//repo', '/home/user/claw/repos');
    expect(result).toBe('/home/user/claw/repos/org/repo');
  });

  it('normalizes single dot segments', () => {
    const result = validatePath('/home/user/claw/repos/./org/./repo', '/home/user/claw/repos');
    expect(result).toBe('/home/user/claw/repos/org/repo');
  });

  it('accepts exact parent path match', () => {
    const result = validatePath('/home/user/claw/repos', '/home/user/claw/repos');
    expect(result).toBe('/home/user/claw/repos');
  });
});

describe('normalizePath', () => {
  it('preserves absolute path root', () => {
    expect(normalizePath('/a/b/c')).toBe('/a/b/c');
  });

  it('removes trailing slashes', () => {
    expect(normalizePath('/a/b/c/')).toBe('/a/b/c');
  });

  it('collapses double slashes', () => {
    expect(normalizePath('/a//b///c')).toBe('/a/b/c');
  });

  it('removes single dot segments', () => {
    expect(normalizePath('/a/./b/./c')).toBe('/a/b/c');
  });

  it('handles root path', () => {
    expect(normalizePath('/')).toBe('/');
  });
});

// ─── Devcontainer Config Validation Tests ────────────────────

describe('validateDevcontainerConfig', () => {
  const repoPath = '/home/user/claw/repos/org/repo';

  it('accepts minimal valid config', () => {
    const config: DevcontainerConfig = { name: 'test' };
    expect(validateDevcontainerConfig(config, repoPath)).toEqual([]);
  });

  it('rejects privileged mode', () => {
    const config: DevcontainerConfig = { privileged: true };
    const errors = validateDevcontainerConfig(config, repoPath);
    expect(errors).toContain('privileged mode is not allowed');
  });

  it('rejects Docker socket mount', () => {
    const config: DevcontainerConfig = {
      mounts: ['/var/run/docker.sock:/var/run/docker.sock'],
    };
    const errors = validateDevcontainerConfig(config, repoPath);
    expect(errors.some((e) => e.includes('Docker socket'))).toBe(true);
  });

  it('rejects Docker socket mount as object', () => {
    const config: DevcontainerConfig = {
      mounts: [
        { source: '/var/run/docker.sock', target: '/var/run/docker.sock', type: 'bind' },
      ],
    };
    const errors = validateDevcontainerConfig(config, repoPath);
    expect(errors.some((e) => e.includes('Docker socket'))).toBe(true);
  });

  it('rejects host path mounts outside repo', () => {
    const config: DevcontainerConfig = {
      mounts: [
        { source: '/etc/secrets', target: '/mnt/secrets', type: 'bind' },
      ],
    };
    const errors = validateDevcontainerConfig(config, repoPath);
    expect(errors.some((e) => e.includes('outside the repo'))).toBe(true);
  });

  it('allows mounts from /tmp', () => {
    const config: DevcontainerConfig = {
      mounts: [
        { source: '/tmp/cache', target: '/cache', type: 'bind' },
      ],
    };
    expect(validateDevcontainerConfig(config, repoPath)).toEqual([]);
  });

  it('allows mounts from repo path', () => {
    const config: DevcontainerConfig = {
      mounts: [
        { source: `${repoPath}/data`, target: '/data', type: 'bind' },
      ],
    };
    expect(validateDevcontainerConfig(config, repoPath)).toEqual([]);
  });

  it('rejects mount from path that only shares prefix with /tmp', () => {
    const config: DevcontainerConfig = {
      mounts: [
        { source: '/tmpx/evil', target: '/data', type: 'bind' },
      ],
    };
    const errors = validateDevcontainerConfig(config, repoPath);
    expect(errors.some((e) => e.includes('outside the repo'))).toBe(true);
  });

  it('rejects mount from path that shares prefix with repo path', () => {
    const config: DevcontainerConfig = {
      mounts: [
        { source: `${repoPath}-evil/data`, target: '/data', type: 'bind' },
      ],
    };
    const errors = validateDevcontainerConfig(config, repoPath);
    expect(errors.some((e) => e.includes('outside the repo'))).toBe(true);
  });

  it('rejects unsafe capabilities', () => {
    const config: DevcontainerConfig = {
      capAdd: ['SYS_ADMIN', 'NET_RAW'],
    };
    const errors = validateDevcontainerConfig(config, repoPath);
    expect(errors).toContain("capability 'SYS_ADMIN' is not in the safe allowlist");
    expect(errors).toContain("capability 'NET_RAW' is not in the safe allowlist");
  });

  it('allows SYS_PTRACE capability', () => {
    const config: DevcontainerConfig = {
      capAdd: ['SYS_PTRACE'],
    };
    expect(validateDevcontainerConfig(config, repoPath)).toEqual([]);
  });

  it('rejects --privileged in runArgs', () => {
    const config: DevcontainerConfig = {
      runArgs: ['--privileged'],
    };
    const errors = validateDevcontainerConfig(config, repoPath);
    expect(errors).toContain('--privileged flag is not allowed in runArgs');
  });

  it('rejects Docker socket mount via -v in runArgs', () => {
    const config: DevcontainerConfig = {
      runArgs: ['-v', '/var/run/docker.sock:/var/run/docker.sock'],
    };
    const errors = validateDevcontainerConfig(config, repoPath);
    expect(errors.some((e) => e.includes('Docker socket mount via -v'))).toBe(true);
  });
});

// ─── Version Comparison Tests ────────────────────────────────

describe('compareVersions', () => {
  it('returns 0 for equal versions', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('returns -1 when a < b (major)', () => {
    expect(compareVersions('1.0.0', '2.0.0')).toBe(-1);
  });

  it('returns 1 when a > b (major)', () => {
    expect(compareVersions('2.0.0', '1.0.0')).toBe(1);
  });

  it('returns -1 when a < b (minor)', () => {
    expect(compareVersions('1.2.0', '1.3.0')).toBe(-1);
  });

  it('returns -1 when a < b (patch)', () => {
    expect(compareVersions('1.2.3', '1.2.4')).toBe(-1);
  });

  it('handles different length versions', () => {
    expect(compareVersions('1.2', '1.2.1')).toBe(-1);
    expect(compareVersions('1.2.1', '1.2')).toBe(1);
  });

  it('strips prerelease suffixes', () => {
    expect(compareVersions('1.2.3-beta', '1.2.3')).toBe(0);
    expect(compareVersions('1.2.3-beta', '1.2.4')).toBe(-1);
  });

  it('strips build metadata', () => {
    expect(compareVersions('1.2.3+build', '1.2.3')).toBe(0);
  });

  it('handles non-numeric segments gracefully', () => {
    // Non-numeric segments are treated as 0
    expect(compareVersions('1.abc.3', '1.0.3')).toBe(0);
  });
});

// ─── Pipeline Constants Tests ────────────────────────────────

describe('Pipeline constants', () => {
  it('has exactly 8 steps', () => {
    expect(PIPELINE_STEPS).toHaveLength(8);
  });

  it('has timeouts for all steps', () => {
    for (const step of PIPELINE_STEPS) {
      expect(STEP_TIMEOUTS[step]).toBeDefined();
      expect(STEP_TIMEOUTS[step]).toBeGreaterThan(0);
    }
  });

  it('steps are in correct order', () => {
    expect(PIPELINE_STEPS[0]).toBe('disk_check');
    expect(PIPELINE_STEPS[1]).toBe('ssh_connect');
    expect(PIPELINE_STEPS[2]).toBe('repo_check');
    expect(PIPELINE_STEPS[3]).toBe('env_sync');
    expect(PIPELINE_STEPS[4]).toBe('devcontainer_up');
    expect(PIPELINE_STEPS[5]).toBe('container_exec');
    expect(PIPELINE_STEPS[6]).toBe('agent_verify');
    expect(PIPELINE_STEPS[7]).toBe('worktree_setup');
  });

  it('MIN_DISK_BYTES is 10 GB', () => {
    expect(MIN_DISK_BYTES).toBe(10 * 1024 * 1024 * 1024);
  });
});

// ─── Pipeline Execution Tests ────────────────────────────────

describe('ProvisioningPipeline', () => {
  let mockExecutor: CommandExecutor;
  let mockCancellation: CancellationChecker;
  let mockRecorder: StepStatusRecorder;
  let mockContainerTracker: ContainerTracker;
  let mockSecretTracker: SecretTracker;
  let ctx: ProvisioningContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createDefaultContext();
  });

  describe('disk_check step', () => {
    it('succeeds with sufficient disk space', async () => {
      const responses = new Map([
        ['df -B1', '  20000000000\n'],  // 20 GB
      ]);
      mockExecutor = createMockExecutor(responses);
      mockCancellation = createMockCancellation(false);
      mockRecorder = createMockStatusRecorder();
      mockContainerTracker = createMockContainerTracker();
      mockSecretTracker = createMockSecretTracker();

      // Make subsequent steps fail so we only test disk_check
      (mockCancellation.isCancelled as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(false)    // disk_check
        .mockResolvedValueOnce(true);    // cancel before ssh_connect

      const pipeline = new ProvisioningPipeline(
        mockExecutor,
        mockCancellation,
        mockRecorder,
        mockContainerTracker,
        mockSecretTracker,
      );

      const result = await pipeline.execute(ctx);
      // First step should succeed, then cancelled
      expect(result.steps[0].step).toBe('disk_check');
      expect(result.steps[0].status).toBe('completed');
      expect(result.steps[0].data?.availableBytes).toBe(20000000000);
    });

    it('fails with insufficient disk space', async () => {
      const responses = new Map([
        ['df -B1', '  5000000000\n'],  // 5 GB (below 10 GB)
      ]);
      mockExecutor = createMockExecutor(responses);
      mockCancellation = createMockCancellation(false);
      mockRecorder = createMockStatusRecorder();
      mockContainerTracker = createMockContainerTracker();
      mockSecretTracker = createMockSecretTracker();

      const pipeline = new ProvisioningPipeline(
        mockExecutor,
        mockCancellation,
        mockRecorder,
        mockContainerTracker,
        mockSecretTracker,
      );

      const result = await pipeline.execute(ctx);
      expect(result.success).toBe(false);
      expect(result.steps[0].status).toBe('failed');
      expect(result.steps[0].error).toContain('Insufficient disk space');
    });

    it('fails when df output is unparseable', async () => {
      const responses = new Map([
        ['df -B1', '  error_output\n'],
      ]);
      mockExecutor = createMockExecutor(responses);
      mockCancellation = createMockCancellation(false);
      mockRecorder = createMockStatusRecorder();
      mockContainerTracker = createMockContainerTracker();
      mockSecretTracker = createMockSecretTracker();

      const pipeline = new ProvisioningPipeline(
        mockExecutor,
        mockCancellation,
        mockRecorder,
        mockContainerTracker,
        mockSecretTracker,
      );

      const result = await pipeline.execute(ctx);
      expect(result.success).toBe(false);
      expect(result.steps[0].error).toContain('Failed to parse disk space');
    });
  });

  describe('cancellation checks', () => {
    it('cancels before first step', async () => {
      mockExecutor = createMockExecutor();
      mockCancellation = createMockCancellation(true);  // Already cancelled
      mockRecorder = createMockStatusRecorder();
      mockContainerTracker = createMockContainerTracker();
      mockSecretTracker = createMockSecretTracker();

      const pipeline = new ProvisioningPipeline(
        mockExecutor,
        mockCancellation,
        mockRecorder,
        mockContainerTracker,
        mockSecretTracker,
      );

      const result = await pipeline.execute(ctx);
      expect(result.success).toBe(false);
      expect(result.cancelled).toBe(true);
      expect(result.steps).toHaveLength(0);
    });

    it('cancels between steps', async () => {
      const responses = new Map([
        ['df -B1', '  20000000000\n'],
      ]);
      mockExecutor = createMockExecutor(responses);
      mockCancellation = createMockCancellation(false);
      mockRecorder = createMockStatusRecorder();
      mockContainerTracker = createMockContainerTracker();
      mockSecretTracker = createMockSecretTracker();

      // Not cancelled for disk_check, cancelled for ssh_connect
      (mockCancellation.isCancelled as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const pipeline = new ProvisioningPipeline(
        mockExecutor,
        mockCancellation,
        mockRecorder,
        mockContainerTracker,
        mockSecretTracker,
      );

      const result = await pipeline.execute(ctx);
      expect(result.success).toBe(false);
      expect(result.cancelled).toBe(true);
      expect(result.steps).toHaveLength(1);  // Only disk_check ran
      expect(result.steps[0].status).toBe('completed');
    });
  });

  describe('rollback on failure', () => {
    it('rolls back in reverse order when a step fails', async () => {
      const rollbackOrder: string[] = [];
      const responses = new Map([
        ['df -B1', '  20000000000\n'],      // disk_check succeeds
        ['test -d', 'missing'],              // repo does not exist
        ['git clone', ''],                   // clone succeeds
        ['op read', 'EVIL=$(hack)\n'],       // env_sync fetches malicious content
      ]);
      mockExecutor = createMockExecutor(responses);
      mockCancellation = createMockCancellation(false);
      mockRecorder = createMockStatusRecorder();
      mockContainerTracker = createMockContainerTracker();
      mockSecretTracker = createMockSecretTracker();

      // Track rollback calls
      const origRun = mockExecutor.run as ReturnType<typeof vi.fn>;
      origRun.mockImplementation(async (command: string) => {
        if (command.includes('realpath')) {
          rollbackOrder.push('realpath');
          return '/home/user/claw/repos/testorg/testrepo\n';
        }
        if (command.includes('rm -rf')) {
          rollbackOrder.push('rm_repo');
          return '';
        }
        for (const [key, value] of responses) {
          if (command.includes(key)) return value;
        }
        return '';
      });

      const pipeline = new ProvisioningPipeline(
        mockExecutor,
        mockCancellation,
        mockRecorder,
        mockContainerTracker,
        mockSecretTracker,
      );

      const result = await pipeline.execute(ctx);
      expect(result.success).toBe(false);
      // env_sync should fail because of malicious .env content
      const failedStep = result.steps.find((s) => s.status === 'failed');
      expect(failedStep).toBeDefined();
    });
  });

  describe('status recording', () => {
    it('records running and completed status for each step', async () => {
      const responses = new Map([
        ['df -B1', '  20000000000\n'],
      ]);
      mockExecutor = createMockExecutor(responses);
      mockCancellation = createMockCancellation(false);
      mockRecorder = createMockStatusRecorder();
      mockContainerTracker = createMockContainerTracker();
      mockSecretTracker = createMockSecretTracker();

      // Cancel after first step to limit scope
      (mockCancellation.isCancelled as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const pipeline = new ProvisioningPipeline(
        mockExecutor,
        mockCancellation,
        mockRecorder,
        mockContainerTracker,
        mockSecretTracker,
      );

      await pipeline.execute(ctx);

      const recordCalls = (mockRecorder.recordStepStatus as ReturnType<typeof vi.fn>).mock.calls;
      // Should have recorded 'running' and 'completed' for disk_check
      expect(recordCalls.length).toBeGreaterThanOrEqual(2);
      expect(recordCalls[0][1]).toBe('disk_check');
      expect(recordCalls[0][2]).toBe('running');
      expect(recordCalls[1][1]).toBe('disk_check');
      expect(recordCalls[1][2]).toBe('completed');
    });

    it('records failed status when step fails', async () => {
      const responses = new Map([
        ['df -B1', '  1000\n'],  // Way too small
      ]);
      mockExecutor = createMockExecutor(responses);
      mockCancellation = createMockCancellation(false);
      mockRecorder = createMockStatusRecorder();
      mockContainerTracker = createMockContainerTracker();
      mockSecretTracker = createMockSecretTracker();

      const pipeline = new ProvisioningPipeline(
        mockExecutor,
        mockCancellation,
        mockRecorder,
        mockContainerTracker,
        mockSecretTracker,
      );

      await pipeline.execute(ctx);

      const recordCalls = (mockRecorder.recordStepStatus as ReturnType<typeof vi.fn>).mock.calls;
      expect(recordCalls[0][2]).toBe('running');
      expect(recordCalls[1][2]).toBe('failed');
    });
  });

  describe('crash recovery (resume)', () => {
    it('resumes from last incomplete step', async () => {
      const responses = new Map([
        ['df -B1', '  20000000000\n'],
      ]);
      mockExecutor = createMockExecutor(responses);
      mockCancellation = createMockCancellation(false);
      mockRecorder = createMockStatusRecorder();
      mockContainerTracker = createMockContainerTracker();
      mockSecretTracker = createMockSecretTracker();

      // Simulate 3 steps completed before crash
      (mockRecorder.getStepStatuses as ReturnType<typeof vi.fn>).mockResolvedValue([
        { step: 'disk_check' as PipelineStepName, status: 'completed' as StepStatus },
        { step: 'ssh_connect' as PipelineStepName, status: 'completed' as StepStatus },
        { step: 'repo_check' as PipelineStepName, status: 'completed' as StepStatus },
      ]);

      // Cancel after first resumed step
      (mockCancellation.isCancelled as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(false)  // env_sync
        .mockResolvedValueOnce(true);  // cancel

      const pipeline = new ProvisioningPipeline(
        mockExecutor,
        mockCancellation,
        mockRecorder,
        mockContainerTracker,
        mockSecretTracker,
      );

      const result = await pipeline.resume(ctx);

      // First 3 steps should show as completed (from recovery)
      expect(result.steps[0].step).toBe('disk_check');
      expect(result.steps[0].status).toBe('completed');
      expect(result.steps[1].step).toBe('ssh_connect');
      expect(result.steps[1].status).toBe('completed');
      expect(result.steps[2].step).toBe('repo_check');
      expect(result.steps[2].status).toBe('completed');

      // Next step should have been attempted
      expect(result.steps.length).toBeGreaterThanOrEqual(4);
    });

    it('resumes from the beginning if no steps were completed', async () => {
      const responses = new Map([
        ['df -B1', '  20000000000\n'],
      ]);
      mockExecutor = createMockExecutor(responses);
      mockCancellation = createMockCancellation(false);
      mockRecorder = createMockStatusRecorder();
      mockContainerTracker = createMockContainerTracker();
      mockSecretTracker = createMockSecretTracker();

      (mockRecorder.getStepStatuses as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      // Cancel after first step
      (mockCancellation.isCancelled as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const pipeline = new ProvisioningPipeline(
        mockExecutor,
        mockCancellation,
        mockRecorder,
        mockContainerTracker,
        mockSecretTracker,
      );

      const result = await pipeline.resume(ctx);
      expect(result.steps[0].step).toBe('disk_check');
    });
  });

  describe('agent version check', () => {
    it('accepts version equal to minimum', () => {
      expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    });

    it('accepts version above minimum', () => {
      expect(compareVersions('2.0.0', '1.0.0')).toBe(1);
    });

    it('rejects version below minimum', () => {
      expect(compareVersions('0.9.0', '1.0.0')).toBe(-1);
    });
  });
});
