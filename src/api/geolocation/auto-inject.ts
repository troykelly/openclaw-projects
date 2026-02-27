/**
 * Geo auto-injection preHandler hook for memory routes.
 * Automatically injects the user's current location into memory
 * create/bulk requests when geo_auto_inject is enabled and no
 * explicit location is provided.
 * Issue #1250.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Pool } from 'pg';

/**
 * Create a Fastify preHandler that auto-injects current geolocation
 * into the request body if:
 *   1. The body doesn't already have explicit lat/lng
 *   2. The user's geo_auto_inject setting is true
 *   3. A current location is available
 *
 * Sets X-Geo-Source header: "explicit" when body has coords,
 * "auto" when injected, omitted otherwise.
 */
export function geoAutoInjectHook(createPool: () => Pool) {
  return async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const body = req.body as Record<string, unknown> | null | undefined;
    if (body === null || body === undefined || typeof body !== 'object' || Array.isArray(body)) return;

    // If explicit lat/lng already provided, mark as explicit and skip
    if (typeof body.lat === 'number' && typeof body.lng === 'number') {
      req.headers['x-geo-source'] = 'explicit';
      return;
    }

    // Need the user's email to look up settings and location
    const session = (req as unknown as { session?: { email?: string } }).session;
    const email = session?.email;
    if (!email) return;

    const pool = createPool();
    try {
      // Check user's geo_auto_inject setting
      let settingResult;
      try {
        settingResult = await pool.query(
          `SELECT geo_auto_inject FROM user_setting WHERE email = $1`,
          [email],
        );
      } catch (err) {
        console.warn('[geo-auto-inject] Setting query failed:', (err as Error).message);
        return;
      }
      const autoInject = settingResult.rows[0]?.geo_auto_inject;
      if (!autoInject) return;

      // Get current location
      let location;
      try {
        const { getCurrentLocation } = await import('./service.ts');
        location = await getCurrentLocation(pool, email);
      } catch (err) {
        console.warn('[geo-auto-inject] Location fetch failed:', (err as Error).message);
        return;
      }
      if (!location) return;

      // Inject location into body
      body.lat = location.lat;
      body.lng = location.lng;
      if (location.address) body.address = location.address;
      if (location.place_label) body.place_label = location.place_label;

      req.headers['x-geo-source'] = 'auto';
    } finally {
      await pool.end();
    }
  };
}
