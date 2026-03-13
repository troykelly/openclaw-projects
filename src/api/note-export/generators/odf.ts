/**
 * ODF (ODT) generator using pandoc system binary.
 * Part of Epic #2475, Issue #2477.
 *
 * Invokes pandoc via child_process with a 30-second timeout.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import type { OdfGeneratorInput } from '../types.ts';

const execFileAsync = promisify(execFile);

/** Default timeout for pandoc execution (30 seconds) */
const PANDOC_TIMEOUT_MS = 30_000;

/** Known pandoc binary locations */
const PANDOC_PATHS = ['/usr/bin/pandoc', '/usr/local/bin/pandoc'];

/**
 * Resolves the path to the pandoc binary.
 * Checks known locations then falls back to PATH lookup.
 */
export function resolvePandocPath(): string {
  const fs = require('fs');
  for (const p of PANDOC_PATHS) {
    if (fs.existsSync(p)) return p;
  }

  // Fall back to 'pandoc' and let PATH resolution handle it
  return 'pandoc';
}

/**
 * Generates an ODT buffer from markdown content using pandoc.
 *
 * @param input - Markdown string
 * @returns ODT binary as Buffer
 * @throws Error if pandoc is not installed or times out
 */
export async function generateOdf(input: OdfGeneratorInput): Promise<Buffer> {
  const pandocPath = resolvePandocPath();

  try {
    const result = await execFileAsync(pandocPath, ['--from=markdown', '--to=odt', '--output=-'], {
      encoding: 'buffer',
      timeout: PANDOC_TIMEOUT_MS,
      maxBuffer: 50 * 1024 * 1024, // 50MB max output
      input: input.markdown,
    } as Parameters<typeof execFileAsync>[2] & { input: string; encoding: 'buffer' });

    // execFile with encoding: 'buffer' returns { stdout: Buffer, stderr: Buffer }
    const output = result as unknown as { stdout: Buffer; stderr: Buffer };
    return Buffer.from(output.stdout);
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { killed?: boolean };

    if (err.code === 'ENOENT') {
      throw new Error(
        'pandoc is not installed or not in PATH — ODF export is unavailable. ' +
        `Checked: ${PANDOC_PATHS.join(', ')}`,
      );
    }

    if (err.killed) {
      throw new Error(`pandoc timed out after ${PANDOC_TIMEOUT_MS / 1000} seconds`);
    }

    throw new Error(`pandoc failed: ${err.message}`);
  }
}
