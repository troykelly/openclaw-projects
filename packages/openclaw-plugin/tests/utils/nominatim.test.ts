/**
 * Tests for Nominatim reverse geocoding utility.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { reverseGeocode, clearGeocodeCache } from '../../src/utils/nominatim.js';

describe('Nominatim reverse geocoding', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearGeocodeCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('should return address and placeLabel from Nominatim response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          display_name: '123 George St, Sydney NSW 2000, Australia',
          name: 'Sydney Opera House',
          address: {
            road: 'George St',
            suburb: 'Sydney',
            city: 'Sydney',
            state: 'New South Wales',
            country: 'Australia',
          },
        }),
    });

    const result = await reverseGeocode(-33.8688, 151.2093, 'http://nominatim:8080');

    expect(result).not.toBeNull();
    expect(result!.address).toBe('123 George St, Sydney NSW 2000, Australia');
    expect(result!.placeLabel).toBe('Sydney Opera House');
  });

  it('should use suburb as placeLabel when name is empty', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          display_name: '456 Broadway, New York, NY 10012, USA',
          name: '',
          address: {
            road: 'Broadway',
            suburb: 'SoHo',
            city: 'New York',
            state: 'New York',
            country: 'United States',
          },
        }),
    });

    const result = await reverseGeocode(40.7218, -73.998, 'http://nominatim:8080');

    expect(result).not.toBeNull();
    expect(result!.placeLabel).toBe('SoHo');
  });

  it('should use city as placeLabel when name and suburb are empty', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          display_name: 'Some address, Melbourne, Australia',
          address: {
            city: 'Melbourne',
            state: 'Victoria',
            country: 'Australia',
          },
        }),
    });

    const result = await reverseGeocode(-37.8136, 144.9631, 'http://nominatim:8080');

    expect(result).not.toBeNull();
    expect(result!.placeLabel).toBe('Melbourne');
  });

  it('should call the correct URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ display_name: 'test', address: {} }),
    });
    globalThis.fetch = mockFetch;

    await reverseGeocode(40.7128, -74.006, 'http://nominatim:8080');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://nominatim:8080/reverse?format=jsonv2&lat=40.7128&lon=-74.006',
      expect.objectContaining({
        headers: { 'User-Agent': 'openclaw-projects/1.0' },
      }),
    );
  });

  it('should return null on non-ok response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });

    const result = await reverseGeocode(0, 0, 'http://nominatim:8080');
    expect(result).toBeNull();
  });

  it('should return null on network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const result = await reverseGeocode(0, 0, 'http://nominatim:8080');
    expect(result).toBeNull();
  });

  it('should cache results for the same rounded coordinates', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          display_name: 'Cached Address',
          name: 'Cached Place',
        }),
    });
    globalThis.fetch = mockFetch;

    const result1 = await reverseGeocode(40.7128, -74.006, 'http://nominatim:8080');
    const result2 = await reverseGeocode(40.7128, -74.006, 'http://nominatim:8080');

    expect(result1).toEqual(result2);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should cache nearby coordinates within ~100m precision', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          display_name: 'Nearby Address',
          name: 'Nearby Place',
        }),
    });
    globalThis.fetch = mockFetch;

    // These two coordinates round to the same cache key at ~100m precision
    await reverseGeocode(40.71281, -74.00601, 'http://nominatim:8080');
    await reverseGeocode(40.71289, -74.00609, 'http://nominatim:8080');

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should make separate calls for sufficiently different coordinates', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          display_name: 'Address',
          name: 'Place',
        }),
    });
    globalThis.fetch = mockFetch;

    await reverseGeocode(40.7128, -74.006, 'http://nominatim:8080');
    await reverseGeocode(-33.8688, 151.2093, 'http://nominatim:8080');

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should handle empty display_name gracefully', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ address: {} }),
    });

    const result = await reverseGeocode(0, 0, 'http://nominatim:8080');

    expect(result).not.toBeNull();
    expect(result!.address).toBe('');
    expect(result!.placeLabel).toBe('');
  });
});
