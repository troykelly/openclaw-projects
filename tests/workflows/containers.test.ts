/**
 * Tests for containers.yml GitHub Actions workflow
 * Validates workflow structure, triggers, matrix configuration, and required steps
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parse } from 'yaml';
import { join } from 'node:path';

const WORKFLOW_PATH = join(import.meta.dirname, '../../.github/workflows/containers.yml');

interface WorkflowJob {
  name?: string;
  'runs-on': string;
  permissions?: Record<string, string>;
  strategy?: {
    matrix: {
      image: Array<{
        name: string;
        context: string;
        dockerfile: string;
      }>;
    };
    'fail-fast'?: boolean;
  };
  steps: Array<{
    name?: string;
    uses?: string;
    with?: Record<string, unknown>;
    env?: Record<string, string>;
    if?: string;
    run?: string;
  }>;
  needs?: string | string[];
}

interface Workflow {
  name: string;
  on: {
    push?: {
      branches?: string[];
      tags?: string[];
    };
    pull_request?: {
      branches?: string[];
    };
  };
  permissions?: Record<string, string>;
  jobs: Record<string, WorkflowJob>;
}

describe('containers.yml workflow', () => {
  let workflow: Workflow;

  beforeAll(() => {
    expect(existsSync(WORKFLOW_PATH)).toBe(true);
    const content = readFileSync(WORKFLOW_PATH, 'utf-8');
    workflow = parse(content) as Workflow;
  });

  describe('workflow metadata', () => {
    it('should have a descriptive name', () => {
      expect(workflow.name).toBeDefined();
      expect(workflow.name.toLowerCase()).toContain('container');
    });
  });

  describe('triggers', () => {
    it('should trigger on push to main branch', () => {
      expect(workflow.on.push?.branches).toContain('main');
    });

    it('should trigger on semver tags (v*.*.*)', () => {
      expect(workflow.on.push?.tags).toBeDefined();
      const tags = workflow.on.push?.tags ?? [];
      expect(tags.some((t) => t.includes('v'))).toBe(true);
    });

    it('should trigger on pull requests', () => {
      expect(workflow.on.pull_request).toBeDefined();
    });
  });

  describe('permissions', () => {
    it('should have packages: write permission for pushing to ghcr.io', () => {
      // Check top-level or job-level permissions
      const topLevelPerms = workflow.permissions?.packages;
      const buildJob = workflow.jobs.build;
      const jobPerms = buildJob?.permissions?.packages;

      expect(topLevelPerms === 'write' || jobPerms === 'write').toBe(true);
    });

    it('should have contents: read permission', () => {
      const topLevelPerms = workflow.permissions?.contents;
      const buildJob = workflow.jobs.build;
      const jobPerms = buildJob?.permissions?.contents;

      expect(topLevelPerms === 'read' || jobPerms === 'read').toBe(true);
    });
  });

  describe('build job', () => {
    it('should have a build job', () => {
      expect(workflow.jobs.build).toBeDefined();
    });

    it('should use ubuntu-latest runner', () => {
      expect(workflow.jobs.build['runs-on']).toBe('ubuntu-latest');
    });

    describe('matrix strategy', () => {
      it('should define matrix strategy for all 6 images', () => {
        const matrix = workflow.jobs.build.strategy?.matrix;
        expect(matrix).toBeDefined();
        expect(matrix?.image).toHaveLength(6);
      });

      it('should include db image with correct dockerfile path', () => {
        const matrix = workflow.jobs.build.strategy?.matrix;
        const db = matrix?.image.find((i) => i.name === 'db');
        expect(db).toBeDefined();
        expect(db?.dockerfile).toBe('docker/postgres/Dockerfile');
      });

      it('should include api image with correct dockerfile path', () => {
        const matrix = workflow.jobs.build.strategy?.matrix;
        const api = matrix?.image.find((i) => i.name === 'api');
        expect(api).toBeDefined();
        expect(api?.dockerfile).toBe('docker/api/Dockerfile');
      });

      it('should include app image with correct dockerfile path', () => {
        const matrix = workflow.jobs.build.strategy?.matrix;
        const app = matrix?.image.find((i) => i.name === 'app');
        expect(app).toBeDefined();
        expect(app?.dockerfile).toBe('docker/app/Dockerfile');
      });

      it('should include migrate image with correct dockerfile path', () => {
        const matrix = workflow.jobs.build.strategy?.matrix;
        const migrate = matrix?.image.find((i) => i.name === 'migrate');
        expect(migrate).toBeDefined();
        expect(migrate?.dockerfile).toBe('docker/migrate/Dockerfile');
      });

      it('should include worker image with correct dockerfile path', () => {
        const matrix = workflow.jobs.build.strategy?.matrix;
        const worker = matrix?.image.find((i) => i.name === 'worker');
        expect(worker).toBeDefined();
        expect(worker?.dockerfile).toBe('docker/worker/Dockerfile');
      });

      it('should include prompt-guard image with correct dockerfile path', () => {
        const matrix = workflow.jobs.build.strategy?.matrix;
        const promptGuard = matrix?.image.find((i) => i.name === 'prompt-guard');
        expect(promptGuard).toBeDefined();
        expect(promptGuard?.dockerfile).toBe('docker/prompt-guard/Dockerfile');
      });

      it('should not use fail-fast (allow other images to build if one fails)', () => {
        const failFast = workflow.jobs.build.strategy?.['fail-fast'];
        expect(failFast).toBe(false);
      });
    });

    describe('required steps', () => {
      let steps: WorkflowJob['steps'];

      beforeAll(() => {
        steps = workflow.jobs.build.steps;
      });

      it('should checkout code', () => {
        const checkout = steps.find((s) => s.uses?.includes('actions/checkout'));
        expect(checkout).toBeDefined();
      });

      it('should setup QEMU for multi-arch builds', () => {
        const qemu = steps.find((s) => s.uses?.includes('docker/setup-qemu-action'));
        expect(qemu).toBeDefined();
      });

      it('should setup BuildKit (buildx)', () => {
        const buildx = steps.find((s) => s.uses?.includes('docker/setup-buildx-action'));
        expect(buildx).toBeDefined();
      });

      it('should login to ghcr.io', () => {
        const login = steps.find((s) => s.uses?.includes('docker/login-action'));
        expect(login).toBeDefined();
        expect(login?.with?.registry).toBe('ghcr.io');
      });

      it('should use metadata-action for OCI labels and tags', () => {
        const metadata = steps.find((s) => s.uses?.includes('docker/metadata-action'));
        expect(metadata).toBeDefined();
      });

      it('should use build-push-action for building images', () => {
        const build = steps.find((s) => s.uses?.includes('docker/build-push-action'));
        expect(build).toBeDefined();
      });

      it('should use Trivy for vulnerability scanning', () => {
        const trivy = steps.find((s) => s.uses?.includes('aquasecurity/trivy-action'));
        expect(trivy).toBeDefined();
      });

      it('should configure Trivy to be informational (exit-code 0) to allow builds with base image vulnerabilities', () => {
        const trivy = steps.find((s) => s.uses?.includes('aquasecurity/trivy-action'));
        const exitCode = String(trivy?.with?.['exit-code'] ?? '');
        // Exit code 0 = informational only (base images may have unfixable vulnerabilities)
        expect(exitCode === '0' || exitCode.includes("'0'")).toBe(true);
        const severity = String(trivy?.with?.severity ?? '').toUpperCase();
        expect(severity).toContain('CRITICAL');
        expect(severity).toContain('HIGH');
      });
    });

    describe('multi-arch configuration', () => {
      it('should build for linux/amd64 and linux/arm64', () => {
        const build = workflow.jobs.build.steps.find((s) => s.uses?.includes('docker/build-push-action'));
        const platforms = String(build?.with?.platforms ?? '');
        expect(platforms).toContain('linux/amd64');
        expect(platforms).toContain('linux/arm64');
      });
    });

    describe('caching configuration', () => {
      it('should use GitHub Actions cache for BuildKit', () => {
        const build = workflow.jobs.build.steps.find((s) => s.uses?.includes('docker/build-push-action'));
        const cacheFrom = String(build?.with?.['cache-from'] ?? '');
        const cacheTo = String(build?.with?.['cache-to'] ?? '');
        expect(cacheFrom).toContain('type=gha');
        expect(cacheTo).toContain('type=gha');
      });
    });

    describe('tag strategy', () => {
      it('should configure metadata-action with correct tag types', () => {
        const metadata = workflow.jobs.build.steps.find((s) => s.uses?.includes('docker/metadata-action'));
        const tags = String(metadata?.with?.tags ?? '');

        // Edge tag for main branch
        expect(tags).toContain('type=edge');

        // Semver tags
        expect(tags).toContain('type=semver');
      });

      it('should include SHA tag for traceability', () => {
        const metadata = workflow.jobs.build.steps.find((s) => s.uses?.includes('docker/metadata-action'));
        const tags = String(metadata?.with?.tags ?? '');
        expect(tags).toContain('type=sha');
      });
    });

    describe('push conditions', () => {
      it('should only push on non-PR events', () => {
        const build = workflow.jobs.build.steps.find((s) => s.uses?.includes('docker/build-push-action'));
        const push = String(build?.with?.push ?? '');
        // Should be a conditional that prevents push on PRs
        expect(push).toContain('pull_request');
      });
    });

    describe('SBOM generation', () => {
      it('should generate SBOM attestation', () => {
        const build = workflow.jobs.build.steps.find((s) => s.uses?.includes('docker/build-push-action'));
        // SBOM can be enabled via sbom: true or via provenance/attestations
        const sbom = build?.with?.sbom;
        const attestations = build?.with?.attestations;
        expect(sbom === true || sbom === 'true' || attestations).toBeTruthy();
      });
    });

    describe('registry configuration', () => {
      it('should push to ghcr.io/troykelly/openclaw-projects-{name}', () => {
        const metadata = workflow.jobs.build.steps.find((s) => s.uses?.includes('docker/metadata-action'));
        const images = String(metadata?.with?.images ?? '');
        expect(images).toContain('ghcr.io/troykelly/openclaw-projects-');
      });
    });
  });
});
