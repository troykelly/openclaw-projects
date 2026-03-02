/**
 * Tests for Sentry environment variable documentation (#2004)
 *
 * Validates:
 * - .env.example has Sentry section
 * - docker-compose files pass Sentry env vars
 * - Each service has correct SENTRY_SERVER_NAME
 * - Traefik dynamic config allows sentry-trace and baggage headers
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');

describe('.env.example — Sentry section', () => {
  let envExample: string;

  beforeAll(() => {
    envExample = readFileSync(resolve(ROOT, '.env.example'), 'utf-8');
  });

  it('should have an Error Tracking section header', () => {
    expect(envExample).toMatch(/Error Tracking.*Sentry.*GlitchTip/i);
  });

  it('should document SENTRY_DSN', () => {
    expect(envExample).toContain('SENTRY_DSN');
  });

  it('should document SENTRY_ENVIRONMENT', () => {
    expect(envExample).toContain('SENTRY_ENVIRONMENT');
  });

  it('should document SENTRY_TRACES_SAMPLE_RATE', () => {
    expect(envExample).toContain('SENTRY_TRACES_SAMPLE_RATE');
  });

  it('should document SENTRY_SAMPLE_RATE', () => {
    expect(envExample).toContain('SENTRY_SAMPLE_RATE');
  });

  it('should document SENTRY_DEBUG', () => {
    expect(envExample).toContain('SENTRY_DEBUG');
  });

  it('should document VITE_SENTRY_DSN (build-time)', () => {
    expect(envExample).toContain('VITE_SENTRY_DSN');
  });

  it('should document VITE_SENTRY_ENVIRONMENT (build-time)', () => {
    expect(envExample).toContain('VITE_SENTRY_ENVIRONMENT');
  });

  it('should document VITE_SENTRY_TRACES_SAMPLE_RATE (build-time)', () => {
    expect(envExample).toContain('VITE_SENTRY_TRACES_SAMPLE_RATE');
  });

  it('should clearly separate runtime vs build-time variables', () => {
    expect(envExample).toMatch(/runtime/i);
    expect(envExample).toMatch(/build.time/i);
  });
});

const COMPOSE_FILES = [
  'docker-compose.yml',
  'docker-compose.traefik.yml',
  'docker-compose.full.yml',
  'docker-compose.quickstart.yml',
];

describe.each(COMPOSE_FILES)('%s — Sentry env vars', (composeFile) => {
  let content: string;

  beforeAll(() => {
    content = readFileSync(resolve(ROOT, composeFile), 'utf-8');
  });

  it('should pass SENTRY_DSN to the api service', () => {
    const apiSection = extractServiceSection(content, 'api');
    if (apiSection) {
      expect(apiSection).toContain('SENTRY_DSN');
    }
  });

  it('should pass SENTRY_ENVIRONMENT to the api service', () => {
    const apiSection = extractServiceSection(content, 'api');
    if (apiSection) {
      expect(apiSection).toContain('SENTRY_ENVIRONMENT');
    }
  });

  it('should set SENTRY_SERVER_NAME for the api service', () => {
    const apiSection = extractServiceSection(content, 'api');
    if (apiSection) {
      expect(apiSection).toContain('SENTRY_SERVER_NAME');
      expect(apiSection).toMatch(/SENTRY_SERVER_NAME.*api/);
    }
  });

  if (composeFile !== 'docker-compose.quickstart.yml') {
    it('should pass SENTRY_DSN to the worker service', () => {
      const workerSection = extractServiceSection(content, 'worker');
      if (workerSection) {
        expect(workerSection).toContain('SENTRY_DSN');
      }
    });

    it('should set SENTRY_SERVER_NAME for the worker service', () => {
      const workerSection = extractServiceSection(content, 'worker');
      if (workerSection) {
        expect(workerSection).toContain('SENTRY_SERVER_NAME');
        expect(workerSection).toMatch(/SENTRY_SERVER_NAME.*worker/);
      }
    });
  }
});

describe('Traefik dynamic config — CORS headers for distributed tracing', () => {
  let traefikConfig: string;

  beforeAll(() => {
    traefikConfig = readFileSync(
      resolve(ROOT, 'docker/traefik/dynamic-config.yml.template'),
      'utf-8',
    );
  });

  it('should allow sentry-trace header in CORS config', () => {
    expect(traefikConfig).toContain('sentry-trace');
  });

  it('should allow baggage header in CORS config', () => {
    expect(traefikConfig).toContain('baggage');
  });
});

/**
 * Extract a docker-compose service section by name.
 * Crude YAML extraction: finds `  <name>:` and reads until the next
 * top-level service key or end of services block.
 */
function extractServiceSection(
  content: string,
  serviceName: string,
): string | null {
  const serviceRegex = new RegExp(
    `^  ${serviceName}:\\s*$`,
    'm',
  );
  const match = serviceRegex.exec(content);
  if (!match) return null;

  const startIndex = match.index;
  const rest = content.slice(startIndex + match[0].length);
  const nextServiceMatch = rest.match(/^  \S+:/m);
  const endIndex = nextServiceMatch
    ? startIndex + match[0].length + nextServiceMatch.index!
    : content.length;

  return content.slice(startIndex, endIndex);
}
