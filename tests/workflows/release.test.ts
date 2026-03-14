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

    // #2524 — compose files must be updated in version bump
    it('should update compose file image tags during version bump', () => {
      const step = workflow.jobs.validate.steps.find((s) =>
        s.name?.toLowerCase().includes('update compose')
      );
      expect(step).toBeDefined();
      const run = step?.run ?? '';
      // Must update all 4 production compose files
      expect(run).toContain('docker-compose.yml');
      expect(run).toContain('docker-compose.traefik.yml');
      expect(run).toContain('docker-compose.quickstart.yml');
      expect(run).toContain('docker-compose.full.yml');
      // Must use the correct sed pattern for project images only
      expect(run).toContain('ghcr.io/troykelly/openclaw-projects-');
      // Must NOT touch devcontainer or test compose files
      expect(run).not.toContain('docker-compose.devcontainer.yml');
      expect(run).not.toContain('docker-compose.test.yml');
    });

    // #2524 — compose files must be included in git add
    it('should include compose files in version bump commit', () => {
      const step = workflow.jobs.validate.steps.find((s) =>
        s.name?.toLowerCase().includes('commit version bump')
      );
      const run = step?.run ?? '';
      expect(run).toContain('docker-compose.yml');
      expect(run).toContain('docker-compose.traefik.yml');
      expect(run).toContain('docker-compose.quickstart.yml');
      expect(run).toContain('docker-compose.full.yml');
    });

    // #2524 — compose files must be in artifact upload
    it('should include compose files in version-bumped-files artifact', () => {
      const step = workflow.jobs.validate.steps.find((s) =>
        s.name?.toLowerCase().includes('upload bumped')
      );
      expect(step).toBeDefined();
      const path = String(step?.with?.path ?? '');
      expect(path).toContain('docker-compose.yml');
      expect(path).toContain('docker-compose.traefik.yml');
      expect(path).toContain('docker-compose.quickstart.yml');
      expect(path).toContain('docker-compose.full.yml');
    });

    // #2524 — post-sed validation for compose files
    it('should validate compose files after version bump sed replacement', () => {
      const steps = workflow.jobs.validate.steps;
      const sedStepIdx = steps.findIndex((s) =>
        s.name?.toLowerCase().includes('update compose')
      );
      const validationStep = steps.find(
        (s, i) => i > sedStepIdx && s.name?.toLowerCase().includes('validate compose')
      );
      expect(validationStep).toBeDefined();
      const run = validationStep?.run ?? '';
      // Should verify no :edge references remain in production compose files
      expect(run).toContain(':edge');
    });

    // #2525 — re-entrancy guard using commit message check
    it('should have a re-entrancy guard that checks commit message', () => {
      const step = workflow.jobs.validate.steps.find((s) =>
        s.name?.toLowerCase().includes('re-entrancy') ||
        s.name?.toLowerCase().includes('reentranc')
      );
      expect(step).toBeDefined();
      const run = step?.run ?? '';
      // Must check commit message for chore(release) pattern, not draft release
      expect(run).toContain('chore');
      expect(run).toContain('release');
      // Must read the commit message
      expect(run).toContain('git log');
    });

    // #2525 — tag re-pointing to version bump commit
    it('should re-point tag to version bump commit', () => {
      const step = workflow.jobs.validate.steps.find((s) =>
        s.name?.toLowerCase().includes('re-point tag') ||
        s.name?.toLowerCase().includes('move tag')
      );
      expect(step).toBeDefined();
      const run = step?.run ?? '';
      expect(run).toContain('git tag -f');
      expect(run).toContain('git push');
      expect(run).toContain('--force');
    });

    // #2525 — tag must use captured SHA, not HEAD~1
    it('should capture version bump SHA explicitly for tag re-pointing', () => {
      const step = workflow.jobs.validate.steps.find((s) =>
        s.name?.toLowerCase().includes('commit version bump')
      );
      const run = step?.run ?? '';
      // Must capture SHA explicitly
      expect(run).toContain('VERSION_BUMP_SHA');
    });

    // #2525/#2526 — no step should use HEAD~1 as a git ref (comments are ok)
    it('should not use HEAD~1 as a git ref in any step', () => {
      const steps = workflow.jobs.validate.steps;
      for (const step of steps) {
        const run = step.run ?? '';
        // Check for HEAD~1 used as an actual git command argument, not in comments
        const lines = run.split('\n').filter((l) => !l.trimStart().startsWith('#'));
        const codeOnly = lines.join('\n');
        expect(codeOnly).not.toContain('HEAD~1');
      }
    });

    // #2525 — output version_bump_sha for other steps
    it('should output version_bump_sha', () => {
      const outputs = workflow.jobs.validate.outputs;
      expect(outputs?.version_bump_sha).toBeDefined();
    });

    // #2526 — restore compose files to :edge after version bump
    it('should restore compose files to :edge after tagging', () => {
      const step = workflow.jobs.validate.steps.find((s) =>
        s.name?.toLowerCase().includes('restore') && s.name?.toLowerCase().includes('edge')
      );
      expect(step).toBeDefined();
      const run = step?.run ?? '';
      expect(run).toContain(':edge');
      expect(run).toContain('docker-compose.yml');
      expect(run).toContain('docker-compose.traefik.yml');
      expect(run).toContain('docker-compose.quickstart.yml');
      expect(run).toContain('docker-compose.full.yml');
    });

    // #2526 — restore commit message
    it('should use correct commit message for edge restore', () => {
      const step = workflow.jobs.validate.steps.find((s) =>
        s.name?.toLowerCase().includes('restore') && s.name?.toLowerCase().includes('edge')
      );
      const run = step?.run ?? '';
      expect(run).toContain('chore(release): restore :edge image tags [skip ci]');
    });

    // #2533 — atomic push for multi-ref mutations
    it('should use git push --atomic for multi-ref pushes', () => {
      const steps = workflow.jobs.validate.steps;
      const hasAtomicPush = steps.some((s) => {
        const run = s.run ?? '';
        return run.includes('--atomic');
      });
      expect(hasAtomicPush).toBe(true);
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
    });

    it('should push main via the atomic push step (not in commit step)', () => {
      const pushStep = workflow.jobs.validate.steps.find((s) =>
        s.name?.toLowerCase().includes('re-point tag') ||
        s.name?.toLowerCase().includes('move tag')
      );
      expect(pushStep).toBeDefined();
      const run = pushStep?.run ?? '';
      expect(run).toContain('git push');
      expect(run).toContain('origin main');
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

    // #2527 — the release job should copy compose files from tag checkout, NOT use sed
    it('should copy compose files from tag checkout instead of generating with sed', () => {
      const step = releaseSteps.find((s) => s.name?.toLowerCase().includes('copy compose'));
      expect(step).toBeDefined();
      const run = step?.run ?? '';
      // Should use cp, not sed
      expect(run).toContain('cp');
      expect(run).not.toContain('sed');
    });

    it('should validate compose files from tag checkout', () => {
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

    // #2535 — symphony-worker must appear in release body
    it('should include symphony-worker in release body', () => {
      const step = releaseSteps.find((s) => s.name?.toLowerCase().includes('release body'));
      const run = step?.run ?? '';
      expect(run).toContain('symphony-worker');
    });

    // #2535 — all 9 container images should be in release body
    it('should include all 9 container images in release body', () => {
      const step = releaseSteps.find((s) => s.name?.toLowerCase().includes('release body'));
      const run = step?.run ?? '';
      const expectedImages = [
        'db', 'api', 'app', 'migrate', 'worker',
        'ha-connector', 'prompt-guard', 'tmux-worker', 'symphony-worker',
      ];
      for (const img of expectedImages) {
        expect(run).toContain(`openclaw-projects-${img}`);
      }
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

    it('should publish containers with matrix for all 9 images', () => {
      const matrix = workflow.jobs['publish-containers'].strategy?.matrix;
      const images = matrix?.image as Array<{ name: string }>;
      expect(images).toHaveLength(9);
      const names = images.map((i) => i.name);
      expect(names).toContain('db');
      expect(names).toContain('api');
      expect(names).toContain('app');
      expect(names).toContain('migrate');
      expect(names).toContain('worker');
      expect(names).toContain('ha-connector');
      expect(names).toContain('prompt-guard');
      expect(names).toContain('tmux-worker');
      expect(names).toContain('symphony-worker');
    });

    // #2535 — container provenance SHA must use version_bump_sha, not github.sha
    it('should use version_bump_sha for container build VCS_REF and OCI_REVISION', () => {
      const buildStep = workflow.jobs['publish-containers'].steps.find((s) =>
        s.name?.toLowerCase().includes('build and push')
      );
      expect(buildStep).toBeDefined();
      const buildArgs = String(buildStep?.with?.['build-args'] ?? '');
      // Should reference the version_bump_sha output, not github.sha
      expect(buildArgs).toContain('version_bump_sha');
      expect(buildArgs).not.toContain('github.sha');
    });
  });

  // #2534 — workflow interaction documentation
  describe('workflow interaction', () => {
    it('should document workflow interaction with ci.yml and containers.yml in comments', () => {
      const content = readFileSync(WORKFLOW_PATH, 'utf-8');
      // The workflow should contain comments about interaction with other workflows
      expect(content).toContain('containers.yml');
    });
  });
});
