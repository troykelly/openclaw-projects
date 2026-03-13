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
