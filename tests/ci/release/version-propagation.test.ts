/**
 * End-to-end release version propagation tests (#2530)
 *
 * Tests the full release workflow behavior including:
 * - Version replacement in compose files
 * - Version restoration to :edge
 * - Re-entrancy guard logic
 * - Docker tag format (build metadata stripping)
 * - Positive version matching
 * - symphony-worker inclusion in release body
 * - File categorization (production vs excluded)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../../..');

/** Production compose files that must be updated at release */
const PROD_COMPOSE_FILES = [
  'docker-compose.yml',
  'docker-compose.traefik.yml',
  'docker-compose.quickstart.yml',
  'docker-compose.full.yml',
];

/** Files that must NOT be updated (use build context) */
const EXCLUDED_FILES = [
  '.devcontainer/docker-compose.devcontainer.yml',
  'docker-compose.test.yml',
];

/** Image prefix for project images */
const IMAGE_PREFIX = 'ghcr.io/troykelly/openclaw-projects-';

/** Known project image names from the audit */
const KNOWN_IMAGES = [
  'db', 'migrate', 'api', 'worker', 'symphony-worker',
  'tmux-worker', 'ha-connector', 'app', 'prompt-guard',
];

// ── Helpers ────────────────────────────────────────────────────────

/** Apply version replacement to compose content (mimics release workflow sed) */
function applyVersionToCompose(content: string, version: string): string {
  // Strip build metadata — Docker tags don't support +
  const cleanVersion = version.replace(/\+.*$/, '');
  // Replace :edge with the versioned tag for project images only
  return content.replace(
    new RegExp(`(${escapeRegex(IMAGE_PREFIX)}[^:]*):edge`, 'g'),
    `$1:${cleanVersion}`,
  );
}

/** Restore compose content to :edge (mimics post-release restore) */
function restoreToEdge(content: string, version: string): string {
  const cleanVersion = version.replace(/\+.*$/, '');
  return content.replace(
    new RegExp(`(${escapeRegex(IMAGE_PREFIX)}[^:]*):${escapeRegex(cleanVersion)}`, 'g'),
    '$1:edge',
  );
}

/** Check if a commit message matches the re-entrancy guard pattern */
function isReentrantCommit(message: string): boolean {
  return /^chore\(release\):/.test(message);
}

/** Strip build metadata from version for Docker tag usage */
function stripBuildMetadata(version: string): string {
  return version.replace(/\+.*$/, '');
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Extract all project image references from compose content */
function extractProjectImages(content: string): Array<{ image: string; tag: string }> {
  const regex = new RegExp(`${escapeRegex(IMAGE_PREFIX)}([^:]+):([^\\s"']+)`, 'g');
  const matches: Array<{ image: string; tag: string }> = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    matches.push({ image: match[1], tag: match[2] });
  }
  return matches;
}

// ── Test Suite ─────────────────────────────────────────────────────

describe('Version replacement in compose content', () => {
  it('should replace all :edge tags with the version', () => {
    const content = [
      `    image: ${IMAGE_PREFIX}db:edge`,
      `    image: ${IMAGE_PREFIX}api:edge`,
      `    image: ${IMAGE_PREFIX}app:edge`,
    ].join('\n');

    const result = applyVersionToCompose(content, '0.0.60');
    expect(result).toContain(`${IMAGE_PREFIX}db:0.0.60`);
    expect(result).toContain(`${IMAGE_PREFIX}api:0.0.60`);
    expect(result).toContain(`${IMAGE_PREFIX}app:0.0.60`);
    expect(result).not.toContain(':edge');
  });

  it('should not modify third-party images', () => {
    const content = [
      `    image: ${IMAGE_PREFIX}api:edge`,
      `    image: traefik:v3.1`,
      `    image: chrislusf/seaweedfs:latest`,
    ].join('\n');

    const result = applyVersionToCompose(content, '0.0.60');
    expect(result).toContain(`${IMAGE_PREFIX}api:0.0.60`);
    expect(result).toContain('traefik:v3.1');
    expect(result).toContain('chrislusf/seaweedfs:latest');
  });

  it('should strip build metadata from version before replacement', () => {
    const content = `    image: ${IMAGE_PREFIX}api:edge`;
    const result = applyVersionToCompose(content, '1.0.0+build.123');
    expect(result).toContain(`${IMAGE_PREFIX}api:1.0.0`);
    expect(result).not.toContain('+');
  });

  it('should handle pre-release versions correctly', () => {
    const content = `    image: ${IMAGE_PREFIX}api:edge`;
    const result = applyVersionToCompose(content, '1.0.0-beta.1');
    expect(result).toContain(`${IMAGE_PREFIX}api:1.0.0-beta.1`);
  });

  it('should handle compose content with no internal images', () => {
    const content = `    image: traefik:v3.1\n    image: postgres:16`;
    const result = applyVersionToCompose(content, '0.0.60');
    expect(result).toBe(content);
  });
});

