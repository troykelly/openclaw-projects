import { defineProject } from 'vitest/config';

/**
 * Docker test project — runs Docker/Dockerfile tests sequentially.
 *
 * Separated from the unit project (#2554) because concurrent `docker build`
 * commands compete for resources, causing timeouts. fileParallelism: false
 * ensures Docker tests run one at a time.
 *
 * Tests that assert on container stdout use `canCaptureDockerStdout` guards
 * and skip gracefully when Docker-in-Docker stdout capture is unavailable.
 */
export default defineProject({
  test: {
    name: 'docker',
    globals: true,
    testTimeout: 120_000,
    fileParallelism: false,

    include: ['tests/docker/**/*.test.ts'],

    exclude: ['.local/**', 'node_modules/**', '**/node_modules/**'],
  },
});
