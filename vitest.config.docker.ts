import { defineProject } from 'vitest/config';

/**
 * Docker test project — Dockerfile build and runtime validation tests.
 *
 * These tests invoke `docker build` and `docker run` in beforeAll hooks,
 * which are resource-intensive. Running them in parallel causes resource
 * contention and intermittent failures (empty stdout from docker commands).
 *
 * fileParallelism: false ensures Docker test files run sequentially.
 *
 * See #2554 for details.
 */
export default defineProject({
  test: {
    name: 'docker',
    globals: true,
    testTimeout: 120000,
    fileParallelism: false,

    include: ['tests/docker/**/*.test.ts'],

    exclude: ['.local/**', 'node_modules/**', '**/node_modules/**'],
  },
});
