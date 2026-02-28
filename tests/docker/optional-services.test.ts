/**
 * Tests that all services start by default (no profiles) and that the
 * override-to-disable pattern is documented.
 *
 * Issue #1262, updated for #1908 (services on by default).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT_DIR = resolve(__dirname, '../..');

interface ComposeService {
  profiles?: string[];
  environment?: Record<string, string> | string[];
  [key: string]: unknown;
}

interface ComposeFile {
  services: Record<string, ComposeService>;
  [key: string]: unknown;
}

function loadCompose(filename: string): ComposeFile {
  const content = readFileSync(resolve(ROOT_DIR, filename), 'utf-8');
  return parse(content) as ComposeFile;
}

function loadDeploymentDocs(): string {
  return readFileSync(resolve(ROOT_DIR, 'docs/deployment.md'), 'utf-8');
}

/** Services that must start by default (no profiles key). */
const DEFAULT_SERVICES = ['nominatim', 'prompt-guard', 'tmux-certs', 'tmux-worker'];

describe('Services start by default (Issue #1908)', () => {
  describe.each(['docker-compose.yml', 'docker-compose.traefik.yml', 'docker-compose.full.yml'])('%s', (filename) => {
    let compose: ComposeFile;

    beforeAll(() => {
      compose = loadCompose(filename);
    });

    it.each(DEFAULT_SERVICES)('%s is defined', (service) => {
      expect(compose.services[service]).toBeDefined();
    });

    it.each(DEFAULT_SERVICES)('%s has no profiles key (starts by default)', (service) => {
      expect(compose.services[service].profiles).toBeUndefined();
    });
  });

  describe('Deployment documentation', () => {
    let docs: string;

    beforeAll(() => {
      docs = loadDeploymentDocs();
    });

    it('documents the override-to-disable pattern', () => {
      expect(docs).toContain('docker-compose.override.yml');
    });

    it('documents that services start by default', () => {
      expect(docs).toMatch(/start.*by default|enabled by default|on by default/i);
    });

    it('documents Nominatim', () => {
      expect(docs).toMatch(/[Nn]ominatim/);
    });

    it('documents PromptGuard / prompt-guard', () => {
      expect(docs).toMatch(/[Pp]rompt.?[Gg]uard/);
    });

    it('documents terminal worker', () => {
      expect(docs).toMatch(/tmux.worker|terminal.worker/i);
    });
  });
});
