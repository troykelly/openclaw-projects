/**
 * Tests for webhook geolocation provider plugin and webhook handler.
 * Issue #1248.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  webhookPlugin,
  generateWebhookToken,
  isValidTokenFormat,
  timingSafeTokenCompare,
  rotateWebhookToken,
  parseWebhookPayload,
  parseStandardPayload,
  parseOwnTracksPayload,
  isOwnTracksPayload,
  createWebhookConnection,
  registerWebhookProvider,
} from './webhook-provider.ts';
import { clearProviders, getProvider } from '../registry.ts';
import {
  handleWebhookRequest,
  extractBearerToken,
  MAX_PAYLOAD_SIZE,
} from '../webhook-handler.ts';

// ---------- validateConfig ----------

describe('webhookPlugin', () => {
  describe('validateConfig', () => {
    it('accepts a valid config with label', () => {
      const result = webhookPlugin.validateConfig({ label: 'My Device' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ label: 'My Device' });
      }
    });

    it('trims whitespace from label', () => {
      const result = webhookPlugin.validateConfig({ label: '  GPS Tracker  ' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ label: 'GPS Tracker' });
      }
    });

    it('rejects non-object config', () => {
      const result = webhookPlugin.validateConfig('not an object');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error[0].field).toBe('label');
        expect(result.error[0].message).toContain('object');
      }
    });

    it('rejects null config', () => {
      const result = webhookPlugin.validateConfig(null);
      expect(result.ok).toBe(false);
    });

    it('rejects missing label', () => {
      const result = webhookPlugin.validateConfig({});
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error[0].field).toBe('label');
        expect(result.error[0].message).toContain('required');
      }
    });

    it('rejects empty string label', () => {
      const result = webhookPlugin.validateConfig({ label: '' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error[0].field).toBe('label');
      }
    });

    it('rejects whitespace-only label', () => {
      const result = webhookPlugin.validateConfig({ label: '   ' });
      expect(result.ok).toBe(false);
    });

    it('rejects non-string label', () => {
      const result = webhookPlugin.validateConfig({ label: 42 });
      expect(result.ok).toBe(false);
    });
  });

  // ---------- token generation ----------

  describe('generateWebhookToken', () => {
    it('generates a token with whk_ prefix', () => {
      const token = generateWebhookToken();
      expect(token.startsWith('whk_')).toBe(true);
    });

    it('generates a token of correct length (whk_ + 64 hex chars)', () => {
      const token = generateWebhookToken();
      expect(token.length).toBe(4 + 64); // 'whk_' + 64 hex chars
    });

    it('generates hex characters after prefix', () => {
      const token = generateWebhookToken();
      const hex = token.slice(4);
      expect(/^[0-9a-f]{64}$/.test(hex)).toBe(true);
    });

    it('generates unique tokens', () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 100; i++) {
        tokens.add(generateWebhookToken());
      }
      expect(tokens.size).toBe(100);
    });
  });

  // ---------- isValidTokenFormat ----------

  describe('isValidTokenFormat', () => {
    it('accepts a valid token', () => {
      const token = generateWebhookToken();
      expect(isValidTokenFormat(token)).toBe(true);
    });

    it('rejects token without prefix', () => {
      expect(isValidTokenFormat('abcdef1234567890'.repeat(4))).toBe(false);
    });

    it('rejects token with wrong prefix', () => {
      expect(isValidTokenFormat(`tok_${'a'.repeat(64)}`)).toBe(false);
    });

    it('rejects token that is too short', () => {
      expect(isValidTokenFormat(`whk_${'a'.repeat(32)}`)).toBe(false);
    });

    it('rejects token that is too long', () => {
      expect(isValidTokenFormat(`whk_${'a'.repeat(128)}`)).toBe(false);
    });

    it('rejects token with uppercase hex', () => {
      expect(isValidTokenFormat(`whk_${'A'.repeat(64)}`)).toBe(false);
    });

    it('rejects token with non-hex characters', () => {
      expect(isValidTokenFormat(`whk_${'g'.repeat(64)}`)).toBe(false);
    });

    it('rejects empty string', () => {
      expect(isValidTokenFormat('')).toBe(false);
    });

    it('rejects non-string', () => {
      expect(isValidTokenFormat(42 as unknown as string)).toBe(false);
    });
  });

  // ---------- timing-safe token comparison ----------

  describe('timingSafeTokenCompare', () => {
    it('returns true for matching tokens', () => {
      const token = generateWebhookToken();
      expect(timingSafeTokenCompare(token, token)).toBe(true);
    });

    it('returns false for different tokens', () => {
      const token1 = generateWebhookToken();
      const token2 = generateWebhookToken();
      expect(timingSafeTokenCompare(token1, token2)).toBe(false);
    });

    it('returns false for empty provided token', () => {
      const token = generateWebhookToken();
      expect(timingSafeTokenCompare('', token)).toBe(false);
    });

    it('returns false for empty expected token', () => {
      const token = generateWebhookToken();
      expect(timingSafeTokenCompare(token, '')).toBe(false);
    });

    it('returns false for different length tokens', () => {
      expect(timingSafeTokenCompare('short', 'a-much-longer-token')).toBe(false);
    });

    it('handles tokens with same length but different content', () => {
      const base = `whk_${'a'.repeat(64)}`;
      const other = `whk_${'b'.repeat(64)}`;
      expect(timingSafeTokenCompare(base, other)).toBe(false);
    });
  });

  // ---------- token rotation ----------

  describe('rotateWebhookToken', () => {
    it('generates a new valid token', () => {
      const token = rotateWebhookToken();
      expect(isValidTokenFormat(token)).toBe(true);
    });

    it('generates a different token each time', () => {
      const token1 = rotateWebhookToken();
      const token2 = rotateWebhookToken();
      expect(token1).not.toBe(token2);
    });
  });

  // ---------- payload parsing: standard format ----------

  describe('parseStandardPayload', () => {
    it('parses minimal lat/lng payload', () => {
      const update = parseStandardPayload({ lat: -33.8688, lng: 151.2093 });
      expect(update).not.toBeNull();
      expect(update!.lat).toBe(-33.8688);
      expect(update!.lng).toBe(151.2093);
      expect(update!.entity_id).toBe('webhook');
    });

    it('parses full payload with all optional fields', () => {
      const update = parseStandardPayload({
        lat: -33.8688,
        lng: 151.2093,
        accuracy_m: 10,
        altitude_m: 50,
        speed_mps: 1.5,
        bearing: 180,
        entity_id: 'phone_1',
        indoor_zone: 'Office',
        timestamp: '2024-01-15T10:00:00Z',
      });
      expect(update).not.toBeNull();
      expect(update!.entity_id).toBe('phone_1');
      expect(update!.accuracy_m).toBe(10);
      expect(update!.altitude_m).toBe(50);
      expect(update!.speed_mps).toBe(1.5);
      expect(update!.bearing).toBe(180);
      expect(update!.indoor_zone).toBe('Office');
      expect(update!.timestamp).toEqual(new Date('2024-01-15T10:00:00Z'));
    });

    it('stores raw payload', () => {
      const payload = { lat: 1, lng: 2 };
      const update = parseStandardPayload(payload);
      expect(update!.raw_payload).toEqual(payload);
    });

    it('returns null for missing lat', () => {
      expect(parseStandardPayload({ lng: 151.2093 })).toBeNull();
    });

    it('returns null for missing lng', () => {
      expect(parseStandardPayload({ lat: -33.8688 })).toBeNull();
    });

    it('returns null for non-numeric lat', () => {
      expect(parseStandardPayload({ lat: 'south', lng: 151.2093 })).toBeNull();
    });

    it('returns null for null payload', () => {
      expect(parseStandardPayload(null)).toBeNull();
    });

    it('returns null for non-object payload', () => {
      expect(parseStandardPayload('not an object')).toBeNull();
    });

    it('ignores invalid timestamp string', () => {
      const update = parseStandardPayload({
        lat: 1,
        lng: 2,
        timestamp: 'not-a-date',
      });
      expect(update).not.toBeNull();
      expect(update!.timestamp).toBeUndefined();
    });

    it('defaults entity_id to webhook when not provided', () => {
      const update = parseStandardPayload({ lat: 1, lng: 2 });
      expect(update!.entity_id).toBe('webhook');
    });
  });

  // ---------- payload parsing: OwnTracks format ----------

  describe('isOwnTracksPayload', () => {
    it('detects OwnTracks location payload', () => {
      expect(isOwnTracksPayload({ _type: 'location', lat: 1, lon: 2 })).toBe(true);
    });

    it('rejects non-location _type', () => {
      expect(isOwnTracksPayload({ _type: 'transition', lat: 1, lon: 2 })).toBe(false);
    });

    it('rejects missing _type', () => {
      expect(isOwnTracksPayload({ lat: 1, lon: 2 })).toBe(false);
    });

    it('rejects missing lat', () => {
      expect(isOwnTracksPayload({ _type: 'location', lon: 2 })).toBe(false);
    });

    it('rejects missing lon', () => {
      expect(isOwnTracksPayload({ _type: 'location', lat: 1 })).toBe(false);
    });

    it('rejects null', () => {
      expect(isOwnTracksPayload(null)).toBe(false);
    });

    it('rejects non-object', () => {
      expect(isOwnTracksPayload('string')).toBe(false);
    });
  });

  describe('parseOwnTracksPayload', () => {
    it('parses minimal OwnTracks payload', () => {
      const update = parseOwnTracksPayload({
        _type: 'location',
        lat: -33.8688,
        lon: 151.2093,
      });
      expect(update.lat).toBe(-33.8688);
      expect(update.lng).toBe(151.2093);
      expect(update.entity_id).toBe('owntracks');
    });

    it('parses full OwnTracks payload', () => {
      const update = parseOwnTracksPayload({
        _type: 'location',
        lat: -33.8688,
        lon: 151.2093,
        acc: 10,
        alt: 50,
        vel: 5,
        cog: 270,
        tid: 'JD',
        tst: 1705312800, // 2024-01-15T10:00:00Z
      });
      expect(update.entity_id).toBe('JD');
      expect(update.accuracy_m).toBe(10);
      expect(update.altitude_m).toBe(50);
      expect(update.speed_mps).toBe(5);
      expect(update.bearing).toBe(270);
      expect(update.timestamp).toEqual(new Date(1705312800 * 1000));
    });

    it('uses owntracks as default entity_id when tid is missing', () => {
      const update = parseOwnTracksPayload({
        _type: 'location',
        lat: 1,
        lon: 2,
      });
      expect(update.entity_id).toBe('owntracks');
    });

    it('stores raw payload', () => {
      const payload = { _type: 'location' as const, lat: 1, lon: 2 };
      const update = parseOwnTracksPayload(payload);
      expect(update.raw_payload).toEqual(payload);
    });
  });

  // ---------- parseWebhookPayload auto-detection ----------

  describe('parseWebhookPayload', () => {
    it('auto-detects OwnTracks format', () => {
      const update = parseWebhookPayload({
        _type: 'location',
        lat: -33.8688,
        lon: 151.2093,
        tid: 'JD',
      });
      expect(update).not.toBeNull();
      expect(update!.entity_id).toBe('JD');
      expect(update!.lng).toBe(151.2093);
    });

    it('auto-detects standard format', () => {
      const update = parseWebhookPayload({
        lat: -33.8688,
        lng: 151.2093,
        entity_id: 'phone_1',
      });
      expect(update).not.toBeNull();
      expect(update!.entity_id).toBe('phone_1');
    });

    it('returns null for invalid payload', () => {
      expect(parseWebhookPayload({ foo: 'bar' })).toBeNull();
    });

    it('returns null for null', () => {
      expect(parseWebhookPayload(null)).toBeNull();
    });

    it('prefers OwnTracks detection when _type is present', () => {
      // A payload that has both OwnTracks fields and standard fields
      const update = parseWebhookPayload({
        _type: 'location',
        lat: 1,
        lon: 2,
        lng: 3, // standard field — should be ignored in favor of OwnTracks lon
      });
      expect(update).not.toBeNull();
      expect(update!.lng).toBe(2); // OwnTracks lon, not standard lng
    });
  });

  // ---------- verify ----------

  describe('verify', () => {
    it('returns success when credentials exist', async () => {
      const result = await webhookPlugin.verify({ label: 'test' }, 'some-encrypted-token');
      expect(result.success).toBe(true);
      expect(result.message).toContain('configured');
      expect(result.entities).toEqual([]);
    });

    it('returns failure when credentials are empty', async () => {
      const result = await webhookPlugin.verify({ label: 'test' }, '');
      expect(result.success).toBe(false);
      expect(result.message).toContain('No webhook token');
    });
  });

  // ---------- discoverEntities ----------

  describe('discoverEntities', () => {
    it('returns empty array', async () => {
      const entities = await webhookPlugin.discoverEntities({ label: 'test' }, 'token');
      expect(entities).toEqual([]);
    });
  });

  // ---------- connect ----------

  describe('connect', () => {
    it('returns a Connection with expected methods', async () => {
      const conn = await webhookPlugin.connect(
        { label: 'test' },
        'token',
        () => {},
      );
      expect(typeof conn.disconnect).toBe('function');
      expect(typeof conn.addEntities).toBe('function');
      expect(typeof conn.removeEntities).toBe('function');
      expect(typeof conn.isConnected).toBe('function');
      expect(conn.isConnected()).toBe(true);
    });

    it('disconnect sets isConnected to false', async () => {
      const conn = await webhookPlugin.connect(
        { label: 'test' },
        'token',
        () => {},
      );
      expect(conn.isConnected()).toBe(true);
      await conn.disconnect();
      expect(conn.isConnected()).toBe(false);
    });
  });

  // ---------- createWebhookConnection ----------

  describe('createWebhookConnection', () => {
    it('pushes updates to the handler', () => {
      const updates: unknown[] = [];
      const { connection, pushUpdate } = createWebhookConnection((u) => updates.push(u));

      pushUpdate({ entity_id: 'test', lat: 1, lng: 2 });

      expect(updates).toHaveLength(1);
      expect(connection.isConnected()).toBe(true);
    });

    it('filters by tracked entities when set', () => {
      const updates: unknown[] = [];
      const { connection, pushUpdate } = createWebhookConnection((u) => updates.push(u));

      connection.addEntities(['phone_1']);

      pushUpdate({ entity_id: 'phone_1', lat: 1, lng: 2 });
      pushUpdate({ entity_id: 'phone_2', lat: 3, lng: 4 }); // filtered out

      expect(updates).toHaveLength(1);
    });

    it('stops pushing updates after disconnect', async () => {
      const updates: unknown[] = [];
      const { connection, pushUpdate } = createWebhookConnection((u) => updates.push(u));

      await connection.disconnect();
      pushUpdate({ entity_id: 'test', lat: 1, lng: 2 });

      expect(updates).toHaveLength(0);
    });

    it('passes all updates when no entities are tracked', () => {
      const updates: unknown[] = [];
      const { pushUpdate } = createWebhookConnection((u) => updates.push(u));

      pushUpdate({ entity_id: 'a', lat: 1, lng: 2 });
      pushUpdate({ entity_id: 'b', lat: 3, lng: 4 });

      expect(updates).toHaveLength(2);
    });

    it('removeEntities adjusts filter', () => {
      const updates: unknown[] = [];
      const { connection, pushUpdate } = createWebhookConnection((u) => updates.push(u));

      connection.addEntities(['a', 'b']);
      connection.removeEntities(['a']);

      pushUpdate({ entity_id: 'a', lat: 1, lng: 2 }); // filtered out
      pushUpdate({ entity_id: 'b', lat: 3, lng: 4 }); // passes

      expect(updates).toHaveLength(1);
    });
  });

  // ---------- registration ----------

  describe('registration', () => {
    beforeEach(() => {
      clearProviders();
    });

    it('registers webhook provider in the registry', () => {
      registerWebhookProvider();
      const provider = getProvider('webhook');
      expect(provider).toBeDefined();
      expect(provider!.type).toBe('webhook');
    });
  });

  // ---------- plugin type ----------

  describe('plugin type', () => {
    it('has type "webhook"', () => {
      expect(webhookPlugin.type).toBe('webhook');
    });
  });
});

// ---------- webhook handler ----------

describe('webhook handler', () => {
  const validToken = generateWebhookToken();

  describe('extractBearerToken', () => {
    it('extracts token from valid Bearer header', () => {
      expect(extractBearerToken('Bearer my-token')).toBe('my-token');
    });

    it('returns null for missing header', () => {
      expect(extractBearerToken(undefined)).toBeNull();
    });

    it('returns null for empty header', () => {
      expect(extractBearerToken('')).toBeNull();
    });

    it('returns null for non-Bearer scheme', () => {
      expect(extractBearerToken('Basic abc123')).toBeNull();
    });

    it('returns null for Bearer with no token', () => {
      expect(extractBearerToken('Bearer ')).toBeNull();
    });

    it('returns null for just the word Bearer', () => {
      expect(extractBearerToken('Bearer')).toBeNull();
    });
  });

  describe('handleWebhookRequest', () => {
    const validBody = JSON.stringify({ lat: -33.8688, lng: 151.2093 });

    it('accepts a valid request', () => {
      const result = handleWebhookRequest({
        expected_token: validToken,
        auth_header: `Bearer ${validToken}`,
        content_type: 'application/json',
        body: validBody,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.update.lat).toBe(-33.8688);
        expect(result.update.lng).toBe(151.2093);
      }
    });

    it('accepts application/json with charset', () => {
      const result = handleWebhookRequest({
        expected_token: validToken,
        auth_header: `Bearer ${validToken}`,
        content_type: 'application/json; charset=utf-8',
        body: validBody,
      });
      expect(result.ok).toBe(true);
    });

    it('rejects missing Authorization header', () => {
      const result = handleWebhookRequest({
        expected_token: validToken,
        auth_header: undefined,
        content_type: 'application/json',
        body: validBody,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(401);
      }
    });

    it('rejects invalid token', () => {
      const result = handleWebhookRequest({
        expected_token: validToken,
        auth_header: 'Bearer wrong-token',
        content_type: 'application/json',
        body: validBody,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(401);
        expect(result.message).toBe('Invalid token');
      }
    });

    it('rejects wrong Content-Type', () => {
      const result = handleWebhookRequest({
        expected_token: validToken,
        auth_header: `Bearer ${validToken}`,
        content_type: 'text/plain',
        body: validBody,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(415);
      }
    });

    it('rejects missing Content-Type', () => {
      const result = handleWebhookRequest({
        expected_token: validToken,
        auth_header: `Bearer ${validToken}`,
        content_type: undefined,
        body: validBody,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(415);
      }
    });

    it('rejects payload exceeding 10KB', () => {
      const largeBody = JSON.stringify({ lat: 1, lng: 2, data: 'x'.repeat(MAX_PAYLOAD_SIZE) });
      const result = handleWebhookRequest({
        expected_token: validToken,
        auth_header: `Bearer ${validToken}`,
        content_type: 'application/json',
        body: largeBody,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(413);
        expect(result.message).toContain('too large');
      }
    });

    it('rejects invalid JSON', () => {
      const result = handleWebhookRequest({
        expected_token: validToken,
        auth_header: `Bearer ${validToken}`,
        content_type: 'application/json',
        body: 'not json',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(400);
      }
    });

    it('rejects JSON without location data', () => {
      const result = handleWebhookRequest({
        expected_token: validToken,
        auth_header: `Bearer ${validToken}`,
        content_type: 'application/json',
        body: JSON.stringify({ foo: 'bar' }),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(422);
      }
    });

    it('accepts OwnTracks payload', () => {
      const result = handleWebhookRequest({
        expected_token: validToken,
        auth_header: `Bearer ${validToken}`,
        content_type: 'application/json',
        body: JSON.stringify({
          _type: 'location',
          lat: -33.8688,
          lon: 151.2093,
          acc: 10,
          tid: 'JD',
        }),
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.update.entity_id).toBe('JD');
        expect(result.update.lng).toBe(151.2093);
        expect(result.update.accuracy_m).toBe(10);
      }
    });

    it('does not leak internal state in error messages', () => {
      const result = handleWebhookRequest({
        expected_token: validToken,
        auth_header: 'Bearer wrong',
        content_type: 'application/json',
        body: validBody,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        // Error message should not contain the expected token or any internal identifiers
        expect(result.message).not.toContain(validToken);
        expect(result.message).not.toContain('internal');
      }
    });

    it('accepts a payload right at the size limit', () => {
      // Create a payload that is exactly at the limit
      const basePayload = { lat: 1, lng: 2, data: '' };
      const baseSize = Buffer.byteLength(JSON.stringify(basePayload), 'utf8');
      // Fill data to reach exactly MAX_PAYLOAD_SIZE
      basePayload.data = 'x'.repeat(MAX_PAYLOAD_SIZE - baseSize);
      const body = JSON.stringify(basePayload);
      expect(Buffer.byteLength(body, 'utf8')).toBe(MAX_PAYLOAD_SIZE);

      const result = handleWebhookRequest({
        expected_token: validToken,
        auth_header: `Bearer ${validToken}`,
        content_type: 'application/json',
        body,
      });
      expect(result.ok).toBe(true);
    });
  });
});
