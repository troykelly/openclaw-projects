# Containerisation, Deployment, and CI/CD

**Date:** 2026-02-04
**Status:** Design approved, implementation pending

## Problem

openclaw-projects has basic Docker support (dev compose, a prod compose, and Dockerfiles for API/DB/migrate) but lacks:
- Published container images (users must build from source)
- A frontend container (assets are bundled into the API image)
- A reverse proxy / TLS termination setup
- Container hardening (images run as root, no security constraints)
- WAF / OWASP protections
- S3-compatible object storage in the stack (SeaweedFS for dev and production)
- Multi-architecture builds (arm64 users can't run the images)
- CI/CD for building and publishing images
- Proper OCI labelling and versioning

Users need an opinionated, secure, production-ready deployment with `docker compose up`.

## Design Principles

- **Opinionated and modern**: TLS 1.3 only, HTTP/3, no legacy protocol support
- **Environment variables only**: No filesystem configuration files for any container
- **Hardened by default**: Non-root users, read-only filesystems, dropped capabilities
- **Extensible where it matters**: Users can extend Traefik routing via Docker labels or a custom config directory — but can't break the core config

## Container Images

Five container images published to `ghcr.io/troykelly/openclaw-projects-*`:

| Image | Base | UID | Purpose |
|-------|------|-----|---------|
| `openclaw-projects-db` | `postgres:18-bookworm` | 999 (postgres) | PostgreSQL 18 + pgvector, TimescaleDB, pg_cron, PostGIS |
| `openclaw-projects-api` | `node:25-bookworm-slim` | 1000 (node) | Fastify API server |
| `openclaw-projects-app` | `nginx:1-alpine` | 101 (nginx) | Static frontend via nginx (multi-stage: Node build → nginx) |
| `openclaw-projects-migrate` | `migrate/migrate` | non-root | One-shot database migration runner |

Upstream images referenced directly in compose (not published by us):
- `traefik:3.6` — reverse proxy, TLS termination, HTTP/3
- `owasp/modsecurity-crs:4-apache-alpine` — WAF sidecar
- `chrislusf/seaweedfs` — S3-compatible object storage

### Container Hardening (all images)

**Dockerfile level:**
- `USER` directive — no container runs as root
- Multi-stage builds where applicable (app: node build stage → nginx runtime stage)
- Only required ports `EXPOSE`d
- `.dockerignore` excludes `.env`, `.git`, `node_modules`, `docs/`, `tests/`
- Pinned base image versions (major.minor, not `latest`)
- No secrets baked into images

**Compose level (both compose files):**
- `read_only: true` on all containers except postgres and seaweedfs (need write to data dirs)
- `tmpfs` mounts for `/tmp` and `/var/run` where needed
- `security_opt: [no-new-privileges:true]` on all containers
- `cap_drop: [ALL]` on all containers, `cap_add` only what's required
- Health checks on every service
- Resource limits with sensible defaults (`mem_limit`, `cpus`)

**CI level:**
- Trivy vulnerability scanning before push (block on critical/high CVEs)
- OCI labels with full provenance
- SBOM generation

## Compose File: Basic (`docker-compose.yml`)

For localhost development or deployment behind an existing reverse proxy.

Services: `db`, `seaweedfs`, `migrate` (one-shot), `api`, `app`

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌────────────┐
│   app    │     │   api    │     │    db    │     │ seaweedfs  │
│  :8080   │     │  :3000   │◄────│  :5432   │     │   :8333    │
│  (nginx) │     │ (fastify)│────►│ (pg 18)  │     │  (S3 API)  │
└────┬─────┘     └────┬─────┘     └──────────┘     └────────────┘
     │                │                 ▲
host:FRONTEND_PORT  host:API_PORT       │
                                   migrate (one-shot)
```

Key environment variables:
- `API_PORT=3000` — host-mapped port for API
- `FRONTEND_PORT=8080` — host-mapped port for frontend
- `POSTGRES_USER=openclaw`, `POSTGRES_PASSWORD` (required), `POSTGRES_DB=openclaw`
- `PUBLIC_BASE_URL=http://localhost:3000`
- `COOKIE_SECRET` (required)
- `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` — auto-configured for SeaweedFS
- All Postmark/Twilio/embedding provider vars remain optional

No TLS, no Traefik — plain HTTP intended for localhost or behind an existing proxy.

## Compose File: Full (`docker-compose.traefik.yml`)

Production deployment with Traefik 3.6, ModSecurity WAF, TLS, and HTTP/3.

Services: `traefik`, `modsecurity`, `db`, `seaweedfs`, `migrate` (one-shot), `api`, `app`

```
Internet
   │
   ▼
┌──────────────────────────────────┐
│           traefik                │
│  :443 (HTTPS + HTTP/3 QUIC)     │
│  :80  (optional redirect only)  │
│  TLS 1.3 minimum, Strict SNI    │
└──┬──────────┬───────────────────┘
   │          │
   ▼          ▼
┌────────┐  ┌────────┐     ┌───────────────┐
│  app   │  │  api   │◄───►│ modsecurity   │
│  /app  │  │  /api  │     │ (OWASP CRS)   │
└────────┘  └────┬───┘     └───────────────┘
                 │
           ┌─────┴─────┐
           │     db    │
           │ seaweedfs │
           └───────────┘
```

### Traefik — Modern Web Configuration

**TLS (opinionated, modern-only):**
- `minVersion: VersionTLS13` — TLS 1.3 only, no TLS 1.2
- `sniStrict: true` — reject connections without SNI extension
- Modern curve preferences (X25519, CurveP384)
- Session tickets enabled (TLS 1.3 manages this safely)

**HTTP/3:**
- QUIC enabled on the HTTPS entrypoint
- Port 443 exposed as both TCP and UDP in compose
- `Alt-Svc` header advertised automatically by Traefik

**HTTP entrypoint:**
- Default: listen on port 80, redirect all traffic to HTTPS (301 permanent)
- `DISABLE_HTTP=true`: do not listen on HTTP at all (for use behind another LB)

**Security headers middleware (applied to all routes):**
- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `X-XSS-Protection: 0` (modern browsers use CSP instead)

**DNS-01 ACME (split-horizon safe):**
- `propagation.disableChecks: true` — skip DNS server verification
- `propagation.delayBeforeChecks: 30` — wait 30 seconds for DNS propagation
- Supports any Lego DNS provider via `ACME_DNS_PROVIDER` env var
- Provider-specific env vars passed through (e.g., `CF_DNS_API_TOKEN` for Cloudflare)
- Documented examples for Cloudflare and AWS Route53

**Behind-another-load-balancer support:**
- `TRUSTED_IPS` env var configures both `proxyProtocol.trustedIPs` and `forwardedHeaders.trustedIPs`
- `HTTPS_PORT=443`, `HTTP_PORT=80` — overridable listening ports

**Key environment variables:**
- `DOMAIN=example.com` (required)
- `ACME_EMAIL=admin@example.com` (required)
- `ACME_DNS_PROVIDER=cloudflare` (default, any Lego provider supported)
- Provider env vars (e.g., `CF_DNS_API_TOKEN`, `AWS_ACCESS_KEY_ID`, etc.)
- `HTTPS_PORT=443`, `HTTP_PORT=80`
- `DISABLE_HTTP=false`
- `TRUSTED_IPS=` (comma-separated CIDRs)
- `MODSEC_PARANOIA_LEVEL=1` (1-4)

### Extensible Traefik Configuration

Two extension mechanisms:

**1. Docker provider (primary):**
Users add services to the compose (or `docker-compose.override.yml`) with standard Traefik Docker labels. Our `api` and `app` services use labels for routing — users can add their own services the same way.

**2. File provider directory (`traefik-custom/`):**
Traefik watches `/etc/traefik/dynamic/custom/` for additional `.yml` files. Users can optionally bind-mount a local `traefik-custom/` directory. Safety guarantees:
- Our core dynamic config lives in a separate path (`/etc/traefik/dynamic/system/`) that users cannot mount over
- Traefik's file provider ignores malformed YAML and logs a warning — existing routes continue working
- Users cannot break system routes, only add to them

### ModSecurity WAF Sidecar

- Image: `owasp/modsecurity-crs:4-apache-alpine`
- OWASP Core Rule Set enabled by default
- Traefik routes API requests through ModSecurity via forwardAuth middleware
- Configurable paranoia level via `MODSEC_PARANOIA_LEVEL` (1 = low false positives, 4 = maximum security)
- Internal-only: not exposed to host network

### SeaweedFS

- Image: `chrislusf/seaweedfs`
- Runs in single-server mode (`weed server -s3`) — master + volume + filer + S3 gateway
- S3 API on port 8333 (internal only, not exposed to host)
- Volume mount required for data persistence
- Environment variables:
  - `SEAWEEDFS_VOLUME_SIZE_LIMIT_MB=30000`
  - `S3_ACCESS_KEY` / `S3_SECRET_KEY` auto-configured to match API expectations

## CI/CD Pipeline

Single GitHub Actions workflow: `.github/workflows/containers.yml`

### Trigger Strategy

| Trigger | Tags produced | Push? |
|---------|--------------|-------|
| Push to `main` | `edge` | Yes |
| Push semver tag `v1.2.3` | `1.2.3`, `1.2`, `1`, `latest` | Yes |
| Pull request | none | No (build + scan only) |

### Build Matrix

```yaml
strategy:
  matrix:
    image: [db, api, app, migrate]
```

### Per-Image Steps

1. `docker/setup-qemu-action@v3` — multi-arch emulation
2. `docker/setup-buildx-action@v3` — BuildKit
3. `docker/login-action@v3` — authenticate to ghcr.io
4. `docker/metadata-action@v5` — generate OCI labels + semver tags
5. `docker/build-push-action@v6` — build `linux/amd64` + `linux/arm64`
6. `aquasecurity/trivy-action` — vulnerability scan (fail on CRITICAL/HIGH)
7. Push to `ghcr.io/troykelly/openclaw-projects-{image}`

### OCI Labels (all images)

- `org.opencontainers.image.title`
- `org.opencontainers.image.description`
- `org.opencontainers.image.version`
- `org.opencontainers.image.created`
- `org.opencontainers.image.source` → GitHub repo URL
- `org.opencontainers.image.url` → GitHub repo URL
- `org.opencontainers.image.revision` → commit SHA
- `org.opencontainers.image.licenses`
- `org.opencontainers.image.authors`
- `org.opencontainers.image.base.name` → base image reference

## MinIO Removal (Completed)

MinIO has been removed and replaced with SeaweedFS:
- Deleted MinIO service from `.devcontainer/docker-compose.devcontainer.yml`
- Added SeaweedFS service to devcontainer
- Removed all MinIO references from documentation, scripts, and env examples
- Updated dev-setup scripts to use SeaweedFS

## Research Sources

- [Traefik ACME DNS-01 Configuration](https://doc.traefik.io/traefik/reference/install-configuration/tls/certificate-resolvers/acme/)
- [Traefik EntryPoints Reference](https://doc.traefik.io/traefik/reference/install-configuration/entrypoints/)
- [Traefik TLS Options Reference](https://doc.traefik.io/traefik/reference/routing-configuration/http/tls/tls-options/)
- [Traefik v3 Propagation Settings](https://community.traefik.io/t/acme-dnschallenge-delaybeforecheck-will-be-ignored/24838)
- [Traefik HTTP/3 Configuration](https://www.catchpoint.com/http2-vs-http3/traefik-http-3)
- [Coraza WAF WASM Plugin](https://plugins.traefik.io/plugins/65f2aea146079255c9ffd1ec/coraza-waf)
- [ModSecurity CRS Plugin for Traefik](https://github.com/acouvreur/traefik-modsecurity-plugin)
- [OCI Image Annotations Spec](https://specs.opencontainers.org/image-spec/annotations/)
- [Docker Metadata Action](https://github.com/docker/metadata-action)
- [Docker Build Push Action Multi-Platform](https://docs.docker.com/build/ci/github-actions/multi-platform/)
- [Docker Container Hardening Best Practices](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html)
- [Sysdig Top 20 Dockerfile Best Practices](https://www.sysdig.com/learn-cloud-native/dockerfile-best-practices)
- [SeaweedFS Docker Compose](https://github.com/seaweedfs/seaweedfs/blob/master/docker/seaweedfs-compose.yml)
- [SeaweedFS S3 Workloads](https://blog.bitexpert.de/blog/seaweedfs_s3)
- [Traefik Releases](https://github.com/traefik/traefik/releases) — latest stable v3.6.7
