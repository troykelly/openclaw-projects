# Geolocation-Aware Memory Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add discrete geo columns, reverse geocoding, and location-aware recall to the memory system across backend API + plugin.

**Architecture:** DB migration adds lat/lng/address/place_label/location_embedding to the `memory` table. Backend API accepts and returns geo fields. Plugin `memory_store` passes location through (with optional reverse geocode via self-hosted Nominatim). Plugin `memory_recall` adds client-side geo re-ranking with proximity, semantic location, and contextual boost modes.

**Tech Stack:** PostgreSQL (cube + earthdistance extensions), Fastify API, Zod schemas, vitest, self-hosted Nominatim (mediagis/nominatim Docker image)

---

## Issue Map

| Issue | Task | Phase |
|-------|------|-------|
| #1207 | Research + document API capabilities | 1 (this plan IS the research) |
| #1205 | DB migration + API + plugin memory_store | 2 |
| #1206 | Plugin memory_recall with geo re-ranking | 3 |
| #1209 | Nominatim container + reverse geocoding | 3 (parallel with #1206) |
| #1210 | Location embedding generation + recall blending | 4 |

---

## Task 1: DB Migration — Add Geo Columns to Memory Table (#1205 prerequisite)

**Issue:** #1205
**Files:**
- Create: `migrations/066_memory_geolocation.up.sql`
- Create: `migrations/066_memory_geolocation.down.sql`

**Step 1: Write the up migration**

```sql
-- Migration 066: Geolocation fields for memory system
-- Part of Epic #1204, Issue #1205

-- Enable cube + earthdistance extensions for proximity queries
CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS earthdistance;

-- Add geo columns to memory table
ALTER TABLE memory ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE memory ADD COLUMN IF NOT EXISTS lng double precision;
ALTER TABLE memory ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE memory ADD COLUMN IF NOT EXISTS place_label text;
ALTER TABLE memory ADD COLUMN IF NOT EXISTS location_embedding vector(1024);

-- lat/lng must be provided together
ALTER TABLE memory ADD CONSTRAINT chk_memory_geo_pair
  CHECK ((lat IS NULL AND lng IS NULL) OR (lat IS NOT NULL AND lng IS NOT NULL));

-- Valid coordinate ranges
ALTER TABLE memory ADD CONSTRAINT chk_memory_lat_range
  CHECK (lat IS NULL OR (lat >= -90 AND lat <= 90));
ALTER TABLE memory ADD CONSTRAINT chk_memory_lng_range
  CHECK (lng IS NULL OR (lng >= -180 AND lng <= 180));

-- Index for proximity queries
CREATE INDEX IF NOT EXISTS idx_memory_geo
  ON memory (lat, lng) WHERE lat IS NOT NULL;

-- HNSW index for location embedding similarity
CREATE INDEX IF NOT EXISTS idx_memory_location_embedding
  ON memory USING hnsw (location_embedding vector_cosine_ops)
  WHERE location_embedding IS NOT NULL;

-- Documentation
COMMENT ON COLUMN memory.lat IS 'WGS84 latitude of location context for this memory';
COMMENT ON COLUMN memory.lng IS 'WGS84 longitude of location context for this memory';
COMMENT ON COLUMN memory.address IS 'Reverse-geocoded address for the memory location';
COMMENT ON COLUMN memory.place_label IS 'Short human-friendly place name';
COMMENT ON COLUMN memory.location_embedding IS 'Separate embedding for address+place_label (1024 dims, same provider as content)';
```

**Step 2: Write the down migration**

```sql
-- Down migration 066: Remove geolocation fields from memory
DROP INDEX IF EXISTS idx_memory_location_embedding;
DROP INDEX IF EXISTS idx_memory_geo;
ALTER TABLE memory DROP CONSTRAINT IF EXISTS chk_memory_lng_range;
ALTER TABLE memory DROP CONSTRAINT IF EXISTS chk_memory_lat_range;
ALTER TABLE memory DROP CONSTRAINT IF EXISTS chk_memory_geo_pair;
ALTER TABLE memory DROP COLUMN IF EXISTS location_embedding;
ALTER TABLE memory DROP COLUMN IF EXISTS place_label;
ALTER TABLE memory DROP COLUMN IF EXISTS address;
ALTER TABLE memory DROP COLUMN IF EXISTS lng;
ALTER TABLE memory DROP COLUMN IF EXISTS lat;
-- Note: Do not drop cube/earthdistance extensions as other migrations may use them
```

