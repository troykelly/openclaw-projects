# Design: IPv6-First Service Bindings (#1128)

**Date:** 2026-02-14
**Issue:** [#1128](https://github.com/troykelly/openclaw-projects/issues/1128)
**Related:** #1129 (SSRF gap), #1130 (Twilio localhost)

## Problem

All compose files and Traefik configuration default to IPv4 (`127.0.0.1`, `0.0.0.0`) for service bindings and inter-service communication. The project should prefer IPv6-first with IPv4 fallback (dual-stack).

## Verified Assumptions

Tested in devcontainer before design:

| Concern | Result |
|---------|--------|
| Node.js/Fastify on `::` dual-stack | IPv4 + IPv6 both respond |
| SeaweedFS `-ip.bind=::` | Master + S3 respond on `127.0.0.1` and `[::1]` inside container |
| `escape_sed()` with `[::1]` | Brackets safe in sed replacement |
| Generated YAML validity | Parses as valid YAML after substitution |
| `http://[::1]:PORT` URL format | Valid per RFC 3986, works in Node URL/fetch/curl |
| Exposure surface | `[::1]` is loopback-only, equivalent to `127.0.0.1` |

## Changes

### Compose files (6)

**`docker-compose.traefik.yml`** and **`docker-compose.full.yml`**:
- Flip port binding order: `[::1]` first, `127.0.0.1` second (all services)
- `SERVICE_HOST` default: `127.0.0.1` → `[::1]`
- Comment: "Set SERVICE_HOST to 127.0.0.1 for IPv4-only environments"
- API `HOST: 0.0.0.0` → `HOST: "::"`
- (full.yml only) `OPENCLAW_BIND: "0.0.0.0"` → `OPENCLAW_BIND: "::"`

**`docker-compose.yml`** and **`docker-compose.quickstart.yml`**:
- Add `[::1]` + `127.0.0.1` dual-bind to published ports
- API `HOST: 0.0.0.0` → `HOST: "::"`

**`docker-compose.test.yml`**:
- Add `[::1]` + `127.0.0.1` dual-bind to postgres and backend ports

**`.devcontainer/docker-compose.devcontainer.yml`**:
- Add `[::1]` + `127.0.0.1` dual-bind to SeaweedFS ports

### Traefik config (4)

**`docker/traefik/dynamic-config.yml.template`**:
- Update architecture comments: `127.0.0.1` → `[::1]`
- Update service comment: default `[::1]`, set to `127.0.0.1` for IPv4

**`docker/traefik/entrypoint.sh`**:
- `SERVICE_HOST` default: `127.0.0.1` → `[::1]`
- Update comment

**`docker/traefik/examples/docker-compose.override.example.yml`**:
- Flip port binding order in examples
- Update `SERVICE_HOST` default in labels

**`docker/traefik/tests/test-entrypoint.sh`**:
- Update test assertions from `127.0.0.1` to `[::1]` where checking default output

### Other services (1)

**`docker/seaweedfs/entrypoint.sh`**:
- `-ip.bind=0.0.0.0` → `-ip.bind=::`

### Ops/docs (4)

**`ops/traefik/dynamic.yml`**:
- Service URLs: `http://127.0.0.1:PORT` → `http://[::1]:PORT`

**`ops/systemd/openclaw-projects.service`**:
- `HOST=127.0.0.1` → `HOST=::`

**`.env.example`**:
- `SERVICE_HOST` default documented as `[::1]`
- `HOST` default documented as `::`
- Flip "set to [::1] for IPv6" → "set to 127.0.0.1 for IPv4-only"

**`docs/deployment.md`**:
- Update architecture diagram, port mapping table, curl examples, SERVICE_HOST docs

## Test Plan

### New tests (4 files)

**`tests/docker/ipv6-first.test.ts`** — Compose structure:
- All compose files: `[::1]` binding listed before `127.0.0.1`
- `SERVICE_HOST` defaults to `[::1]` in traefik/full compose
- API `HOST` is `::` in all compose files with HOST env
- Gateway `OPENCLAW_BIND` is `::` in full compose
- SeaweedFS entrypoint uses `-ip.bind=::`

**`tests/docker/traefik-entrypoint.test.ts`** — Sed substitution:
- Run sed pipeline with `SERVICE_HOST=[::1]`
- Output contains `http://[::1]:PORT` URLs
- Output is valid YAML
- No unsubstituted `${SERVICE_HOST}` placeholders remain

**`tests/api/dual-stack-binding.test.ts`** — Fastify integration:
- Start Fastify on `host: '::'`
- HTTP request to `http://127.0.0.1:PORT` succeeds (IPv4 via dual-stack)
- HTTP request to `http://[::1]:PORT` succeeds (IPv6 native)

**`tests/docker/seaweedfs-ipv6.test.ts`** — Container dual-stack:
- Start SeaweedFS with `-ip.bind=::`
- `docker exec` verify master on `127.0.0.1` and `[::1]`
- `docker exec` verify S3 on `127.0.0.1` and `[::1]`

### Updated tests (2 files)

**`tests/docker/seaweedfs-compose.test.ts`**:
- Update `expect(s3Port).toContain('127.0.0.1')` to assert `[::1]` first

**`docker/traefik/tests/test-entrypoint.sh`**:
- Update default-output assertions from `127.0.0.1` to `[::1]`

## Rollback

Operators on IPv4-only hosts set in `.env`:
```
SERVICE_HOST=127.0.0.1
HOST=0.0.0.0
OPENCLAW_BIND=0.0.0.0
```

## Non-goals

- SSRF filter fix (`[::]` unspecified) → #1129
- Twilio localhost `[::1]` → #1130
- Application code changes (Fastify already defaults to `::` in `src/api/run.ts`)
- Container-internal healthcheck addresses (dual-stack `::` accepts `127.0.0.1`)
