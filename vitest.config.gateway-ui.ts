import { defineProject } from 'vitest/config';
import fs from 'node:fs';
import path from 'node:path';

const gatewayDir = path.resolve(__dirname, '.local/openclaw-gateway');
const hasGateway = fs.existsSync(gatewayDir);

/**
 * Gateway UI test project — tests that need a DOM environment (jsdom).
 *
 * These tests live in .local/openclaw-gateway/ui/ and use Lit, DOMPurify,
 * and other browser APIs. They run under jsdom so they can be included
 * in the standard `pnpm test` run.
 *
 * Files matching *.browser.test.ts are excluded — those tests mount the
 * full OpenClawApp web component and need a real browser (Playwright).
 *
 * The *.node.test.ts files are also excluded — they run via the gateway's
 * own vitest.node.config.ts.
 */
export default defineProject({
  resolve: {
    // Keep symlink paths as-is so Vite's module graph stays within the
    // project root. Without this, .local → /workspaces/.../  resolves
    // outside the Vite server root and triggers /@fs/ path failures.
    preserveSymlinks: true,
  },
  test: {
    name: 'gateway-ui',
    globals: true,
    testTimeout: 15000,
    fileParallelism: true,
    environment: 'jsdom',

    include: hasGateway
      ? ['.local/openclaw-gateway/ui/src/**/*.test.ts']
      : [],

    exclude: [
      '**/node_modules/**',
      '**/*.node.test.ts',
      '**/*.browser.test.ts',
    ],
  },
});
