import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function getAppVersion(): string {
  const pkg = JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
  const version = pkg.version ?? '0.0.0';

  // CI or explicit VITE_APP_VERSION override
  if (process.env.VITE_APP_VERSION) return process.env.VITE_APP_VERSION;

  // Try to get git short hash for edge/dev builds
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf-8' }).trim();
    // Check if current commit is tagged (release build)
    try {
      const tag = execFileSync('git', ['describe', '--exact-match', '--tags', 'HEAD'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      if (tag) return tag.replace(/^v/, '');
    } catch {
      // Not a tagged commit — use edge format
    }
    return `${version}-edge+${sha}`;
  } catch {
    return version;
  }
}

// Build the frontend directly into the Fastify static directory.
// Fastify serves `/static/*` from `src/api/static/*`.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Sentry source map upload — only active in CI when SENTRY_AUTH_TOKEN is set.
    // Uses @sentry/vite-plugin with debug IDs for reliable source map association.
    // Source map upload via @sentry/vite-plugin. The errorHandler ensures build failures are non-fatal if the Sentry/GlitchTip API is unreachable.
    ...(process.env.SENTRY_AUTH_TOKEN
      ? [
          sentryVitePlugin({
            org: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT,
            authToken: process.env.SENTRY_AUTH_TOKEN,
            url: process.env.SENTRY_URL,
            release: { name: getAppVersion() },
            sourcemaps: {
              filesToDeleteAfterUpload: ['./src/api/static/app/**/*.map'],
            },
            // Best-effort: don't fail the build if source map upload fails
            // (e.g. SSL cert issues in Docker, transient network errors).
            errorHandler: (err) => {
              console.warn('[sentry-vite-plugin] Source map upload failed:', err.message);
            },
          }),
        ]
      : []),
  ],
  root: path.join(__dirname, 'src', 'ui', 'app'),
  base: process.env.VITE_BASE || '/static/app/',
  define: {
    __APP_VERSION__: JSON.stringify(getAppVersion()),
  },
  server: {
    host: '::',
  },
  build: {
    outDir: path.join(__dirname, 'src', 'api', 'static', 'app'),
    emptyOutDir: true,
    sourcemap: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
