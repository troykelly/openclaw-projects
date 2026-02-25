/**
 * Tests for command-based credential provider.
 * Issue #1671.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  executeCredentialCommand,
  resolveCommandCredential,
  clearCredentialCache,
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
        executeCredentialCommand('empty-cmd', 5000),
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
        executeCredentialCommand('failing-cmd', 5000),
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
        executeCredentialCommand('slow-cmd', 1000),
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
        'cache-cmd',
        5000,
        60, // 60s cache
      );
      expect(result1).toBe('secret-1');

      const result2 = await resolveCommandCredential(
        'cred-cached',
        'cache-cmd',
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

      await resolveCommandCredential('cred-no-cache', 'no-cache-cmd', 5000, 0);
      await resolveCommandCredential('cred-no-cache', 'no-cache-cmd', 5000, 0);

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

      await resolveCommandCredential('cred-clear', 'clear-cmd', 5000, 60);
      expect(callCount).toBe(1);

      clearCredentialCache();

      await resolveCommandCredential('cred-clear', 'clear-cmd', 5000, 60);
      // Command should be called again after cache clear
      expect(callCount).toBe(2);
    });
  });
});
