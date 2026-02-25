import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync, spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

const DOCKERFILE_PATH = join(__dirname, '../../docker/migrate/Dockerfile');
const BUILD_CONTEXT = join(__dirname, '../..');
const IMAGE_NAME = 'openclaw-migrate-test';

/**
 * Check if Docker is available AND can actually pull images.
 * Docker daemon may be running but the credential helper may be broken,
 * which causes all builds to fail with "error getting credentials".
 */
const canRunDocker = (() => {
  try {
    execSync('docker info', { stdio: 'ignore' });
    // Verify credential helper works by attempting an image pull.
    // hello-world is tiny and validates registry auth works end-to-end.
    execSync('docker pull hello-world', { stdio: 'ignore', timeout: 30000 });
    return true;
  } catch {
    return false;
  }
})();

/**
 * Check if buildx supports a given platform
 */
function canBuildPlatform(platform: string): boolean {
  try {
    // Check if builder supports the platform
    const result = spawnSync('docker', ['buildx', 'inspect', '--bootstrap'], {
      encoding: 'utf-8',
      timeout: 30000,
    });

    if (result.status !== 0) {
      return false;
    }

    // Check if the platform is listed in the builder's platforms
    return result.stdout.includes(platform);
  } catch {
    return false;
  }
}

/**
 * Tests for hardened migrate Dockerfile
 *
 * Requirements:
 * - Non-root user
 * - OCI labels via build args
 * - Pinned base image version
 * - Multi-arch build support (linux/amd64, linux/arm64)
 */