**Step 3: Run migration against dev database**

```bash
pnpm run migrate
```

Expected: Migration applies cleanly, no errors.

**Step 4: Verify columns exist**

```bash
# In a test or psql session, verify the columns
psql -U openclaw -d openclaw -c "\d memory" | grep -E "lat|lng|address|place_label|location_embedding"
```

**Step 5: Commit**

```bash
git add migrations/066_memory_geolocation.up.sql migrations/066_memory_geolocation.down.sql
git commit -m "[#1205] Add geolocation columns to memory table"
```

---

## Task 2: Backend Types — Extend Memory Interfaces (#1205)

**Issue:** #1205
**Files:**
- Modify: `src/api/memory/types.ts`

**Step 1: Add geo fields to CreateMemoryInput**

In `src/api/memory/types.ts`, add to `CreateMemoryInput` (line 46):

```typescript
export interface CreateMemoryInput extends MemoryScope, MemoryAttribution, MemoryLifecycle {
  title: string;
  content: string;
  memoryType?: MemoryType;
  tags?: string[];
  /** WGS84 latitude (-90 to 90) */
  lat?: number;
  /** WGS84 longitude (-180 to 180) */
  lng?: number;
  /** Reverse-geocoded address */
  address?: string;
  /** Short human-friendly place name */
  placeLabel?: string;
}
```

**Step 2: Add geo fields to MemoryEntry**

In `src/api/memory/types.ts`, add to `MemoryEntry` (after line 87):

```typescript
export interface MemoryEntry {
  // ... existing fields ...
  /** WGS84 latitude */
  lat: number | null;
  /** WGS84 longitude */
  lng: number | null;
  /** Reverse-geocoded address */
  address: string | null;
  /** Short human-friendly place name */
  placeLabel: string | null;
  // ... rest of existing fields ...
}
```

**Step 3: Run typecheck**

```bash
pnpm run typecheck
```

Expected: Type errors in `service.ts` (mapRowToMemory missing new fields) — that's next task.

**Step 4: Commit**

```bash
git add src/api/memory/types.ts
git commit -m "[#1205] Add geo fields to memory type interfaces"
```

---

## Task 3: Backend Service — Handle Geo in Create + Map (#1205)

**Issue:** #1205
**Files:**
- Modify: `src/api/memory/service.ts:26-48` (mapRowToMemory)
- Modify: `src/api/memory/service.ts:115-240` (createMemory)
- Modify: `src/api/memory/service.ts:628-784` (searchMemories — return geo in results)

**Step 1: Write integration test for geo memory creation**

Create test in the existing test structure. The test should:
- Create a memory with lat, lng, address, place_label
- Retrieve it and verify geo fields are returned
- Create a memory without location and verify null geo fields
- Test constraint: lat without lng should fail

**Step 2: Update mapRowToMemory to include geo fields**

In `service.ts:26-48`, add:

```typescript
function mapRowToMemory(row: Record<string, unknown>): MemoryEntry {
  return {
    // ... existing mappings ...
    lat: row.lat as number | null,
    lng: row.lng as number | null,
    address: row.address as string | null,
    placeLabel: row.place_label as string | null,
    // ... rest ...
  };
}
```

**Step 3: Update createMemory to accept and INSERT geo fields**

In `service.ts`, the INSERT query (lines 207-237) must add lat, lng, address, place_label columns:

```typescript
const result = await pool.query(
  `INSERT INTO memory (
    user_email, work_item_id, contact_id, relationship_id,
    title, content, memory_type,
    tags,
    created_by_agent, created_by_human, source_url,
    importance, confidence, expires_at,
    lat, lng, address, place_label
  ) VALUES ($1, $2, $3, $4, $5, $6, $7::memory_type, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
  RETURNING
    id::text, user_email, work_item_id::text, contact_id::text, relationship_id::text,
    title, content, memory_type::text, tags,
    created_by_agent, created_by_human, source_url,
    importance, confidence, expires_at, superseded_by::text,
    embedding_status, created_at, updated_at,
    lat, lng, address, place_label`,
  [
    // ... existing params ...
    input.lat ?? null,
    input.lng ?? null,
    input.address ?? null,
    input.placeLabel ?? null,
  ],
);
```

Also update ALL SELECT queries that return memory rows (getMemory, updateMemory, listMemories, searchMemories, deduplication check) to include `lat, lng, address, place_label` in their column lists.

**Step 4: Run tests**

```bash
pnpm test -- --grep "memory"
```

**Step 5: Commit**

```bash
git add src/api/memory/service.ts
git commit -m "[#1205] Handle geo fields in memory service create/read/search"
```

---

## Task 4: Backend API Routes — Accept and Return Geo (#1205)

**Issue:** #1205
**Files:**
- Modify: `src/api/server.ts:6500-6515` (POST /api/memories/unified body type)
- Modify: `src/api/server.ts:6533-6548` (createMemory call)
- Modify: `src/api/server.ts:6564-6641` (POST /api/memories/bulk)

**Step 1: Extend POST /api/memories/unified body type**

At `server.ts:6500`, add to the body type:

```typescript
const body = req.body as {
  // ... existing fields ...
  lat?: number;
  lng?: number;
  address?: string;
  place_label?: string;
};
```

**Step 2: Pass geo fields to createMemory**

At `server.ts:6533`, add to the createMemory call:

```typescript
const memory = await createMemory(pool, {
  // ... existing fields ...
  lat: body.lat,
  lng: body.lng,
  address: body.address,
  placeLabel: body.place_label,
});
```

**Step 3: Validate coordinates**

Before createMemory call, add validation:

```typescript
if (body.lat !== undefined || body.lng !== undefined) {
  if (body.lat === undefined || body.lng === undefined) {
    return reply.code(400).send({ error: 'lat and lng must be provided together' });
  }
  if (body.lat < -90 || body.lat > 90) {
    return reply.code(400).send({ error: 'lat must be between -90 and 90' });
  }
  if (body.lng < -180 || body.lng > 180) {
    return reply.code(400).send({ error: 'lng must be between -180 and 180' });
  }
}
```

**Step 4: Update bulk endpoint similarly**

Apply the same changes to `POST /api/memories/bulk` (line 6564).

**Step 5: Run the full test suite**

```bash
pnpm test
```

**Step 6: Commit**

```bash
git add src/api/server.ts
git commit -m "[#1205] Accept and return geo fields in memory API routes"
```

---

## Task 5: Plugin memory_store — Add Location Schema + Pass-through (#1205)

**Issue:** #1205
**Files:**
- Modify: `packages/openclaw-plugin/src/tools/memory-store.ts:16-25` (schema)
- Modify: `packages/openclaw-plugin/src/tools/memory-store.ts:29-36` (StoredMemory)
- Modify: `packages/openclaw-plugin/src/tools/memory-store.ts:150-158` (payload)
- Modify: `packages/openclaw-plugin/src/register-openclaw.ts:120-164` (JSONSchema)
- Modify: `packages/openclaw-plugin/src/register-openclaw.ts:1149-1200` (handler)
- Test: `packages/openclaw-plugin/tests/tools/memory-store.test.ts`

**Step 1: Write failing tests for location in memory_store**

Add tests to `memory-store.test.ts`:
- Valid location with all fields passes schema validation
- Valid location with only lat/lng passes
- Invalid lat (>90) fails validation
- Invalid lng (>180) fails validation
- lat without lng fails (Zod refine)
- Location data is included in API payload
- Memory without location still works

**Step 2: Run tests to verify they fail**

```bash
cd packages/openclaw-plugin && pnpm test -- --grep "memory.store"
```

**Step 3: Add location to MemoryStoreParamsSchema**

In `memory-store.ts:16-25`:

```typescript
export const MemoryStoreParamsSchema = z.object({
  text: z.string().min(1).max(10000).optional(),
  content: z.string().min(1).max(10000).optional(),
  category: MemoryCategory.optional(),
  importance: z.number().min(0).max(1).optional(),
  tags: z.array(z.string().min(1).max(100)).max(20).optional(),
  relationship_id: z.string().uuid().optional(),
  location: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    address: z.string().max(500).optional(),
    place_label: z.string().max(200).optional(),
  }).optional(),
}).refine((data) => data.text || data.content, {
  message: 'Either text or content is required',
});
```

**Step 4: Pass location through to API payload**

In `memory-store.ts:150-158`, add to payload:

```typescript
if (parseResult.data.location) {
  payload.lat = parseResult.data.location.lat;
  payload.lng = parseResult.data.location.lng;
  if (parseResult.data.location.address) {
    payload.address = parseResult.data.location.address;
  }
  if (parseResult.data.location.place_label) {
    payload.place_label = parseResult.data.location.place_label;
  }
}
```

**Step 5: Update JSONSchema in register-openclaw.ts**

At `register-openclaw.ts:120-164`, add `location` property to `memoryStoreSchema`:

```typescript
location: {
  type: 'object',
  description: 'Optional location context for this memory',
  properties: {
    lat: { type: 'number', description: 'WGS84 latitude', minimum: -90, maximum: 90 },
    lng: { type: 'number', description: 'WGS84 longitude', minimum: -180, maximum: 180 },
    address: { type: 'string', description: 'Human-readable address', maxLength: 500 },
    place_label: { type: 'string', description: 'Short place name', maxLength: 200 },
  },
  required: ['lat', 'lng'],
},
```

**Step 6: Update handler in register-openclaw.ts**

At `register-openclaw.ts:1149-1200`, add location to the destructured params and payload:

```typescript
const { text, content: contentAlias, category = 'other', importance = 0.7, tags, relationship_id, location } = params as {
  // ... existing types ...
  location?: { lat: number; lng: number; address?: string; place_label?: string };
};
// ...
if (location) {
  payload.lat = location.lat;
  payload.lng = location.lng;
  if (location.address) payload.address = location.address;
  if (location.place_label) payload.place_label = location.place_label;
}
```

**Step 7: Run tests**

```bash
cd packages/openclaw-plugin && pnpm test -- --grep "memory.store"
```

**Step 8: Commit**

```bash
git add packages/openclaw-plugin/src/tools/memory-store.ts packages/openclaw-plugin/src/register-openclaw.ts packages/openclaw-plugin/tests/tools/memory-store.test.ts
git commit -m "[#1205] Add location fields to memory_store plugin tool"
```

---

## Task 6: Plugin memory_recall — Add Location Params + Geo Re-ranking (#1206)

**Issue:** #1206
**Files:**
- Modify: `packages/openclaw-plugin/src/tools/memory-recall.ts:19-25` (schema)
- Modify: `packages/openclaw-plugin/src/tools/memory-recall.ts:28-37` (Memory interface)
- Modify: `packages/openclaw-plugin/src/tools/memory-recall.ts:115-217` (execute handler)
- Create: `packages/openclaw-plugin/src/utils/geo.ts` (haversine + scoring)
- Modify: `packages/openclaw-plugin/src/register-openclaw.ts:78-115` (JSONSchema)
- Modify: `packages/openclaw-plugin/src/register-openclaw.ts:1103-1147` (handler)
- Test: `packages/openclaw-plugin/tests/tools/memory-recall.test.ts`
- Test: `packages/openclaw-plugin/tests/utils/geo.test.ts`

**Step 1: Write failing tests for geo utility functions**

Create `packages/openclaw-plugin/tests/utils/geo.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { haversineDistanceKm, computeGeoScore, blendScores } from '../../src/utils/geo.js';

describe('haversineDistanceKm', () => {
  it('returns 0 for identical points', () => {
    expect(haversineDistanceKm(-33.9, 151.2, -33.9, 151.2)).toBe(0);
  });

  it('calculates Sydney to Melbourne (~714 km)', () => {
    const d = haversineDistanceKm(-33.8688, 151.2093, -37.8136, 144.9631);
    expect(d).toBeGreaterThan(700);
    expect(d).toBeLessThan(730);
  });

  it('handles antimeridian crossing', () => {
    const d = haversineDistanceKm(0, 179, 0, -179);
    expect(d).toBeLessThan(250); // ~222 km
  });

  it('handles poles', () => {
    const d = haversineDistanceKm(90, 0, -90, 0);
    expect(d).toBeGreaterThan(19000); // ~20015 km
  });
});

describe('computeGeoScore', () => {
  it('returns 1.0 for distance 0', () => {
    expect(computeGeoScore(0)).toBe(1.0);
  });

  it('returns ~0 for very large distances', () => {
    expect(computeGeoScore(20000)).toBeLessThan(0.01);
  });

  it('decays with distance', () => {
    const near = computeGeoScore(1);
    const far = computeGeoScore(50);
    expect(near).toBeGreaterThan(far);
  });
});

describe('blendScores', () => {
  it('with weight 0 returns content score only', () => {
    expect(blendScores(0.8, 0.2, 0)).toBe(0.8);
  });

  it('with weight 1 returns geo score only', () => {
    expect(blendScores(0.8, 0.2, 1)).toBeCloseTo(0.2);
  });

  it('blends proportionally', () => {
    expect(blendScores(0.8, 0.4, 0.5)).toBeCloseTo(0.6);
  });
});
```

**Step 2: Implement geo utilities**

Create `packages/openclaw-plugin/src/utils/geo.ts`:

```typescript
/**
 * Geo utilities for location-aware memory recall.
 * Part of Epic #1204, Issue #1206.
 */

/** Haversine distance in kilometres between two WGS84 points. */
export function haversineDistanceKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Compute a geo relevance score from distance.
 * Uses exponential decay: score = exp(-distance / scale).
 * Scale of 10 km means ~37% relevance at 10 km, ~5% at 30 km.
 */
export function computeGeoScore(distanceKm: number, scaleKm = 10): number {
  return Math.exp(-distanceKm / scaleKm);
}

/**
 * Blend content similarity score with geo score.
 * weight=0 → pure content, weight=1 → pure geo.
 */
export function blendScores(contentScore: number, geoScore: number, weight: number): number {
  return (1 - weight) * contentScore + weight * geoScore;
}
```

**Step 3: Write failing tests for memory_recall with location params**

Add to `memory-recall.test.ts`:
- Location params pass schema validation
- location_radius_km validates range
- location_weight validates 0-1 range
- Recall with location re-ranks results by proximity
- Recall without location returns unchanged results
- Memories without stored geo get neutral score

**Step 4: Extend MemoryRecallParamsSchema**

In `memory-recall.ts:19-25`:

```typescript
export const MemoryRecallParamsSchema = z.object({
  query: z.string().min(1).max(1000),
  limit: z.number().int().min(1).max(20).optional(),
  category: MemoryCategory.optional(),
  tags: z.array(z.string().min(1).max(100)).max(20).optional(),
  relationship_id: z.string().uuid().optional(),
  location: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }).optional(),
  location_radius_km: z.number().min(0.1).max(100).optional(),
  location_weight: z.number().min(0).max(1).optional(),
});
```

**Step 5: Add geo fields to Memory interface**

In `memory-recall.ts:29-37`:

```typescript
export interface Memory {
  id: string;
  content: string;
  category: string;
  tags?: string[];
  score?: number;
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  place_label?: string | null;
  created_at?: string;
  updated_at?: string;
}
```

**Step 6: Implement geo re-ranking in execute handler**

In `memory-recall.ts`, the execute handler (line 115+):

1. If `location` is provided, request `3 * limit` from API (to allow for filtering/re-ranking)
2. Map results including lat/lng/address/place_label from API response
3. If `location_radius_km` is set, filter to memories within radius (haversine)
4. Compute geo score for each memory with stored lat/lng
5. Memories without stored lat/lng get neutral geo score (0.5)
6. Blend: `final_score = (1 - weight) * content_score + weight * geo_score`
7. Re-sort by final_score, truncate to original limit

```typescript
// After getting rawResults from API...
if (parseResult.data.location) {
  const { lat: qLat, lng: qLng } = parseResult.data.location;
  const radiusKm = parseResult.data.location_radius_km;
  const weight = parseResult.data.location_weight ?? 0.3;

  let filtered = memories;

  // Proximity filter
  if (radiusKm !== undefined) {
    filtered = filtered.filter((m) => {
      if (m.lat == null || m.lng == null) return false;
      return haversineDistanceKm(qLat, qLng, m.lat, m.lng) <= radiusKm;
    });
  }

  // Re-rank with geo score
  const ranked = filtered.map((m) => {
    const contentScore = m.score ?? 0;
    let geoScore = 0.5; // neutral for no-geo memories
    if (m.lat != null && m.lng != null) {
      const dist = haversineDistanceKm(qLat, qLng, m.lat, m.lng);
      geoScore = computeGeoScore(dist);
    }
    return { ...m, score: blendScores(contentScore, geoScore, weight) };
  });

  ranked.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  memories = ranked.slice(0, limit);
}
```

**Step 7: Update JSONSchema in register-openclaw.ts**

At `register-openclaw.ts:78-115`, add to `memoryRecallSchema.properties`:

```typescript
location: {
  type: 'object',
  description: 'Current location for geo-aware recall ranking',
  properties: {
    lat: { type: 'number', description: 'WGS84 latitude', minimum: -90, maximum: 90 },
    lng: { type: 'number', description: 'WGS84 longitude', minimum: -180, maximum: 180 },
  },
  required: ['lat', 'lng'],
},
location_radius_km: {
  type: 'number',
  description: 'Filter to memories within this radius in km',
  minimum: 0.1,
  maximum: 100,
},
location_weight: {
  type: 'number',
  description: 'Weight of location relevance vs content relevance (0-1, default 0.3)',
  minimum: 0,
  maximum: 1,
  default: 0.3,
},
```

**Step 8: Update handler in register-openclaw.ts**

At `register-openclaw.ts:1103-1147`, extend the handler to pass location params and re-rank.

**Step 9: Run tests**

```bash
cd packages/openclaw-plugin && pnpm test
```

**Step 10: Commit**

```bash
git add packages/openclaw-plugin/src/utils/geo.ts packages/openclaw-plugin/src/tools/memory-recall.ts packages/openclaw-plugin/src/register-openclaw.ts packages/openclaw-plugin/tests/
git commit -m "[#1206] Add location context to memory_recall with geo re-ranking"
```

---

## Task 7: Nominatim Container + Reverse Geocoding (#1209)

**Issue:** #1209
**Files:**
- Modify: `.devcontainer/docker-compose.devcontainer.yml`
- Create: `packages/openclaw-plugin/src/utils/nominatim.ts`
- Test: `packages/openclaw-plugin/tests/utils/nominatim.test.ts`
- Modify: `packages/openclaw-plugin/src/tools/memory-store.ts` (call geocoder before API)
- Modify: `packages/openclaw-plugin/src/config.ts` (add NOMINATIM_URL)

**Step 1: Add Nominatim to devcontainer compose**

In `.devcontainer/docker-compose.devcontainer.yml`, add before `volumes:`:

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

Add volume: `openclaw_projects_nominatim_data:` to the volumes section.

Add `NOMINATIM_URL: http://nominatim:8080` to workspace environment.

**Step 2: Write failing tests for Nominatim client**

Create `packages/openclaw-plugin/tests/utils/nominatim.test.ts`:
- Successful reverse geocode returns address
- Failed geocode returns null (graceful degradation)
- Cache returns cached result for nearby coordinates
- Coordinate rounding to ~100m precision for cache key

**Step 3: Implement Nominatim client**

Create `packages/openclaw-plugin/src/utils/nominatim.ts`:

```typescript
/**
 * Reverse geocoding via self-hosted Nominatim.
 * Part of Epic #1204, Issue #1209.
 */

export interface GeocodedLocation {
  address: string;
  placeLabel: string;
}

/** LRU cache for geocoded results (key: rounded lat,lng) */
const geocodeCache = new Map<string, GeocodedLocation>();
const MAX_CACHE_SIZE = 500;

/** Round to ~100m precision for cache key */
function cacheKey(lat: number, lng: number): string {
  return `${Math.round(lat * 1000) / 1000},${Math.round(lng * 1000) / 1000}`;
}

/**
 * Reverse geocode coordinates to address via Nominatim.
 * Returns null on failure (graceful degradation).
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
  nominatimUrl: string,
): Promise<GeocodedLocation | null> {
  const key = cacheKey(lat, lng);
  if (geocodeCache.has(key)) {
    return geocodeCache.get(key)!;
  }

  try {
    const url = `${nominatimUrl}/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'openclaw-projects/1.0' },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return null;

    const data = await response.json() as {
      display_name?: string;
      name?: string;
      address?: {
        road?: string;
        suburb?: string;
        city?: string;
        state?: string;
        country?: string;
      };
    };

    const result: GeocodedLocation = {
      address: data.display_name ?? '',
      placeLabel: data.name || data.address?.suburb || data.address?.city || '',
    };

    // LRU eviction
    if (geocodeCache.size >= MAX_CACHE_SIZE) {
      const oldest = geocodeCache.keys().next().value;
      if (oldest !== undefined) geocodeCache.delete(oldest);
    }
    geocodeCache.set(key, result);

    return result;
  } catch {
    return null; // Graceful degradation
  }
}