describe('Version restoration in compose content', () => {
  it('should restore versioned tags to :edge', () => {
    const content = [
      `    image: ${IMAGE_PREFIX}db:0.0.60`,
      `    image: ${IMAGE_PREFIX}api:0.0.60`,
    ].join('\n');

    const result = restoreToEdge(content, '0.0.60');
    expect(result).toContain(`${IMAGE_PREFIX}db:edge`);
    expect(result).toContain(`${IMAGE_PREFIX}api:edge`);
  });

  it('should not modify third-party images during restore', () => {
    const content = [
      `    image: ${IMAGE_PREFIX}api:0.0.60`,
      `    image: traefik:v3.1`,
    ].join('\n');

    const result = restoreToEdge(content, '0.0.60');
    expect(result).toContain(`${IMAGE_PREFIX}api:edge`);
    expect(result).toContain('traefik:v3.1');
  });

  it('should handle build metadata in restore version', () => {
    const content = `    image: ${IMAGE_PREFIX}api:1.0.0`;
    const result = restoreToEdge(content, '1.0.0+build.123');
    expect(result).toContain(`${IMAGE_PREFIX}api:edge`);
  });
});

describe('Full round-trip: version bump → restore', () => {
  for (const file of PROD_COMPOSE_FILES) {
    it(`should round-trip ${file} without changes`, () => {
      const filepath = resolve(ROOT, file);
      if (!existsSync(filepath)) {
        return; // Skip if file doesn't exist in this checkout
      }
      const original = readFileSync(filepath, 'utf-8');

      // Apply version
      const versioned = applyVersionToCompose(original, '99.99.99');

      // Verify no :edge references remain for project images
      const edgeRefs = extractProjectImages(versioned).filter(i => i.tag === 'edge');
      expect(edgeRefs).toHaveLength(0);

      // Verify all project images now use the version
      const versionedRefs = extractProjectImages(versioned);
      for (const ref of versionedRefs) {
        expect(ref.tag).toBe('99.99.99');
      }

      // Restore to :edge
      const restored = restoreToEdge(versioned, '99.99.99');

      // Should match the original
      expect(restored).toBe(original);
    });
  }
});

describe('File categorization', () => {
  it('should identify production compose files', () => {
    for (const file of PROD_COMPOSE_FILES) {
      const filepath = resolve(ROOT, file);
      // Production files should exist
      expect(existsSync(filepath), `${file} should exist`).toBe(true);
    }
  });

  it('should verify excluded files use build context, not published images', () => {
    for (const file of EXCLUDED_FILES) {
      const filepath = resolve(ROOT, file);
      if (!existsSync(filepath)) continue;

      const content = readFileSync(filepath, 'utf-8');
      const publishedRefs = extractProjectImages(content);
      expect(
        publishedRefs,
        `${file} should not reference published images (found: ${JSON.stringify(publishedRefs)})`,
      ).toHaveLength(0);
    }
  });

  it('should not modify devcontainer compose', () => {
    const devCompose = resolve(ROOT, '.devcontainer/docker-compose.devcontainer.yml');
    if (!existsSync(devCompose)) return;

    const content = readFileSync(devCompose, 'utf-8');
    // Devcontainer should use build context, not published images
    expect(content).not.toMatch(new RegExp(`${escapeRegex(IMAGE_PREFIX)}[^:]+:edge`));
  });
});

