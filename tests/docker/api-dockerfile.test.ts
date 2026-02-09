import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const ROOT_DIR = resolve(__dirname, '../..');
const DOCKERFILE_PATH = resolve(ROOT_DIR, 'docker/api/Dockerfile');
const DOCKERIGNORE_PATH = resolve(ROOT_DIR, 'docker/api/.dockerignore');

describe('API Dockerfile hardening', () => {
  let dockerfileContent: string;
  let dockerignoreContent: string;

  beforeAll(() => {
    dockerfileContent = readFileSync(DOCKERFILE_PATH, 'utf-8');
    dockerignoreContent = existsSync(DOCKERIGNORE_PATH) ? readFileSync(DOCKERIGNORE_PATH, 'utf-8') : '';
  });

  describe('Dockerfile structure', () => {
    it('uses multi-stage build with builder and runtime stages', () => {
      expect(dockerfileContent).toMatch(/FROM\s+node:25-bookworm-slim\s+AS\s+builder/i);
      expect(dockerfileContent).toMatch(/FROM\s+node:25-bookworm-slim\s+AS\s+runtime/i);
    });

    it('has separate deps stage for production dependencies', () => {
      expect(dockerfileContent).toMatch(/FROM\s+node:25-bookworm-slim\s+AS\s+deps/i);
      expect(dockerfileContent).toMatch(/pnpm install.*--prod/);
    });

    it('pins base image to node:25-bookworm-slim', () => {
      const fromStatements = dockerfileContent.match(/^FROM\s+\S+/gm) || [];
      for (const stmt of fromStatements) {
        expect(stmt).toMatch(/node:25-bookworm-slim/);
      }
    });

    it('uses non-root user', () => {
      // node:25-bookworm-slim already has a node user with UID 1000
      expect(dockerfileContent).toMatch(/USER\s+node/);
    });

    it('has USER directive before CMD', () => {
      const userIndex = dockerfileContent.lastIndexOf('USER node');
      const cmdIndex = dockerfileContent.lastIndexOf('CMD');
      expect(userIndex).toBeGreaterThan(-1);
      expect(cmdIndex).toBeGreaterThan(-1);
      expect(userIndex).toBeLessThan(cmdIndex);
    });

    it('only exposes port 3000', () => {
      const exposeStatements = dockerfileContent.match(/^EXPOSE\s+\d+/gm) || [];
      expect(exposeStatements).toHaveLength(1);
      expect(exposeStatements[0]).toBe('EXPOSE 3000');
    });

    it('has OCI labels with build args', () => {
      expect(dockerfileContent).toMatch(/ARG\s+BUILD_DATE/);
      expect(dockerfileContent).toMatch(/ARG\s+VCS_REF/);
      expect(dockerfileContent).toMatch(/ARG\s+VERSION/);
      expect(dockerfileContent).toMatch(/org\.opencontainers\.image\.created/);
      expect(dockerfileContent).toMatch(/org\.opencontainers\.image\.revision/);
      expect(dockerfileContent).toMatch(/org\.opencontainers\.image\.version/);
      expect(dockerfileContent).toMatch(/org\.opencontainers\.image\.source/);
      expect(dockerfileContent).toMatch(/org\.opencontainers\.image\.title/);
    });

    it('copies only production dependencies in runtime stage', () => {
      // Should copy from deps stage which has --prod flag
      expect(dockerfileContent).toMatch(/COPY\s+--from=deps/);
    });

    it('does not copy UI source files', () => {
      // Should NOT have any COPY for src/ui
      expect(dockerfileContent).not.toMatch(/COPY.*src\/ui/);
    });
  });

  describe('.dockerignore', () => {
    it('exists', () => {
      expect(existsSync(DOCKERIGNORE_PATH)).toBe(true);
    });

    it('excludes .env files', () => {
      expect(dockerignoreContent).toMatch(/\.env/);
    });

    it('excludes .git', () => {
      expect(dockerignoreContent).toMatch(/\.git/);
    });

    it('excludes node_modules', () => {
      expect(dockerignoreContent).toMatch(/node_modules/);
    });

    it('excludes docs/', () => {
      expect(dockerignoreContent).toMatch(/docs\//);
    });

    it('excludes tests/', () => {
      expect(dockerignoreContent).toMatch(/tests\//);
    });

    it('excludes src/ui/', () => {
      expect(dockerignoreContent).toMatch(/src\/ui\//);
    });

    it('excludes docker/', () => {
      expect(dockerignoreContent).toMatch(/docker\//);
    });
  });
});

describe('API Docker image build and runtime', () => {
  const IMAGE_NAME = 'openclaw-api-test:hardening';

  // Skip actual build tests if not in CI or if docker is unavailable
  const canRunDocker = (() => {
    try {
      execSync('docker info', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();

  // Build image once before tests if docker is available
  beforeAll(() => {
    if (!canRunDocker) {
      console.log('Skipping Docker build tests - Docker not available');
      return;
    }

    // Build for current platform first for faster tests
    try {
      execSync(
        `docker build -t ${IMAGE_NAME} -f docker/api/Dockerfile \
          --build-arg BUILD_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ") \
          --build-arg VCS_REF=test \
          --build-arg VERSION=test \
          .`,
        { cwd: ROOT_DIR, stdio: 'pipe', timeout: 300000 },
      );
    } catch (error) {
      console.error('Failed to build Docker image:', error);
      throw error;
    }
  }, 600000);

  it.skipIf(!canRunDocker)('builds successfully', () => {
    const result = execSync(`docker image inspect ${IMAGE_NAME}`, {
      cwd: ROOT_DIR,
      encoding: 'utf-8',
    });
    expect(result).toBeTruthy();
  });

  it.skipIf(!canRunDocker)('runs as non-root user (UID 1000)', () => {
    const result = execSync(`docker run --rm ${IMAGE_NAME} id -u`, { cwd: ROOT_DIR, encoding: 'utf-8' });
    expect(result.trim()).toBe('1000');
  });

  it.skipIf(!canRunDocker)('does not contain src/ui/ directory', () => {
    try {
      execSync(`docker run --rm ${IMAGE_NAME} ls -la /app/src/ui/`, { cwd: ROOT_DIR, encoding: 'utf-8' });
      // If we get here, the directory exists which is bad
      expect(false).toBe(true);
    } catch (error: unknown) {
      // Directory should not exist
      const e = error as { status?: number };
      expect(e.status).toBeTruthy();
    }
  });

  it.skipIf(!canRunDocker)('has OCI labels', () => {
    const result = execSync(`docker image inspect ${IMAGE_NAME} --format '{{json .Config.Labels}}'`, { cwd: ROOT_DIR, encoding: 'utf-8' });
    const labels = JSON.parse(result);
    expect(labels['org.opencontainers.image.title']).toBe('openclaw-api');
    expect(labels['org.opencontainers.image.source']).toMatch(/github\.com/);
  });

  it.skipIf(!canRunDocker)('exposes only port 3000', () => {
    const result = execSync(`docker image inspect ${IMAGE_NAME} --format '{{json .Config.ExposedPorts}}'`, { cwd: ROOT_DIR, encoding: 'utf-8' });
    const ports = JSON.parse(result);
    const portKeys = Object.keys(ports);
    expect(portKeys).toHaveLength(1);
    expect(portKeys[0]).toBe('3000/tcp');
  });
});

describe('Multi-architecture build support', () => {
  const canRunDocker = (() => {
    try {
      execSync('docker info', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();

  const hasBuildx = (() => {
    if (!canRunDocker) return false;
    try {
      execSync('docker buildx version', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();

  // Check if multi-platform is supported by the current buildx driver
  const supportsMultiPlatform = (() => {
    if (!hasBuildx) return false;
    try {
      // Test if the driver supports multi-platform by trying a dry run
      // The docker driver doesn't support multi-platform, but docker-container does
      const output = execSync('docker buildx inspect --bootstrap 2>&1', {
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      // If we see "docker" driver type, multi-platform is not supported
      // If we see "docker-container" or similar, it is supported
      return !output.includes('Driver: docker\n');
    } catch {
      return false;
    }
  })();

  it('Dockerfile is valid for multi-architecture builds (structure check)', () => {
    // This test validates the Dockerfile structure is suitable for multi-arch
    // without actually performing the build (which requires specific buildx drivers)
    const dockerfileContent = readFileSync(DOCKERFILE_PATH, 'utf-8');

    // Check that the Dockerfile uses a multi-arch compatible base image
    expect(dockerfileContent).toMatch(/FROM\s+node:25-bookworm-slim/);

    // Check no platform-specific commands that would break multi-arch
    expect(dockerfileContent).not.toMatch(/--platform=linux\/amd64/);
    expect(dockerfileContent).not.toMatch(/apt-get.*:amd64/);

    // Base image node:25-bookworm-slim supports both amd64 and arm64
    // This is a static verification since we can't always run multi-arch builds
  });

  it.skipIf(!supportsMultiPlatform)(
    'builds for linux/amd64 and linux/arm64 with compatible buildx driver',
    () => {
      // This test only runs when a multi-platform capable driver is available
      const result = execSync(
        `docker buildx build --platform linux/amd64,linux/arm64 \
        -f docker/api/Dockerfile \
        --build-arg BUILD_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ") \
        --build-arg VCS_REF=test \
        --build-arg VERSION=test \
        .`,
        { cwd: ROOT_DIR, encoding: 'utf-8', stdio: 'pipe', timeout: 600000 },
      );
      expect(true).toBe(true);
    },
    600000,
  );
});
