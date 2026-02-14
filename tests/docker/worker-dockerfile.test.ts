/**
 * Worker Dockerfile hardening tests.
 * Mirrors the API Dockerfile tests in structure.
 * Part of Issue #1178.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const ROOT_DIR = resolve(__dirname, '../..');
const DOCKERFILE_PATH = resolve(ROOT_DIR, 'docker/worker/Dockerfile');
const DOCKERIGNORE_PATH = resolve(ROOT_DIR, 'docker/worker/.dockerignore');

describe('Worker Dockerfile hardening', () => {
  let dockerfileContent: string;

  beforeAll(() => {
    dockerfileContent = readFileSync(DOCKERFILE_PATH, 'utf-8');
  });

  describe('Dockerfile structure', () => {
    it('uses multi-stage build with builder, deps, and runtime stages', () => {
      expect(dockerfileContent).toMatch(/FROM\s+node:\S+\s+AS\s+builder/i);
      expect(dockerfileContent).toMatch(/FROM\s+node:\S+\s+AS\s+deps/i);
      expect(dockerfileContent).toMatch(/FROM\s+node:\S+\s+AS\s+runtime/i);
    });

    it('has separate deps stage for production dependencies', () => {
      expect(dockerfileContent).toMatch(/pnpm install.*--prod/);
    });

    it('uses non-root user', () => {
      expect(dockerfileContent).toMatch(/USER\s+node/);
    });

    it('exposes port 9000 (health/metrics)', () => {
      const exposeStatements = dockerfileContent.match(/^EXPOSE\s+\d+/gm) || [];
      expect(exposeStatements.length).toBeGreaterThanOrEqual(1);
      expect(exposeStatements.some((s) => s.includes('9000'))).toBe(true);
    });

    it('has OCI labels with build args', () => {
      expect(dockerfileContent).toMatch(/ARG\s+BUILD_DATE/);
      expect(dockerfileContent).toMatch(/ARG\s+VCS_REF/);
      expect(dockerfileContent).toMatch(/ARG\s+VERSION/);
      expect(dockerfileContent).toMatch(/org\.opencontainers\.image\.created/);
      expect(dockerfileContent).toMatch(/org\.opencontainers\.image\.revision/);
    });

    it('copies src/worker directory', () => {
      expect(dockerfileContent).toMatch(/COPY.*src\/worker/);
    });

    it('does not copy UI source files', () => {
      expect(dockerfileContent).not.toMatch(/COPY.*src\/ui/);
    });

    it('runs worker entrypoint', () => {
      expect(dockerfileContent).toMatch(/src\/worker\/run\.ts/);
    });

    it('uses experimental-transform-types flag', () => {
      expect(dockerfileContent).toMatch(/--experimental-transform-types/);
    });
  });

  describe('.dockerignore', () => {
    it('exists or shares parent dockerignore', () => {
      // Worker may share API's .dockerignore or have its own
      const hasOwn = existsSync(DOCKERIGNORE_PATH);
      const hasParent = existsSync(resolve(ROOT_DIR, 'docker/api/.dockerignore'));
      expect(hasOwn || hasParent).toBe(true);
    });
  });
});

describe('Worker Docker Compose configuration', () => {
  it('has worker service in docker-compose.yml', () => {
    const content = readFileSync(resolve(ROOT_DIR, 'docker-compose.yml'), 'utf-8');
    expect(content).toMatch(/worker:/);
  });

  it('has worker service in docker-compose.test.yml', () => {
    const content = readFileSync(resolve(ROOT_DIR, 'docker-compose.test.yml'), 'utf-8');
    expect(content).toMatch(/worker/);
  });

  it('worker service uses correct health port', () => {
    const content = readFileSync(resolve(ROOT_DIR, 'docker-compose.yml'), 'utf-8');
    expect(content).toMatch(/9000/);
  });

  it('worker service has security hardening', () => {
    const content = readFileSync(resolve(ROOT_DIR, 'docker-compose.yml'), 'utf-8');
    expect(content).toMatch(/read_only:\s*true/);
    expect(content).toMatch(/no-new-privileges/);
  });
});

describe('Worker in CI workflow', () => {
  it('includes worker in containers.yml build matrix', () => {
    const content = readFileSync(resolve(ROOT_DIR, '.github/workflows/containers.yml'), 'utf-8');
    expect(content).toMatch(/worker/);
  });
});
