# Enable All Services by Default — Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** All services start by default; users override to disable. Terminal features work in all deployment modes.

**Issue:** #1908
**Related:** #1904 (CORS fix that revealed the underlying 502)
**Epic:** #1667

---

## 1. Docker Compose Changes

### Remove profiles from optional services

In `docker-compose.yml`, `docker-compose.traefik.yml`, and `docker-compose.full.yml`:

- Remove `profiles: ["terminal"]` from `tmux-certs` and `tmux-worker`
- Remove `profiles: ["geo"]` from `nominatim`
- Remove `profiles: ["ml"]` from `prompt-guard`

All services start with plain `docker compose up -d`.

### Add tmux-worker to Traefik compose

`docker-compose.traefik.yml` is missing `tmux-certs` and `tmux-worker` entirely. Add:

- `tmux-certs` init service (identical to `docker-compose.yml` definition)
- `tmux-worker` service with:
  - Same env vars, health checks, depends_on as `docker-compose.yml`
  - SSH enrollment port bound directly to host (bypasses Traefik — TCP, not HTTP)
  - gRPC port internal only (container-to-container via Docker network with mTLS)
- `tmux_certs` and `tmux_data` volumes
- API service additions: `TMUX_WORKER_GRPC_URL`, mTLS cert env vars, `tmux_certs:/certs:ro` volume

### Port routing in Traefik deployments

- **gRPC (50051):** Internal, API → tmux-worker on Docker network. mTLS. No Traefik routing.
- **SSH enrollment (2222):** Direct host port binding (same as basic compose). Traefik TCP routing is a future enhancement.
- **Health (9002):** Internal only, Docker healthcheck.
- **WebSocket terminal I/O:** Already handled — browser connects via `wss://api.DOMAIN/api/terminal/sessions/:id/attach`, API bridges to gRPC.

### Override-to-disable pattern

Users who want to skip services create `docker-compose.override.yml`:

```yaml
services:
  # Disable terminal features
  tmux-certs:
    profiles: ["disabled"]
  tmux-worker:
    profiles: ["disabled"]

  # Disable reverse geocoding
  nominatim:
    profiles: ["disabled"]

  # Disable ML prompt injection detection
  prompt-guard:
    profiles: ["disabled"]
```

Adding `profiles: ["disabled"]` means the service only starts with `--profile disabled` (which nobody passes). Works for both init containers and long-running services. Docker Compose only evaluates `depends_on` for services being started, so disabling a group (tmux-certs + tmux-worker) is safe.

### OpenClaw gateway

Stays in `docker-compose.full.yml` only. Users opt-in by using `-f docker-compose.full.yml`.

---

## 2. UI Graceful Degradation

### API health endpoint

Add `GET /api/terminal/health`:
- Pings gRPC client with a lightweight call
- Returns `200 { "status": "ok" }` if worker responds
- Returns `503 { "status": "unavailable" }` if not

### UI query hook

Add `useTerminalHealth()` hook that calls `GET /api/terminal/health`.

### Terminal page behavior when worker is down

- **Persistent banner:** "Terminal worker is not available. Session and connection test features are disabled."
- **Disabled buttons:** "Test" and "Start Session" buttons disabled
- **CRUD unaffected:** Listing, creating, editing, deleting connections and credentials still work (pure database operations)

### Affected pages

- `ConnectionDetailPage.tsx` — disable "Test" and "Start Session"
- `ConnectionsPage.tsx` — banner at top
- `SessionDetailPage.tsx` — banner if worker goes away mid-session

---

## 3. Testing

### Docker Compose validation

In `docker/traefik/tests/test-entrypoint.sh`:
- Verify `tmux-worker` and `tmux-certs` exist in generated config
- Verify `nominatim` and `prompt-guard` have no `profiles:` key
- Verify override-to-disable pattern excludes services from `docker compose config`

### API unit tests

- `GET /api/terminal/health` returns 200 when gRPC client connects
- `GET /api/terminal/health` returns 503 when gRPC client fails

### UI component tests

- Buttons disabled when `useTerminalHealth()` returns unavailable
- Banner renders when worker is down, absent when up
- CRUD buttons remain enabled regardless

---

## 4. Documentation

### `docs/deployment.md` — rewrite Optional Services section

- All services start by default
- Services table with resource requirements (add terminal worker)
- "Disabling Services" subsection with `docker-compose.override.yml` pattern
- Service groups (tmux-certs + tmux-worker must be disabled together)
- Example overrides: lightweight (no ml + geo), no terminal, minimal (all optional disabled)

### `.env.example`

Ensure tmux-worker variables documented:
- `TMUX_GRPC_PORT` (default 50051)
- `TMUX_SSH_PORT` (default 2222)
