import { defineProject } from 'vitest/config';
import fs from 'node:fs';
import path from 'node:path';

const gatewayRoot = path.resolve(__dirname, '.local/openclaw-gateway');
const hasGateway = fs.existsSync(gatewayRoot);

/**
 * Integration test project — tests that require Postgres or a running server.
 *
 * Parallelism is disabled because these tests share one local Postgres
 * instance with per-test TRUNCATE cleanup.
 *
 * Pure unit tests (no DB, no HTTP) live in vitest.config.unit.ts and run
 * in parallel for speed. See that file for the classification heuristic.
 */
export default defineProject({
  test: {
    name: 'integration',
    globals: true,
    testTimeout: 30000,

    // Tests share one local Postgres database with per-test TRUNCATE cleanup.
    // Parallelism is disabled to avoid migration race conditions.
    fileParallelism: false,

    exclude: [
      // ── Unit tests (run by the unit project) ───────────────────────
      'tests/ui/**',
      'tests/devcontainer/**',
      'tests/docker/**',
      'tests/frontend/**',
      'tests/workflows/**',
      'tests/openclaw-contract/**',
      'tests/command_palette.test.ts',
      'tests/generate_title.test.ts',
      'tests/layout_components.test.ts',
      'tests/note_presence_cursor_rate_limit.test.ts',
      'tests/note_presence_timeout.test.ts',
      'tests/ui_components.test.ts',
      'tests/webhook_ssrf.test.ts',
      'tests/api/dual-stack-binding.test.ts',
      'tests/api/ip-whitelist.test.ts',
      'tests/api/per-user-rate-limit.test.ts',
      'tests/embeddings/config.test.ts',
      'tests/embeddings/errors.test.ts',
      'tests/embeddings/providers.test.ts',
      'tests/embeddings/service.test.ts',
      'tests/file-storage/content-disposition-sanitization.test.ts',
      'tests/oauth/config.test.ts',
      'tests/postmark/email-utils.test.ts',
      'tests/realtime/emitter.test.ts',
      'tests/realtime/hub.test.ts',
      'tests/recurrence/parser.test.ts',
      'tests/twilio/phone-utils.test.ts',
      'tests/webhooks/config.test.ts',
      'tests/webhooks/payloads.test.ts',
      'tests/webhooks/verification.test.ts',
      'tests/worker/**',
      // Co-located src/ unit tests
      'src/api/oauth/**/*.test.ts',
      'src/api/memory/keyword-boost-unit.test.ts',
      'src/api/webhooks/payloads.test.ts',
      'src/api/geolocation/network-guard.test.ts',
      'src/api/geolocation/registry.test.ts',
      'src/api/geolocation/crypto.test.ts',
      'src/worker/**/*.test.ts',

      // ── E2E / Playwright / external ────────────────────────────────
      'tests/e2e-playwright/**',
      'packages/openclaw-plugin/tests/e2e/**',
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

    // setup-api.ts disables bearer token auth for tests
    // Gateway setup registers channel plugins needed by gateway unit tests
    setupFiles: [
      './tests/setup-api.ts',
      ...(hasGateway ? ['./tests/setup-gateway.ts'] : []),
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
