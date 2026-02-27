/**
 * Tests for provider creation SQL patterns.
 * Validates that count queries do not use FOR UPDATE (incompatible with aggregates).
 * Issue #1895.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('provider creation SQL', () => {
  it('count query does not use FOR UPDATE', () => {
    const serverContent = readFileSync('src/api/server.ts', 'utf8');

    // Find all COUNT(*) queries on geo_provider that also have FOR UPDATE
    const countQueries = serverContent.match(/SELECT COUNT\(\*\).*geo_provider.*FOR UPDATE/g);
    expect(countQueries).toBeNull();
  });
});
