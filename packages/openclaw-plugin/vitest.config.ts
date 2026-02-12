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
 * When the gateway source is NOT available, gateway tests are skipped.
 */
const gatewayRoot = path.resolve(__dirname, '../../.local/openclaw-gateway');
const hasGateway = fs.existsSync(gatewayRoot);

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
      // Skip gateway integration tests when gateway source is not available
      ...(hasGateway ? [] : ['tests/gateway/**/*.test.ts']),
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
