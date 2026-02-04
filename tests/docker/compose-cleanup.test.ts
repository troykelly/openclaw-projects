import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parse } from 'yaml';

const ROOT_DIR = resolve(__dirname, '../..');
const COMPOSE_PATH = resolve(ROOT_DIR, 'docker-compose.yml');
const COMPOSE_PROD_PATH = resolve(ROOT_DIR, 'docker-compose.prod.yml');
const PACKAGE_JSON_PATH = resolve(ROOT_DIR, 'package.json');
const OPS_README_PATH = resolve(ROOT_DIR, 'ops/README.md');
const DEVCONTAINER_COMPOSE_PATH = resolve(ROOT_DIR, '.devcontainer/docker-compose.devcontainer.yml');

interface PackageJson {
  scripts?: Record<string, string>;
}

interface ComposeFile {
  name?: string;
  services: Record<string, unknown>;
  volumes?: Record<string, unknown>;
}

describe('docker-compose.prod.yml removal', () => {
  it('docker-compose.prod.yml should not exist', () => {
    expect(existsSync(COMPOSE_PROD_PATH)).toBe(false);
  });

  it('docker-compose.yml should exist', () => {
    expect(existsSync(COMPOSE_PATH)).toBe(true);
  });
});

describe('docker-compose.yml is production compose', () => {
  let compose: ComposeFile;

  beforeAll(() => {
    const content = readFileSync(COMPOSE_PATH, 'utf-8');
    compose = parse(content) as ComposeFile;
  });

  it('uses published images from ghcr.io', () => {
    // Verify it uses published images, not local builds
    const services = compose.services as Record<string, { image?: string; build?: unknown }>;
    expect(services.db?.image).toMatch(/^ghcr\.io\/troykelly/);
    expect(services.api?.image).toMatch(/^ghcr\.io\/troykelly/);
    expect(services.app?.image).toMatch(/^ghcr\.io\/troykelly/);
    expect(services.migrate?.image).toMatch(/^ghcr\.io\/troykelly/);
  });

  it('has all required services', () => {
    expect(compose.services.db).toBeDefined();
    expect(compose.services.api).toBeDefined();
    expect(compose.services.app).toBeDefined();
    expect(compose.services.seaweedfs).toBeDefined();
    expect(compose.services.migrate).toBeDefined();
  });
});

describe('package.json scripts use devcontainer compose', () => {
  let packageJson: PackageJson;

  beforeAll(() => {
    const content = readFileSync(PACKAGE_JSON_PATH, 'utf-8');
    packageJson = JSON.parse(content) as PackageJson;
  });

  it('devcontainer compose file exists', () => {
    expect(existsSync(DEVCONTAINER_COMPOSE_PATH)).toBe(true);
  });

  it('db:up references devcontainer compose', () => {
    const dbUp = packageJson.scripts?.['db:up'];
    expect(dbUp).toBeDefined();
    expect(dbUp).toContain('.devcontainer/docker-compose.devcontainer.yml');
    expect(dbUp).not.toContain('docker-compose.prod');
  });

  it('db:down references devcontainer compose', () => {
    const dbDown = packageJson.scripts?.['db:down'];
    expect(dbDown).toBeDefined();
    expect(dbDown).toContain('.devcontainer/docker-compose.devcontainer.yml');
    expect(dbDown).not.toContain('docker-compose.prod');
  });
});

describe('documentation updates', () => {
  it('ops/README.md should not reference docker-compose.prod.yml', () => {
    const content = readFileSync(OPS_README_PATH, 'utf-8');
    expect(content).not.toContain('docker-compose.prod.yml');
  });

  it('ops/README.md should reference docker-compose.yml as production compose', () => {
    const content = readFileSync(OPS_README_PATH, 'utf-8');
    // Should reference the new compose file
    expect(content).toContain('docker-compose.yml');
    // Should mention production deployment with docker compose
    expect(content).toMatch(/docker\s+compose\s+up/i);
  });
});
