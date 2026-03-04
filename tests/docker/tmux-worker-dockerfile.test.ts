/**
 * TMux Worker Dockerfile hardening tests.
 * Issue #2129 — Dockerfile uses non-LTS Node.js 25.
 *
 * Verifies that the tmux-worker Dockerfile uses LTS Node.js (Node 22)
 * and follows best practices for multi-stage builds.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const ROOT_DIR = resolve(__dirname, '../..');
const DOCKERFILE_PATH = resolve(ROOT_DIR, 'docker/tmux-worker/Dockerfile');

describe('TMux Worker Dockerfile — Node LTS', () => {
  let dockerfileContent: string;

  beforeAll(() => {
    if (!existsSync(DOCKERFILE_PATH)) {
      throw new Error('docker/tmux-worker/Dockerfile not found');
    }
    dockerfileContent = readFileSync(DOCKERFILE_PATH, 'utf-8');
  });

  describe('Node.js version', () => {
    it('uses Node 22 LTS for builder stage', () => {
      expect(dockerfileContent).toMatch(/FROM\s+node:22-bookworm-slim\s+AS\s+builder/i);
    });

    it('uses Node 22 LTS for deps stage', () => {
      expect(dockerfileContent).toMatch(/FROM\s+node:22-bookworm-slim\s+AS\s+deps/i);
    });

    it('uses Node 22 LTS for runtime stage', () => {
      expect(dockerfileContent).toMatch(/FROM\s+node:22-bookworm-slim\s+AS\s+runtime/i);
    });

    it('does not use non-LTS Node 25', () => {
      expect(dockerfileContent).not.toMatch(/node:25/);
    });

    it('all FROM node: statements use node:22-bookworm-slim', () => {
      const fromStatements = dockerfileContent.match(/^FROM\s+node:\S+/gm) || [];
      expect(fromStatements.length).toBeGreaterThanOrEqual(3);
      for (const stmt of fromStatements) {
        expect(stmt).toMatch(/node:22-bookworm-slim/);
      }
    });
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

    it('uses experimental-transform-types flag', () => {
      expect(dockerfileContent).toMatch(/--experimental-transform-types/);
    });

    it('installs tmux and SSH tools in runtime stage', () => {
      // apt-get install and package names span multiple lines
      expect(dockerfileContent).toContain('tmux');
      expect(dockerfileContent).toContain('openssh');
    });

    it('exposes gRPC, SSH enrollment, and health ports', () => {
      expect(dockerfileContent).toMatch(/EXPOSE\s+50051/);
      expect(dockerfileContent).toMatch(/2222/);
      expect(dockerfileContent).toMatch(/9002/);
    });

    it('has OCI labels with build args', () => {
      expect(dockerfileContent).toMatch(/ARG\s+BUILD_DATE/);
      expect(dockerfileContent).toMatch(/ARG\s+VCS_REF/);
      expect(dockerfileContent).toMatch(/ARG\s+VERSION/);
      expect(dockerfileContent).toMatch(/org\.opencontainers\.image\.title/);
    });

    it('documents Node version requirement', () => {
      expect(dockerfileContent).toMatch(/Node 22/i);
    });
  });
});
