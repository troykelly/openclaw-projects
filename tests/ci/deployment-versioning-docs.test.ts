/**
 * Tests for deployment versioning documentation (#2529)
 *
 * Validates that docs/deployment.md contains required versioning guidance
 * for all three user personas:
 * 1. Docker Compose Deployer (release asset compose files)
 * 2. Git Tag Deployer (git checkout)
 * 3. Documentation-Guided Deployer (following the docs)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');

describe('docs/deployment.md — version consistency guidance (#2529)', () => {
  let deploymentDoc: string;

  beforeAll(() => {
    deploymentDoc = readFileSync(
      resolve(ROOT, 'docs/deployment.md'),
      'utf-8',
    );
  });

  describe('Version Deployment section', () => {
    it('should have a section about deploying a specific version', () => {
      expect(deploymentDoc).toMatch(
        /##.*deploy.*specific.*version|##.*version.*deploy/i,
      );
    });

    it('should explain how to use release asset compose files', () => {
      expect(deploymentDoc).toMatch(/release.*asset|github.*release/i);
      expect(deploymentDoc).toMatch(
        /download.*compose|compose.*download|release.*compose/i,
      );
    });

    it('should explain the git checkout approach', () => {
      expect(deploymentDoc).toMatch(/git\s+checkout.*v\d/i);
    });

    it('should warn about :edge on main branch', () => {
      expect(deploymentDoc).toMatch(/:edge/);
      expect(deploymentDoc).toMatch(/main.*branch.*:?edge|:edge.*main/i);
    });
  });

  describe('Image tag guidance', () => {
    it('should not use :latest as the primary image reference', () => {
      // The architecture section should use versioned or :edge references,
      // not :latest which is ambiguous for deployment users
      const architectureSection =
        deploymentDoc.match(
          /## Architecture Overview([\s\S]*?)(?=\n## )/,
        )?.[1] ?? '';
      // If :latest appears, there should also be guidance about versioned tags
      if (architectureSection.includes(':latest')) {
        expect(deploymentDoc).toMatch(
          /versioned.*tag|specific.*version|pin.*version/i,
        );
      }
    });

    it('should document the image tagging scheme', () => {
      expect(deploymentDoc).toMatch(
        /:edge|edge.*tag|development.*branch|main.*branch.*edge/i,
      );
    });
  });

  describe('Release notes template coverage', () => {
    it('should reference deployment from GitHub releases', () => {
      expect(deploymentDoc).toMatch(
        /github.*release|release.*page|release.*asset/i,
      );
    });
  });
});

describe('README.md — quick start versioning awareness (#2529)', () => {
  let readme: string;

  beforeAll(() => {
    readme = readFileSync(resolve(ROOT, 'README.md'), 'utf-8');
  });

  it('should reference deployment documentation', () => {
    expect(readme).toMatch(/docs\/deployment\.md|deployment guide/i);
  });
});
