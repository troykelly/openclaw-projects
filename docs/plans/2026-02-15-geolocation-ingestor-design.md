# Geolocation Ingestor Plugin System

**Date:** 2026-02-15
**Status:** Approved
**Depends on:** Epic #1204 (Geolocation-Aware Memory)

## Problem

The geolocation memory system (#1204) requires agents to explicitly provide user location on every memory store/recall call. This adds burden to OpenClaw agents and means location context is only available when agents remember to include it.

Users have existing location infrastructure (Home Assistant, MQTT-based trackers, mobile apps) that continuously knows where they are. This epic builds an automatic ingestion layer that pulls location from those sources and injects it into functions that use or require it — removing the agent from the loop for location context.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Architecture | Dedicated geolocation subsystem | Domain is distinct enough (persistent connections, time-series, multi-provider priority) to warrant its own tables and service layer |
| Location history storage | TimescaleDB hypertable with embeddings | Native retention policies, efficient time-range queries, semantic search on geocoded addresses |
| Provider model | Shared connections with per-user subscriptions | One HA WebSocket serves multiple users; avoids duplicate connections |
| HA connectivity | WebSocket primary, REST fallback | Real-time push with REST for verification and initial state |
| HA authentication | OAuth2 + long-lived access tokens | OAuth for Nabu Casa/public HA, tokens for local-only setups |
| MQTT format support | OwnTracks + HA MQTT + custom JSONPath | Covers common formats with extensibility for arbitrary payloads |
| Transport security | TLS-only for all providers | HTTPS/WSS for HA, MQTTS for MQTT, Traefik-enforced for webhooks. No exceptions. |
| Location injection | Server-side auto-inject + explicit API endpoint | Zero agent effort by default, explicit endpoint for agent-driven queries |
| Ingestion pipeline | Two-stage: hot path (insert) + background (geocode + embed) | Keeps ingestion fast, Nominatim/embeddings are non-blocking |
| Retention | Two-tier: high-res window + general downsampled | User-configurable, only affects raw location data — never memories or embeddings |

---

## Data Model

### Types

```sql
CREATE TYPE geo_provider_type AS ENUM ('home_assistant', 'mqtt', 'webhook');
CREATE TYPE geo_auth_type AS ENUM ('oauth2', 'access_token', 'mqtt_credentials', 'webhook_token');
CREATE TYPE geo_provider_status AS ENUM ('active', 'inactive', 'error', 'connecting');
```

### `geo_provider` — Physical connection (shared infrastructure)

```sql
CREATE TABLE geo_provider (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email           text NOT NULL REFERENCES user_setting(email),
  provider_type         geo_provider_type NOT NULL,
  auth_type             geo_auth_type NOT NULL,
  label                 text NOT NULL,
  status                geo_provider_status NOT NULL DEFAULT 'inactive',
  status_message        text,

  config                jsonb NOT NULL DEFAULT '{}',
  credentials           bytea,                        -- encrypted at rest
  poll_interval_seconds integer,                      -- null = push-only
  max_age_seconds       integer NOT NULL DEFAULT 900, -- staleness threshold
  is_shared             boolean NOT NULL DEFAULT false,

  -- Multi-worker support (follow-up)
  -- claimed_by         text,
  -- claimed_at         timestamptz,

  last_seen_at          timestamptz,
  deleted_at            timestamptz,                  -- soft delete
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_geo_provider_max_age CHECK (max_age_seconds > 0)
);

CREATE INDEX idx_geo_provider_owner ON geo_provider (owner_email) WHERE deleted_at IS NULL;
```

### `geo_provider_user` — Per-user subscription with entity mapping

```sql
CREATE TABLE geo_provider_user (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id     uuid NOT NULL REFERENCES geo_provider(id) ON DELETE CASCADE,
  user_email      text NOT NULL REFERENCES user_setting(email),
  priority        integer NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,

  -- Entity mapping: [{entity_id, label, priority}]
  -- Entity assignments are set by the provider owner, not self-service
  entities        jsonb NOT NULL DEFAULT '[]',

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_geo_provider_user UNIQUE (provider_id, user_email),
  CONSTRAINT chk_geo_provider_user_priority CHECK (priority >= 0)
);

CREATE INDEX idx_geo_provider_user_email ON geo_provider_user (user_email);
```

### `geo_location` — TimescaleDB hypertable for location history

```sql
CREATE TABLE geo_location (
  time               timestamptz NOT NULL DEFAULT now(),
  user_email         text NOT NULL,
  provider_id        uuid NOT NULL REFERENCES geo_provider(id) ON DELETE CASCADE,
  entity_id          text,

  lat                double precision NOT NULL,
  lng                double precision NOT NULL,
  accuracy_m         double precision,
  altitude_m         double precision,
  speed_mps          double precision,
  bearing            double precision,
  indoor_zone        text,

  address            text,
  place_label        text,
  raw_payload        jsonb,

  location_embedding vector(1024),
  embedding_status   text DEFAULT 'pending',

  CONSTRAINT chk_geo_location_lat CHECK (lat >= -90 AND lat <= 90),
  CONSTRAINT chk_geo_location_lng CHECK (lng >= -180 AND lng <= 180)
);

SELECT create_hypertable('geo_location', 'time');

CREATE INDEX idx_geo_location_user_time ON geo_location (user_email, time DESC);
CREATE INDEX idx_geo_location_provider ON geo_location (provider_id, time DESC);
CREATE INDEX idx_geo_location_coords ON geo_location (lat, lng);
CREATE INDEX idx_geo_location_embedding
  ON geo_location USING hnsw (location_embedding vector_cosine_ops)
  WHERE location_embedding IS NOT NULL;
```

### Retention settings — added to `user_setting`

```sql
ALTER TABLE user_setting
  ADD COLUMN geo_auto_inject             boolean NOT NULL DEFAULT false,
  ADD COLUMN geo_high_res_retention_hours integer NOT NULL DEFAULT 168,
  ADD COLUMN geo_general_retention_days   integer NOT NULL DEFAULT 365,
  ADD COLUMN geo_high_res_threshold_m     double precision NOT NULL DEFAULT 50.0;
```

Retention logic (pgcron job):
1. Records older than `geo_high_res_retention_hours` with accuracy <= threshold: downsample to best-accuracy per hour
2. Records older than `geo_general_retention_days`: delete entirely
3. Only affects `geo_location` — memories and embeddings are never touched

### Current location resolution algorithm

1. Query `geo_location` for the most recent record per active provider/entity within `max_age_seconds`
2. Filter by: `geo_provider.status = 'active'`, `geo_provider_user.is_active = true`, `geo_provider.deleted_at IS NULL`
3. Rank by: `geo_provider_user.priority` ASC, then entity sub-priority ASC, then `accuracy_m` ASC
4. Return top result or null

---

## API Surface

### Provider Management

```
POST   /api/geolocation/providers                    — Create provider
GET    /api/geolocation/providers                    — List providers (owned + shared subscriptions)
GET    /api/geolocation/providers/:id                — Get provider (scoped by ownership/subscription)
PATCH  /api/geolocation/providers/:id                — Update config (owner only)
DELETE /api/geolocation/providers/:id                — Soft-delete (owner only)
POST   /api/geolocation/providers/:id/verify         — Test connection, return sample entities
GET    /api/geolocation/providers/:id/entities        — List available entities from connected provider
POST   /api/geolocation/providers/:id/share          — Toggle sharing, assign entities to users (owner only)
POST   /api/geolocation/providers/:id/rotate-token   — Regenerate webhook token (owner only)
```

Create body varies by type:

```typescript
// Home Assistant
{ provider_type: "home_assistant", auth_type: "oauth2" | "access_token",
  label: string, config: { url: string }, access_token?: string }

// MQTT
{ provider_type: "mqtt", auth_type: "mqtt_credentials",
  label: string, config: { host: string, port: number,
    ca_cert?: string, format: "owntracks" | "home_assistant" | "custom",
    topics: string[], payload_mapping?: { lat: string, lng: string, accuracy?: string } },
  credentials: { username: string, password: string } }

// Webhook
{ provider_type: "webhook", auth_type: "webhook_token", label: string }
// Response includes auto-generated webhook_url and webhook_token
```

Share body (owner only):

```typescript
{ is_shared: boolean,
  user_assignments?: [{ user_email: string, priority: number,
    entities: [{ entity_id: string, label: string, priority: number }] }] }
```

Entity uniqueness enforced: same entity cannot be assigned to multiple users on the same provider.

Non-owners see only: `id`, `label`, `provider_type`, simplified status, and their own entity assignments. Never: `config`, `credentials`, `status_message`.

Per-user provider limit: 10 providers, 50 entities total.

### HA OAuth

```
GET    /api/geolocation/oauth/authorize              — Generate HA OAuth URL (PKCE + state)
GET    /api/geolocation/oauth/callback               — Handle HA OAuth redirect
```

Separate from existing `/api/oauth/*` because the OAuth server URL is dynamic (per HA instance).

### User Subscriptions

```
GET    /api/geolocation/subscriptions                — List my subscriptions
PATCH  /api/geolocation/subscriptions/:id            — Update my priority or active state
```

Users can adjust priority and toggle active/inactive on subscriptions assigned to them by the owner. Cannot add entities or self-subscribe.

Priority conflicts auto-reorder (shift others down).

### Current Location

```
GET    /api/geolocation/current                      — Resolved current location
```

Response:

```typescript
{ lat: number, lng: number, accuracy_m: number,
  address?: string, place_label?: string, indoor_zone?: string,
  provider_label: string, entity_id: string,
  age_seconds: number, stale: boolean }
// 404 if no recent location
```

### Location History

```
GET    /api/geolocation/history?from=&to=&limit=     — Time-range query
POST   /api/geolocation/history/search               — Semantic search against location embeddings
```

Semantic search uses hybrid: vector similarity + full-text on address/place_label/indoor_zone. Falls back to text-only when no embeddings match.

### Webhook Ingestion

```
POST   /api/geolocation/webhook/:provider_id         — Receive location update
       Authorization: Bearer <webhook_token>
```

Public endpoint (no session auth). Per-provider rate limiting. Max payload 10KB. Supports standard schema and OwnTracks HTTP format.

Response: `{ ok: true }` — minimal, no internal state leaked.

### Retention Settings

Added to existing `PATCH /api/settings`:

```typescript
{ geo_auto_inject: boolean,
  geo_high_res_retention_hours: number,  // 1-2160
  geo_general_retention_days: number,    // 1-3650
  geo_high_res_threshold_m: number }     // 1-10000
```

### Auto-Injection

Implemented as a Fastify `preHandler` hook. Routes opt in with `{ geoAutoInject: true }` in route config.

Initial routes:
- `POST /api/memories/unified` — attach location to stored memories
- `POST /api/memories/bulk` — same
- `GET /api/memories/search` — attach location context to recall

Behaviour:
- If request includes explicit `lat`/`lng` — use explicit, set `X-Geo-Source: explicit`
- If no location + user has `geo_auto_inject = true` + current location available — inject, set `X-Geo-Source: auto`
- If no location + auto-inject disabled or no current location — proceed without location (no error)

---

## Provider Plugin Architecture

### Interface

```typescript
interface GeoProviderPlugin {
  readonly type: GeoProviderType;
  readonly supportedAuthTypes: GeoAuthType[];

  validateConfig(config: unknown): Result<ProviderConfig, ValidationError>;
  verify(provider: GeoProvider): Promise<VerifyResult>;
  discoverEntities(provider: GeoProvider): Promise<EntityInfo[]>;
  connect(provider: GeoProvider, onUpdate: LocationUpdateHandler): Promise<Connection>;
  poll(provider: GeoProvider, entityIds: string[]): Promise<LocationUpdate[]>;
  parsePayload(raw: unknown, format?: string): Result<LocationUpdate[], ParseError>;
}

interface Connection {
  readonly status: 'connected' | 'reconnecting' | 'disconnected';
  disconnect(): Promise<void>;
  addEntities(entityIds: string[]): Promise<void>;
  removeEntities(entityIds: string[]): Promise<void>;
}

interface LocationUpdate {
  entity_id: string;
  lat: number;
  lng: number;
  accuracy_m?: number;
  altitude_m?: number;
  speed_mps?: number;
  bearing?: number;
  indoor_zone?: string;
  raw_payload?: Record<string, unknown>;
  timestamp?: Date;
}
```

### Provider Registry

```typescript
// src/api/geolocation/registry.ts
const registry = new Map<GeoProviderType, GeoProviderPlugin>();
export function registerProvider(plugin: GeoProviderPlugin): void;
export function getProvider(type: GeoProviderType): GeoProviderPlugin | undefined;

// Registered at startup
registerProvider(new HomeAssistantProvider());
registerProvider(new MqttProvider());
registerProvider(new WebhookProvider());
```

### Provider Implementations

**Home Assistant** (`providers/home-assistant.ts`):
- `connect()`: WSS WebSocket, authenticates with token, subscribes to `state_changed` for tracked entities
- `poll()`: `GET /api/states/{entity_id}` REST fallback
- `verify()`: Connects, fetches `/api/` for version info, lists `device_tracker.*` + `person.*` + `sensor.bermuda_*`
- `discoverEntities()`: Filters to location-capable entities, returns with friendly names
- Handles OAuth token refresh
- Reconnects with exponential backoff + jitter

**MQTT** (`providers/mqtt.ts`):
- `connect()`: MQTTS connection, subscribes to configured topics
- `poll()`: N/A — push-only
- `verify()`: Connects, subscribes, waits up to 10s for a message
- `parsePayload()`: Dispatches to format-specific parsers (OwnTracks, HA MQTT, custom JSONPath)
- `addEntities()`/`removeEntities()`: Actually subscribes/unsubscribes MQTT topics on the live connection
- Validates TLS certificate (supports custom CA)
- JSONPath restricted to simple property access (no recursive descent, no filters)

**Webhook** (`providers/webhook.ts`):
- `connect()`: No-op (passive, inbound HTTP)
- `verify()`: Returns webhook URL, confirms endpoint registered
- `parsePayload()`: Standard schema + OwnTracks HTTP format detection

### SSRF Protection

Centralised in `providers/network-guard.ts`:
- `validateOutboundUrl(url)`: Rejects private/reserved IPs, non-TLS schemes (`http://`, `ws://`), file/ftp schemes
- `validateOutboundHost(host, port)`: DNS resolution then IP validation
- All providers call these before any outbound connection

### Worker: Connection Manager

```typescript
class GeoConnectionManager {
  private connections = new Map<string, Connection>();

  async initialize(): Promise<void>;          // Reconnect all active providers on startup
  async startProvider(providerId: string): Promise<void>;
  async stopProvider(providerId: string): Promise<void>;
  async updateEntities(providerId: string): Promise<void>;
  getStatus(): Map<string, ConnectionStatus>;
}
```

Listens for pg NOTIFY on provider config changes. SIGTERM handler cleanly disconnects all connections with 5-second grace period.

Reconnection: exponential backoff with random jitter. Stagger initial reconnections on startup across 30 seconds.

### Ingestion Pipeline

Shared across all providers:

```
Provider emits LocationUpdate
  -> Validate: lat/lng ranges, accuracy non-negative, entity_id sanitised
  -> Per-provider per-entity rate limit (min_interval_seconds, default 10s)
  -> Dedup: same entity, <5m distance, <30s ago -> update timestamp only
  -> Resolve user_email via geo_provider_user entity mapping
  -> Unmatched entity_id -> silently dropped
  -> INSERT into geo_location (hot path, synchronous)
  -> Update geo_provider.last_seen_at
  -> Background: geocode records where address IS NULL (Nominatim, async)
  -> Background: generate embeddings where address changed (database-backed queue)
```

### Adding a New Provider

1. Create `src/api/geolocation/providers/new-provider.ts` implementing `GeoProviderPlugin`
2. Add type to `geo_provider_type` enum (migration)
3. Register in `registry.ts`
4. Add config validation schema
5. Add UI config form component

No changes to ingestion pipeline, API routes, or data model.

---

## Security Constraints

### Transport Security

- **All providers: TLS-only, no exceptions**
- HA: `https://` and `wss://` only — reject `http://` and `ws://` at config validation and connection time
- MQTT: `mqtts://` only — port 8883 default, no plaintext connections
- Webhook: HTTPS enforced at Traefik level and validated in code
- MQTT self-signed certs supported via optional CA certificate field — never disable certificate validation

### Credential Management

- Credentials encrypted at rest using existing `crypto.ts` pattern (encryptToken/decryptToken)
- API never returns stored credentials to the frontend — write-only
- Webhook tokens: returned on creation and explicit reveal (separate API call); minimum 256-bit cryptographically random

### Shared Provider Access Control

- Entity-to-user assignments set by owner only — not self-service
- Non-owners see only: label, provider type, simplified status, own entity assignments
- Non-owners never see: config, credentials, status_message, raw_payload
- Same entity cannot be assigned to multiple users on the same provider
- Users see assigned subscriptions and can toggle active/priority — cannot add entities

### Input Validation

- All provider configs validated per type (URL format, port range, topic patterns, cert size)
- SSRF protection via centralised `network-guard.ts` with DNS resolution validation
- JSONPath expressions restricted to simple property access — no recursive descent or filter expressions
- Webhook payloads: max 10KB, JSON depth limit
- Config JSONB: max 50KB
- CA certificate: max 10KB
- Entity IDs: max length, no control characters
- Ingestion validation: lat/lng ranges, accuracy < 100km, speed < 1000 m/s, timestamp not future, not > 1h past

### Rate Limiting

- Webhook endpoint: per-provider rate limit (reuse #1225 infrastructure)
- Verify endpoint: 5 per minute per user
- Per-provider per-entity ingestion rate limit (min_interval_seconds)
- Per-user provider limit: 10 providers, 50 entities total

### Privacy

- Location data is PII — right-to-deletion cascades from user account deletion
- Soft-delete on providers — location history retained until retention policies expire it
- raw_payload may contain sensitive device data — consider stripping non-essential fields
- Retention settings UI has explicit warning that memories/embeddings are never affected
- `geo_auto_inject` requires explicit opt-in (default false)
- Consent notice in UI for tracking other people's HA entities

---

## Frontend Settings UI

### Settings Navigation

New **"Location"** section between Connected Accounts and Appearance.

### Page Layout

1. **Auto-Inject Toggle** — explicit opt-in with explanation text
2. **Current Location Card** — resolved location, provider source, freshness, accuracy. Polls every 30s.
3. **My Providers** — drag-and-drop reorderable cards (dnd-kit with keyboard accessibility). Each card shows: label, type, auth method, entity count, status, verify/edit/delete actions.
4. **Shared With Me** — subscriptions from other users' shared providers. Toggle active, change priority. No edit/delete.
5. **Data Retention** — high-res hours, general days, accuracy threshold inputs with validation (min/max bounds). Warning banner about memories/embeddings.

### Add Provider Flow

Modal with three steps:
1. Choose type (Home Assistant / MQTT / Webhook)
2. Configure (type-specific form with inline validation, TLS enforcement notices)
3. Verify + entity selection (test connection, pick entities to track)

### Type-Specific Config Forms

- **HA**: Label, auth method (OAuth or access token), URL (HTTPS only), token field, entity picker from discovered entities, share toggle. Inline link to HA docs for token creation.
- **MQTT**: Label, broker host, port (default 8883), username/password, optional CA cert, message format selector (OwnTracks/HA/Custom), topics, TLS-only notice.
- **Webhook**: Label, auto-generated URL + token with copy buttons (truncated by default, expand on click), sample payload documentation, OwnTracks HTTP format note.

### Sharing Flow

Owner's edit view has a Share tab: toggle sharing, assign entities to platform users (type-ahead search, restricted to opted-in users), entity-per-user mapping.

### UI Security

- Stored credentials never returned to frontend — write-only fields
- Webhook URL/token displayed truncated by default, expand on click with auto-hide
- Delete and token rotation require confirmation dialogs
- Provider error messages sanitised for non-owners
- Entity names from external systems rendered only via React JSX auto-escaping (never raw HTML injection)
- OAuth callback redirects to `/settings?section=location` with provider edit state

### Component Structure

```
src/ui/components/settings/
  location-section.tsx
  location-current.tsx
  location-provider-card.tsx
  location-provider-form.tsx
  location-ha-config.tsx
  location-mqtt-config.tsx
  location-webhook-config.tsx
  location-entity-picker.tsx
  location-share-form.tsx
  location-retention.tsx
  use-geolocation.ts
```

Uses: dnd-kit, shadcn/ui (Alert, Card, Dialog, Toggle, Input, Select), TanStack React Query.

---

## Testing Strategy

### Unit Tests

**Provider parsers**: OwnTracks location + transition, HA state_changed, HA Bermuda, custom JSONPath. Malformed payloads, missing fields, recorded fixtures in `test/fixtures/geo/`.

**Network guard**: Private IP rejection, scheme validation, DNS resolution to private IP blocked.

**Geo utilities**: Haversine distance, dedup logic, ingestion rate limiting, scoring.

**Config validation**: Per-type schema validation, TLS enforcement, size limits, JSONPath restrictions.

**Current location resolution**: Single/multiple providers, priority ordering, accuracy tiebreaking, staleness exclusion, null result.

**Retention logic**: High-res window untouched, beyond-window downsampled, beyond-general deleted, memories unaffected.

**Payload parser robustness**: Property-based tests (fast-check) — random payloads never throw, extreme values rejected.

### Integration Tests (real PostgreSQL)

**Database operations**: Provider CRUD with soft-delete, encrypted credential round-trip, subscription CRUD, auto-reorder on priority conflict, hypertable insert, dedup, time-range queries, retention job execution, embedding queue processing, cascade on user deletion.

**Auto-injection**: With/without current location, with/without opt-in, explicit location takes precedence, X-Geo-Source header, backward compatibility for users without providers.

**Webhook endpoint**: Valid/invalid token, malformed payload, rate limiting, oversized payload, token rotation.

**Authorization boundaries**: User A cannot access user B's providers/location. Non-owners cannot see config/credentials. Users cannot query other users' location history.

**Credential encryption**: Round-trip verify — raw bytea is not plaintext.

**Concurrent priority updates**: Two simultaneous requests produce consistent state.

**TLS enforcement**: Plaintext connection attempts rejected at every layer.

**Embedding dedup**: Same address skips embedding, new address generates new embedding.

**Provider limit enforcement**: Creating beyond limit returns error.

**Entity uniqueness**: Same entity to two users on same provider rejected.

### Provider Integration Tests (mock servers)

**HA mock** (`test/mocks/ha-server.ts`): WebSocket auth + state_changed, REST endpoints, injectable failures. Bind to 127.0.0.1, random ports.

**MQTT mock** (`test/mocks/mqtt-broker.ts`): aedes in-process TLS broker, configurable payloads. Bind to 127.0.0.1, random ports.

Tests: connect, authenticate, receive, parse LocationUpdate, reconnection with backoff, HA token refresh, HA verify with entity list, MQTT subscribe and parse, MQTT plaintext rejected.

### HA OAuth Tests

Mock OAuth server: authorize URL generation with PKCE + state, callback with valid/invalid code, token exchange, token refresh, refresh failure to error status.

### Worker Tests

**Restart recovery**: Active providers in DB, connection manager initialises, reconnects all.

**Config change propagation**: PATCH config, pg NOTIFY, worker reconnects with new config.

**Nominatim unavailability**: Location stored without address, backfilled when Nominatim recovers.

**Graceful shutdown**: SIGTERM, all connections cleanly disconnected.

### E2E Tests

Full ingestion pipeline per provider type. Multi-provider priority resolution. Shared provider flow. Auto-injection round-trip. Semantic history search. Retention job execution.

### Frontend Tests

Component rendering, add provider flow, config form validation, retention input bounds, priority reorder (drag-and-drop + keyboard), shared provider limitations, delete/rotate confirmation dialogs.

### Performance Assertions

Query time thresholds on current location resolution (<10ms), hypertable inserts, retention job duration. Not full load tests but regression-catching assertions.

---

## Implementation Phases

| Phase | Scope | Parallelisable |
|-------|-------|----------------|
| 1 | DB migration (tables, hypertable, user_setting columns) | No (foundation) |
| 2 | Provider plugin interface + registry + network guard + SSRF protection | No (provides abstractions) |
| 3 | Ingestion pipeline (dedup, rate limit, validation, insert) + background workers (geocode, embed) | No (needs plugin interface) |
| 4a | Home Assistant provider | Yes |
| 4b | MQTT provider | Yes |
| 4c | Webhook provider + endpoint | Yes |
| 5 | API routes (provider CRUD, subscriptions, current, history, share, verify, entities, OAuth) | After phase 3 |
| 6 | Auto-injection preHandler hook + memory route integration | After phase 5 |
| 7 | Frontend settings UI (location section, provider forms, entity picker, retention, sharing) | After phase 5 |
| 8 | Retention pgcron job | After phase 1 |
| 9 | E2E tests + backward compatibility verification | After all |

Phases 4a/4b/4c are independent and can be parallelised across agents/teammates.

---

## Follow-Up Items (out of scope, tracked as separate issues)

- Multi-worker advisory locking for connection ownership
- OwnTracks region/transition handling for indoor_zone
- Location history map visualisation in frontend
- Provider health notifications via the notification system
- Load testing at scale
- Additional providers (Google Location, Life360, etc.)
