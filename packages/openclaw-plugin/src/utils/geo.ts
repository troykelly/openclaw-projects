/**
 * Geo utilities for location-aware memory recall.
 * Part of Epic #1204, Issue #1206.
 */

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Calculate the great-circle distance between two points using the Haversine formula.
 * Returns distance in kilometres.
 */
export function haversineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Compute a geo relevance score using exponential decay.
 * Returns 1.0 for distance 0, approaching 0 for large distances.
 * @param distanceKm - distance in kilometres
 * @param scaleKm - decay scale factor (default 10 km)
 */
export function computeGeoScore(distanceKm: number, scaleKm = 10): number {
  return Math.exp(-distanceKm / scaleKm);
}

/**
 * Blend a content relevance score with a geo relevance score.
 * @param contentScore - semantic similarity score (0-1)
 * @param geoScore - geo proximity score (0-1)
 * @param weight - weight given to geo score (0 = content only, 1 = geo only)
 */
export function blendScores(contentScore: number, geoScore: number, weight: number): number {
  return (1 - weight) * contentScore + weight * geoScore;
}
