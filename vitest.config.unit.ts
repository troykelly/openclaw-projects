import { defineProject } from 'vitest/config';
import path from 'node:path';

/**
 * Unit test project — pure tests with NO database or server dependencies.
 *
 * These tests run with fileParallelism: true for speed. If you add a test
 * file here that needs Postgres, move it to the integration project
 * (the root vitest.config.ts) instead.
 *
 * How to decide:
 *   - Imports buildServer / createTestPool / truncateAllTables / pg Pool → integration
 *   - Pure functions, React components, mocks only → unit (add pattern here)
 */
export default defineProject({
  test: {
    name: 'unit',
    globals: true,
    testTimeout: 15000,
    fileParallelism: true,

    include: [
      // ── React component tests (jsdom) ──────────────────────────────
      'tests/ui/**/*.test.{ts,tsx}',

      // ── Docker / devcontainer / workflow config tests ──────────────
      'tests/devcontainer/**/*.test.ts',
      'tests/docker/**/*.test.ts',
      'tests/frontend/**/*.test.ts',
      'tests/workflows/**/*.test.ts',

      // ── Pure utility / logic tests under tests/ ────────────────────
      'tests/command_palette.test.ts',
      'tests/generate_title.test.ts',
      'tests/layout_components.test.ts',
      'tests/note_presence_cursor_rate_limit.test.ts',
      'tests/note_presence_timeout.test.ts',
      'tests/ui_components.test.ts',
      'tests/webhook_ssrf.test.ts',

      // ── Subdirectory unit tests (config, parsing, utilities) ───────
      'tests/api/dual-stack-binding.test.ts',
      'tests/api/ip-whitelist.test.ts',
      'tests/api/per-user-rate-limit.test.ts',
      'tests/embeddings/config.test.ts',
      'tests/embeddings/errors.test.ts',
      'tests/embeddings/providers.test.ts',
      'tests/embeddings/service.test.ts',
      'tests/file-storage/content-disposition-sanitization.test.ts',
      'tests/file-storage/s3-presigned-external-endpoint.test.ts',
      'tests/file-storage/sharing-presigned-url.test.ts',
      'tests/oauth/config.test.ts',
      'tests/openclaw-contract/**/*.test.ts',
      'tests/postmark/email-utils.test.ts',
      'tests/realtime/emitter.test.ts',
      'tests/realtime/hub.test.ts',
      'tests/recurrence/parser.test.ts',
      'tests/twilio/phone-utils.test.ts',
      'tests/webhooks/config.test.ts',
      'tests/webhooks/payloads.test.ts',
      'tests/webhooks/verification.test.ts',
      'tests/worker/**/*.test.ts',

      // ── Pure unit tests co-located in src/ ─────────────────────────
      'src/api/auth/**/*.test.ts',
      'src/api/oauth/**/*.test.ts',
      'src/api/memory/keyword-boost-unit.test.ts',
      'src/api/memory/namespace-priority.test.ts',
      'src/api/webhooks/payloads.test.ts',
      'src/api/geolocation/network-guard.test.ts',
      'src/api/geolocation/registry.test.ts',
      'src/api/geolocation/bootstrap.test.ts',
      'src/api/geolocation/crypto.test.ts',
      'src/worker/**/*.test.ts',
    ],

    exclude: [
      // .local/ subtrees (e.g. openclaw-gateway clone) are never this project's tests.
      '.local/**',
      'node_modules/**',
      '**/node_modules/**',
    ],

    // jsdom for React component tests
    environmentMatchGlobs: [['tests/ui/**', 'jsdom']],

    // UI setup (jsdom mocks) — safe as a no-op in Node environment
    setupFiles: ['./tests/setup-ui.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
