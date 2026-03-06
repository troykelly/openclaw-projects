# GlitchTip/Sentry Error Tracking Integration — Design

**Date:** 2026-03-02
**Status:** Draft (post-review revision)

---

## Problem

openclaw-projects has no structured error reporting. Errors are logged to console/pino but not aggregated, searchable, or alertable. There is no visibility into frontend errors, no distributed tracing linking user actions to API calls, and no source map support for debugging minified frontend stack traces.

## Goals

1. Capture errors and unhandled rejections across **all** processes: API, Worker, TMux Worker, HA Connector, Frontend
2. Distributed tracing linking frontend user actions to backend API calls automatically
3. Environment support (production / staging / development)
4. Source map uploads to GlitchTip during CI release pipeline
5. Fully optional — disabled when `SENTRY_DSN` is unset
6. Self-hosting documentation for environment variables
7. Optional user feedback dialog on frontend crashes (simple error boundary, not Sentry-hosted dialog)

## Non-Goals

- Continuous profiling (not needed at this stage)
- Session replay (`replayIntegration` — GlitchTip does not support it; excluded to avoid ~50-80KB bundle bloat)
- Sentry-hosted feedback widget (`feedbackIntegration` / `showReportDialog()` — GlitchTip does not serve the required dialog page)
- Custom dashboards or alerting rules (configured in GlitchTip UI, not in code)
- Replacing pino/console logging (Sentry supplements, does not replace)

---

## Architecture

### Backend: ESM Preload Instrumentation (`src/instrument.ts`)

**Critical: Sentry v8+ requires the `--import` CLI flag for full auto-instrumentation.**

Sentry v8 is built on OpenTelemetry. For ESM applications, `Sentry.init()` must run **before** any application module is imported, so OpenTelemetry can monkey-patch `pg`, `fastify`, `undici`, etc. Simply calling `initSentry()` at the top of a `run.ts` file is insufficient because ESM static imports are evaluated before any user code runs.

**Solution:** Create `src/instrument.ts` that is loaded via Node's `--import` flag:

```ts
// src/instrument.ts — loaded via --import flag BEFORE any application code
import * as Sentry from '@sentry/node';

const dsn = process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || 'development',
    release: process.env.SENTRY_RELEASE || getPackageVersion(),
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
    sampleRate: parseFloat(process.env.SENTRY_SAMPLE_RATE || '1.0'),
    debug: process.env.SENTRY_DEBUG === 'true',
    serverName: process.env.SENTRY_SERVER_NAME, // set per-process via env
    beforeSend(event) { return scrubPii(event); },
    beforeSendTransaction(event) { return scrubPii(event); },
  });
}
```

Each process sets `SENTRY_SERVER_NAME` via its Docker environment (e.g., `api`, `worker`, `tmux-worker`, `ha-connector`).

**All four Dockerfile CMD entries must change:**

```dockerfile
# Before:
CMD ["node", "--experimental-transform-types", "--experimental-detect-module", "src/api/run.ts"]

# After:
CMD ["node", "--experimental-transform-types", "--experimental-detect-module", "--import", "./src/instrument.ts", "src/api/run.ts"]
```

**All four Dockerfiles must COPY `src/instrument.ts`** — currently they only COPY their own `src/<process>/` directories. A new COPY directive is required in each:

```dockerfile
COPY --from=builder /app/src/instrument.ts ./src/instrument.ts
```

### Fastify Integration (API process)

- Use `setupFastifyErrorHandler` as a **named import**: `import { setupFastifyErrorHandler } from '@sentry/node'`
- **NOT** `Sentry.setupFastifyErrorHandler()` — it is a standalone export, not a namespace method
- Call `setupFastifyErrorHandler(app)` in `server.ts` after the Fastify instance is created
- **Important: Avoid duplicate reporting.** The existing `app.setErrorHandler` (server.ts:847) already handles errors. `setupFastifyErrorHandler` installs its own error handler. The design must either:
  - Call `setupFastifyErrorHandler(app)` **before** registering the custom error handler, so the custom handler overrides it but Sentry's hooks are still in place, OR
  - Integrate `Sentry.captureException()` into the existing error handler for 5xx errors **instead of** using `setupFastifyErrorHandler`, to avoid a double-capture scenario
  - **Recommended:** Use the existing error handler and add `Sentry.captureException()` calls explicitly. This is clearer and avoids hidden interaction between two error handlers.

- Attach user context via a Fastify `onRequest` hook: `Sentry.setUser({ id: namespace_id })`

