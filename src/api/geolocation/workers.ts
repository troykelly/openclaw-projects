/**
 * Geolocation background workers for geocoding and embedding generation.
 * Issue #1245.
 *
 * processGeoGeocode: Reverse geocodes lat/lng via Nominatim → address + place_label.
 * processGeoEmbeddings: Generates embeddings for addresses, with dedup for same address.
 */

import type { Pool } from 'pg';

const DEFAULT_BATCH_SIZE = 50;
const NOMINATIM_USER_AGENT = 'openclaw-projects/1.0';

/**
 * Process geo_location records that need reverse geocoding.
 * Selects records where address IS NULL and lat IS NOT NULL,
 * calls Nominatim reverse geocode, and updates address + place_label.
 *
 * @returns Number of successfully geocoded records.
 */
export async function processGeoGeocode(pool: Pool, batchSize: number = DEFAULT_BATCH_SIZE): Promise<number> {
  const result = await pool.query(
    `SELECT time, user_email, provider_id, entity_id, lat, lng
     FROM geo_location
     WHERE address IS NULL AND lat IS NOT NULL
     ORDER BY time DESC
     LIMIT $1`,
    [batchSize],
  );

  if (result.rows.length === 0) return 0;

  let processed = 0;

  for (const row of result.rows) {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(row.lat)}&lon=${encodeURIComponent(row.lng)}&format=jsonv2`,
        {
          headers: {
            'User-Agent': NOMINATIM_USER_AGENT,
            'Accept': 'application/json',
          },
        },
      );

      if (!response.ok) {
        // Log and skip on API errors
        continue;
      }

      const data = await response.json() as { display_name?: string; name?: string };
      const address = data.display_name ?? null;
      const placeLabel = data.name ?? null;

      await pool.query(
        `UPDATE geo_location
         SET address = $1, place_label = $2
         WHERE time = $3 AND user_email = $4 AND provider_id = $5 AND entity_id = $6`,
        [address, placeLabel, row.time, row.user_email, row.provider_id, row.entity_id],
      );

      processed++;
    } catch {
      // Network errors, JSON parse errors — skip and continue
      continue;
    }
  }

  return processed;
}

/**
 * Process geo_location records that need embedding generation.
 * Selects records where embedding_status = 'pending' and address IS NOT NULL.
 * Skips records whose address matches a previous record for the same user+entity
 * (sets embedding_status = 'skipped').
 * Otherwise generates an embedding and sets embedding_status = 'complete'.
 *
 * @returns Number of processed records (including skipped).
 */
export async function processGeoEmbeddings(pool: Pool, batchSize: number = DEFAULT_BATCH_SIZE): Promise<number> {
  const result = await pool.query(
    `SELECT time, user_email, provider_id, entity_id, address
     FROM geo_location
     WHERE embedding_status = 'pending' AND address IS NOT NULL
     ORDER BY time DESC
     LIMIT $1`,
    [batchSize],
  );

  if (result.rows.length === 0) return 0;

  let processed = 0;

  for (const row of result.rows) {
    // Check if a previous record has the same address for this user+entity
    const dupCheck = await pool.query(
      `SELECT address FROM geo_location
       WHERE user_email = $1 AND entity_id = $2
         AND address = $3
         AND embedding_status IN ('complete', 'skipped')
         AND time < $4
       LIMIT 1`,
      [row.user_email, row.entity_id, row.address, row.time],
    );

    if (dupCheck.rows.length > 0) {
      // Same address already embedded/skipped — mark as skipped
      await pool.query(
        `UPDATE geo_location
         SET embedding_status = 'skipped'
         WHERE time = $1 AND user_email = $2 AND provider_id = $3 AND entity_id = $4`,
        [row.time, row.user_email, row.provider_id, row.entity_id],
      );
      processed++;
      continue;
    }

    // Generate embedding for this address
    try {
      // Dynamic import to avoid hard dependency at module level
      const { createEmbeddingService } = await import('../embeddings/service.ts');
      const embeddingService = createEmbeddingService();

      if (!embeddingService.isConfigured()) {
        // No embedding provider configured — skip
        await pool.query(
          `UPDATE geo_location
           SET embedding_status = 'skipped'
           WHERE time = $1 AND user_email = $2 AND provider_id = $3 AND entity_id = $4`,
          [row.time, row.user_email, row.provider_id, row.entity_id],
        );
        processed++;
        continue;
      }

      const embResult = await embeddingService.embed(row.address as string);

      if (embResult) {
        await pool.query(
          `UPDATE geo_location
           SET location_embedding = $1, embedding_status = 'complete'
           WHERE time = $2 AND user_email = $3 AND provider_id = $4 AND entity_id = $5`,
          [JSON.stringify(embResult.embedding), row.time, row.user_email, row.provider_id, row.entity_id],
        );
      } else {
        await pool.query(
          `UPDATE geo_location
           SET embedding_status = 'skipped'
           WHERE time = $1 AND user_email = $2 AND provider_id = $3 AND entity_id = $4`,
          [row.time, row.user_email, row.provider_id, row.entity_id],
        );
      }
      processed++;
    } catch {
      // Embedding generation failed — skip
      continue;
    }
  }

  return processed;
}