/** Clear cache (for testing) */
export function clearGeocodeCache(): void {
  geocodeCache.clear();
}
```

**Step 4: Integrate geocoder into memory_store**

In `memory-store.ts`, before the API call (around line 145):

```typescript
// Reverse geocode if location has lat/lng but no address
if (parseResult.data.location && !parseResult.data.location.address) {
  const nominatimUrl = options.config.nominatimUrl;
  if (nominatimUrl) {
    const geocoded = await reverseGeocode(
      parseResult.data.location.lat,
      parseResult.data.location.lng,
      nominatimUrl,
    );
    if (geocoded) {
      parseResult.data.location.address = geocoded.address;
      if (!parseResult.data.location.place_label) {
        parseResult.data.location.place_label = geocoded.placeLabel;
      }
    }
  }
}
```

**Step 5: Add NOMINATIM_URL to config**

In `packages/openclaw-plugin/src/config.ts`, add:

```typescript
nominatimUrl: process.env.NOMINATIM_URL || undefined,
```

**Step 6: Run tests**

```bash
cd packages/openclaw-plugin && pnpm test
```

**Step 7: Commit**

```bash
git add .devcontainer/docker-compose.devcontainer.yml packages/openclaw-plugin/src/utils/nominatim.ts packages/openclaw-plugin/tests/utils/nominatim.test.ts packages/openclaw-plugin/src/tools/memory-store.ts packages/openclaw-plugin/src/config.ts
git commit -m "[#1209] Add Nominatim container and reverse geocoding for memory locations"
```

---

## Task 8: Location Embedding — Generate + Use at Recall (#1210)

**Issue:** #1210
**Files:**
- Modify: `src/api/embeddings/memory-integration.ts` (new function for location embedding)
- Modify: `src/api/server.ts:6550-6552` (generate location embedding after memory creation)
- Modify: `packages/openclaw-plugin/src/tools/memory-recall.ts` (use location_embedding similarity)
- Test: Integration test for location embedding round-trip

**Step 1: Write failing test for location embedding generation**

Test that when a memory is created with address+place_label, a location_embedding is generated in a separate column.

**Step 2: Add generateLocationEmbedding function**

In `src/api/embeddings/memory-integration.ts`:

```typescript
/**
 * Generate and store location embedding for a memory record.
 * Uses address + place_label as input text.
 */