### CORS Update Required for Distributed Tracing

**The current CORS configuration blocks Sentry trace propagation headers.**

`src/api/cors.ts` line 64 only allows: `['Authorization', 'Content-Type', 'Accept']`

For distributed tracing to work (frontend → backend), the `sentry-trace` and `baggage` headers must be allowed:

```ts
allowedHeaders: ['Authorization', 'Content-Type', 'Accept', 'sentry-trace', 'baggage'],
```

This change must also be reflected in any Traefik/proxy CORS configuration for deployments using `CORS_HANDLED_BY_PROXY=true`.

### Worker Processes (Worker, TMux Worker, HA Connector)

- Basic Node.js instrumentation via `--import ./src/instrument.ts` (uncaught exceptions, unhandled promise rejections auto-captured by Sentry)
- **Tracing spans** (not DB transactions) around existing units of work — one span per job processed, not one broad transaction per polling batch. The worker uses a polling loop; wrapping the entire batch in a single trace span would conflate unrelated jobs.
- Circuit breaker state changes captured as breadcrumbs
- Process-specific tags via `SENTRY_SERVER_NAME` env var

### Graceful Shutdown: `Sentry.close()`

**All backend processes must call `await Sentry.close(5000)` during shutdown** to flush pending events before `process.exit()`. Without this, errors captured just before container restart/shutdown are lost.

Each `run.ts` already has SIGTERM/SIGINT handlers — `Sentry.close()` must be added to each.

### Frontend: React Integration (`@sentry/react`)

Initialized in `src/ui/app/main.tsx`:

- DSN from `import.meta.env.VITE_SENTRY_DSN` — no-op if unset
- `Sentry.browserTracingIntegration()` for automatic XHR/fetch instrumentation
- `tracePropagationTargets`: same-origin (default) — works since API and frontend share origin in both deployment modes
- **No `replayIntegration()`** — GlitchTip does not support session replay; excluding avoids ~50-80KB bundle penalty
- **No `feedbackIntegration()` or `showReportDialog()`** — GlitchTip does not serve the required hosted dialog page

#### Error Boundary Integration

The project already has a custom `ErrorBoundary` class component at `src/ui/components/error-boundary.tsx`. Rather than replacing it with `Sentry.ErrorBoundary`, **extend the existing component**:

- Add `Sentry.captureException(error, { contexts: { react: { componentStack } } })` in the existing `componentDidCatch` method
- Add an optional "Send Feedback" button to the existing fallback UI that opens a simple textarea modal (custom, not Sentry-hosted)
- Wrap the root `<App>` in `main.tsx` with the existing `<ErrorBoundary>` component (currently not present at the root level)

This preserves the existing UI patterns and avoids introducing a second error boundary abstraction.

#### `VITE_*` Variables Are Build-Time Only

`VITE_*` environment variables are compiled into the bundle at build time by Vite. They are **not** runtime-configurable. This means:

- The Docker app image (`docker/app/Dockerfile`) must receive `VITE_SENTRY_DSN` and `VITE_SENTRY_ENVIRONMENT` as **build args**, not runtime env vars
- The CI release workflow must pass these as `--build-arg` to the Docker build
- Self-hosters must set these when building the frontend, not when deploying

#### Frontend/Backend Distributed Tracing

Sentry's `browserTracingIntegration()` automatically injects `sentry-trace` and `baggage` headers on outgoing fetch/XHR requests when the target URL matches `tracePropagationTargets`. The Fastify `@sentry/node` integration reads these headers server-side and continues the trace.

Result: A single trace spans from button click → API request → database query → response.

---

## Environment Variables

### Runtime (all backend processes)

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `SENTRY_DSN` | No | _(unset = disabled)_ | Sentry/GlitchTip DSN for backend processes |
| `SENTRY_ENVIRONMENT` | No | `development` | Environment tag (production/staging/development) |
| `SENTRY_RELEASE` | No | _(auto from package.json)_ | Release version identifier |
| `SENTRY_TRACES_SAMPLE_RATE` | No | `0.1` | Fraction of transactions to trace (0.0–1.0) |
| `SENTRY_SAMPLE_RATE` | No | `1.0` | Fraction of error events to capture (0.0–1.0) |
| `SENTRY_SERVER_NAME` | No | _(unset)_ | Process identifier (api/worker/tmux-worker/ha-connector) |
| `SENTRY_DEBUG` | No | `false` | Enable verbose Sentry SDK logging to console |

