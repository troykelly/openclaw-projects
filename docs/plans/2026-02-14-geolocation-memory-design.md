# Geolocation-Aware Memory Storage and Recall

**Epic:** #1204
**Date:** 2026-02-14
**Status:** Approved

## Problem

Memory recall is pure semantic text search. All memories are equally weighted regardless of situational context. Location is a strong proxy for situational relevance — food preferences matter near restaurants, dev tooling preferences matter at a desk.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Geo storage | Discrete DB columns | Queryable, indexable, no metadata JSON hack |
| Geocoding | Self-hosted Nominatim in devcontainer | Free, no rate limits, no external dependency |
| Location embedding | Same provider as content | Consistent dimensionality, simpler pipeline |
| Container placement | Devcontainer compose | Available automatically in dev |

## Database Migration (066)

Add columns to the `memory` table:

```sql
ALTER TABLE memory ADD COLUMN lat double precision;
ALTER TABLE memory ADD COLUMN lng double precision;
ALTER TABLE memory ADD COLUMN address text;
ALTER TABLE memory ADD COLUMN place_label text;
ALTER TABLE memory ADD COLUMN location_embedding vector(1024);

-- Constraint: lat/lng must be provided together
ALTER TABLE memory ADD CONSTRAINT chk_memory_geo_pair
  CHECK ((lat IS NULL AND lng IS NULL) OR (lat IS NOT NULL AND lng IS NOT NULL));

-- Constraint: valid coordinate ranges
ALTER TABLE memory ADD CONSTRAINT chk_memory_lat_range
  CHECK (lat IS NULL OR (lat >= -90 AND lat <= 90));
ALTER TABLE memory ADD CONSTRAINT chk_memory_lng_range
  CHECK (lng IS NULL OR (lng >= -180 AND lng <= 180));

-- Index for proximity queries using cube/earthdistance
CREATE INDEX idx_memory_geo ON memory (lat, lng) WHERE lat IS NOT NULL;

-- HNSW index for location embedding similarity
CREATE INDEX idx_memory_location_embedding
  ON memory USING hnsw (location_embedding vector_cosine_ops)
  WHERE location_embedding IS NOT NULL;
```

Uses `cube` + `earthdistance` extensions (PostgreSQL contrib, lighter than PostGIS) for haversine distance calculations.

## Core API Changes

### POST /api/memories/unified

Accept optional fields:
- `lat: number` — WGS84 latitude (-90 to 90)
- `lng: number` — WGS84 longitude (-180 to 180)
- `address: string` — Human-readable address
- `place_label: string` — Short place name

### GET /api/memories/search

Return geo fields in results when present:
- `lat`, `lng`, `address`, `place_label` on each result object

### Memory Types & Service

Extend `CreateMemoryInput`, `MemoryEntry`, `mapRowToMemory()`, and `createMemory()` to handle geo fields.

## Plugin: memory_store (#1205)

### Schema Addition

```typescript
location: z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().max(500).optional(),
  place_label: z.string().max(200).optional(),
}).optional()
```

### Behaviour

1. Validate location schema
2. If lat/lng provided without address, call Nominatim for reverse geocoding
3. Pass `lat`, `lng`, `address`, `place_label` to `POST /api/memories/unified`
4. Memories without location continue to work unchanged

## Plugin: memory_recall (#1206)

### Schema Addition

```typescript
location: z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
}).optional(),
location_radius_km: z.number().min(0.1).max(100).optional(),
location_weight: z.number().min(0).max(1).default(0.3).optional(),
```

### Retrieval Modes

1. **Proximity** — when `location` + `location_radius_km` provided: filter results to memories stored within radius (haversine on lat/lng)
2. **Semantic location** — when `location` provided: compute cosine similarity between current location context and stored `location_embedding`
3. **Contextual boost** (default) — normal content search, geo-proximate results get score bump: `final_score = (1 - weight) * content_score + weight * geo_score`

### Implementation

- Request 3x `limit` from API to compensate for re-ranking filtering
- Memories without stored location get neutral geo score (not penalised)
- Without location param, behaviour is identical to current

## Reverse Geocoding (#1209)

### Nominatim Container

Add `mediagis/nominatim` to `.devcontainer/docker-compose.devcontainer.yml`:

```yaml
nominatim:
  image: mediagis/nominatim:4.5
  environment:
    PBF_URL: https://download.geofabrik.de/australia-oceania-latest.osm.pbf
    REPLICATION_URL: https://download.geofabrik.de/australia-oceania-updates/
    NOMINATIM_PASSWORD: nominatim
  volumes:
    - openclaw_projects_nominatim_data:/var/lib/postgresql/14/main
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:8080/status"]
    interval: 10s
    timeout: 5s
    retries: 10
    start_period: 120s
```

### Plugin Integration

- Config: `NOMINATIM_URL` env var (default: `http://nominatim:8080`)
- Endpoint: `GET /reverse?format=jsonv2&lat={lat}&lon={lng}`
- Cache: LRU cache keyed by rounded coords (~100m precision)
- Graceful degradation: if Nominatim unavailable, store with lat/lng only

## Location Embedding (#1210)

### Store-Time

When a memory has address or place_label:
1. Compose location string: `"${address} ${place_label}".trim()`
2. Generate embedding using existing `generateMemoryEmbedding()` pipeline
3. Store in `location_embedding` column

### Recall-Time

When recall has location context:
1. Reverse geocode the query lat/lng to get context address
2. Generate embedding for the context address
3. Compute cosine similarity against stored `location_embedding` values
4. Blend with content similarity score

## Implementation Phases

| Phase | Issues | Dependencies | Parallelisable |
|-------|--------|-------------|----------------|
| 1 | #1207 (research) | None | No (unblocks all) |
| 2 | #1205 (store) | #1207 | No (provides schema) |
| 3 | #1206 (recall) + #1209 (geocoding) | #1205 | Yes (independent) |
| 4 | #1210 (embeddings) | #1205, #1206 | No (needs both) |

## Testing Strategy

- Unit tests: Zod schema validation, haversine math, score blending
- Integration tests: Full roundtrip store→recall with geo data against real Postgres
- E2E tests: Plugin tool invocation with location params
- Edge cases: Antimeridian (lng=180/-180), poles, missing Nominatim, no location on recall
