import { defineConfig } from 'vitest/config';
import fs from 'node:fs';
import path from 'node:path';

const gatewayRoot = path.resolve(__dirname, '.local/openclaw-gateway');
const hasGateway = fs.existsSync(gatewayRoot);

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 30000,

    // Tests share one local Postgres database with per-test TRUNCATE cleanup.
    // Parallelism is disabled to avoid migration race conditions. If migrating
    // to per-file temp databases, this could be re-enabled.
    fileParallelism: false,

    // Exclude E2E tests from default test run (Level 2 requires Docker backend)
    // E2E tests are run separately via `pnpm run test:e2e` with RUN_E2E=true
    // Also exclude Playwright E2E tests (they use their own runner) and node_modules
    // Gateway E2E tests require a running gateway server and are excluded here;
    // they run via the gateway's own vitest config.
    // Gateway UI tests (ui/) use vitest browser mode with Playwright and have
    // their own vitest config; exclude them from the root run.
    // Gateway browser tests (*.browser.test.ts) need a DOM environment.
    // Gateway CWD-dependent tests use process.cwd() to resolve paths relative to
    // the gateway root; they must be run via the gateway's own vitest config.
    // Gateway test/ directory tests are not included by the gateway's own config
    // (except format-error.test.ts) and have stale imports.
    exclude: [
      'tests/e2e-playwright/**',
      'packages/openclaw-plugin/tests/e2e/**',
      // Gateway loader integration tests require .local/openclaw-gateway source;
      // skip them in environments (like CI) where the gateway is not available
      ...(hasGateway ? [] : ['packages/openclaw-plugin/tests/gateway/**']),
      'node_modules/**',
      '**/node_modules/**',
      '.local/openclaw-gateway/**/*.e2e.test.ts',
      '.local/openclaw-gateway/**/*.browser.test.ts',
      '.local/openclaw-gateway/ui/**',
      '.local/openclaw-gateway/**/vendor/**',
      '.local/openclaw-gateway/dist/**',
      // CWD-dependent: resolve files relative to gateway root via process.cwd()
      '.local/openclaw-gateway/src/docs/slash-commands-doc.test.ts',
      '.local/openclaw-gateway/src/cron/cron-protocol-conformance.test.ts',
      '.local/openclaw-gateway/src/canvas-host/server.test.ts',
      '.local/openclaw-gateway/src/cli/gateway.sigterm.test.ts',
      '.local/openclaw-gateway/src/infra/run-node.test.ts',
      '.local/openclaw-gateway/src/process/child-process-bridge.test.ts',
      '.local/openclaw-gateway/src/web/qr-image.test.ts',
      '.local/openclaw-gateway/src/agents/skills.summarize-skill-description.test.ts',
      '.local/openclaw-gateway/src/cli/browser-cli-extension.test.ts',
      // Stale import: deliverWebReply moved to auto-reply/deliver-reply.ts
      '.local/openclaw-gateway/test/auto-reply.retry.test.ts',
    ],

    // UI component tests use jsdom environment
    environmentMatchGlobs: [['tests/ui/**', 'jsdom']],
    // setup-api.ts disables bearer token auth for tests
    // setup-ui.ts configures jsdom mocks for UI tests
    // Gateway setup registers channel plugins needed by gateway unit tests
    setupFiles: [
      './tests/setup-api.ts',
      './tests/setup-ui.ts',
      ...(hasGateway ? ['./.local/openclaw-gateway/test/setup.ts'] : []),
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      ...(hasGateway
        ? {
            'openclaw/plugin-sdk': path.join(gatewayRoot, 'src', 'plugin-sdk', 'index.ts'),
            'openclaw-gateway/plugins/loader': path.join(gatewayRoot, 'src', 'plugins', 'loader.ts'),
            'openclaw-gateway/plugins/hooks': path.join(gatewayRoot, 'src', 'plugins', 'hooks.ts'),
            'openclaw-gateway/plugins/registry': path.join(gatewayRoot, 'src', 'plugins', 'registry.ts'),
          }
        : {}),
    },
  },
});