### Build-Time (frontend — Vite prefix, compiled into bundle)

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `VITE_SENTRY_DSN` | No | _(unset = disabled)_ | Sentry/GlitchTip DSN for frontend |
| `VITE_SENTRY_ENVIRONMENT` | No | `development` | Frontend environment tag |
| `VITE_SENTRY_TRACES_SAMPLE_RATE` | No | `0.1` | Frontend trace sample rate |
| `VITE_SENTRY_RELEASE` | No | _(auto from `__APP_VERSION__`)_ | Frontend release version (must match backend for trace linking) |

### CI Only (source map upload + release creation)

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `SENTRY_AUTH_TOKEN` | Yes (CI) | — | API token for `sentry-cli` / Vite plugin uploads |
| `SENTRY_ORG` | Yes (CI) | — | Organization slug in GlitchTip |
| `SENTRY_PROJECT` | Yes (CI) | — | Project slug in GlitchTip |
| `SENTRY_URL` | Yes (CI) | — | GlitchTip server base URL (for self-hosted) |

---

## Source Map Upload Strategy

### Primary: `@sentry/vite-plugin` (replaces manual `sentry-cli`)

**Use `@sentry/vite-plugin` instead of manual `sentry-cli` invocations.** This is the modern recommended approach and solves multiple problems:

1. **Debug IDs**: The plugin injects debug IDs into source files, enabling reliable source map association without fragile `--url-prefix` guessing
2. **URL-prefix agnostic**: Works correctly regardless of whether assets are served from `/static/app/` (Fastify) or `/assets/` (nginx Docker container with `VITE_BASE=/`)
3. **Automatic cleanup**: `filesToDeleteAfterUpload` removes `.map` files from the build output after upload, ensuring they never ship in Docker images

```ts
// vite.config.ts addition
import { sentryVitePlugin } from "@sentry/vite-plugin";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Only active when SENTRY_AUTH_TOKEN is set (CI builds)
    ...(process.env.SENTRY_AUTH_TOKEN ? [sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      url: process.env.SENTRY_URL,
      release: { name: getAppVersion() },
      sourcemaps: {
        filesToDeleteAfterUpload: ["./src/api/static/app/**/*.map"],
      },
    })] : []),
  ],
  build: {
    sourcemap: true, // already configured
  },
});
```

### CI Integration

The release workflow (`release.yml`) needs these changes:

