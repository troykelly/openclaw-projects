/**
 * Tests for geo auto-injection preHandler hook.
 * Issue #1250.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { geoAutoInjectHook } from './auto-inject.ts';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
const mockEnd = vi.fn();
const mockPool = { query: mockQuery, end: mockEnd };
const createPool = vi.fn(() => mockPool as any);

vi.mock('./service.ts', () => ({
  getCurrentLocation: vi.fn(),
}));

import { getCurrentLocation } from './service.ts';
const mockGetCurrentLocation = getCurrentLocation as ReturnType<typeof vi.fn>;

function makeReq(overrides: {
  body?: Record<string, unknown> | null;
  email?: string | null;
}): FastifyRequest {
  return {
    body: 'body' in overrides ? overrides.body : {},
    headers: {},
    session: overrides.email !== null ? { email: overrides.email ?? 'user@example.com' } : undefined,
  } as unknown as FastifyRequest;
}

const noopReply = {} as FastifyReply;

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('geoAutoInjectHook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnd.mockResolvedValue(undefined);
  });

  it('injects location when auto_inject enabled and location available', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ geo_auto_inject: true }] });
    mockGetCurrentLocation.mockResolvedValueOnce({
      lat: -33.8688,
      lng: 151.2093,
      address: '123 George St, Sydney',
      place_label: 'Sydney CBD',
    });

    const req = makeReq({ body: { content: 'Test memory' } });
    const hook = geoAutoInjectHook(createPool);
    await hook(req, noopReply);

    const body = req.body as Record<string, unknown>;
    expect(body.lat).toBe(-33.8688);
    expect(body.lng).toBe(151.2093);
    expect(body.address).toBe('123 George St, Sydney');
    expect(body.place_label).toBe('Sydney CBD');
    expect(req.headers['x-geo-source']).toBe('auto');
  });

  it('does not overwrite explicit lat/lng', async () => {
    const req = makeReq({
      body: { content: 'Test', lat: 40.7128, lng: -74.006 },
    });
    const hook = geoAutoInjectHook(createPool);
    await hook(req, noopReply);

    const body = req.body as Record<string, unknown>;
    expect(body.lat).toBe(40.7128);
    expect(body.lng).toBe(-74.006);
    expect(req.headers['x-geo-source']).toBe('explicit');
    // Should not have called DB at all
    expect(createPool).not.toHaveBeenCalled();
  });

  it('skips when geo_auto_inject is false', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ geo_auto_inject: false }] });

    const req = makeReq({ body: { content: 'Test' } });
    const hook = geoAutoInjectHook(createPool);
    await hook(req, noopReply);

    const body = req.body as Record<string, unknown>;
    expect(body.lat).toBeUndefined();
    expect(body.lng).toBeUndefined();
    expect(mockGetCurrentLocation).not.toHaveBeenCalled();
  });

  it('skips when no current location is available', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ geo_auto_inject: true }] });
    mockGetCurrentLocation.mockResolvedValueOnce(null);

    const req = makeReq({ body: { content: 'Test' } });
    const hook = geoAutoInjectHook(createPool);
    await hook(req, noopReply);

    const body = req.body as Record<string, unknown>;
    expect(body.lat).toBeUndefined();
    expect(body.lng).toBeUndefined();
    expect(req.headers['x-geo-source']).toBeUndefined();
  });

  it('skips when user has no settings row', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const req = makeReq({ body: { content: 'Test' } });
    const hook = geoAutoInjectHook(createPool);
    await hook(req, noopReply);

    const body = req.body as Record<string, unknown>;
    expect(body.lat).toBeUndefined();
    expect(mockGetCurrentLocation).not.toHaveBeenCalled();
  });

  it('skips when no session email', async () => {
    const req = makeReq({ body: { content: 'Test' }, email: null });
    const hook = geoAutoInjectHook(createPool);
    await hook(req, noopReply);

    expect(createPool).not.toHaveBeenCalled();
  });

  it('skips when body is null', async () => {
    const req = makeReq({ body: null });
    const hook = geoAutoInjectHook(createPool);
    await hook(req, noopReply);

    expect(createPool).not.toHaveBeenCalled();
  });

  it('does not inject address/place_label when location lacks them', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ geo_auto_inject: true }] });
    mockGetCurrentLocation.mockResolvedValueOnce({
      lat: -33.8688,
      lng: 151.2093,
      address: null,
      place_label: null,
    });

    const req = makeReq({ body: { content: 'Test' } });
    const hook = geoAutoInjectHook(createPool);
    await hook(req, noopReply);

    const body = req.body as Record<string, unknown>;
    expect(body.lat).toBe(-33.8688);
    expect(body.lng).toBe(151.2093);
    expect(body.address).toBeUndefined();
    expect(body.place_label).toBeUndefined();
  });

  it('always releases pool', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB error'));

    const req = makeReq({ body: { content: 'Test' } });
    const hook = geoAutoInjectHook(createPool);

    // With error handling, should NOT throw — returns silently
    await hook(req, noopReply);
    expect(mockEnd).toHaveBeenCalled();
  });

  it('queries user_setting by email column', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ geo_auto_inject: true }] });
    mockGetCurrentLocation.mockResolvedValueOnce({
      lat: -33.8688, lng: 151.2093, address: 'Test', place_label: 'Test',
    });

    const req = makeReq({ body: { content: 'Test' } });
    const hook = geoAutoInjectHook(createPool);
    await hook(req, noopReply);

    // Assert the first query uses "email" column, not "user_email"
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('WHERE email = $1'),
      ['user@example.com'],
    );
  });

  it('returns silently when DB query throws', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    const req = makeReq({ body: { content: 'Test' } });
    const hook = geoAutoInjectHook(createPool);

    // Should NOT throw
    await hook(req, noopReply);

    const body = req.body as Record<string, unknown>;
    expect(body.lat).toBeUndefined();
    expect(body.lng).toBeUndefined();
  });

  it('returns silently when getCurrentLocation throws', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ geo_auto_inject: true }] });
    mockGetCurrentLocation.mockRejectedValueOnce(new Error('location service down'));

    const req = makeReq({ body: { content: 'Test' } });
    const hook = geoAutoInjectHook(createPool);

    // Should NOT throw
    await hook(req, noopReply);

    const body = req.body as Record<string, unknown>;
    expect(body.lat).toBeUndefined();
    expect(body.lng).toBeUndefined();
  });
});
