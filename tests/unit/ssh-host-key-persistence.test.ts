/**
 * Tests for SSH host key persistence.
 * Issue #1857 — Persist enrollment SSH host key across worker restarts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadOrGenerateHostKey } from '../../src/tmux-worker/enrollment-ssh-server.ts';

describe('loadOrGenerateHostKey', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssh-key-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('generates a new key when no file exists', () => {
    const keyPath = path.join(tmpDir, 'host_key');
    const key = loadOrGenerateHostKey(keyPath);

    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBeGreaterThan(0);
    expect(key.toString()).toContain('PRIVATE KEY');
  });

  it('saves the generated key to disk', () => {
    const keyPath = path.join(tmpDir, 'host_key');
    loadOrGenerateHostKey(keyPath);

    expect(fs.existsSync(keyPath)).toBe(true);
    const saved = fs.readFileSync(keyPath, 'utf-8');
    expect(saved).toContain('PRIVATE KEY');
  });

  it('loads an existing key from disk', () => {
    const keyPath = path.join(tmpDir, 'host_key');

    // Generate and save
    const key1 = loadOrGenerateHostKey(keyPath);

    // Load from disk
    const key2 = loadOrGenerateHostKey(keyPath);

    // Should be the same key
    expect(key1.toString()).toEqual(key2.toString());
  });

  it('generates a new key when path is empty string', () => {
    const key = loadOrGenerateHostKey('');

    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBeGreaterThan(0);
    expect(key.toString()).toContain('PRIVATE KEY');
  });

  it('sets restrictive file permissions on saved key', () => {
    const keyPath = path.join(tmpDir, 'host_key');
    loadOrGenerateHostKey(keyPath);

    const stats = fs.statSync(keyPath);
    // 0o600 = owner read/write only
    const mode = stats.mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