1. **Pass Sentry env vars to the frontend build step** (both the test job's `pnpm app:build` and the container build):
   ```yaml
   env:
     SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
     SENTRY_ORG: ${{ secrets.SENTRY_ORG }}
     SENTRY_PROJECT: ${{ secrets.SENTRY_PROJECT }}
     SENTRY_URL: ${{ secrets.SENTRY_URL }}
     VITE_SENTRY_DSN: ${{ secrets.VITE_SENTRY_DSN }}
     VITE_SENTRY_ENVIRONMENT: production
     VITE_SENTRY_RELEASE: ${{ needs.validate.outputs.version }}
   ```

2. **Docker app build must also receive build args** for `VITE_SENTRY_*`:
   ```yaml
   build-args: |
     VITE_SENTRY_DSN=${{ secrets.VITE_SENTRY_DSN }}
     VITE_SENTRY_ENVIRONMENT=production
     VITE_SENTRY_RELEASE=${{ needs.validate.outputs.version }}
     SENTRY_AUTH_TOKEN=${{ secrets.SENTRY_AUTH_TOKEN }}
     SENTRY_ORG=${{ secrets.SENTRY_ORG }}
     SENTRY_PROJECT=${{ secrets.SENTRY_PROJECT }}
     SENTRY_URL=${{ secrets.SENTRY_URL }}
   ```

3. **`docker/app/Dockerfile` must accept these as ARGs** and pass them to the Vite build

4. **Build parity**: The source maps uploaded by `@sentry/vite-plugin` during the Docker app build are generated from the exact same inputs as the shipped bundle, solving the build-parity problem that a separate CI upload step would have.

### Fallback: `sentry-cli` for Release Finalization

After source maps are uploaded via the Vite plugin, use `sentry-cli` (as a **devDependency**) for release management only:

```bash
pnpm exec sentry-cli releases new "$VERSION"
pnpm exec sentry-cli releases set-commits "$VERSION" --auto
pnpm exec sentry-cli releases finalize "$VERSION"
```

**Order matters**: Create release → upload source maps (handled by Vite plugin during build) → set commits → finalize release. The Vite plugin handles the upload; `sentry-cli` handles release metadata.

### Source Maps Removed from Docker Images

Currently, `docker/app/Dockerfile` copies all build output including `.map` files into the nginx image (line 66: `COPY --from=builder /app/src/api/static/app /usr/share/nginx/html`).

The `@sentry/vite-plugin`'s `filesToDeleteAfterUpload` setting removes `.map` files after upload, so they won't exist in the build output when the COPY happens. As a safety net, also add:

```dockerfile
# Remove any remaining source maps from production image
RUN find /usr/share/nginx/html -name "*.map" -delete
```

---

## PII Scrubbing and Data Minimization

This API handles OAuth tokens, email content, SMS messages, and webhook payloads. Explicit scrubbing is required.

### `beforeSend` / `beforeSendTransaction` Hooks

The `src/instrument.ts` init must include scrubbing hooks that:

1. Strip `Authorization` header values from request data
2. Strip `Cookie` / `Set-Cookie` header values
3. Strip query parameters containing `token`, `key`, `secret`, `code`
4. Strip request body fields named `password`, `token`, `secret`, `refresh_token`
5. Redact email/SMS message bodies from breadcrumbs

### Sentry SDK Default Scrubbing

The Sentry SDK has built-in scrubbing for common patterns (credit cards, etc.). Ensure `sendDefaultPii: false` (the default) is not overridden.

---

## GlitchTip Compatibility Notes

GlitchTip implements the Sentry SDK protocol with these limitations:

| Feature | Sentry | GlitchTip | Our Approach |
|---------|--------|-----------|--------------|
| Error capture | Yes | Yes | Use |
| Performance/tracing | Yes | Yes (basic) | Use |
| Source maps | Yes | Yes (debug IDs since v4.2) | Use via `@sentry/vite-plugin` |
| Release tracking | Yes | Yes | Use via `sentry-cli` |
| Session replay | Yes | No | **Exclude** — do not add `replayIntegration` |
| Profiling | Yes | No | **Exclude** |
| Feedback widget | Yes | Limited | **Custom implementation** — simple modal in existing ErrorBoundary |
| Cron monitoring | Yes | Limited | **Defer** — add in future issue if needed |

### SDK Version Pinning

**Pin to `@sentry/node@^8` and `@sentry/react@^8`.** Sentry v8 is the current stable release with well-documented GlitchTip compatibility. Newer major versions may use protocol features GlitchTip hasn't implemented. Include a comment in `package.json` noting the GlitchTip compatibility constraint.

---

## Epic Structure

### Epic: GlitchTip/Sentry Error Tracking Integration

**7 issues**, with dependencies:

#### Issue 1: Add Sentry SDK dependencies, shared instrument module, and PII scrubbing

- Add `@sentry/node@^8` to dependencies
- Add `@sentry/react@^8` to dependencies
- Add `@sentry/vite-plugin@^2` to devDependencies
- Add `@sentry/cli@^2` to devDependencies
- Create `src/instrument.ts` — preload module with `Sentry.init()`, env var config, PII scrubbing hooks
- Export a `closeSentry()` helper for shutdown handlers
- Unit tests: init is no-op when DSN unset, PII scrubbing strips sensitive fields, configures correctly when set
- **Blocks:** Issues 2, 3, 4, 5

#### Issue 2: Instrument API process with Sentry

- Add `--import ./src/instrument.ts` to API Dockerfile CMD
- Add `COPY src/instrument.ts` to API Dockerfile builder and runtime stages
- Set `SENTRY_SERVER_NAME=api` in Dockerfile ENV
- Integrate `Sentry.captureException()` into existing `app.setErrorHandler` for 5xx errors (NOT `setupFastifyErrorHandler` — avoid duplicate capture)
- Add `Sentry.setUser({ id: namespace_id })` via Fastify `onRequest` hook
- Add `sentry-trace` and `baggage` to CORS `allowedHeaders` in `src/api/cors.ts`
- Add `await Sentry.close(5000)` to shutdown handler in `src/api/run.ts`
- Tests: verify Sentry captures on 5xx, skips 4xx, attaches user context, CORS allows trace headers
- **Blocked by:** Issue 1

#### Issue 3: Instrument Worker, TMux Worker, and HA Connector

- Add `--import ./src/instrument.ts` to each Dockerfile CMD
- Add `COPY src/instrument.ts` to each Dockerfile builder and runtime stages
- Set `SENTRY_SERVER_NAME` env per process in each Dockerfile
- Add tracing spans around individual job processing (not batch-level transactions)
- Capture circuit breaker state changes as breadcrumbs
- Add `await Sentry.close(5000)` to each shutdown handler
- Tests: verify error capture in each process type, verify graceful shutdown flushes events
- **Blocked by:** Issue 1

#### Issue 4: Instrument frontend with Sentry React SDK

- Initialize `@sentry/react` in `main.tsx` (conditional on `import.meta.env.VITE_SENTRY_DSN`)
- Configure `browserTracingIntegration()` with default `tracePropagationTargets` (same-origin)
- **Do NOT add** `replayIntegration()` or `feedbackIntegration()` (GlitchTip incompatible)
- Extend existing `ErrorBoundary` component (`src/ui/components/error-boundary.tsx`):
  - Add `Sentry.captureException()` call in `componentDidCatch`
  - Add optional "Send Feedback" button with simple custom textarea modal
- Wrap root app tree in `main.tsx` with existing `<ErrorBoundary>` component
- Set `VITE_SENTRY_RELEASE` to `__APP_VERSION__` for release matching
- Tests: verify init is no-op when DSN unset, error boundary captures to Sentry, feedback modal renders
- **Blocked by:** Issue 1

#### Issue 5: Source map upload via `@sentry/vite-plugin` in CI

- Add `@sentry/vite-plugin` to `vite.config.ts` (conditional on `SENTRY_AUTH_TOKEN`)
- Configure `filesToDeleteAfterUpload` to strip `.map` files post-upload
- Update `docker/app/Dockerfile`:
  - Accept `VITE_SENTRY_*`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_URL` as build ARGs
  - Pass them to the `RUN pnpm run app:build` step
  - Add safety-net `RUN find ... -name "*.map" -delete` after COPY
- Update `release.yml`:
  - Pass Sentry secrets as build-args to Docker app container build
  - Add release finalization step: `sentry-cli releases new`, `set-commits --auto`, `finalize`
- Document required GitHub Actions secrets
- Tests: dry-run validation (verify plugin skipped when `SENTRY_AUTH_TOKEN` unset)
- **Blocked by:** Issue 1

#### Issue 6: Environment variable documentation and `.env.example` updates

- Add all Sentry env vars to `.env.example` with clear documentation comments
- Document which vars are runtime vs build-time
- Add `SENTRY_SERVER_NAME` to each service in docker-compose files
- Pass `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE`, `SENTRY_SAMPLE_RATE`, `SENTRY_DEBUG` through docker-compose service definitions
- Document self-hosting setup: how to get a DSN from GlitchTip, what values to set
- Document environment naming convention (production/staging/development)
- Document Traefik CORS considerations for `sentry-trace` and `baggage` headers
- **Blocked by:** Issue 1 only (env var names are finalized there; can proceed in parallel with 2-5)

#### Issue 7: Store GlitchTip credentials in 1Password and configure GitHub Actions secrets

- Store DSN, auth token, org slug, project slug, server URL in 1Password vault
- Configure GitHub Actions repository secrets: `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_URL`, `VITE_SENTRY_DSN`
- Verify CI pipeline can access secrets in release workflow
- **Blocked by:** Issue 5 (secrets are only useful once the CI integration exists)
- **Note:** This issue contains no code — it is an operational task

---

## Security Considerations

- DSN is **not** a secret (embedded in frontend JS) but should not be hardcoded in source
- `SENTRY_AUTH_TOKEN` IS a secret — used only in CI build steps, never in runtime containers
- `sendDefaultPii: false` (Sentry default) — no automatic PII collection
- Explicit `beforeSend` scrubbing for Authorization headers, cookies, tokens, passwords
- Source maps uploaded to GlitchTip only, stripped from Docker images via `filesToDeleteAfterUpload` + safety-net deletion
- No email/SMS message bodies in breadcrumbs
- User context uses namespace ID only, never email/name/PII

---

## Open Questions Resolved

| Question | Decision |
|----------|----------|
| Which frontend deployment is canonical for tracing? | Both — `@sentry/vite-plugin` with debug IDs works regardless of URL prefix |
| One Sentry project or separate per process? | One project, differentiated by `serverName` tag |
| Should source maps be publicly served? | No — deleted after upload via Vite plugin |
| `setupFastifyErrorHandler` vs manual capture? | Manual `Sentry.captureException()` in existing error handler to avoid double-capture |
| Replace or extend existing ErrorBoundary? | Extend existing component with Sentry calls |
