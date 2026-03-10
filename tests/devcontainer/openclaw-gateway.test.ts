/**
 * Smoke tests for OpenClaw gateway devcontainer integration.
 *
 * These tests verify the devcontainer configuration correctly sets up
 * the development environment. They validate file presence and
 * configuration structure rather than running scripts (which requires
 * the full devcontainer runtime).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const DEVCONTAINER_DIR = resolve(import.meta.dirname, '../../.devcontainer');

describe('OpenClaw Gateway Devcontainer Configuration', () => {
  describe('docker-compose.devcontainer.yml', () => {
    const composePath = resolve(DEVCONTAINER_DIR, 'docker-compose.devcontainer.yml');

    it('should exist', () => {
      expect(existsSync(composePath)).toBe(true);
    });

    it('should not use a named volume for gateway source', () => {
      const content = readFileSync(composePath, 'utf-8');
      const config = parse(content);
      expect(config.volumes).not.toHaveProperty('openclaw_gateway_source');
    });
  });

  describe('post-create.sh', () => {
    const postCreatePath = resolve(DEVCONTAINER_DIR, 'post-create.sh');

    it('should exist', () => {
      expect(existsSync(postCreatePath)).toBe(true);
    });

    it('should use run_step pattern for idempotent setup', () => {
      const content = readFileSync(postCreatePath, 'utf-8');
      expect(content).toContain('run_step');
    });

    it('should install project dependencies with pnpm', () => {
      const content = readFileSync(postCreatePath, 'utf-8');
      expect(content).toContain('pnpm install');
    });

    it('should set up Node.js via nvm', () => {
      const content = readFileSync(postCreatePath, 'utf-8');
      expect(content).toContain('NVM_DIR');
      expect(content).toContain('nvm install');
    });

    it('should configure pnpm home directory', () => {
      const content = readFileSync(postCreatePath, 'utf-8');
      expect(content).toContain('PNPM_HOME');
    });

    it('should install Claude Code CLI', () => {
      const content = readFileSync(postCreatePath, 'utf-8');
      expect(content).toContain('install_claude');
    });

    it('should install Codex CLI', () => {
      const content = readFileSync(postCreatePath, 'utf-8');
      expect(content).toContain('install_codex');
    });

    it('should configure MCP servers', () => {
      const content = readFileSync(postCreatePath, 'utf-8');
      expect(content).toContain('configure_mcp');
    });
  });

  describe('scripts/openclaw-gateway.sh', () => {
    const scriptPath = resolve(import.meta.dirname, '../../scripts/openclaw-gateway.sh');

    it('should exist', () => {
      expect(existsSync(scriptPath)).toBe(true);
    });

    it('should skip channels for dev mode', () => {
      const content = readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('OPENCLAW_SKIP_CHANNELS=1');
    });

    it('should support configurable port via OPENCLAW_GATEWAY_PORT', () => {
      const content = readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('OPENCLAW_GATEWAY_PORT');
    });

    it('should use default port 18789', () => {
      const content = readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('18789');
    });

    it('should support --reset flag', () => {
      const content = readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('--reset');
    });
  });

  describe('devcontainer.json', () => {
    const devcontainerPath = resolve(DEVCONTAINER_DIR, 'devcontainer.json');

    it('should exist', () => {
      expect(existsSync(devcontainerPath)).toBe(true);
    });

    it('should reference docker-compose file', () => {
      const content = readFileSync(devcontainerPath, 'utf-8');
      expect(content).toContain('"dockerComposeFile": "docker-compose.devcontainer.yml"');
    });

    it('should use post-create.sh as postCreateCommand', () => {
      const content = readFileSync(devcontainerPath, 'utf-8');
      expect(content).toContain('post-create.sh');
    });
  });
});
