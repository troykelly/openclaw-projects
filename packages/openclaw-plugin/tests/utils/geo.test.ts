import { describe, it, expect } from 'vitest';
import { haversineDistanceKm, computeGeoScore, blendScores } from '../../src/utils/geo.js';

describe('haversineDistanceKm', () => {
  it('returns 0 for identical points', () => {
    expect(haversineDistanceKm(0, 0, 0, 0)).toBe(0);
    expect(haversineDistanceKm(-33.8688, 151.2093, -33.8688, 151.2093)).toBe(0);
  });

  it('calculates Sydney to Melbourne distance (~714 km)', () => {
    // Sydney: -33.8688, 151.2093   Melbourne: -37.8136, 144.9631
    const dist = haversineDistanceKm(-33.8688, 151.2093, -37.8136, 144.9631);
    expect(dist).toBeGreaterThan(700);
    expect(dist).toBeLessThan(730);
  });

  it('handles antimeridian crossing', () => {
    // Point near the antimeridian on each side: (0, 179) to (0, -179) ~ 222 km
    const dist = haversineDistanceKm(0, 179, 0, -179);
    expect(dist).toBeGreaterThan(200);
    expect(dist).toBeLessThan(250);
  });

  it('handles North Pole to South Pole (~20015 km)', () => {
    const dist = haversineDistanceKm(90, 0, -90, 0);
    expect(dist).toBeGreaterThan(20000);
    expect(dist).toBeLessThan(20100);
  });

  it('is symmetric', () => {
    const d1 = haversineDistanceKm(40.7128, -74.006, 51.5074, -0.1278);
    const d2 = haversineDistanceKm(51.5074, -0.1278, 40.7128, -74.006);
    expect(d1).toBeCloseTo(d2, 10);
  });

  it('returns non-negative values', () => {
    expect(haversineDistanceKm(-90, -180, 90, 180)).toBeGreaterThanOrEqual(0);
  });
});

describe('computeGeoScore', () => {
  it('returns 1.0 for distance 0', () => {
    expect(computeGeoScore(0)).toBe(1);
  });

  it('returns ~0.37 for distance equal to scale', () => {
    // e^(-1) ≈ 0.3679
    expect(computeGeoScore(10, 10)).toBeCloseTo(Math.exp(-1), 5);
  });

  it('approaches 0 for very large distances', () => {
    expect(computeGeoScore(1000, 10)).toBeLessThan(0.001);
  });

  it('preserves ordering: closer = higher score', () => {
    const s1 = computeGeoScore(1);
    const s2 = computeGeoScore(5);
    const s3 = computeGeoScore(50);
    expect(s1).toBeGreaterThan(s2);
    expect(s2).toBeGreaterThan(s3);
  });

  it('respects custom scale parameter', () => {
    const sSmallScale = computeGeoScore(5, 1);
    const sLargeScale = computeGeoScore(5, 100);
    // With smaller scale, same distance gives lower score
    expect(sSmallScale).toBeLessThan(sLargeScale);
  });
});

describe('blendScores', () => {
  it('returns content score when weight is 0', () => {
    expect(blendScores(0.8, 0.2, 0)).toBe(0.8);
  });

  it('returns geo score when weight is 1', () => {
    expect(blendScores(0.8, 0.2, 1)).toBe(0.2);
  });

  it('returns 50/50 blend at weight 0.5', () => {
    expect(blendScores(0.8, 0.2, 0.5)).toBeCloseTo(0.5, 10);
  });

  it('proportionally blends with weight 0.3', () => {
    // (1 - 0.3) * 0.8 + 0.3 * 0.6 = 0.56 + 0.18 = 0.74
    expect(blendScores(0.8, 0.6, 0.3)).toBeCloseTo(0.74, 10);
  });

  it('returns 0 when both scores are 0', () => {
    expect(blendScores(0, 0, 0.5)).toBe(0);
  });
});
