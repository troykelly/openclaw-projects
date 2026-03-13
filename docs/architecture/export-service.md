# Export Service Architecture

Part of Epic #2475 — Notes & Notebooks: Export to PDF, DOCX, and ODF.

## Overview

The export service converts notes and notebooks into downloadable documents (PDF, DOCX, ODF). It requires two system-level tools:

- **Chromium** (headless) — HTML-to-PDF rendering via puppeteer-core
- **pandoc** — HTML-to-DOCX and HTML-to-ODF conversion

## Option A: Embedded (Current)

Chromium and pandoc are installed directly in the API Docker image.

### Pros

- Simpler deployment — single container, no inter-service communication
- No network overhead for export operations
- Easier local development — `docker compose up` just works
- Lower operational complexity for small-to-medium usage volumes

### Cons

- Image size increase: ~200-300 MB for Chromium + shared libs + pandoc
- Chromium runs in the same process space as the API (shared security boundary)
- Cannot scale export capacity independently of API capacity
- Memory spikes from Chromium rendering affect API performance
- OOM risk: a large export could kill the API process

### Mitigations

- Chromium runs as the `node` user (non-root) via the existing `USER node` directive
- `--no-sandbox` is NOT used — we rely on the Debian chromium sandbox
- Export requests should be rate-limited and queued (max concurrent exports)
- Memory limits should be set via Docker/Kubernetes resource constraints

## Option B: Sidecar (Future)

A dedicated export worker container handles all rendering, communicating with the API via an internal queue or HTTP.

### Pros

- Isolated security boundary — Chromium compromise does not affect API
- Independently scalable — add export workers without scaling API
- Smaller API image — faster deploys, lower attack surface
- Memory isolation — Chromium OOM does not affect API availability
- Can use a hardened/minimal Chromium container image

### Cons

- More complex deployment (additional container, networking, health checks)
- Inter-service communication overhead (queue or HTTP)
- More moving parts to monitor and debug
- Overkill for low-volume usage

## Recommendation

**Use embedded (Option A) for now.** The current usage volume does not justify the operational complexity of a sidecar. The export feature is new and usage patterns are unknown.

**Migrate to sidecar (Option B) when any of:**

- Export volume exceeds ~100 exports/day consistently
- Memory pressure from Chromium is observed affecting API latency
- Security audit recommends process isolation for Chromium
- The system moves to Kubernetes where sidecars are a natural pattern