describe('Re-entrancy guard logic', () => {
  it('should detect chore(release): commit messages as re-entrant', () => {
    expect(isReentrantCommit('chore(release): v0.0.60 [skip ci]')).toBe(true);
    expect(isReentrantCommit('chore(release): v1.0.0-beta.1 [skip ci]')).toBe(true);
    expect(isReentrantCommit('chore(release): v2.0.0')).toBe(true);
  });

  it('should not flag normal commits as re-entrant', () => {
    expect(isReentrantCommit('fix: resolve login bug')).toBe(false);
    expect(isReentrantCommit('feat: add new API endpoint')).toBe(false);
    expect(isReentrantCommit('[#123] Add version bump')).toBe(false);
    expect(isReentrantCommit('Merge pull request #456')).toBe(false);
  });

  it('should not flag commits that merely mention chore(release) in body', () => {
    // The check is on the first line only
    expect(isReentrantCommit('fix: related to chore(release) issue')).toBe(false);
  });
});

describe('Docker tag format — build metadata handling', () => {
  it('should strip + and everything after for Docker tags', () => {
    expect(stripBuildMetadata('1.0.0+build.123')).toBe('1.0.0');
    expect(stripBuildMetadata('0.0.60+sha.abc123')).toBe('0.0.60');
    expect(stripBuildMetadata('2.0.0-beta.1+build.456')).toBe('2.0.0-beta.1');
  });

  it('should leave versions without build metadata unchanged', () => {
    expect(stripBuildMetadata('1.0.0')).toBe('1.0.0');
    expect(stripBuildMetadata('1.0.0-beta.1')).toBe('1.0.0-beta.1');
    expect(stripBuildMetadata('0.0.60')).toBe('0.0.60');
  });

  it('should produce valid Docker tag characters', () => {
    const versions = [
      '1.0.0',
      '1.0.0-beta.1',
      '1.0.0-rc.1',
      '1.0.0+build.123',
      '0.0.60+sha.abc123',
    ];
    // Docker tag regex: [a-zA-Z0-9_.-]+
    const dockerTagRegex = /^[a-zA-Z0-9_.-]+$/;
    for (const v of versions) {
      const tag = stripBuildMetadata(v);
      expect(tag, `${v} → ${tag} should be a valid Docker tag`).toMatch(dockerTagRegex);
    }
  });
});

describe('Positive version matching in compose files', () => {
  it('should positively match when all images use expected version', () => {
    const content = [
      `    image: ${IMAGE_PREFIX}db:0.0.60`,
      `    image: ${IMAGE_PREFIX}api:0.0.60`,
      `    image: ${IMAGE_PREFIX}app:0.0.60`,
    ].join('\n');

    const images = extractProjectImages(content);
    const allMatch = images.every(i => i.tag === '0.0.60');
    expect(allMatch).toBe(true);
  });

  it('should detect mismatch when one image has wrong version', () => {
    const content = [
      `    image: ${IMAGE_PREFIX}db:0.0.60`,
      `    image: ${IMAGE_PREFIX}api:0.0.59`,
      `    image: ${IMAGE_PREFIX}app:0.0.60`,
    ].join('\n');

    const images = extractProjectImages(content);
    const allMatch = images.every(i => i.tag === '0.0.60');
    expect(allMatch).toBe(false);
  });

  it('should detect :edge as a mismatch in release mode', () => {
    const content = [
      `    image: ${IMAGE_PREFIX}db:0.0.60`,
      `    image: ${IMAGE_PREFIX}api:edge`,
    ].join('\n');

    const images = extractProjectImages(content);
    const allMatch = images.every(i => i.tag === '0.0.60');
    expect(allMatch).toBe(false);
  });

  it('should pass when all images use :edge in dev mode', () => {
    const content = [
      `    image: ${IMAGE_PREFIX}db:edge`,
      `    image: ${IMAGE_PREFIX}api:edge`,
    ].join('\n');

    const images = extractProjectImages(content);
    const allEdge = images.every(i => i.tag === 'edge');
    expect(allEdge).toBe(true);
  });
});

describe('Production compose file image inventory', () => {
  for (const file of PROD_COMPOSE_FILES) {
    it(`${file} should have project image references`, () => {
      const filepath = resolve(ROOT, file);
      if (!existsSync(filepath)) return;

      const content = readFileSync(filepath, 'utf-8');
      const images = extractProjectImages(content);
      expect(images.length).toBeGreaterThan(0);
    });
  }

  it('docker-compose.yml should reference all 9 project images', () => {
    const filepath = resolve(ROOT, 'docker-compose.yml');
    if (!existsSync(filepath)) return;

    const content = readFileSync(filepath, 'utf-8');
    const images = extractProjectImages(content);
    const imageNames = images.map(i => i.image);

    for (const name of KNOWN_IMAGES) {
      expect(imageNames, `Should contain ${name}`).toContain(name);
    }
  });
});