export async function generateLocationEmbedding(
  pool: Pool,
  memoryId: string,
  locationText: string,
): Promise<void> {
  if (!embeddingService.isConfigured() || !locationText.trim()) return;

  try {
    const result = await embeddingService.embed(locationText);
    if (!result) return;

    await pool.query(
      `UPDATE memory
       SET location_embedding = $1::vector
       WHERE id = $2`,
      [`[${result.embedding.join(',')}]`, memoryId],
    );
  } catch (error) {
    // Non-fatal: location embedding is a bonus signal
    const msg = error instanceof Error ? error.message : String(error);
    if (!msg.includes('Cannot use a pool after calling end')) {
      console.error(`[Embeddings] Failed to embed location for memory ${memoryId}:`, msg);
    }
  }
}
```

**Step 3: Call from server.ts after memory creation**

At `server.ts:6550-6552`, after `generateMemoryEmbedding`:

```typescript
// Generate location embedding if geo data present
if (memory.address || memory.placeLabel) {
  const locationText = [memory.address, memory.placeLabel].filter(Boolean).join(' ');
  await generateLocationEmbedding(pool, memory.id, locationText);
}
```

**Step 4: Use location embedding in recall**

In memory_recall plugin, when location is provided:
1. Reverse geocode the query location to get an address string
2. The API search results already include location_embedding similarity if we extend the search query
3. Alternatively, compute similarity client-side if the API doesn't expose it

For simplicity, use the haversine-based geo scoring from Task 6 as the primary geo signal. The location_embedding adds a semantic dimension — "near a university" vs "near a restaurant" — which can be blended in future iterations.

**Step 5: Run full test suite**

```bash
pnpm test
```

**Step 6: Commit**

```bash
git add src/api/embeddings/memory-integration.ts src/api/server.ts
git commit -m "[#1210] Generate separate location embeddings for geo-tagged memories"
```

---

## Task 9: E2E Test — Full Geo Memory Round-trip

**Files:**
- Modify: `packages/openclaw-plugin/tests/e2e/plugin-memory-roundtrip.test.ts`

**Step 1: Add E2E test for geo memory lifecycle**

```typescript
describe('geo memory round-trip', () => {
  it('stores memory with location and recalls with proximity', async () => {
    // Store a memory at Sydney CBD
    const storeResult = await memoryStore({
      text: 'Great sushi at Sushi Hub',
      category: 'preference',
      tags: ['food', 'dining'],
      location: { lat: -33.8688, lng: 151.2093, place_label: 'Sydney CBD' },
    });
    expect(storeResult.success).toBe(true);

    // Recall from nearby (Circular Quay, ~500m)
    const nearRecall = await memoryRecall({
      query: 'food preferences',
      location: { lat: -33.8568, lng: 151.2153 },
      location_weight: 0.5,
    });
    expect(nearRecall.success).toBe(true);
    expect(nearRecall.data.details.memories.length).toBeGreaterThan(0);

    // Recall with tight radius should include it
    const radiusRecall = await memoryRecall({
      query: 'food preferences',
      location: { lat: -33.8688, lng: 151.2093 },
      location_radius_km: 1,
    });
    expect(radiusRecall.success).toBe(true);

    // Recall from Melbourne should rank it lower
    const farRecall = await memoryRecall({
      query: 'food preferences',
      location: { lat: -37.8136, lng: 144.9631 },
      location_weight: 0.5,
    });
    // Memory should still appear (content match) but with lower blended score
  });

  it('stores memory without location — no regression', async () => {
    const result = await memoryStore({
      text: 'Prefers dark mode',
      category: 'preference',
    });
    expect(result.success).toBe(true);
  });
});
```

**Step 2: Run E2E tests**

```bash
cd packages/openclaw-plugin && RUN_E2E=true pnpm run test:e2e
```

**Step 3: Commit**

```bash
git add packages/openclaw-plugin/tests/e2e/plugin-memory-roundtrip.test.ts
git commit -m "[#1204] Add E2E tests for geo memory round-trip"
```

---

## Task 10: Research Documentation + Issue Updates (#1207)

**Issue:** #1207
**Files:**
- Comment on GitHub issues

**Step 1: Document research findings on #1207**

Post a comment to issue #1207 with:
- The `memory` table had NO metadata JSON column — required a migration
- Added discrete columns: `lat`, `lng`, `address`, `place_label`, `location_embedding`
- Uses `cube` + `earthdistance` PostgreSQL extensions for proximity
- Uses same embedding provider for location as content
- Recommended and implemented: DB migration approach (not tags, not skill_store)

**Step 2: Close #1207**

**Step 3: Update all child issues with progress as implementation proceeds**

Post implementation updates on #1205, #1206, #1209, #1210 as each task completes.

---

## Task 11: Final Verification + PR

**Step 1: Run full local verification**

```bash
pnpm run typecheck && pnpm run lint && pnpm test
```

**Step 2: Push branch and create PR**

```bash
git push -u origin issue/1204-geolocation-memory
```

Create PR with title `[#1204] Geolocation-aware memory storage and recall` and body:

```markdown
## Summary
- Adds geo columns to memory table (migration 066)
- Backend API accepts/returns lat, lng, address, place_label
- Plugin memory_store passes location through (with optional Nominatim reverse geocoding)
- Plugin memory_recall adds client-side geo re-ranking (proximity, contextual boost)
- Separate location embeddings for semantic location matching
- Self-hosted Nominatim added to devcontainer

Closes #1204, Closes #1207, Closes #1205, Closes #1206, Closes #1209, Closes #1210

## Test plan
- [ ] Migration applies and rolls back cleanly
- [ ] Memory store with location persists geo fields
- [ ] Memory store without location is unchanged
- [ ] Memory recall with location re-ranks by proximity
- [ ] Memory recall without location is unchanged
- [ ] Proximity filter works with location_radius_km
- [ ] Haversine math is correct (Sydney-Melbourne ~714km)
- [ ] Nominatim reverse geocode enriches lat/lng-only stores
- [ ] Nominatim failure degrades gracefully
- [ ] Location embedding generated at store time
- [ ] E2E round-trip passes
- [ ] All existing tests still pass
```

**Step 3: Run Codex review**

Use Codex CLI for security + blind spot review.

**Step 4: Address review comments, get to green CI, merge**
