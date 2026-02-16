/**
 * Tests that optional services (Nominatim, PromptGuard) are documented
 * and can be disabled via Docker Compose profiles or overrides.
 *
 * Issue #1262
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
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

describe('Optional services configuration', () => {
  describe('Nominatim in docker-compose.traefik.yml', () => {
    let compose: ComposeFile;

    beforeAll(() => {
      compose = loadCompose('docker-compose.traefik.yml');
    });

    it('should have nominatim service defined', () => {
      expect(compose.services.nominatim).toBeDefined();
    });

    it('should have nominatim behind a profile', () => {
      expect(compose.services.nominatim.profiles).toBeDefined();
      expect(compose.services.nominatim.profiles).toContain('geo');
    });
  });

  describe('Nominatim in docker-compose.full.yml', () => {
    let compose: ComposeFile;

    beforeAll(() => {
      compose = loadCompose('docker-compose.full.yml');
    });

    it('should have nominatim service defined', () => {
      expect(compose.services.nominatim).toBeDefined();
    });

    it('should have nominatim behind a profile', () => {
      expect(compose.services.nominatim.profiles).toBeDefined();
      expect(compose.services.nominatim.profiles).toContain('geo');
    });
  });

  describe('PromptGuard profile consistency', () => {
    it('should have prompt-guard behind ml profile in traefik compose', () => {
      const compose = loadCompose('docker-compose.traefik.yml');
      expect(compose.services['prompt-guard']?.profiles).toContain('ml');
    });

    it('should have prompt-guard behind ml profile in full compose', () => {
      const compose = loadCompose('docker-compose.full.yml');
      expect(compose.services['prompt-guard']?.profiles).toContain('ml');
    });
  });

  describe('Deployment documentation', () => {
    let docs: string;

    beforeAll(() => {
      docs = loadDeploymentDocs();
    });

    it('should document optional services section', () => {
      expect(docs).toContain('Optional Services');
    });

    it('should document how to enable Nominatim', () => {
      expect(docs).toContain('--profile geo');
    });

    it('should document how to enable PromptGuard', () => {
      expect(docs).toContain('--profile ml');
    });

    it('should document that Nominatim is opt-in', () => {
      expect(docs).toMatch(/[Nn]ominatim/);
      expect(docs).toMatch(/geo.*profile|profile.*geo/i);
    });
  });
});
