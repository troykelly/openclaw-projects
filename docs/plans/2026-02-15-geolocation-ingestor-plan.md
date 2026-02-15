# Geolocation Ingestor Plugin System — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a plugin-style geolocation ingestion system that automatically pulls user location from Home Assistant, MQTT, and webhooks, stores it as a TimescaleDB time-series with embeddings, and injects it into memory operations.

**Architecture:** Dedicated `geo_provider` / `geo_provider_user` / `geo_location` tables with a provider plugin interface. Worker process manages persistent WebSocket/MQTT connections. Ingestion pipeline validates, deduplicates, inserts, then asynchronously geocodes and generates embeddings. Auto-injection Fastify preHandler transparently attaches location to memory routes.

**Tech Stack:** PostgreSQL (TimescaleDB, pgvector, pgcron), Fastify, `ws` (HA WebSocket), `mqtt` (MQTT client), Zod, vitest, React 19, shadcn/ui, TanStack React Query, dnd-kit.

**Design doc:** `docs/plans/2026-02-15-geolocation-ingestor-design.md`

---

## Issue Map

| # | Issue | Phase | Depends On | Parallelisable |
|---|-------|-------|------------|----------------|
| 1 | DB migration: geo tables, hypertable, user_setting columns | 1 | None | No (foundation) |
| 2 | Provider plugin interface, registry, network guard | 2 | #1 | No (abstractions) |
| 3 | Ingestion pipeline: validate, dedup, rate limit, insert, background workers | 3 | #2 | No |
| 4 | Home Assistant provider: WSS + REST, OAuth, entity discovery | 4 | #3 | Yes (with #5, #6) |
| 5 | MQTT provider: MQTTS, OwnTracks/HA/custom parsers | 4 | #3 | Yes (with #4, #6) |
| 6 | Webhook provider: public endpoint, token auth, payload parsing | 4 | #3 | Yes (with #4, #5) |
| 7 | Geolocation API routes: provider CRUD, subscriptions, current, history, share | 5 | #3 | After phase 3 |
| 8 | Auto-injection: Fastify preHandler, memory route integration | 6 | #7 | After phase 5 |
| 9 | Frontend: Location settings UI, provider forms, retention, sharing | 7 | #7 | After phase 5 |
| 10 | Retention pgcron job: downsampling + deletion | 8 | #1 | After phase 1 |

---

## Task 1: DB Migration — Geo Tables + Hypertable + Settings Columns

**Issue:** Epic child #1 (Foundation)
**Files:**
- Create: `migrations/067_geolocation_providers.up.sql`
- Create: `migrations/067_geolocation_providers.down.sql`

**Step 1: Write the up migration**

```sql
-- Migration 067: Geolocation provider system
-- Epic: Geolocation Ingestor Plugin System

-- Types
CREATE TYPE geo_provider_type AS ENUM ('home_assistant', 'mqtt', 'webhook');
CREATE TYPE geo_auth_type AS ENUM ('oauth2', 'access_token', 'mqtt_credentials', 'webhook_token');
CREATE TYPE geo_provider_status AS ENUM ('active', 'inactive', 'error', 'connecting');

-- Provider connections (shared infrastructure)
CREATE TABLE geo_provider (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email           text NOT NULL REFERENCES user_setting(email),
  provider_type         geo_provider_type NOT NULL,
  auth_type             geo_auth_type NOT NULL,
  label                 text NOT NULL,
  status                geo_provider_status NOT NULL DEFAULT 'inactive',
  status_message        text,
  config                jsonb NOT NULL DEFAULT '{}',
  credentials           bytea,
  poll_interval_seconds integer,
  max_age_seconds       integer NOT NULL DEFAULT 900,
  is_shared             boolean NOT NULL DEFAULT false,
  last_seen_at          timestamptz,
  deleted_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_geo_provider_max_age CHECK (max_age_seconds > 0)
);

CREATE INDEX idx_geo_provider_owner ON geo_provider (owner_email) WHERE deleted_at IS NULL;

CREATE TRIGGER geo_provider_updated_at
  BEFORE UPDATE ON geo_provider
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Per-user subscription with entity mapping
CREATE TABLE geo_provider_user (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id     uuid NOT NULL REFERENCES geo_provider(id) ON DELETE CASCADE,
  user_email      text NOT NULL REFERENCES user_setting(email),
  priority        integer NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  entities        jsonb NOT NULL DEFAULT '[]',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_geo_provider_user UNIQUE (provider_id, user_email),
  CONSTRAINT chk_geo_provider_user_priority CHECK (priority >= 0)
);

CREATE INDEX idx_geo_provider_user_email ON geo_provider_user (user_email);

CREATE TRIGGER geo_provider_user_updated_at
  BEFORE UPDATE ON geo_provider_user
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Location history (TimescaleDB hypertable)
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

-- Add geo settings to user_setting
ALTER TABLE user_setting
  ADD COLUMN IF NOT EXISTS geo_auto_inject boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS geo_high_res_retention_hours integer NOT NULL DEFAULT 168,
  ADD COLUMN IF NOT EXISTS geo_general_retention_days integer NOT NULL DEFAULT 365,
  ADD COLUMN IF NOT EXISTS geo_high_res_threshold_m double precision NOT NULL DEFAULT 50.0;

-- Comments
COMMENT ON TABLE geo_provider IS 'Geolocation provider connections (HA, MQTT, webhook)';
COMMENT ON TABLE geo_provider_user IS 'Per-user subscription to a geo provider with entity mapping';
COMMENT ON TABLE geo_location IS 'TimescaleDB hypertable of location updates with embeddings';
COMMENT ON COLUMN user_setting.geo_auto_inject IS 'When true, auto-attach current location to memory operations';
COMMENT ON COLUMN user_setting.geo_high_res_retention_hours IS 'How long to keep high-resolution location data (hours)';
COMMENT ON COLUMN user_setting.geo_general_retention_days IS 'How long to keep downsampled location data (days)';
COMMENT ON COLUMN user_setting.geo_high_res_threshold_m IS 'Accuracy threshold (metres) separating high-res from general';
```