describe('Migrate Dockerfile hardening', () => {
  describe('Dockerfile content validation', () => {
    let dockerfileContent: string;

    beforeAll(() => {
      dockerfileContent = readFileSync(DOCKERFILE_PATH, 'utf-8');
    });

    it('pins base image to specific version', () => {
      // Should use migrate/migrate:v4.x.x, not :latest
      const fromLine = dockerfileContent.match(/^FROM\s+(\S+)/m)?.[1];
      expect(fromLine).toBeDefined();
      expect(fromLine).toMatch(/^migrate\/migrate:v\d+\.\d+\.\d+$/);
    });

    it('defines OCI label build args', () => {
      const requiredArgs = ['BUILD_DATE', 'VCS_REF', 'VERSION'];

      for (const arg of requiredArgs) {
        expect(dockerfileContent).toContain(`ARG ${arg}`);
      }
    });

    it('includes required OCI labels', () => {
      const requiredLabels = [
        'org.opencontainers.image.title',
        'org.opencontainers.image.description',
        'org.opencontainers.image.version',
        'org.opencontainers.image.created',
        'org.opencontainers.image.source',
        'org.opencontainers.image.revision',
        'org.opencontainers.image.licenses',
      ];

      for (const label of requiredLabels) {
        expect(dockerfileContent).toContain(label);
      }
    });

    it('sets USER directive for non-root execution', () => {
      // Should have a USER directive
      expect(dockerfileContent).toMatch(/^USER\s+\S+/m);
    });
  });

  describe('Image build validation', () => {
    beforeAll(() => {
      if (!canRunDocker) {
        console.log('Skipping Docker build tests - Docker not available or credential helper broken');
        return;
      }

      // Build the image with test labels
      const buildCommand = [
        'docker',
        'build',
        '-f',
        DOCKERFILE_PATH,
        '-t',
        IMAGE_NAME,
        '--build-arg',
        'BUILD_DATE=2026-02-04T00:00:00Z',
        '--build-arg',
        'VCS_REF=abc123',
        '--build-arg',
        'VERSION=1.0.0-test',
        BUILD_CONTEXT,
      ].join(' ');

      execSync(buildCommand, { stdio: 'pipe' });
    }, 120000);

    afterAll(() => {
      if (!canRunDocker) return;
      // Clean up test image
      try {
        execSync(`docker rmi ${IMAGE_NAME}`, { stdio: 'pipe' });
      } catch {
        // Ignore cleanup errors
      }
    });

    it.skipIf(!canRunDocker)('image has OCI labels set correctly', () => {
      const inspectResult = execSync(`docker inspect ${IMAGE_NAME} --format '{{json .Config.Labels}}'`, { encoding: 'utf-8' });

      const labels = JSON.parse(inspectResult);

      expect(labels['org.opencontainers.image.title']).toBe('openclaw-projects-migrate');
      expect(labels['org.opencontainers.image.version']).toBe('1.0.0-test');
      expect(labels['org.opencontainers.image.created']).toBe('2026-02-04T00:00:00Z');
      expect(labels['org.opencontainers.image.revision']).toBe('abc123');
      expect(labels['org.opencontainers.image.source']).toContain('github.com');
      expect(labels['org.opencontainers.image.licenses']).toBeDefined();
    });

    it.skipIf(!canRunDocker)('image runs as non-root user', () => {
      // Run a test container and check the user
      const result = spawnSync('docker', ['run', '--rm', '--entrypoint', 'id', IMAGE_NAME], { encoding: 'utf-8' });

      const output = result.stdout || result.stderr;

      // The migrate image is Alpine-based, check we're not running as root (uid=0)
      // We expect the user to be non-root
      expect(output).not.toMatch(/uid=0\(root\)/);
    });

    it.skipIf(!canRunDocker)('migrations directory is present', () => {
      const result = spawnSync('docker', ['run', '--rm', '--entrypoint', 'ls', IMAGE_NAME, '-la', '/migrations'], { encoding: 'utf-8' });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('001_init.up.sql');
    });

    it.skipIf(!canRunDocker)('migrate binary is executable', () => {
      const result = spawnSync('docker', ['run', '--rm', IMAGE_NAME, '--version'], { encoding: 'utf-8' });

      // migrate tool should output version info
      expect(result.stdout + result.stderr).toMatch(/\d+\.\d+/);
    });
  });

  describe('Multi-architecture build validation', () => {
    it.skipIf(!canRunDocker)('builds for linux/amd64', () => {
      const result = spawnSync(
        'docker',
        [
          'buildx',
          'build',
          '--platform',
          'linux/amd64',
          '-f',
          DOCKERFILE_PATH,
          '--build-arg',
          'BUILD_DATE=2026-02-04T00:00:00Z',
          '--build-arg',
          'VCS_REF=test',
          '--build-arg',
          'VERSION=test',
          BUILD_CONTEXT,
        ],
        { encoding: 'utf-8', timeout: 120000 },
      );

      expect(result.status).toBe(0);
    }, 180000);

    it.skipIf(!canRunDocker)('builds for linux/arm64', () => {
      // Skip if buildx doesn't support arm64 emulation
      // This commonly happens in CI environments without QEMU setup
      const canBuildArm64 = canBuildPlatform('linux/arm64');
      if (!canBuildArm64) {
        console.log('Skipping arm64 build test: buildx does not support linux/arm64 emulation');
        return;
      }

      const result = spawnSync(
        'docker',
        [
          'buildx',
          'build',
          '--platform',
          'linux/arm64',
          '-f',
          DOCKERFILE_PATH,
          '--build-arg',
          'BUILD_DATE=2026-02-04T00:00:00Z',
          '--build-arg',
          'VCS_REF=test',
          '--build-arg',
          'VERSION=test',
          BUILD_CONTEXT,
        ],
        { encoding: 'utf-8', timeout: 120000 },
      );

      expect(result.status).toBe(0);
    }, 180000);

    it('Dockerfile is valid for multi-arch (base image supports both)', () => {
      // Verify the base image is multi-arch by checking it exists for both platforms
      // This doesn't require building, just validates the FROM image tag
      const dockerfileContent = readFileSync(DOCKERFILE_PATH, 'utf-8');
      const fromLine = dockerfileContent.match(/^FROM\s+(\S+)/m)?.[1];

      expect(fromLine).toBeDefined();

      // The migrate/migrate image provides multi-arch manifests
      // This test validates our Dockerfile uses a proper versioned tag that supports both archs
      expect(fromLine).toMatch(/^migrate\/migrate:v\d+\.\d+\.\d+$/);

      if (!canRunDocker) return;

      // Verify the manifest includes both architectures by checking Docker Hub
      // (The image we use - migrate/migrate:v4.19.1 - is published for amd64 and arm64)
      const result = spawnSync('docker', ['manifest', 'inspect', fromLine!], { encoding: 'utf-8', timeout: 30000 });

      // If manifest inspect works, check it has both platforms
      if (result.status === 0) {
        const manifest = JSON.parse(result.stdout);
        const platforms = manifest.manifests?.map((m: { platform?: { architecture?: string } }) => m.platform?.architecture) || [];

        expect(platforms).toContain('amd64');
        expect(platforms).toContain('arm64');
      }
      // If manifest inspect isn't available, the test still passes
      // based on the FROM line validation above
    });
  });
});
