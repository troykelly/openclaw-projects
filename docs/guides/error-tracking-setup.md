# Error Tracking Setup (Sentry / GlitchTip)

openclaw-projects supports Sentry-compatible error tracking and distributed tracing. This works with both [Sentry](https://sentry.io/) SaaS and self-hosted [GlitchTip](https://glitchtip.com/).

## Quick Start

1. **Get a DSN** from your Sentry or GlitchTip instance
2. **Set environment variables** in your `.env` file
3. **Restart services** to pick up the new configuration

## Obtaining a DSN from GlitchTip

1. Log in to your GlitchTip instance
2. Navigate to **Settings** > **Projects**
3. Select your project (or create one)
4. Copy the **DSN** from the project settings page
5. The DSN looks like: `https://<key>@<glitchtip-host>/<project-id>`

## Environment Variables

### Runtime (Backend Processes)

These variables configure error tracking for all backend services: API, Worker, TMux Worker, and HA Connector.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SENTRY_DSN` | No | _(disabled)_ | DSN for backend error tracking |
| `SENTRY_ENVIRONMENT` | No | `development` | Environment tag (production/staging/development) |
| `SENTRY_TRACES_SAMPLE_RATE` | No | `0.1` | Fraction of transactions to trace (0.0-1.0) |
| `SENTRY_SAMPLE_RATE` | No | `1.0` | Fraction of error events to capture (0.0-1.0) |
| `SENTRY_DEBUG` | No | `false` | Enable verbose SDK logging |

`SENTRY_SERVER_NAME` is set automatically per service in docker-compose (api, worker, tmux-worker, ha-connector).

### Build-Time (Frontend)

These are compiled into the frontend bundle at build time via Vite's `VITE_` prefix convention. They are **not** runtime-configurable.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_SENTRY_DSN` | No | _(disabled)_ | DSN for frontend error tracking |
| `VITE_SENTRY_ENVIRONMENT` | No | `development` | Frontend environment tag |
| `VITE_SENTRY_TRACES_SAMPLE_RATE` | No | `0.1` | Frontend trace sample rate |

Self-hosters must set these when building the app Docker image (as build args), not at runtime.

### CI-Only (Source Map Upload)

Used only in the GitHub Actions release pipeline for source map upload and release finalization.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SENTRY_AUTH_TOKEN` | Yes (CI) | - | API token for sentry-cli |
| `SENTRY_ORG` | Yes (CI) | - | Organization slug |
| `SENTRY_PROJECT` | Yes (CI) | - | Project slug |
| `SENTRY_URL` | Yes (CI) | - | GlitchTip server URL |

Configure these as GitHub Actions repository secrets.

## Self-Hosting with Docker Compose

Add the Sentry environment variables to your `.env` file:

```bash
# Error tracking
SENTRY_DSN=https://key@glitchtip.example.com/1
SENTRY_ENVIRONMENT=production
```

All docker-compose files (`docker-compose.yml`, `docker-compose.traefik.yml`, `docker-compose.full.yml`, `docker-compose.quickstart.yml`) automatically pass these to the appropriate services.

## Traefik CORS Configuration

For distributed tracing to work (frontend traces linking to backend traces), the `sentry-trace` and `baggage` HTTP headers must be allowed through CORS.

The Traefik dynamic configuration template (`docker/traefik/dynamic-config.yml.template`) already includes these headers in the `api-cors` middleware. No additional configuration is needed for Traefik deployments.

If you use `CORS_HANDLED_BY_PROXY=true` with a different reverse proxy, ensure your proxy allows these headers:

```
Access-Control-Allow-Headers: Authorization, Content-Type, Accept, sentry-trace, baggage
```

## GlitchTip Compatibility

GlitchTip implements the Sentry SDK protocol with some limitations:

| Feature | Supported | Notes |
|---------|-----------|-------|
| Error capture | Yes | Full support |
| Performance/tracing | Yes | Basic support |
| Source maps | Yes | Debug IDs since GlitchTip v4.2 |
| Release tracking | Yes | Via sentry-cli |
| Session replay | No | Do not enable `replayIntegration` |
| Profiling | No | Not available |

The SDK is pinned to `@sentry/node@^8` and `@sentry/react@^8` for GlitchTip compatibility.

## Source Map Upload (CI)

Source maps are uploaded automatically during the release workflow using `@sentry/vite-plugin`. The plugin:

1. Injects debug IDs into source files during the Vite build
2. Uploads source maps to GlitchTip
3. Deletes `.map` files from the build output

As a safety net, the app Dockerfile also runs `find ... -name "*.map" -delete` to ensure source maps never ship in production images.

After container publishing, the release workflow runs `sentry-cli` to finalize the release with commit metadata.