When the sidecar becomes appropriate, create a new issue to implement it. The generation service (Issue #2477) is designed with a `GenerationEngine` interface that abstracts the rendering backend, making the transition straightforward.

---

# ADR: Async Export Job Queue Mechanism

**Issue:** #2484
**Status:** Accepted
**Date:** 2026-03-13
**Author:** teammate-foundation (agent)

## Context

The Notes Export epic (#2475) requires an async pipeline: the API accepts an export request, returns HTTP 202, and a background process generates the document (PDF/DOCX/ODF), uploads it to S3, and updates the `note_export` row.

Three architectural options were evaluated.

## Options Evaluated

### Option 1: In-Process Async

The API handler spawns an async task (via `setImmediate` or a bounded in-process queue) in the same Node.js process.

| Aspect | Assessment |
|--------|------------|
| Complexity | Low — no new process or infra |
| Crash recovery | **Poor** — if the API container crashes mid-generation, the job is lost. Requires startup recovery to reset stuck rows. |
| Resource isolation | **None** — Chromium/pandoc compete with API request handling for CPU and memory |
| Scaling | Scales with API replicas, but each replica must carry Chromium overhead |
| Retry | Must be implemented manually with an in-process retry loop |

### Option 2: DB-Backed Worker Poll (Existing Worker)

The existing worker process (`src/worker/run.ts`) already polls `internal_job` and `webhook_outbox` tables via LISTEN/NOTIFY + fallback polling. Export jobs are added as a new `internal_job` kind.

| Aspect | Assessment |
|--------|------------|
| Complexity | **Low** — adds a new job kind handler, reuses existing claim/complete/fail infrastructure |
| Crash recovery | **Good** — `internal_job_claim` uses advisory locks and atomic state transitions. Stuck jobs auto-recover via the existing `locked_at` timeout. |
| Resource isolation | **Moderate** — worker process is separate from API. However, Chromium/pandoc still run inside the worker container. |
| Scaling | Worker pool is configurable (`WORKER_POOL_MAX`). Multiple worker replicas can run. |
| Retry | **Built-in** — `internal_job` already supports `attempts`, exponential backoff via `internal_job_fail`. |
| LISTEN/NOTIFY | Can reuse `internal_job_ready` channel for immediate pickup |

### Option 3: Dedicated Export Worker (Sidecar)

A separate Docker container with Chromium + pandoc pre-installed polls the `note_export` table directly.

| Aspect | Assessment |
|--------|------------|
| Complexity | **High** — new Dockerfile, compose entry, separate health checks, separate deployment |
| Crash recovery | Good — same DB-backed pattern but with dedicated polling |
| Resource isolation | **Best** — export processing fully isolated from API and general worker |
| Scaling | Independent scaling of export workers |
| Retry | Must implement from scratch (no `internal_job` infrastructure) |

## Decision

**Option 2: DB-Backed Worker Poll** using the existing `internal_job` infrastructure.

### Rationale

1. **Reuse over reinvention**: The existing worker already solves job claiming, locking, retries, dead-lettering, LISTEN/NOTIFY dispatch, circuit breaking, and health monitoring. Adding a new job kind is a fraction of the effort of building a new queue.

2. **Crash recovery is solved**: `internal_job_claim` uses `locked_at` + advisory locks. If the worker crashes, the lock expires and the job is re-claimable. No special startup recovery needed.

3. **Operational simplicity**: No new containers, no new deployment targets. The worker already runs in Docker with health checks and graceful shutdown.

4. **Sufficient isolation**: The worker process is already separate from the API. While Chromium/pandoc share the worker container, export jobs are bounded by `JOB_BATCH_SIZE=10` and sequential processing prevents resource exhaustion.

5. **Path to Option 3**: If export load grows, we can split the worker into a dedicated export sidecar later by simply running a second worker instance with a filter on job kinds. The `internal_job` schema doesn't change.

## Implementation Details

### Job Flow

```
API POST /exports → INSERT note_export (status=pending)
                  → INSERT internal_job (kind='export.generate', payload={export_id})
                  → NOTIFY internal_job_ready

Worker tick → claimJobs() picks up 'export.generate'
           → handler fetches note_export row
           → sets status=generating, started_at=NOW()
           → serialises Lexical → HTML/markdown
           → runs generator (PDF/DOCX/ODF)
           → uploads to S3
           → sets status=ready, storage_key, size_bytes
           → completes internal_job

On failure → sets note_export status=failed, error_message
           → internal_job_fail with exponential backoff
           → after EXPORT_MAX_RETRIES (default 3): status=failed permanently
```

### Schema Additions to note_export (#2476)

- `attempt_count SMALLINT NOT NULL DEFAULT 0` — incremented each time the job transitions to `generating`
- `started_at TIMESTAMPTZ` — set when status transitions to `generating`; used for stuck-job detection

### Stuck Job Recovery

Not needed as a custom mechanism. The existing `internal_job` locking with `locked_at` timeout handles this. If a worker crashes while processing an export:

1. The `internal_job` lock expires after `LOCK_TIMEOUT_MS` (5 minutes)
2. Next worker tick reclaims the job
3. The handler checks `note_export.status = 'generating'` and resets to `pending` if `attempt_count < EXPORT_MAX_RETRIES`
4. If `attempt_count >= EXPORT_MAX_RETRIES`, sets status to `failed`

### Retry Policy

- Maximum retries: `EXPORT_MAX_RETRIES` env var (default: 3)
- Backoff: exponential, inherited from `internal_job` processor (`2^attempts * 60` seconds)
- Retriable errors: S3 upload timeout, Chromium crash, pandoc timeout, temporary DB errors
- Non-retriable errors: note not found, invalid Lexical state, namespace auth failure

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `EXPORT_MAX_RETRIES` | `3` | Max generation attempts before permanent failure |
| `EXPORT_PRESIGNED_URL_TTL_SECONDS` | `3600` | Presigned download URL TTL |
| `PUPPETEER_EXECUTABLE_PATH` | `/usr/bin/chromium` | System Chromium binary path |
| `EXPORT_MAX_CONTENT_BYTES` | `10485760` | Max note content size (10MB) |

## S3 Lifecycle Note

The `pg_cron` job (`note_export_expiry`) only marks rows as `expired` in the DB. It does **not** delete S3 objects — this is intentional because SQL cannot call S3.

S3 cleanup is handled by `expireExports()` in the application layer, which should be called periodically (e.g., by the worker or a dedicated cron job). This function:
1. Finds expired rows with `storage_key` set
2. Deletes the S3 object
3. Only marks the row as `expired` after successful S3 deletion

If S3 deletion fails, the row remains in its current state for retry on the next cycle.
