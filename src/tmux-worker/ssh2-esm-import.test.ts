/**
 * Smoke test: verify ssh2 CJS package imports resolve at runtime.
 *
 * Issue #1916 — The tmux-worker container crash-loops because ssh2 is a
 * CommonJS-only package and ESM named imports (e.g. `import { Server } from 'ssh2'`)
 * fail under Node 25 with --experimental-transform-types.
 *
 * The fix uses default imports with destructuring + companion type aliases.
 * This test catches the regression by importing the actual modules that use ssh2
 * and verifying the re-exported values are real constructors, not undefined.
 */

import { describe, it, expect } from 'vitest';

describe('ssh2 ESM import smoke test', () => {
  it('enrollment-ssh-server: SSHServer constructor is available', async () => {
    // This import will throw SyntaxError at load time if the ssh2
    // named-export bug regresses.
    const mod = await import('./enrollment-ssh-server.ts');

    // createEnrollmentSSHServer is the factory that calls `new SSHServer(...)`.
    // If the import resolved, this function exists and is callable.
    expect(typeof mod.createEnrollmentSSHServer).toBe('function');
  });

  it('ssh/client: SSH2Client constructor is available', async () => {
    const mod = await import('./ssh/client.ts');

    // SSHConnectionManager wraps SSH2Client. If the import resolved,
    // the class exists and can be instantiated (it takes pool + key).
    expect(typeof mod.SSHConnectionManager).toBe('function');
    expect(typeof mod.buildSSHConfig).toBe('function');
  });

  it('ssh2 default import exposes Server, Client, and utils', async () => {
    // Direct verification that the CJS default import pattern works.
    const ssh2 = await import('ssh2');
    const mod = ssh2.default ?? ssh2;

    expect(typeof mod.Server).toBe('function');
    expect(typeof mod.Client).toBe('function');
    expect(mod.utils).toBeDefined();
  });
});
