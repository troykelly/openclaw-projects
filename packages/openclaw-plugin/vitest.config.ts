import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Find the actual bundled files containing the openclaw plugin loader functions.
 * The openclaw package uses hashed bundle names, so we need to search for them.
 *
 * WORKAROUND: openclaw doesn't export these as part of its public API (package.json exports).
 * These are internal Gateway implementation details, but Level 3 tests need them to validate
 * our plugin works with the ACTUAL Gateway loader (not mocks).
 *
 * If openclaw updates and bundle hashes change, this will automatically find the new files.
 * If the functions are removed/renamed, tests will fail and we'll know to update.
 */
function findOpenClawInternalModule(searchString: string): string {
  const openclawDistPath = path.resolve(__dirname, '../../node_modules/.pnpm');
  const openclawDirs = readdirSync(openclawDistPath).filter(d => d.startsWith('openclaw@'));

  if (openclawDirs.length === 0) {
    throw new Error('openclaw package not found in node_modules');
  }

  const distPath = path.join(openclawDistPath, openclawDirs[0], 'node_modules/openclaw/dist');
  const files = readdirSync(distPath).filter(f => f.endsWith('.js'));

  for (const file of files) {
    const content = readFileSync(path.join(distPath, file), 'utf-8');
    if (content.includes(searchString)) {
      return path.join(distPath, file);
    }
  }

  throw new Error(`Could not find openclaw module containing: ${searchString}`);
}

export default defineConfig({
  resolve: {
    alias: {
      // Map expected import paths to actual hashed bundle files
      'openclaw/dist/plugins/loader.js': findOpenClawInternalModule('loadOpenClawPlugins'),
      'openclaw/dist/plugins/hooks.js': findOpenClawInternalModule('createHookRunner'),
      'openclaw/dist/plugins/tools.js': findOpenClawInternalModule('resolvePluginTools'),
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
