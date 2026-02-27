import { defineProject } from 'vitest/config';
import path from 'node:path';

/**
 * Integration test project — tests that require Postgres or a running server.
 *
 * Parallelism is disabled because these tests share one local Postgres
 * instance with per-test TRUNCATE cleanup.
 *
 * Pure unit tests (no DB, no HTTP) live in vitest.config.unit.ts and run
 * in parallel for speed. See that file for the classification heuristic.
 *
 * IMPORTANT: Explicit include globs are required to prevent anything from
 * .local/ (e.g. openclaw-gateway clone) from leaking into this serial
 * project. The blanket '.local/**' exclude is the safety net.
 */
export default defineProject({
  test: {
    name: 'integration',
    globals: true,
    testTimeout: 30000,

    // Tests share one local Postgres database with per-test TRUNCATE cleanup.
    // Parallelism is disabled to avoid migration race conditions.
    fileParallelism: false,

    // Explicit includes prevent future accidental inclusion from new directories.
    // Only cover this project's own test files — never .local/ subtrees.
    include: [
      'tests/**/*.test.{ts,tsx}',
      'src/**/*.test.ts',
      'packages/**/*.test.ts',
    ],

    exclude: [
      // ── .local/ subtrees — never part of this project's test suite ─
      '.local/**',

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
      // tmux-worker unit tests (run by the unit project)
      'src/tmux-worker/**/*.test.ts',
      // Auth unit tests
      'src/api/auth/**/*.test.ts',
      // Geolocation unit tests
      'src/api/geolocation/bootstrap.test.ts',
      // Memory unit tests
      'src/api/memory/namespace-priority.test.ts',
      // File-storage unit tests
      'tests/file-storage/s3-presigned-external-endpoint.test.ts',
      'tests/file-storage/sharing-presigned-url.test.ts',
      // HA-connector unit tests
      'tests/ha-connector/**/*.test.ts',
      // Grouped unit test directories
      'tests/unit/**/*.test.ts',

      // ── E2E / Playwright / external ────────────────────────────────
      'tests/e2e-playwright/**',
      'packages/openclaw-plugin/tests/e2e/**',
      // Gateway plugin tests require the openclaw-gateway checkout — skip.
      'packages/openclaw-plugin/tests/gateway/**',
      'node_modules/**',
      '**/node_modules/**',
    ],

    // setup-api.ts disables bearer token auth for tests.
    // setup-embeddings-mock.ts intercepts fetch calls to embedding endpoints
    //   so tests never make real API calls (each costs 500-750ms + credits).
    setupFiles: [
      './tests/setup-api.ts',
      './tests/setup-embeddings-mock.ts',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
