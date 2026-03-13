/**
 * Tests for Sentry source map CI integration (#2003)
 *
 * Validates:
 * - vite.config.ts conditional @sentry/vite-plugin usage
 * - docker/app/Dockerfile Sentry build ARGs
 * - release.yml Sentry release finalization
 * - Source map deletion safety net in Dockerfile
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');

describe('Vite config — @sentry/vite-plugin', () => {
  let viteConfig: string;

  beforeAll(() => {
    viteConfig = readFileSync(resolve(ROOT, 'vite.config.ts'), 'utf-8');
  });

  it('should import sentryVitePlugin', () => {
    expect(viteConfig).toContain("from '@sentry/vite-plugin'");
  });

  it('should conditionally include plugin when SENTRY_AUTH_TOKEN is set', () => {
    expect(viteConfig).toContain('process.env.SENTRY_AUTH_TOKEN');
    expect(viteConfig).toContain('sentryVitePlugin');
  });

  it('should configure org, project, authToken, and url from env vars', () => {
    expect(viteConfig).toContain('process.env.SENTRY_ORG');
    expect(viteConfig).toContain('process.env.SENTRY_PROJECT');
    expect(viteConfig).toContain('process.env.SENTRY_AUTH_TOKEN');
    expect(viteConfig).toContain('process.env.SENTRY_URL');
  });

  it('should set release name to getAppVersion()', () => {
    expect(viteConfig).toMatch(/release:\s*\{\s*name:\s*getAppVersion\(\)/);
  });

  it('should configure filesToDeleteAfterUpload for .map files', () => {
    expect(viteConfig).toContain('filesToDeleteAfterUpload');
    expect(viteConfig).toContain('**/*.map');
  });

  it('should place sentry plugin after react() and tailwindcss()', () => {
    const reactIndex = viteConfig.indexOf('react()');
    const tailwindIndex = viteConfig.indexOf('tailwindcss()');
    const sentryIndex = viteConfig.indexOf('sentryVitePlugin(');
    expect(reactIndex).toBeLessThan(sentryIndex);
    expect(tailwindIndex).toBeLessThan(sentryIndex);
  });
});

describe('docker/app/Dockerfile — Sentry build config', () => {
  let dockerfile: string;

  beforeAll(() => {
    dockerfile = readFileSync(resolve(ROOT, 'docker/app/Dockerfile'), 'utf-8');
  });

  it('should accept VITE_SENTRY_DSN as build ARG', () => {
    expect(dockerfile).toContain('ARG VITE_SENTRY_DSN');
  });

  it('should accept VITE_SENTRY_ENVIRONMENT as build ARG', () => {
    expect(dockerfile).toContain('ARG VITE_SENTRY_ENVIRONMENT');
  });

  it('should accept VITE_SENTRY_RELEASE as build ARG', () => {
    expect(dockerfile).toContain('ARG VITE_SENTRY_RELEASE');
  });

  it('should receive SENTRY_AUTH_TOKEN via BuildKit secret mount (not ARG)', () => {
    expect(dockerfile).not.toContain('ARG SENTRY_AUTH_TOKEN');
    expect(dockerfile).toContain('--mount=type=secret,id=sentry_auth_token');
    expect(dockerfile).toContain('/run/secrets/sentry_auth_token');
  });

  it('should accept SENTRY_ORG as build ARG', () => {
    expect(dockerfile).toContain('ARG SENTRY_ORG');
  });

  it('should accept SENTRY_PROJECT as build ARG', () => {
    expect(dockerfile).toContain('ARG SENTRY_PROJECT');
  });

  it('should accept SENTRY_URL as build ARG', () => {
    expect(dockerfile).toContain('ARG SENTRY_URL');
  });

  it('should have safety-net deletion of .map files', () => {
    expect(dockerfile).toMatch(/find.*\.map.*-delete/);
  });

  it('should have safety-net .map deletion after the COPY from builder', () => {
    // The safety-net RUN find ... -delete should appear after the COPY --from=builder
    const copyIndex = dockerfile.indexOf('COPY --from=builder /app/src/api/static/app');
    // Look for the find+delete pattern that appears in the runtime stage
    const findDeleteMatch = dockerfile.match(/find.*\/usr\/share\/nginx\/html.*\.map.*-delete/);
    expect(copyIndex).toBeGreaterThan(-1);
    expect(findDeleteMatch).not.toBeNull();
    expect(findDeleteMatch!.index!).toBeGreaterThan(copyIndex);
  });
});

describe('release.yml — Sentry release finalization', () => {
  let releaseYml: string;

  beforeAll(() => {
    releaseYml = readFileSync(
      resolve(ROOT, '.github/workflows/release.yml'),
      'utf-8',
    );
  });

  it('should pass Sentry config for the app image build', () => {
    // SENTRY_AUTH_TOKEN is now passed as a BuildKit secret, not a build-arg
    expect(releaseYml).toContain('sentry_auth_token');
    expect(releaseYml).toContain('SENTRY_ORG');
    expect(releaseYml).toContain('SENTRY_PROJECT');
    expect(releaseYml).toContain('SENTRY_URL');
    expect(releaseYml).toContain('VITE_SENTRY_DSN');
  });

  it('should have a sentry release finalization step', () => {
    expect(releaseYml).toContain('sentry-cli releases new');
    expect(releaseYml).toContain('sentry-cli releases set-commits');
    expect(releaseYml).toContain('sentry-cli releases finalize');
  });

  it('should make sentry finalization conditional on SENTRY_AUTH_TOKEN', () => {
    expect(releaseYml).toMatch(/SENTRY_AUTH_TOKEN/);
  });
});