**Step 2: Write the down migration**

```sql
-- Down migration 067: Remove geolocation provider system
ALTER TABLE user_setting DROP COLUMN IF EXISTS geo_high_res_threshold_m;
ALTER TABLE user_setting DROP COLUMN IF EXISTS geo_general_retention_days;
ALTER TABLE user_setting DROP COLUMN IF EXISTS geo_high_res_retention_hours;
ALTER TABLE user_setting DROP COLUMN IF EXISTS geo_auto_inject;

DROP TABLE IF EXISTS geo_location;
DROP TABLE IF EXISTS geo_provider_user;
DROP TABLE IF EXISTS geo_provider;

DROP TYPE IF EXISTS geo_provider_status;
DROP TYPE IF EXISTS geo_auth_type;
DROP TYPE IF EXISTS geo_provider_type;
```

**Step 3: Run the migration**

```bash
pnpm run migrate
```

Expected: Migration applies cleanly.

**Step 4: Verify tables exist**

```bash
psql -c "\dt geo_*" -c "\d user_setting" | grep -E "geo_"
```

Expected: Three geo tables and four new columns on user_setting.

**Step 5: Verify hypertable**

```bash
psql -c "SELECT hypertable_name FROM timescaledb_information.hypertables WHERE hypertable_name = 'geo_location';"
```

Expected: One row returned.

**Step 6: Commit**

```bash
git add migrations/067_geolocation_providers.up.sql migrations/067_geolocation_providers.down.sql
git commit -m "[#EPIC_CHILD_1] Add geolocation provider tables, hypertable, and settings columns"
```

---

## Task 2: Provider Plugin Interface + Registry + Network Guard

**Issue:** Epic child #2 (Framework)
**Files:**
- Create: `src/api/geolocation/types.ts`
- Create: `src/api/geolocation/registry.ts`
- Create: `src/api/geolocation/network-guard.ts`
- Test: `src/api/geolocation/network-guard.test.ts`
- Test: `src/api/geolocation/registry.test.ts`

**Step 1: Write types**

Create `src/api/geolocation/types.ts` with:
- `GeoProviderType`, `GeoAuthType`, `GeoProviderStatus` as string literal unions matching the DB enums
- `GeoProvider` interface matching the `geo_provider` table row
- `GeoProviderUser` interface matching the `geo_provider_user` table row
- `GeoLocation` interface matching the `geo_location` table row
- `LocationUpdate` interface (from design doc)
- `Connection` interface (from design doc)
- `GeoProviderPlugin` interface (from design doc)
- `VerifyResult`, `EntityInfo`, `ProviderConfig`, `ValidationError`, `ParseError` types
- `LocationUpdateHandler` type alias

**Step 2: Write failing network-guard tests**

