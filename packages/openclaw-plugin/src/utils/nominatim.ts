/**
 * Nominatim reverse geocoding client with LRU cache.
 * Resolves lat/lng to human-readable address and place label.
 */

export interface GeocodedLocation {
  address: string;
  place_label: string;
}

const geocodeCache = new Map<string, GeocodedLocation>();
const MAX_CACHE_SIZE = 500;

/**
 * Rounds coordinates to ~100m precision for cache key deduplication.
 */
function cacheKey(lat: number, lng: number): string {
  return `${Math.round(lat * 1000) / 1000},${Math.round(lng * 1000) / 1000}`;
}

/**
 * Reverse geocode a lat/lng pair via Nominatim.
 * Returns null on any failure (timeout, network error, bad response).
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
  nominatimUrl: string,
): Promise<GeocodedLocation | null> {
  const key = cacheKey(lat, lng);
  if (geocodeCache.has(key)) return geocodeCache.get(key)!;

  try {
    const url = `${nominatimUrl}/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'openclaw-projects/1.0' },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      console.warn(`[Nominatim] Reverse geocode failed: HTTP ${response.status} for (${lat}, ${lng})`);
      return null;
    }

    const data = (await response.json()) as {
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
      place_label: data.name || data.address?.suburb || data.address?.city || '',
    };

    if (geocodeCache.size >= MAX_CACHE_SIZE) {
      const oldest = geocodeCache.keys().next().value;
      if (oldest !== undefined) geocodeCache.delete(oldest);
    }
    geocodeCache.set(key, result);
    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[Nominatim] Reverse geocode error for (${lat}, ${lng}): ${msg}`);
    return null;
  }
}

/**
 * Clears the geocode cache (for testing).
 */
export function clearGeocodeCache(): void {
  geocodeCache.clear();
}
