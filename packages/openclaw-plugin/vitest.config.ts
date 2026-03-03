import { defineConfig } from 'vitest/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolve the gateway source root for gateway integration tests.
 *
 * Level 3 gateway tests import internal Gateway functions (loadOpenClawPlugins,
 * createHookRunner) that are not part of openclaw's public npm API.
 *
 * When the gateway source is available at .local/openclaw-gateway, we alias
 * test imports directly to the source TypeScript files. This gives us:
 * - Correct function signatures (not minified bundle aliases)
 * - Full TypeScript support via vitest's built-in transpilation
 * - Resilience to bundle hash changes
 *
 * When the gateway source is NOT available, tests that import gateway internals
 * are skipped. Tests that only use local files or the published SDK (e.g.
 * manifest-validation, plugin-exports) always run. (#2043)
 */
const gatewayRoot = path.resolve(__dirname, '../../.local/openclaw-gateway');
const hasGateway = fs.existsSync(gatewayRoot);

/**
 * Gateway test files that require the gateway source tree at .local/openclaw-gateway.
 * These import internal gateway functions (loadOpenClawPlugins, createHookRunner)
 * that are NOT part of the openclaw npm package's public API.
 *
 * Tests NOT listed here (manifest-validation, plugin-exports) use only local
 * filesystem reads or the built dist/ output and always run, including in CI. (#2043)
 */
const gatewaySourceRequiredTests = [
  'tests/gateway/plugin-loading.test.ts',
  'tests/gateway/config-validation.test.ts',
  'tests/gateway/tool-registration.test.ts',
  'tests/gateway/tool-resolution.test.ts',
  'tests/gateway/hook-registration.test.ts',
  'tests/gateway/hook-invocation.test.ts',
  'tests/gateway/service-registration.test.ts',
  'tests/gateway/cli-registration.test.ts',
];

if (!hasGateway) {
  console.warn(
    `[openclaw-plugin] Gateway source not found at ${gatewayRoot}. ` +
      `Skipping ${gatewaySourceRequiredTests.length} gateway integration tests that require ` +
      `internal gateway imports (loadOpenClawPlugins, createHookRunner). ` +
      `To run all tests, symlink the gateway source to .local/openclaw-gateway. (#2043)`,
  );
}

export default defineConfig({
  resolve: {
    alias: {
      // Point gateway test imports to source TypeScript files
      ...(hasGateway
        ? {
            'openclaw-gateway/plugins/loader': path.join(gatewayRoot, 'src/plugins/loader.ts'),
            'openclaw-gateway/plugins/hooks': path.join(gatewayRoot, 'src/plugins/hooks.ts'),
            'openclaw-gateway/plugins/registry': path.join(gatewayRoot, 'src/plugins/registry.ts'),
            'openclaw/plugin-sdk': path.join(gatewayRoot, 'src/plugin-sdk/index.ts'),
          }
        : {}),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: [
      // Only skip gateway tests that import internal gateway functions.
      // Tests that use local files or built output (manifest-validation,
      // plugin-exports) always run, even without gateway source. (#2043)
      ...(hasGateway ? [] : gatewaySourceRequiredTests),
    ],
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