Create `src/api/geolocation/network-guard.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { validateOutboundUrl, validateOutboundHost } from './network-guard.ts';

describe('validateOutboundUrl', () => {
  it('accepts https:// URLs', () => {
    const result = validateOutboundUrl('https://ha.example.com');
    expect(result.ok).toBe(true);
  });

  it('accepts wss:// URLs', () => {
    const result = validateOutboundUrl('wss://ha.example.com/api/websocket');
    expect(result.ok).toBe(true);
  });

  it('rejects http:// URLs', () => {
    const result = validateOutboundUrl('http://ha.example.com');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('TLS');
  });

  it('rejects ws:// URLs', () => {
    const result = validateOutboundUrl('ws://ha.example.com');
    expect(result.ok).toBe(false);
  });

  it('rejects file:// URLs', () => {
    const result = validateOutboundUrl('file:///etc/passwd');
    expect(result.ok).toBe(false);
  });

  it('rejects private IP 127.0.0.1', () => {
    const result = validateOutboundUrl('https://127.0.0.1');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('private');
  });

  it('rejects 10.x.x.x range', () => {
    const result = validateOutboundUrl('https://10.0.0.1');
    expect(result.ok).toBe(false);
  });

  it('rejects 172.16-31.x.x range', () => {
    const result = validateOutboundUrl('https://172.16.0.1');
    expect(result.ok).toBe(false);
  });

  it('rejects 192.168.x.x range', () => {
    const result = validateOutboundUrl('https://192.168.1.1');
    expect(result.ok).toBe(false);
  });

  it('rejects link-local 169.254.x.x', () => {
    const result = validateOutboundUrl('https://169.254.169.254');
    expect(result.ok).toBe(false);
  });

  it('rejects malformed URLs', () => {
    const result = validateOutboundUrl('not-a-url');
    expect(result.ok).toBe(false);
  });
});

describe('validateOutboundHost', () => {
  it('accepts valid public hostname', () => {
    const result = validateOutboundHost('mqtt.example.com', 8883);
    expect(result.ok).toBe(true);
  });

  it('rejects port 0', () => {
    const result = validateOutboundHost('mqtt.example.com', 0);
    expect(result.ok).toBe(false);
  });

  it('rejects port > 65535', () => {
    const result = validateOutboundHost('mqtt.example.com', 70000);
    expect(result.ok).toBe(false);
  });

  it('rejects private IPs', () => {
    const result = validateOutboundHost('127.0.0.1', 8883);
    expect(result.ok).toBe(false);
  });
});
```

**Step 3: Run tests to verify they fail**

```bash
pnpm test -- src/api/geolocation/network-guard.test.ts
```

Expected: FAIL — module not found.

**Step 4: Implement network-guard**

Create `src/api/geolocation/network-guard.ts`:
- `validateOutboundUrl(url: string): Result<URL, string>` — parse URL, check scheme (https/wss only), check hostname against private IP ranges
- `validateOutboundHost(host: string, port: number): Result<void, string>` — validate hostname not private IP, port in 1-65535
- `isPrivateIp(ip: string): boolean` — check against 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, ::1, fc00::/7
- Use `Result<T, E>` pattern: `{ ok: true, value: T } | { ok: false, error: E }`

**Step 5: Run tests to verify they pass**

```bash
pnpm test -- src/api/geolocation/network-guard.test.ts
```

Expected: All PASS.

**Step 6: Write registry**

