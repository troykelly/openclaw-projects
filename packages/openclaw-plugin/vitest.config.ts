import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  resolve: {
    alias: {
      // Alias openclaw internal paths for gateway tests
      // These are internal Gateway APIs not exported by openclaw package.json,
      // but needed for Level 3 integration tests
      'openclaw/dist/plugins/loader.js': path.resolve(
        __dirname,
        '../../node_modules/.pnpm/openclaw@2026.2.6_@napi-rs+canvas@0.1.89_@types+express@5.0.6_node-llama-cpp@3.15.1_typ_ba61b0e8a0ad421954e0aeea196f8801/node_modules/openclaw/dist/loader-CKycv-3K.js'
      ),
      'openclaw/dist/plugins/hooks.js': path.resolve(
        __dirname,
        '../../node_modules/.pnpm/openclaw@2026.2.6_@napi-rs+canvas@0.1.89_@types+express@5.0.6_node-llama-cpp@3.15.1_typ_ba61b0e8a0ad421954e0aeea196f8801/node_modules/openclaw/dist/hooks-BbqKYyTk.js'
      ),
      'openclaw/dist/plugins/tools.js': path.resolve(
        __dirname,
        '../../node_modules/.pnpm/openclaw@2026.2.6_@napi-rs+canvas@0.1.89_@types+express@5.0.6_node-llama-cpp@3.15.1_typ_ba61b0e8a0ad421954e0aeea196f8801/node_modules/openclaw/dist/tools-COxnH3Gg.js'
      ),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    globals: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/types/**'],
      reporter: ['text', 'text-summary', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage',
      thresholds: {
        lines: 70,
        branches: 55,
        functions: 70,
        statements: 70,
      },
    },
  },
});
