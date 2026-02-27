/**
 * Unit tests for the SSH enrollment server rate limiting and host key logic.
 *
 * Issue #1684 — SSH enrollment server
 *
 * Note: Full auth flow tests (token validation, connection creation, tunnel
 * handling) require a running Postgres instance with enrollment token rows
 * and a real SSH client. Those paths are covered by the integration test suite
 * (tests/terminal_api.test.ts enrollment section). This file focuses on the
 * pure logic that can be tested without external dependencies.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isRateLimited,
  recordFailedAttempt,
  clearRateLimit,
  failedAuthAttempts,
  loadOrGenerateHostKey,
} from './enrollment-ssh-server.ts';

describe('SSH enrollment rate limiting', () => {
  beforeEach(() => {
    failedAuthAttempts.clear();
  });

  it('allows first attempt from new IP', () => {
    expect(isRateLimited('1.2.3.4')).toBe(false);
  });

  it('rate-limits after MAX_FAILED_ATTEMPTS', () => {
    const ip = '10.0.0.1';
    for (let i = 0; i < 5; i++) {
      recordFailedAttempt(ip);
    }
    expect(isRateLimited(ip)).toBe(true);
  });

  it('does not rate-limit before threshold', () => {
    const ip = '10.0.0.2';
    for (let i = 0; i < 4; i++) {
      recordFailedAttempt(ip);
    }
    expect(isRateLimited(ip)).toBe(false);
  });

  it('clears rate limit on successful auth', () => {
    const ip = '10.0.0.3';
    for (let i = 0; i < 5; i++) {
      recordFailedAttempt(ip);
    }
    expect(isRateLimited(ip)).toBe(true);

    clearRateLimit(ip);
    expect(isRateLimited(ip)).toBe(false);
  });

  it('isolates rate limits per IP', () => {
    for (let i = 0; i < 5; i++) {
      recordFailedAttempt('10.0.0.10');
    }
    expect(isRateLimited('10.0.0.10')).toBe(true);
    expect(isRateLimited('10.0.0.11')).toBe(false);
  });
});

describe('loadOrGenerateHostKey', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enrollment-key-test-'));

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('generates ephemeral key when path is empty', () => {
    const key = loadOrGenerateHostKey('');
    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBeGreaterThan(0);
    // Should contain PEM markers for Ed25519 private key
    expect(key.toString()).toContain('PRIVATE KEY');
  });

  it('generates and saves key when path does not exist', () => {
    const keyPath = path.join(tmpDir, 'new-host-key.pem');
    expect(fs.existsSync(keyPath)).toBe(false);

    const key = loadOrGenerateHostKey(keyPath);
    expect(key).toBeInstanceOf(Buffer);
    expect(key.toString()).toContain('PRIVATE KEY');

    // File should now exist with restrictive permissions (0600)
    expect(fs.existsSync(keyPath)).toBe(true);
    const mode = fs.statSync(keyPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('loads existing key from disk', () => {
    const keyPath = path.join(tmpDir, 'existing-host-key.pem');
    // Generate once
    const original = loadOrGenerateHostKey(keyPath);

    // Load again — should return same key
    const loaded = loadOrGenerateHostKey(keyPath);
    expect(loaded.toString()).toBe(original.toString());
  });

  it('creates parent directories if needed', () => {
    const keyPath = path.join(tmpDir, 'nested', 'dir', 'host-key.pem');
    const key = loadOrGenerateHostKey(keyPath);
    expect(key).toBeInstanceOf(Buffer);
    expect(fs.existsSync(keyPath)).toBe(true);
  });
});