Create `src/api/geolocation/registry.ts`:
- `Map<GeoProviderType, GeoProviderPlugin>` storage
- `registerProvider(plugin)`, `getProvider(type)`, `getRegisteredTypes()` exports
- No providers registered at this point (they're registered in later issues)

**Step 7: Write registry test**

Create `src/api/geolocation/registry.test.ts`:
- Test register + get round-trip
- Test getProvider for unregistered type returns undefined
- Test getRegisteredTypes returns all registered types

**Step 8: Run all tests**

```bash
pnpm test -- src/api/geolocation/
```

Expected: All PASS.

**Step 9: Commit**

```bash
git add src/api/geolocation/types.ts src/api/geolocation/registry.ts src/api/geolocation/network-guard.ts src/api/geolocation/network-guard.test.ts src/api/geolocation/registry.test.ts
git commit -m "[#EPIC_CHILD_2] Add provider plugin interface, registry, and network guard"
```

---

## Task 3: Ingestion Pipeline + Background Workers

**Issue:** Epic child #3 (Pipeline)
**Files:**
- Create: `src/api/geolocation/service.ts`
- Create: `src/api/geolocation/ingestion.ts`
- Create: `src/api/geolocation/crypto.ts`
- Test: `src/api/geolocation/ingestion.test.ts`
- Test: `src/api/geolocation/service.test.ts`
- Modify: `src/worker/run.ts` (add geo background jobs)

### Sub-task 3a: Geo Crypto Module

**Step 1:** Create `src/api/geolocation/crypto.ts` following the pattern in `src/api/oauth/crypto.ts`:
- Use same `OAUTH_TOKEN_ENCRYPTION_KEY` env var (shared master key) or a separate `GEO_TOKEN_ENCRYPTION_KEY`
- `encryptCredentials(plaintext: string, providerId: string): Buffer`
- `decryptCredentials(ciphertext: Buffer, providerId: string): string`
- Same AES-256-GCM + HKDF pattern

**Step 2:** Write tests in `src/api/geolocation/crypto.test.ts`:
- Encrypt + decrypt round-trip
- Different provider IDs produce different ciphertext
- Raw bytes don't contain plaintext
- Graceful fallback when encryption disabled

### Sub-task 3b: Geolocation Service (CRUD)

**Step 1:** Create `src/api/geolocation/service.ts` with database operations:

```typescript
// Row mapping functions
function rowToProvider(row: Record<string, unknown>): GeoProvider;
function rowToProviderUser(row: Record<string, unknown>): GeoProviderUser;
function rowToLocation(row: Record<string, unknown>): GeoLocation;

// Provider CRUD
export async function createProvider(pool: Pool, input: CreateProviderInput): Promise<GeoProvider>;
export async function getProvider(pool: Pool, id: string): Promise<GeoProvider | null>;
export async function listProviders(pool: Pool, userEmail: string): Promise<GeoProvider[]>;
export async function updateProvider(pool: Pool, id: string, updates: UpdateProviderInput): Promise<GeoProvider | null>;
export async function softDeleteProvider(pool: Pool, id: string): Promise<boolean>;

// Subscription CRUD
export async function createSubscription(pool: Pool, input: CreateSubscriptionInput): Promise<GeoProviderUser>;
export async function listSubscriptions(pool: Pool, userEmail: string): Promise<GeoProviderUser[]>;
export async function updateSubscription(pool: Pool, id: string, updates: UpdateSubscriptionInput): Promise<GeoProviderUser | null>;

// Current location resolution
export async function getCurrentLocation(pool: Pool, userEmail: string): Promise<GeoLocation | null>;

// Location history
export async function getLocationHistory(pool: Pool, userEmail: string, from: Date, to: Date, limit: number): Promise<GeoLocation[]>;

// Location insert (used by ingestion pipeline)
export async function insertLocation(pool: Pool, location: InsertLocationInput): Promise<void>;
```

**Step 2:** Write integration tests in `src/api/geolocation/service.test.ts`:
- Provider CRUD with soft-delete
- Credential encryption round-trip (verify raw bytea is not plaintext)
- Subscription create with priority
- Auto-reorder on priority conflict
- Current location resolution: priority ordering, staleness exclusion, accuracy tiebreak
- Location insert + query by time range

### Sub-task 3c: Ingestion Pipeline

**Step 1:** Write failing tests in `src/api/geolocation/ingestion.test.ts`:

```typescript
describe('validateLocationUpdate', () => {
  it('accepts valid update', () => { ... });
  it('rejects lat > 90', () => { ... });
  it('rejects lat < -90', () => { ... });
  it('rejects lng > 180', () => { ... });
  it('rejects negative accuracy', () => { ... });
  it('rejects accuracy > 100000', () => { ... });
  it('rejects future timestamp', () => { ... });
  it('rejects timestamp > 1h in past', () => { ... });
  it('sanitises entity_id (strips control chars, max length)', () => { ... });
});

describe('shouldDedup', () => {
  it('returns true for same location within 5m and 30s', () => { ... });
  it('returns false for location beyond 5m', () => { ... });
  it('returns false for location beyond 30s', () => { ... });
  it('returns false when no previous record', () => { ... });
});

describe('shouldRateLimit', () => {
  it('returns true for update within min_interval_seconds', () => { ... });
  it('returns false for update beyond min_interval_seconds', () => { ... });
});
```

**Step 2:** Implement `src/api/geolocation/ingestion.ts`:

```typescript
export function validateLocationUpdate(update: LocationUpdate): Result<LocationUpdate, string>;
export function shouldDedup(current: LocationUpdate, previous: GeoLocation | null, thresholdM: number, thresholdS: number): boolean;
export function shouldRateLimit(lastInsertTime: Date | null, minIntervalSeconds: number): boolean;

// Main ingestion function — called by all providers
export async function ingestLocationUpdate(
  pool: Pool,
  providerId: string,
  update: LocationUpdate,
): Promise<{ inserted: boolean; reason?: string }> {
  // 1. Validate
  // 2. Resolve user_email via geo_provider_user entity mapping
  // 3. Rate limit check
  // 4. Dedup check
  // 5. Insert into geo_location
  // 6. Update geo_provider.last_seen_at
}
```

**Step 3:** Run tests, verify pass.

### Sub-task 3d: Background Workers

**Step 1:** Add to `src/worker/run.ts`:
- Import `processGeoGeocode` and `processGeoEmbeddings` functions
- Add to the `tick()` function alongside existing job processing
- `processGeoGeocode`: query `geo_location WHERE address IS NULL AND lat IS NOT NULL`, reverse geocode via Nominatim, update records
- `processGeoEmbeddings`: query `geo_location WHERE embedding_status = 'pending' AND address IS NOT NULL`, generate embeddings, update records. Skip if address matches previous record's address (set `embedding_status = 'skipped'`).

**Step 2:** Write tests for background workers:
- Geocode worker picks up records with null address
- Geocode worker handles Nominatim unavailability gracefully
- Embedding worker generates embeddings for new addresses
- Embedding worker skips when address unchanged (dedup)

**Step 3:** Commit all pipeline code.

---

## Task 4: Home Assistant Provider

**Issue:** Epic child #4 (HA Provider)
**Files:**
- Create: `src/api/geolocation/providers/home-assistant.ts`
- Test: `src/api/geolocation/providers/home-assistant.test.ts`
- Create: `test/mocks/ha-server.ts`
- Add dependency: `ws` (WebSocket client)

**Key implementation points:**

1. **Config validation**: Zod schema for `{ url: string }`. URL must be `https://` or `wss://`. Call `validateOutboundUrl()`.

2. **verify()**: Connect to `GET {url}/api/` for version check. List entities via `GET {url}/api/states` filtered to `device_tracker.*`, `person.*`, `sensor.bermuda_*`. Return as `EntityInfo[]`.

3. **discoverEntities()**: Same as verify entity list but with more detail (friendly_name, last_changed, attributes).

4. **connect()**: Open WSS connection to `{url}/api/websocket`. Auth flow:
   - Receive `auth_required` message
   - Send `{ type: 'auth', access_token: '...' }`
   - Receive `auth_ok` or `auth_invalid`
   - Send `{ id: 1, type: 'subscribe_events', event_type: 'state_changed' }`
   - Filter incoming events to tracked entity IDs
   - Extract lat/lng/accuracy from `new_state.attributes`

5. **parsePayload()**: Extract from HA state attributes:
   ```typescript
   {
     entity_id: state.entity_id,
     lat: state.attributes.latitude,
     lng: state.attributes.longitude,
     accuracy_m: state.attributes.gps_accuracy,
     // Bermuda entities use different attributes:
     // state.attributes.area_name -> indoor_zone
   }
   ```

6. **Reconnection**: Exponential backoff with jitter. Max 5 minutes between attempts.

7. **OAuth**: Separate sub-task. Create `src/api/geolocation/oauth.ts` for HA-specific OAuth flow (dynamic auth server URL). Routes added in Task 7.

8. **Mock HA server**: `test/mocks/ha-server.ts` using `ws` library. Simulates auth flow + state_changed events. Bind to 127.0.0.1, random port.

**Tests:**
- Config validation: valid HTTPS accepted, HTTP rejected
- verify(): returns entity list from mock
- connect(): auth flow, receive state_changed, emit LocationUpdate
- connect(): reconnection on disconnect
- parsePayload(): valid HA state -> LocationUpdate
- parsePayload(): Bermuda entity -> indoor_zone populated
- parsePayload(): malformed state -> graceful error

---

## Task 5: MQTT Provider

**Issue:** Epic child #5 (MQTT Provider)
**Files:**
- Create: `src/api/geolocation/providers/mqtt-provider.ts`
- Create: `src/api/geolocation/providers/parsers/owntracks.ts`
- Create: `src/api/geolocation/providers/parsers/ha-mqtt.ts`
- Create: `src/api/geolocation/providers/parsers/custom-jsonpath.ts`
- Test: `src/api/geolocation/providers/mqtt-provider.test.ts`
- Test: `src/api/geolocation/providers/parsers/owntracks.test.ts`
- Test: `src/api/geolocation/providers/parsers/ha-mqtt.test.ts`
- Test: `src/api/geolocation/providers/parsers/custom-jsonpath.test.ts`
- Create: `test/mocks/mqtt-broker.ts`
- Create: `test/fixtures/geo/owntracks-location.json`
- Create: `test/fixtures/geo/owntracks-transition.json`
- Create: `test/fixtures/geo/ha-mqtt-location.json`
- Add dependencies: `mqtt`, `aedes` (dev)

**Key implementation points:**

1. **Config validation**: Zod schema for `{ host, port, ca_cert?, format, topics[], payload_mapping? }`. Port default 8883. Call `validateOutboundHost()`. Reject port 1883 (standard non-TLS MQTT port) with helpful error.

2. **connect()**: `mqtts://` connection using `mqtt` package. Options: `{ rejectUnauthorized: true, ca: config.ca_cert }`. Subscribe to configured topics. On message, dispatch to format-specific parser.

3. **Format parsers**:
   - OwnTracks: `{ _type: "location", lat, lon, acc, alt, vel, tid }` -> LocationUpdate. Also handle `_type: "transition"` for indoor_zone.
   - HA MQTT: `{ latitude, longitude, gps_accuracy }` -> LocationUpdate
   - Custom: Use simple property path extraction (dot-notation, not full JSONPath). Validate paths at config save time.

4. **addEntities/removeEntities**: Subscribe/unsubscribe MQTT topics on the live connection.

5. **Mock broker**: `test/mocks/mqtt-broker.ts` using `aedes` with TLS. Self-signed test cert (clearly marked). Bind to 127.0.0.1.

**Tests:**
- Config validation: valid host/port accepted, port 1883 rejected with TLS message
- Parser unit tests per format with fixture files
- OwnTracks transition -> indoor_zone update
- Custom parser: dot-notation extraction works, deeply nested rejected
- connect() -> subscribe -> receive message -> LocationUpdate emitted
- TLS enforcement: plaintext connection rejected
- Reconnection on broker disconnect
- Property-based tests (fast-check): random payloads -> parser never throws

---

## Task 6: Webhook Provider + Public Endpoint

**Issue:** Epic child #6 (Webhook Provider)
**Files:**
- Create: `src/api/geolocation/providers/webhook-provider.ts`
- Test: `src/api/geolocation/providers/webhook-provider.test.ts`
- Create: `src/api/geolocation/webhook-handler.ts` (Fastify route)
- Test: `src/api/geolocation/webhook-handler.test.ts`

**Key implementation points:**

1. **Token generation**: `crypto.randomBytes(32).toString('hex')` — 256-bit, prefixed `whk_` for easy identification.

2. **Webhook URL format**: `POST /api/geolocation/webhook/{provider_id}`. Auth via `Authorization: Bearer whk_...` header.

3. **webhook-handler.ts**: Fastify route handler:
   - Parse provider_id from URL params
   - Extract Bearer token from Authorization header
   - Look up provider, verify token (timing-safe comparison)
   - Validate payload (max 10KB, JSON depth limit)
   - Parse payload (standard schema + OwnTracks HTTP format detection)
   - Call `ingestLocationUpdate()` from the pipeline
   - Return `{ ok: true }` — minimal response
   - Rate limit per provider (reuse existing rate limiting from #1225)

4. **parsePayload()**: Two formats:
   - Standard: `{ lat, lng, accuracy_m?, altitude_m?, speed_mps?, indoor_zone?, timestamp? }`
   - OwnTracks HTTP: detect by `_type: "location"`, reuse OwnTracks parser from MQTT

5. **Token rotation**: New function in service.ts: `rotateWebhookToken(pool, providerId)` — generate new token, encrypt, update, return new token.

**Tests:**
- Valid token + valid payload -> 200
- Invalid token -> 401
- Missing Authorization header -> 401
- Malformed payload -> 400
- Oversized payload -> 413
- Rate limit exceeded -> 429
- Token rotation: old token fails, new token works
- OwnTracks HTTP format detected and parsed correctly
- Response body is minimal (`{ ok: true }`)

---

## Task 7: Geolocation API Routes

**Issue:** Epic child #7 (API)
**Files:**
- Create: `src/api/geolocation/routes.ts` (or add to `src/api/server.ts` following existing pattern)
- Create: `src/api/geolocation/oauth.ts` (HA OAuth flow)
- Test: `src/api/geolocation/routes.test.ts`

**Routes to implement** (see design doc for full spec):

```
POST   /api/geolocation/providers
GET    /api/geolocation/providers
GET    /api/geolocation/providers/:id
PATCH  /api/geolocation/providers/:id
DELETE /api/geolocation/providers/:id
POST   /api/geolocation/providers/:id/verify
GET    /api/geolocation/providers/:id/entities
POST   /api/geolocation/providers/:id/share
POST   /api/geolocation/providers/:id/rotate-token
GET    /api/geolocation/subscriptions
PATCH  /api/geolocation/subscriptions/:id
GET    /api/geolocation/current
GET    /api/geolocation/history
POST   /api/geolocation/history/search
GET    /api/geolocation/oauth/authorize
GET    /api/geolocation/oauth/callback
```

**Key implementation details:**

1. **Authorization**: All routes require session auth (`getSessionEmail(req)`). Ownership checks on mutating provider routes.

2. **Provider creation**: Validate config per type (call `plugin.validateConfig()`). Encrypt credentials. Generate webhook token for webhook type. Enforce per-user provider limit (10 providers).

3. **Non-owner scoping**: When listing providers for a non-owner, strip `config`, `credentials`, `status_message`. Return only: id, label, provider_type, simplified status, user's entity assignments.

4. **Share endpoint**: Owner-only. Validate target users exist in `user_setting`. Enforce entity uniqueness across users.

5. **Verify endpoint**: Rate limited (5/min/user). Call `plugin.verify()`. SSRF protection via network-guard.

6. **Current location**: Call `getCurrentLocation()` from service.ts. 404 if no recent location.

7. **History search**: Hybrid vector + full-text search on geo_location table.

8. **HA OAuth**: Dynamic auth server URL. PKCE + state. Store state in `oauth_state` table (reuse existing pattern). Token exchange. Save connection.

**Tests:**
- Full CRUD lifecycle for each provider type
- Authorization: user A cannot access user B's providers
- Non-owner view: config/credentials stripped
- Share: owner assigns entities, non-owner sees subscription
- Provider limit enforcement
- Entity uniqueness enforcement
- Verify: returns entity list
- Current location: resolution algorithm
- History: time-range query, pagination

---

## Task 8: Auto-Injection preHandler Hook

**Issue:** Epic child #8 (Auto-inject)
**Files:**
- Create: `src/api/geolocation/auto-inject.ts`
- Test: `src/api/geolocation/auto-inject.test.ts`
- Modify: `src/api/server.ts` (apply preHandler to memory routes)

**Implementation:**

```typescript
// src/api/geolocation/auto-inject.ts
export async function geoAutoInjectHook(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const email = await getSessionEmail(req);
  if (!email) return;

  const body = req.body as Record<string, unknown> | undefined;

  // Skip if explicit location provided
  if (body?.lat !== undefined && body?.lng !== undefined) {
    reply.header('X-Geo-Source', 'explicit');
    return;
  }

  // Check user opt-in
  const settings = await getUserSettings(pool, email);
  if (!settings?.geo_auto_inject) return;

  // Get current location
  const location = await getCurrentLocation(pool, email);
  if (!location) return;

  // Inject into request body
  if (body) {
    body.lat = location.lat;
    body.lng = location.lng;
    if (location.address) body.address = location.address;
    if (location.place_label) body.place_label = location.place_label;
  }
  reply.header('X-Geo-Source', 'auto');
}
```

**Apply to memory routes in server.ts:**

```typescript
app.post('/api/memories/unified', { preHandler: [geoAutoInjectHook] }, async (req, reply) => { ... });
app.post('/api/memories/bulk', { preHandler: [geoAutoInjectHook] }, async (req, reply) => { ... });
app.get('/api/memories/search', { preHandler: [geoAutoInjectHook] }, async (req, reply) => { ... });
```

**Tests:**
- Auto-inject enabled + current location available -> location injected, X-Geo-Source: auto
- Auto-inject disabled -> no injection, no header
- Explicit location in request -> not overwritten, X-Geo-Source: explicit
- No current location -> proceeds without location, no error
- User with no providers -> proceeds normally (backward compatible)
- Memory store without location + auto-inject -> memory has geo fields

---

## Task 9: Frontend Location Settings UI

**Issue:** Epic child #9 (Frontend)
**Files:**
- Create: `src/ui/components/settings/location-section.tsx`
- Create: `src/ui/components/settings/location-current.tsx`
- Create: `src/ui/components/settings/location-provider-card.tsx`
- Create: `src/ui/components/settings/location-provider-form.tsx`
- Create: `src/ui/components/settings/location-ha-config.tsx`
- Create: `src/ui/components/settings/location-mqtt-config.tsx`
- Create: `src/ui/components/settings/location-webhook-config.tsx`
- Create: `src/ui/components/settings/location-entity-picker.tsx`
- Create: `src/ui/components/settings/location-share-form.tsx`
- Create: `src/ui/components/settings/location-retention.tsx`
- Create: `src/ui/components/settings/use-geolocation.ts`
- Modify: `src/ui/components/settings/settings-page.tsx` (add Location section)

**MUST READ FIRST:** `docs/knowledge/frontend-2026.md` for React 19 / Tailwind v4 / shadcn/ui patterns.

**Key implementation details:**

1. **Add to SECTIONS array** in settings-page.tsx: `{ id: 'location', label: 'Location', icon: MapPin }` between 'accounts' and 'appearance'.

2. **use-geolocation.ts hook**: React Query hooks for:
   - `useGeoProviders()` — list owned + shared subscriptions
   - `useGeoCurrent()` — current location (refetchInterval: 30000)
   - `useGeoSubscriptions()` — user's subscriptions
   - Mutation hooks for create/update/delete/verify/share/rotate

3. **Provider cards**: Drag-and-drop reorderable using dnd-kit (already in deps). Show status badge, entity count, actions. Keyboard accessible (dnd-kit built-in keyboard support + up/down arrow buttons).

4. **Add provider modal**: Three-step flow — type selection, config form, verify + entity picker. Type-specific config components render based on selection.

5. **Retention section**: Number inputs with validation. Warning banner (shadcn Alert). Inline help text.

6. **Security**: Never display stored credentials. Webhook URL/token truncated by default. Confirmation dialogs for delete and token rotation.

**Tests** (vitest + React Testing Library):
- Settings page renders Location section
- Provider card renders status, label, entity count
- Add provider flow: type selection, config form, verify
- MQTT config: port defaults to 8883, TLS notice visible
- Retention: input validation, warning banner present
- Priority reorder via drag-and-drop and keyboard
- Delete confirmation dialog appears

---

## Task 10: Retention pgcron Job

**Issue:** Epic child #10 (Retention)
**Files:**
- Create: `migrations/068_geo_retention_job.up.sql`
- Create: `migrations/068_geo_retention_job.down.sql`
- Create: `src/api/geolocation/retention.ts`
- Test: `src/api/geolocation/retention.test.ts`

**Step 1: Write the retention function**

```sql
-- In migration 068
CREATE OR REPLACE FUNCTION geo_retention_cleanup() RETURNS void AS $$
DECLARE
  setting RECORD;
BEGIN
  -- Process each user's retention settings independently
  FOR setting IN
    SELECT email, geo_high_res_retention_hours, geo_general_retention_days, geo_high_res_threshold_m
    FROM user_setting
    WHERE geo_high_res_retention_hours IS NOT NULL
  LOOP
    -- Downsample high-res data beyond retention window
    -- Keep best-accuracy record per hour
    WITH ranked AS (
      SELECT ctid,
             ROW_NUMBER() OVER (
               PARTITION BY user_email, provider_id, entity_id,
                            date_trunc('hour', time)
               ORDER BY accuracy_m ASC NULLS LAST
             ) AS rn
      FROM geo_location
      WHERE user_email = setting.email
        AND time < now() - (setting.geo_high_res_retention_hours || ' hours')::interval
        AND time >= now() - (setting.geo_general_retention_days || ' days')::interval
        AND (accuracy_m IS NULL OR accuracy_m <= setting.geo_high_res_threshold_m)
    )
    DELETE FROM geo_location WHERE ctid IN (SELECT ctid FROM ranked WHERE rn > 1);

    -- Delete records beyond general retention
    DELETE FROM geo_location
    WHERE user_email = setting.email
      AND time < now() - (setting.geo_general_retention_days || ' days')::interval;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Schedule: run daily at 03:00 UTC
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'geo_retention_cleanup') THEN
    PERFORM cron.schedule(
      'geo_retention_cleanup',
      '0 3 * * *',
      $cmd$SELECT geo_retention_cleanup();$cmd$
    );
  END IF;
END $do$;
```

**Step 2: Write TypeScript wrapper in `src/api/geolocation/retention.ts`** for manual triggering / testing.

**Step 3: Integration test**: Insert records spanning multiple days with different accuracies. Run retention. Verify:
- Recent records untouched
- Beyond high-res window: only best-accuracy per hour remains
- Beyond general window: all deleted
- Records belonging to other users: untouched

---

## Dependencies to Add

```bash
pnpm add ws mqtt
pnpm add -D @types/ws aedes @types/aedes fast-check
```

---

## Execution Notes

- **Phases 4a/4b/4c** (HA, MQTT, Webhook providers) are independent and ideal for **agent teams** or **parallel subagents**
- Each task corresponds to one GitHub issue and one PR
- All work in isolated worktrees: `/tmp/worktree-issue-<number>-<slug>`
- Run `pnpm test` and `pnpm run lint` before every push
- Commit format: `[#NN] Brief description`
- PR body must include `Closes #NN`
