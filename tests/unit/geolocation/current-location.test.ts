/**
 * Tests for getCurrentLocation SQL to prevent cross-user location leaks.
 * Issue #1895.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('getCurrentLocation SQL', () => {
  it('filters geo_location by user_email to prevent cross-user leaks', () => {
    const serviceContent = readFileSync('src/api/geolocation/service.ts', 'utf8');

    // Find the getCurrentLocation function's query
    const fnMatch = serviceContent.match(
      /async function getCurrentLocation[\s\S]*?`([\s\S]*?)`/
    );
    expect(fnMatch).not.toBeNull();
    const query = fnMatch![1];

    // Must filter gl.user_email to prevent shared provider cross-user leak
    expect(query).toContain('gl.user_email');
  });
});
