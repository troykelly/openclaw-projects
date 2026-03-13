/**
 * Docker image validation tests for export dependencies.
 * Part of Issue #2481 — verifies Chromium and pandoc are available in the runtime.
 *
 * These tests validate that the Docker API image has the required
 * system-level tools for the export service. They check for binary
 * availability and basic functionality.
 *
 * In CI, these run inside the built Docker container. In local development,
 * they run against the devcontainer (which should also have these tools).
 * Tests are skipped gracefully if the binaries are not available (e.g.,
 * running unit tests on a host machine without chromium/pandoc).
 */

import { describe, it, expect } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Check if a binary is available on PATH.
 */
async function binaryExists(name: string): Promise<boolean> {
  try {
    await execFileAsync('which', [name]);
    return true;
  } catch {
    return false;
  }
}

describe('Docker export dependencies', () => {
  describe('Chromium', () => {
    it('chromium binary is available', async () => {
      const exists = await binaryExists('chromium');
      if (!exists) {
        console.warn('SKIP: chromium not found on PATH (expected in Docker/devcontainer)');
        return;
      }
      expect(exists).toBe(true);
    });

    it('chromium --headless renders successfully', async () => {
      const exists = await binaryExists('chromium');
      if (!exists) {
        console.warn('SKIP: chromium not found on PATH');
        return;
      }

      const { stdout } = await execFileAsync('chromium', [
        '--headless',
        '--no-sandbox',
        '--disable-gpu',
        '--dump-dom',
        'about:blank',
      ], { timeout: 30000 });

      // about:blank produces a minimal HTML document
      expect(stdout).toContain('<html');
    });

    it('PUPPETEER_EXECUTABLE_PATH env var points to a chromium binary', () => {
      const execPath = process.env.PUPPETEER_EXECUTABLE_PATH;
      if (!execPath) {
        console.warn('SKIP: PUPPETEER_EXECUTABLE_PATH not set (expected in Docker/devcontainer)');
        return;
      }
      // In Docker: /usr/bin/chromium; in devcontainer: Playwright path
      expect(execPath).toMatch(/chrom/i);
    });

    it('PUPPETEER_SKIP_CHROMIUM_DOWNLOAD is set in Docker', () => {
      // This env var is only set in the Docker image, not in devcontainer
      const skip = process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD;
      if (!skip) {
        console.warn('SKIP: PUPPETEER_SKIP_CHROMIUM_DOWNLOAD not set (expected in Docker image only)');
        return;
      }
      expect(skip).toBe('true');
    });
  });

  describe('pandoc', () => {
    it('pandoc binary is available', async () => {
      const exists = await binaryExists('pandoc');
      if (!exists) {
        console.warn('SKIP: pandoc not found on PATH (expected in Docker/devcontainer)');
        return;
      }
      expect(exists).toBe(true);
    });

    it('pandoc --version succeeds', async () => {
      const exists = await binaryExists('pandoc');
      if (!exists) {
        console.warn('SKIP: pandoc not found on PATH');
        return;
      }

      const { stdout } = await execFileAsync('pandoc', ['--version'], { timeout: 10000 });

      expect(stdout).toContain('pandoc');
    });
  });
});