describe('symphony-worker in release body', () => {
  it('should be included in the release workflow container matrix', () => {
    const releaseYml = readFileSync(resolve(ROOT, '.github/workflows/release.yml'), 'utf-8');
    expect(releaseYml).toContain('symphony-worker');
  });

  it('should be present in the container build matrix', () => {
    const releaseYml = readFileSync(resolve(ROOT, '.github/workflows/release.yml'), 'utf-8');
    expect(releaseYml).toContain('name: symphony-worker');
  });

  it('should exist as a compose service in docker-compose.yml', () => {
    const compose = readFileSync(resolve(ROOT, 'docker-compose.yml'), 'utf-8');
    expect(compose).toContain(`${IMAGE_PREFIX}symphony-worker`);
  });
});

describe('Container provenance SHA', () => {
  it('should use github.sha for VCS_REF build arg', () => {
    const releaseYml = readFileSync(resolve(ROOT, '.github/workflows/release.yml'), 'utf-8');
    expect(releaseYml).toContain('VCS_REF=${{ github.sha }}');
    expect(releaseYml).toContain('OCI_REVISION=${{ github.sha }}');
  });
});

describe('Release workflow re-entrancy guard', () => {
  it('should have a concurrency group to serialize releases', () => {
    const releaseYml = readFileSync(resolve(ROOT, '.github/workflows/release.yml'), 'utf-8');
    expect(releaseYml).toContain('concurrency:');
    expect(releaseYml).toContain('group: release');
  });

  it('should not cancel in-progress releases', () => {
    const releaseYml = readFileSync(resolve(ROOT, '.github/workflows/release.yml'), 'utf-8');
    expect(releaseYml).toContain('cancel-in-progress: false');
  });

  it('should use [skip ci] in the version bump commit message', () => {
    const releaseYml = readFileSync(resolve(ROOT, '.github/workflows/release.yml'), 'utf-8');
    expect(releaseYml).toContain('[skip ci]');
    expect(releaseYml).toMatch(/chore\(release\):.*\[skip ci\]/);
  });

  it('should have the chore(release) commit message that triggers the re-entrancy guard', () => {
    // The workflow commits with 'chore(release):' prefix
    // If the workflow re-triggers on its own commit, the guard must detect it
    const releaseYml = readFileSync(resolve(ROOT, '.github/workflows/release.yml'), 'utf-8');
    const commitLineMatch = releaseYml.match(/git commit -m "chore\(release\):[^"]*"/);
    expect(commitLineMatch, 'workflow should commit with chore(release): prefix').not.toBeNull();
    // Extract the commit message and verify the guard helper would catch it
    if (commitLineMatch) {
      const msgMatch = commitLineMatch[0].match(/"(.+)"/);
      if (msgMatch) {
        // The commit message template uses ${FILE_VERSION} so we test a concrete example
        const exampleMessage = msgMatch[1].replace('${FILE_VERSION}', '0.0.60');
        expect(isReentrantCommit(exampleMessage)).toBe(true);
      }
    }
  });

  it('should only trigger on tag pushes, not on push-to-main from version bump', () => {
    const releaseYml = readFileSync(resolve(ROOT, '.github/workflows/release.yml'), 'utf-8');
    // The workflow should only trigger on tag pushes
    expect(releaseYml).toMatch(/on:\s*\n\s*push:\s*\n\s*tags:/);
    // It should NOT trigger on branch pushes
    expect(releaseYml).not.toMatch(/on:\s*\n\s*push:\s*\n\s*branches:/);
  });
});

