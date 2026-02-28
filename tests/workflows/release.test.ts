/**
 * Tests for release.yml GitHub Actions workflow
 * Validates workflow structure, version bump, publish jobs, and release configuration
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parse } from 'yaml';
import { join } from 'node:path';

const WORKFLOW_PATH = join(import.meta.dirname, '../../.github/workflows/release.yml');

interface WorkflowStep {
  name?: string;
  id?: string;
  uses?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
  if?: string;
  run?: string;
}

interface WorkflowJob {
  name?: string;
  'runs-on': string;
  permissions?: Record<string, string>;
  environment?: string;
  outputs?: Record<string, string>;
  strategy?: {
    matrix: Record<string, unknown>;
    'fail-fast'?: boolean;
  };
  steps: WorkflowStep[];
  needs?: string | string[];
}

interface Workflow {
  name: string;
  on: {
    push?: {
      tags?: string[];
    };
  };
  concurrency?: {
    group: string;
    'cancel-in-progress': boolean;
  };
  permissions?: Record<string, string>;
  jobs: Record<string, WorkflowJob>;
}

describe('release.yml workflow', () => {
  let workflow: Workflow;

  beforeAll(() => {
    expect(existsSync(WORKFLOW_PATH)).toBe(true);
    const content = readFileSync(WORKFLOW_PATH, 'utf-8');
    workflow = parse(content) as Workflow;
  });

  describe('workflow metadata', () => {
    it('should have a name', () => {
      expect(workflow.name).toBeDefined();
    });

    it('should trigger on version tags', () => {
      expect(workflow.on.push?.tags).toContain('v*.*.*');
    });

    it('should use release concurrency group to serialize releases', () => {
      expect(workflow.concurrency?.group).toBe('release');
      expect(workflow.concurrency?.['cancel-in-progress']).toBe(false);
    });

    it('should have empty top-level permissions', () => {
      expect(workflow.permissions).toEqual({});
    });
  });

  describe('job structure', () => {
    it('should have validate, test, publish-npm, publish-github-packages, publish-containers, and release jobs', () => {
      expect(workflow.jobs.validate).toBeDefined();
      expect(workflow.jobs.test).toBeDefined();
      expect(workflow.jobs['publish-npm']).toBeDefined();
      expect(workflow.jobs['publish-github-packages']).toBeDefined();
      expect(workflow.jobs['publish-containers']).toBeDefined();
      expect(workflow.jobs.release).toBeDefined();
    });

    it('should have release job depend on all publish jobs', () => {
      const needs = workflow.jobs.release.needs;
      const needsArray = Array.isArray(needs) ? needs : [needs];
      expect(needsArray).toContain('validate');
      expect(needsArray).toContain('publish-npm');
      expect(needsArray).toContain('publish-github-packages');
      expect(needsArray).toContain('publish-containers');
    });
  });

  describe('validate job', () => {
    it('should have contents: write permission for version bump commit', () => {
      expect(workflow.jobs.validate.permissions?.contents).toBe('write');
    });

    it('should checkout main branch (not the tag) for version bump', () => {
      const checkout = workflow.jobs.validate.steps.find((s) =>
        s.uses?.includes('actions/checkout')
      );
      expect(checkout?.with?.ref).toBe('main');
    });

    it('should not persist checkout credentials (minimize PAT exposure)', () => {
      const checkout = workflow.jobs.validate.steps.find((s) =>
        s.uses?.includes('actions/checkout')
      );
      expect(checkout?.with?.['persist-credentials']).toBe(false);
    });

    it('should use REPO_PAT in commit step to bypass branch protection on push', () => {
      const step = workflow.jobs.validate.steps.find((s) =>
        s.name?.toLowerCase().includes('commit version bump')
      );
      const env = step?.env ?? {};
      expect(JSON.stringify(env)).toContain('REPO_PAT');
    });

    it('should extract version from tag', () => {
      const step = workflow.jobs.validate.steps.find((s) =>
        s.name?.toLowerCase().includes('extract')
      );
      expect(step).toBeDefined();
    });

    it('should install pnpm for lockfile update', () => {
      const pnpmStep = workflow.jobs.validate.steps.find((s) =>
        s.uses?.includes('pnpm/action-setup')
      );
      expect(pnpmStep).toBeDefined();
    });

    it('should bump version in all package files', () => {
      const step = workflow.jobs.validate.steps.find((s) =>
        s.name?.toLowerCase().includes('bump version')
      );
      expect(step).toBeDefined();
      const run = step?.run ?? '';
      expect(run).toContain('package.json');
      expect(run).toContain('packages/openclaw-plugin/package.json');
      expect(run).toContain('packages/openclaw-plugin/openclaw.plugin.json');
    });

    it('should update lockfile after version bump', () => {
      const step = workflow.jobs.validate.steps.find((s) =>
        s.name?.toLowerCase().includes('bump version')
      );
      const run = step?.run ?? '';
      expect(run).toContain('pnpm install --lockfile-only');
    });

    it('should commit version bump to main with [skip ci]', () => {
      const step = workflow.jobs.validate.steps.find((s) =>
        s.name?.toLowerCase().includes('commit version bump')
      );
      expect(step).toBeDefined();
      const run = step?.run ?? '';
      expect(run).toContain('[skip ci]');
      expect(run).toContain('git push origin main');
    });

    it('should skip commit if versions already match', () => {
      const step = workflow.jobs.validate.steps.find((s) =>
        s.name?.toLowerCase().includes('commit version bump')
      );
      const run = step?.run ?? '';
      expect(run).toContain('git diff --quiet');
    });

    it('should determine release type (prerelease vs stable)', () => {
      const step = workflow.jobs.validate.steps.find((s) =>
        s.name?.toLowerCase().includes('release type')
      );
      expect(step).toBeDefined();
    });

    it('should output version, tag, prerelease, npm_tag, and docker_latest', () => {
      const outputs = workflow.jobs.validate.outputs;
      expect(outputs).toBeDefined();
      expect(outputs?.version).toBeDefined();
      expect(outputs?.tag).toBeDefined();
      expect(outputs?.prerelease).toBeDefined();
      expect(outputs?.npm_tag).toBeDefined();
      expect(outputs?.docker_latest).toBeDefined();
    });
  });

  describe('release job', () => {
    let releaseSteps: WorkflowStep[];

    beforeAll(() => {
      releaseSteps = workflow.jobs.release.steps;
    });

    it('should have contents: write permission', () => {
      expect(workflow.jobs.release.permissions?.contents).toBe('write');
    });

    it('should checkout code', () => {
      const checkout = releaseSteps.find((s) => s.uses?.includes('actions/checkout'));
      expect(checkout).toBeDefined();
    });

    it('should generate versioned compose files', () => {
      const step = releaseSteps.find((s) => s.name?.toLowerCase().includes('versioned compose'));
      expect(step).toBeDefined();
    });

    it('should validate generated compose files', () => {
      const step = releaseSteps.find((s) => s.name?.toLowerCase().includes('validate'));
      expect(step).toBeDefined();
    });

    it('should create codebase tarball', () => {
      const step = releaseSteps.find((s) => s.name?.toLowerCase().includes('tarball'));
      expect(step).toBeDefined();
    });

    it('should generate release body', () => {
      const step = releaseSteps.find((s) => s.name?.toLowerCase().includes('release body'));
      expect(step).toBeDefined();
    });

    describe('draft-then-undraft pattern', () => {
      it('should create GitHub Release as a draft', () => {
        const releaseStep = releaseSteps.find((s) =>
          s.uses?.includes('softprops/action-gh-release')
        );
        expect(releaseStep).toBeDefined();
        expect(releaseStep?.with?.draft).toBe(true);
      });

      it('should use SHA-pinned softprops/action-gh-release', () => {
        const releaseStep = releaseSteps.find((s) =>
          s.uses?.includes('softprops/action-gh-release')
        );
        const sha = releaseStep?.uses?.split('@')[1];
        expect(sha).toMatch(/^[a-f0-9]{40}$/);
      });

      it('should have the release step produce an output with the release id', () => {
        const releaseStep = releaseSteps.find((s) =>
          s.uses?.includes('softprops/action-gh-release')
        );
        expect(releaseStep?.id).toBeDefined();
      });

      it('should have an undraft step after the release creation step', () => {
        const releaseStepIndex = releaseSteps.findIndex((s) =>
          s.uses?.includes('softprops/action-gh-release')
        );
        const undraftStep = releaseSteps.find(
          (s, i) => i > releaseStepIndex && s.name?.toLowerCase().includes('undraft')
        );
        expect(undraftStep).toBeDefined();
      });

      it('should undraft using gh CLI', () => {
        const undraftStep = releaseSteps.find((s) =>
          s.name?.toLowerCase().includes('undraft')
        );
        expect(undraftStep).toBeDefined();
        const run = undraftStep?.run ?? '';
        expect(run).toContain('gh release edit');
      });

      it('should only undraft if previous steps succeeded (no if: failure())', () => {
        const undraftStep = releaseSteps.find((s) =>
          s.name?.toLowerCase().includes('undraft')
        );
        const ifCondition = undraftStep?.if ?? '';
        expect(ifCondition).not.toContain('failure()');
        expect(ifCondition).not.toContain('always()');
      });
    });
  });

  describe('publish jobs', () => {
    it('should require release environment for all publish jobs', () => {
      expect(workflow.jobs['publish-npm'].environment).toBe('release');
      expect(workflow.jobs['publish-github-packages'].environment).toBe('release');
      expect(workflow.jobs['publish-containers'].environment).toBe('release');
    });

    it('should publish npm with provenance (id-token: write)', () => {
      expect(workflow.jobs['publish-npm'].permissions?.['id-token']).toBe('write');
    });

    it('should publish containers with matrix for all 8 images', () => {
      const matrix = workflow.jobs['publish-containers'].strategy?.matrix;
      const images = matrix?.image as Array<{ name: string }>;
      expect(images).toHaveLength(8);
      const names = images.map((i) => i.name);
      expect(names).toContain('db');
      expect(names).toContain('api');
      expect(names).toContain('app');
      expect(names).toContain('migrate');
      expect(names).toContain('worker');
      expect(names).toContain('ha-connector');
      expect(names).toContain('prompt-guard');
      expect(names).toContain('tmux-worker');
    });
  });
});
