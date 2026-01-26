import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 30000,

    // All tests currently share one local Postgres database.
    // Disable parallelism so migration reset/apply steps don't race.
    fileParallelism: false,
  },
});