describe('Partial failure scenarios', () => {
  it('should verify push uses explicit remote URL (not cached credentials)', () => {
    const releaseYml = readFileSync(resolve(ROOT, '.github/workflows/release.yml'), 'utf-8');
    expect(releaseYml).toContain('git remote set-url origin');
    expect(releaseYml).toContain('REPO_PAT');
  });

  it('should not persist credentials from checkout', () => {
    const releaseYml = readFileSync(resolve(ROOT, '.github/workflows/release.yml'), 'utf-8');
    expect(releaseYml).toContain('persist-credentials: false');
  });

  it('should verify tag points to commit on main before releasing', () => {
    const releaseYml = readFileSync(resolve(ROOT, '.github/workflows/release.yml'), 'utf-8');
    expect(releaseYml).toContain('merge-base --is-ancestor');
  });

  it('should report all mismatches, not just the first one', () => {
    // If multiple compose files have wrong versions, the verifier should report all
    const content1 = `    image: ${IMAGE_PREFIX}db:0.0.59\n    image: ${IMAGE_PREFIX}api:0.0.59`;
    const content2 = `    image: ${IMAGE_PREFIX}db:edge\n    image: ${IMAGE_PREFIX}api:edge`;

    const images1 = extractProjectImages(content1);
    const images2 = extractProjectImages(content2);

    const mismatches1 = images1.filter(i => i.tag !== '0.0.60');
    const mismatches2 = images2.filter(i => i.tag !== '0.0.60');

    // Both files have mismatches — verifier should catch all
    expect(mismatches1.length).toBe(2);
    expect(mismatches2.length).toBe(2);
  });

  it('should detect partial updates (some files versioned, some still :edge)', () => {
    const versionedContent = `    image: ${IMAGE_PREFIX}db:0.0.60`;
    const edgeContent = `    image: ${IMAGE_PREFIX}db:edge`;

    const versionedImages = extractProjectImages(versionedContent);
    const edgeImages = extractProjectImages(edgeContent);

    expect(versionedImages[0].tag).toBe('0.0.60');
    expect(edgeImages[0].tag).toBe('edge');
    // A mix of these across files = partial failure
    expect(versionedImages[0].tag).not.toBe(edgeImages[0].tag);
  });
});

describe('Workflow sed pattern matches production code', () => {
  it('should use the same image prefix pattern as the test helpers', () => {
    const releaseYml = readFileSync(resolve(ROOT, '.github/workflows/release.yml'), 'utf-8');
    // The workflow sed command should reference our project images
    expect(releaseYml).toContain('ghcr.io/troykelly/openclaw-projects-');
  });

  it('should have a sed replacement pattern that only affects project images', () => {
    const releaseYml = readFileSync(resolve(ROOT, '.github/workflows/release.yml'), 'utf-8');
    // The sed command should specifically target our image prefix with :edge
    expect(releaseYml).toMatch(/sed.*openclaw-projects-.*:edge/);
  });

  it('should have a verification step in the release workflow', () => {
    const releaseYml = readFileSync(resolve(ROOT, '.github/workflows/release.yml'), 'utf-8');
    expect(releaseYml).toContain('verify-release-versions.sh');
  });
});

describe('Edge case: mixed internal and external images', () => {
  it('should only modify project images, leaving all others intact', () => {
    const content = [
      `    image: ${IMAGE_PREFIX}db:edge`,
      `    image: traefik:v3.1.2`,
      `    image: ${IMAGE_PREFIX}api:edge`,
      `    image: chrislusf/seaweedfs:3.71`,
      `    image: ${IMAGE_PREFIX}app:edge`,
      `    image: owasp/modsecurity-crs:4.6.0-nginx-202410140806`,
    ].join('\n');

    const versioned = applyVersionToCompose(content, '0.0.60');

    // Project images should be versioned
    expect(versioned).toContain(`${IMAGE_PREFIX}db:0.0.60`);
    expect(versioned).toContain(`${IMAGE_PREFIX}api:0.0.60`);
    expect(versioned).toContain(`${IMAGE_PREFIX}app:0.0.60`);

    // Third-party images should be unchanged
    expect(versioned).toContain('traefik:v3.1.2');
    expect(versioned).toContain('chrislusf/seaweedfs:3.71');
    expect(versioned).toContain('owasp/modsecurity-crs:4.6.0-nginx-202410140806');
  });
});

describe('Pre-release version handling', () => {
  const preReleaseVersions = [
    '1.0.0-alpha.1',
    '1.0.0-beta.1',
    '1.0.0-rc.1',
    '2.0.0-canary.5',
  ];

  for (const version of preReleaseVersions) {
    it(`should handle ${version} correctly in compose replacement`, () => {
      const content = `    image: ${IMAGE_PREFIX}api:edge`;
      const result = applyVersionToCompose(content, version);
      expect(result).toContain(`${IMAGE_PREFIX}api:${version}`);
    });

    it(`should restore ${version} back to :edge`, () => {
      const content = `    image: ${IMAGE_PREFIX}api:${version}`;
      const result = restoreToEdge(content, version);
      expect(result).toContain(`${IMAGE_PREFIX}api:edge`);
    });
  }
});
