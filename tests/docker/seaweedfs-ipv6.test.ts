import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';

const CONTAINER_NAME = 'seaweed-ipv6-test-vitest';
const IMAGE = 'chrislusf/seaweedfs:4.09';
const STARTUP_WAIT_MS = 35_000;

function dockerExec(cmd: string[]): string {
  return execFileSync('docker', ['exec', CONTAINER_NAME, ...cmd], {
    encoding: 'utf-8',
    timeout: 10_000,
  }).trim();
}

function isDockerAvailable(): boolean {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore', timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

describe('SeaweedFS dual-stack with -ip.bind=::', () => {
  const skip = !isDockerAvailable();

  beforeAll(async () => {
    if (skip) return;
    // Clean up any leftover container
    try {
      execFileSync('docker', ['rm', '-f', CONTAINER_NAME], { stdio: 'ignore' });
    } catch { /* ignore */ }

    execFileSync(
      'docker',
      ['run', '--rm', '-d', '--name', CONTAINER_NAME, IMAGE, 'server', '-s3', '-ip.bind=::', '-s3.port=8333', '-volume.max=1'],
      { timeout: 15_000 },
    );

    // Wait for SeaweedFS to fully start
    await new Promise((r) => setTimeout(r, STARTUP_WAIT_MS));
  }, STARTUP_WAIT_MS + 10_000);

  afterAll(() => {
    if (skip) return;
    try {
      execFileSync('docker', ['stop', CONTAINER_NAME], { stdio: 'ignore', timeout: 15_000 });
    } catch { /* ignore */ }
  });

  it.skipIf(skip)('master responds on IPv4 (127.0.0.1:9333)', () => {
    const result = dockerExec(['wget', '-q', '-O', '-', 'http://127.0.0.1:9333/cluster/status']);
    expect(result).toContain('IsLeader');
  });

  it.skipIf(skip)('master responds on IPv6 ([::1]:9333)', () => {
    const result = dockerExec(['wget', '-q', '-O', '-', 'http://[::1]:9333/cluster/status']);
    expect(result).toContain('IsLeader');
  });

  it.skipIf(skip)('S3 responds on IPv4 (127.0.0.1:8333)', () => {
    const result = dockerExec(['wget', '-q', '-O', '-', 'http://127.0.0.1:8333/']);
    expect(result).toContain('ListAllMyBucketsResult');
  });

  it.skipIf(skip)('S3 responds on IPv6 ([::1]:8333)', () => {
    const result = dockerExec(['wget', '-q', '-O', '-', 'http://[::1]:8333/']);
    expect(result).toContain('ListAllMyBucketsResult');
  });
});
