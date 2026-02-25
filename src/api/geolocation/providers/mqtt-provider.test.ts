/**
 * Tests for MQTT geolocation provider plugin.
 * Issue #1247. Issue #1822: DNS rebinding protection.
 *
 * These tests cover:
 * - validateConfig (various valid/invalid configs)
 * - Payload parsers (OwnTracks location, OwnTracks transition, HA MQTT, custom)
 * - Dot-notation property extraction
 * - Entity ID derivation from topics
 * - Entity filtering
 * - Connection interface shape
 * - Registration
 *
 * No mock broker tests -- we test parsers and config validation only.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dns.promises before importing modules that use resolveAndValidateOutboundHost
const { mockLookup } = vi.hoisted(() => ({ mockLookup: vi.fn() }));
vi.mock('node:dns', () => ({
  promises: { lookup: mockLookup },
}));

import { clearProviders, getProvider } from '../registry.ts';
import type { PayloadMapping } from './mqtt-provider.ts';
import {
  deriveEntityIdFromTopic,
  extractByPath,
  isValidPropertyPath,
  mqttPlugin,
  parseCustomPayload,
  parseHaMqttPayload,
  parseOwnTracksLocation,
  parseOwnTracksTransition,
  registerMqttProvider,
} from './mqtt-provider.ts';

// ---------- validateConfig ----------

describe('mqttPlugin', () => {
  beforeEach(() => {
    // Default: external hostnames resolve to a public IP
    mockLookup.mockResolvedValue({ address: '93.184.216.34', family: 4 });
  });

  afterEach(() => {
    mockLookup.mockReset();
  });

  describe('validateConfig', () => {
    const validConfig = {
      host: 'mqtt.example.com',
      port: 8883,
      format: 'owntracks',
      topics: ['owntracks/#'],
    };

    it('accepts a valid owntracks config', async () => {
      const result = await mqttPlugin.validateConfig(validConfig);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(validConfig);
      }
    });

    it('accepts config with default port when port is omitted', async () => {
      const { port: _, ...configWithoutPort } = validConfig;
      const result = await mqttPlugin.validateConfig(configWithoutPort);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect((result.value as Record<string, unknown>).port).toBe(8883);
      }
    });

    it('accepts config with ca_cert', async () => {
      const result = await mqttPlugin.validateConfig({
        ...validConfig,
        ca_cert: '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect((result.value as Record<string, unknown>).ca_cert).toContain('BEGIN CERTIFICATE');
      }
    });

    it('accepts home_assistant format', async () => {
      const result = await mqttPlugin.validateConfig({
        host: 'mqtt.example.com',
        port: 8883,
        format: 'home_assistant',
        topics: ['homeassistant/device_tracker/#'],
      });
      expect(result.ok).toBe(true);
    });

    it('accepts custom format with valid payload_mapping', async () => {
      const result = await mqttPlugin.validateConfig({
        host: 'mqtt.example.com',
        port: 8883,
        format: 'custom',
        topics: ['devices/+/location'],
        payload_mapping: {
          lat: 'position.latitude',
          lng: 'position.longitude',
          accuracy: 'position.accuracy',
          entity_id: 'device_id',
        },
      });
      expect(result.ok).toBe(true);
    });

    it('rejects non-object config', async () => {
      const result = await mqttPlugin.validateConfig('not an object');
      expect(result.ok).toBe(false);
    });

    it('rejects null config', async () => {
      const result = await mqttPlugin.validateConfig(null);
      expect(result.ok).toBe(false);
    });

    it('rejects missing host', async () => {
      const { host: _, ...configWithoutHost } = validConfig;
      const result = await mqttPlugin.validateConfig(configWithoutHost);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.some((e) => e.field === 'host')).toBe(true);
      }
    });

    it('rejects empty host', async () => {
      const result = await mqttPlugin.validateConfig({ ...validConfig, host: '' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.some((e) => e.field === 'host')).toBe(true);
      }
    });

    it('rejects invalid port (string)', async () => {
      const result = await mqttPlugin.validateConfig({ ...validConfig, port: 'not-a-number' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.some((e) => e.field === 'port')).toBe(true);
      }
    });

    it('rejects port 0', async () => {
      const result = await mqttPlugin.validateConfig({ ...validConfig, port: 0 });
      expect(result.ok).toBe(false);
    });

    it('rejects port > 65535', async () => {
      const result = await mqttPlugin.validateConfig({ ...validConfig, port: 70000 });
      expect(result.ok).toBe(false);
    });

    it('rejects port 1883 (non-TLS) via network guard', async () => {
      const result = await mqttPlugin.validateConfig({ ...validConfig, port: 1883 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const msg = result.error.map((e) => e.message).join(' ');
        expect(msg).toContain('1883');
        expect(msg.toLowerCase()).toContain('tls');
      }
    });

    it('rejects missing format', async () => {
      const { format: _, ...configWithoutFormat } = validConfig;
      const result = await mqttPlugin.validateConfig(configWithoutFormat);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.some((e) => e.field === 'format')).toBe(true);
      }
    });

    it('rejects invalid format', async () => {
      const result = await mqttPlugin.validateConfig({ ...validConfig, format: 'invalid_format' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.some((e) => e.field === 'format')).toBe(true);
      }
    });

    it('rejects missing topics', async () => {
      const { topics: _, ...configWithoutTopics } = validConfig;
      const result = await mqttPlugin.validateConfig(configWithoutTopics);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.some((e) => e.field === 'topics')).toBe(true);
      }
    });

    it('rejects empty topics array', async () => {
      const result = await mqttPlugin.validateConfig({ ...validConfig, topics: [] });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.some((e) => e.field === 'topics')).toBe(true);
      }
    });

    it('rejects topics with non-string entries', async () => {
      const result = await mqttPlugin.validateConfig({ ...validConfig, topics: [123] });
      expect(result.ok).toBe(false);
    });

    it('rejects topics with empty string entries', async () => {
      const result = await mqttPlugin.validateConfig({ ...validConfig, topics: ['valid', ''] });
      expect(result.ok).toBe(false);
    });

    it('rejects private IP host', async () => {
      const result = await mqttPlugin.validateConfig({ ...validConfig, host: '192.168.1.1' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error[0].message).toContain('private');
      }
    });

    it('rejects localhost host', async () => {
      const result = await mqttPlugin.validateConfig({ ...validConfig, host: 'localhost' });
      expect(result.ok).toBe(false);
    });

    it('rejects .local hostname', async () => {
      const result = await mqttPlugin.validateConfig({ ...validConfig, host: 'broker.local' });
      expect(result.ok).toBe(false);
    });

    it('rejects hostname that resolves to private IP (DNS rebinding)', async () => {
      mockLookup.mockResolvedValue({ address: '172.16.0.1', family: 4 });
      const result = await mqttPlugin.validateConfig(validConfig);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error[0].message).toContain('private');
      }
    });

    it('rejects hostname that resolves to 127.0.0.1 (DNS rebinding)', async () => {
      mockLookup.mockResolvedValue({ address: '127.0.0.1', family: 4 });
      const result = await mqttPlugin.validateConfig(validConfig);
      expect(result.ok).toBe(false);
    });

    it('rejects custom format without payload_mapping', async () => {
      const result = await mqttPlugin.validateConfig({
        host: 'mqtt.example.com',
        port: 8883,
        format: 'custom',
        topics: ['devices/#'],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.some((e) => e.field === 'payload_mapping')).toBe(true);
      }
    });

    it('rejects custom format with invalid payload_mapping paths', async () => {
      const result = await mqttPlugin.validateConfig({
        host: 'mqtt.example.com',
        port: 8883,
        format: 'custom',
        topics: ['devices/#'],
        payload_mapping: {
          lat: '.invalid.path',
          lng: 'also..invalid',
        },
      });
      expect(result.ok).toBe(false);
    });

    it('rejects non-string ca_cert', async () => {
      const result = await mqttPlugin.validateConfig({ ...validConfig, ca_cert: 42 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.some((e) => e.field === 'ca_cert')).toBe(true);
      }
    });

    it('accepts multiple topics', async () => {
      const result = await mqttPlugin.validateConfig({
        ...validConfig,
        topics: ['owntracks/user1/#', 'owntracks/user2/#'],
      });
      expect(result.ok).toBe(true);
    });
  });

  // ---------- parseOwnTracksLocation ----------

  describe('parseOwnTracksLocation', () => {
    it('parses a valid OwnTracks location payload', () => {
      const payload = {
        _type: 'location',
        lat: -33.8688,
        lon: 151.2093,
        acc: 10,
        alt: 42,
        vel: 5,
        cog: 180,
        tst: 1700000000,
      };
      const update = parseOwnTracksLocation(payload, 'owntracks/jane/phone');
      expect(update).not.toBeNull();
      expect(update!.entity_id).toBe('jane/phone');
      expect(update!.lat).toBe(-33.8688);
      expect(update!.lng).toBe(151.2093);
      expect(update!.accuracy_m).toBe(10);
      expect(update!.altitude_m).toBe(42);
      expect(update!.speed_mps).toBe(5);
      expect(update!.bearing).toBe(180);
      expect(update!.timestamp).toEqual(new Date(1700000000 * 1000));
      expect(update!.raw_payload).toBe(payload);
    });

    it('parses minimal location with only lat/lon', () => {
      const payload = {
        _type: 'location',
        lat: 51.5074,
        lon: -0.1278,
      };
      const update = parseOwnTracksLocation(payload, 'owntracks/bob/tablet');
      expect(update).not.toBeNull();
      expect(update!.lat).toBe(51.5074);
      expect(update!.lng).toBe(-0.1278);
      expect(update!.accuracy_m).toBeUndefined();
      expect(update!.altitude_m).toBeUndefined();
    });

    it('returns null for non-location _type', () => {
      const payload = { _type: 'transition', lat: 1, lon: 2 };
      expect(parseOwnTracksLocation(payload, 'owntracks/user/device')).toBeNull();
    });

    it('returns null when _type is missing', () => {
      const payload = { lat: 1, lon: 2 };
      expect(parseOwnTracksLocation(payload, 'owntracks/user/device')).toBeNull();
    });

    it('returns null when lat is missing', () => {
      const payload = { _type: 'location', lon: 2 };
      expect(parseOwnTracksLocation(payload, 'owntracks/user/device')).toBeNull();
    });

    it('returns null when lon is missing', () => {
      const payload = { _type: 'location', lat: 1 };
      expect(parseOwnTracksLocation(payload, 'owntracks/user/device')).toBeNull();
    });

    it('returns null when lat is not a number', () => {
      const payload = { _type: 'location', lat: 'bad', lon: 2 };
      expect(parseOwnTracksLocation(payload, 'owntracks/user/device')).toBeNull();
    });
  });

  // ---------- parseOwnTracksTransition ----------

  describe('parseOwnTracksTransition', () => {
    it('parses an enter transition', () => {
      const payload = {
        _type: 'transition',
        lat: -33.8688,
        lon: 151.2093,
        acc: 15,
        event: 'enter',
        desc: 'Home',
        tst: 1700000000,
      };
      const update = parseOwnTracksTransition(payload, 'owntracks/jane/phone');
      expect(update).not.toBeNull();
      expect(update!.entity_id).toBe('jane/phone');
      expect(update!.lat).toBe(-33.8688);
      expect(update!.lng).toBe(151.2093);
      expect(update!.indoor_zone).toBe('Home');
      expect(update!.accuracy_m).toBe(15);
      expect(update!.timestamp).toEqual(new Date(1700000000 * 1000));
    });

    it('clears indoor_zone on leave transition', () => {
      const payload = {
        _type: 'transition',
        lat: -33.8688,
        lon: 151.2093,
        event: 'leave',
        desc: 'Home',
      };
      const update = parseOwnTracksTransition(payload, 'owntracks/jane/phone');
      expect(update).not.toBeNull();
      expect(update!.indoor_zone).toBe('');
    });

    it('returns null for non-transition _type', () => {
      const payload = { _type: 'location', lat: 1, lon: 2 };
      expect(parseOwnTracksTransition(payload, 'owntracks/user/device')).toBeNull();
    });

    it('returns null without lat/lon', () => {
      const payload = { _type: 'transition', event: 'enter', desc: 'Home' };
      expect(parseOwnTracksTransition(payload, 'owntracks/user/device')).toBeNull();
    });
  });

  // ---------- parseHaMqttPayload ----------

  describe('parseHaMqttPayload', () => {
    it('parses a valid HA MQTT payload', () => {
      const payload = {
        latitude: -33.8688,
        longitude: 151.2093,
        gps_accuracy: 10,
        altitude: 42,
        speed: 5,
        bearing: 180,
      };
      const update = parseHaMqttPayload(payload, 'homeassistant/device_tracker/phone');
      expect(update).not.toBeNull();
      expect(update!.entity_id).toBe('phone');
      expect(update!.lat).toBe(-33.8688);
      expect(update!.lng).toBe(151.2093);
      expect(update!.accuracy_m).toBe(10);
      expect(update!.altitude_m).toBe(42);
      expect(update!.speed_mps).toBe(5);
      expect(update!.bearing).toBe(180);
    });

    it('parses minimal HA payload with only lat/lng', () => {
      const payload = { latitude: 51.5074, longitude: -0.1278 };
      const update = parseHaMqttPayload(payload, 'ha/tracker');
      expect(update).not.toBeNull();
      expect(update!.lat).toBe(51.5074);
      expect(update!.lng).toBe(-0.1278);
      expect(update!.accuracy_m).toBeUndefined();
    });

    it('returns null when latitude is missing', () => {
      const payload = { longitude: 151.2093 };
      expect(parseHaMqttPayload(payload, 'ha/tracker')).toBeNull();
    });

    it('returns null when longitude is missing', () => {
      const payload = { latitude: -33.8688 };
      expect(parseHaMqttPayload(payload, 'ha/tracker')).toBeNull();
    });

    it('returns null when coordinates are not numbers', () => {
      const payload = { latitude: 'bad', longitude: 'data' };
      expect(parseHaMqttPayload(payload, 'ha/tracker')).toBeNull();
    });

    it('uses last topic segment as entity_id', () => {
      const payload = { latitude: 1, longitude: 2 };
      const update = parseHaMqttPayload(payload, 'a/b/my_device');
      expect(update!.entity_id).toBe('my_device');
    });
  });

  // ---------- parseCustomPayload ----------

  describe('parseCustomPayload', () => {
    const defaultMapping: PayloadMapping = {
      lat: 'position.lat',
      lng: 'position.lng',
    };

    it('parses with simple dot-notation paths', () => {
      const payload = { position: { lat: -33.8688, lng: 151.2093 } };
      const update = parseCustomPayload(payload, 'devices/tracker1', defaultMapping);
      expect(update).not.toBeNull();
      expect(update!.lat).toBe(-33.8688);
      expect(update!.lng).toBe(151.2093);
    });

    it('extracts entity_id from mapping', () => {
      const mapping: PayloadMapping = {
        lat: 'lat',
        lng: 'lng',
        entity_id: 'device_name',
      };
      const payload = { lat: 1, lng: 2, device_name: 'my-tracker' };
      const update = parseCustomPayload(payload, 'devices/x', mapping);
      expect(update!.entity_id).toBe('my-tracker');
    });

    it('falls back to topic for entity_id when mapping extraction fails', () => {
      const mapping: PayloadMapping = {
        lat: 'lat',
        lng: 'lng',
        entity_id: 'device_name',
      };
      const payload = { lat: 1, lng: 2 }; // device_name missing
      const update = parseCustomPayload(payload, 'devices/fallback', mapping);
      expect(update!.entity_id).toBe('fallback');
    });

    it('extracts all optional fields', () => {
      const mapping: PayloadMapping = {
        lat: 'coords.lat',
        lng: 'coords.lng',
        accuracy: 'coords.acc',
        altitude: 'coords.alt',
        speed: 'motion.speed',
        bearing: 'motion.heading',
        indoor_zone: 'zone',
        timestamp: 'ts',
      };
      const payload = {
        coords: { lat: 1, lng: 2, acc: 5, alt: 100 },
        motion: { speed: 10, heading: 90 },
        zone: 'Office',
        ts: 1700000000,
      };
      const update = parseCustomPayload(payload, 'topic', mapping);
      expect(update).not.toBeNull();
      expect(update!.accuracy_m).toBe(5);
      expect(update!.altitude_m).toBe(100);
      expect(update!.speed_mps).toBe(10);
      expect(update!.bearing).toBe(90);
      expect(update!.indoor_zone).toBe('Office');
      expect(update!.timestamp).toEqual(new Date(1700000000 * 1000));
    });

    it('handles ISO timestamp strings', () => {
      const mapping: PayloadMapping = {
        lat: 'lat',
        lng: 'lng',
        timestamp: 'time',
      };
      const payload = { lat: 1, lng: 2, time: '2024-01-15T10:00:00Z' };
      const update = parseCustomPayload(payload, 'topic', mapping);
      expect(update!.timestamp).toEqual(new Date('2024-01-15T10:00:00Z'));
    });

    it('returns null when lat path does not resolve to a number', () => {
      const payload = { position: { lat: 'bad', lng: 151.2093 } };
      expect(parseCustomPayload(payload, 'topic', defaultMapping)).toBeNull();
    });

    it('returns null when lng path does not resolve to a number', () => {
      const payload = { position: { lat: -33.8688, lng: 'bad' } };
      expect(parseCustomPayload(payload, 'topic', defaultMapping)).toBeNull();
    });

    it('returns null when lat path is missing', () => {
      const payload = { position: { lng: 151.2093 } };
      expect(parseCustomPayload(payload, 'topic', defaultMapping)).toBeNull();
    });

    it('stores raw_payload', () => {
      const payload = { position: { lat: 1, lng: 2 } };
      const update = parseCustomPayload(payload, 'topic', defaultMapping);
      expect(update!.raw_payload).toBe(payload);
    });
  });

  // ---------- extractByPath ----------

  describe('extractByPath', () => {
    it('extracts top-level property', () => {
      expect(extractByPath({ foo: 42 }, 'foo')).toBe(42);
    });

    it('extracts nested property', () => {
      expect(extractByPath({ a: { b: { c: 'deep' } } }, 'a.b.c')).toBe('deep');
    });

    it('returns undefined for missing property', () => {
      expect(extractByPath({ a: 1 }, 'b')).toBeUndefined();
    });

    it('returns undefined for missing nested property', () => {
      expect(extractByPath({ a: { b: 1 } }, 'a.c')).toBeUndefined();
    });

    it('returns undefined when traversing through null', () => {
      expect(extractByPath({ a: null }, 'a.b')).toBeUndefined();
    });

    it('returns undefined when traversing through non-object', () => {
      expect(extractByPath({ a: 42 }, 'a.b')).toBeUndefined();
    });

    it('returns undefined for null input', () => {
      expect(extractByPath(null, 'a')).toBeUndefined();
    });

    it('returns undefined for undefined input', () => {
      expect(extractByPath(undefined, 'a')).toBeUndefined();
    });
  });

  // ---------- isValidPropertyPath ----------

  describe('isValidPropertyPath', () => {
    it('accepts simple property name', () => {
      expect(isValidPropertyPath('lat')).toBe(true);
    });

    it('accepts dotted path', () => {
      expect(isValidPropertyPath('position.latitude')).toBe(true);
    });

    it('accepts deeply nested path', () => {
      expect(isValidPropertyPath('a.b.c.d')).toBe(true);
    });

    it('accepts underscored segments', () => {
      expect(isValidPropertyPath('my_field.sub_field')).toBe(true);
    });

    it('rejects empty string', () => {
      expect(isValidPropertyPath('')).toBe(false);
    });

    it('rejects leading dot', () => {
      expect(isValidPropertyPath('.foo')).toBe(false);
    });

    it('rejects trailing dot', () => {
      expect(isValidPropertyPath('foo.')).toBe(false);
    });

    it('rejects consecutive dots', () => {
      expect(isValidPropertyPath('foo..bar')).toBe(false);
    });

    it('rejects segment starting with digit', () => {
      expect(isValidPropertyPath('1abc')).toBe(false);
    });

    it('rejects segment with special characters', () => {
      expect(isValidPropertyPath('foo-bar')).toBe(false);
    });

    it('rejects segment with spaces', () => {
      expect(isValidPropertyPath('foo bar')).toBe(false);
    });
  });

  // ---------- deriveEntityIdFromTopic ----------

  describe('deriveEntityIdFromTopic', () => {
    it('strips "owntracks" prefix and joins remaining', () => {
      expect(deriveEntityIdFromTopic('owntracks/jane/phone')).toBe('jane/phone');
    });

    it('handles owntracks with extra path segments', () => {
      expect(deriveEntityIdFromTopic('owntracks/user/device/event')).toBe('user/device/event');
    });

    it('is case-insensitive for owntracks prefix', () => {
      expect(deriveEntityIdFromTopic('OwnTracks/Jane/Phone')).toBe('Jane/Phone');
    });

    it('returns last two segments for non-owntracks topics', () => {
      expect(deriveEntityIdFromTopic('homeassistant/device_tracker/phone')).toBe('device_tracker/phone');
    });

    it('returns the full topic if only one segment', () => {
      expect(deriveEntityIdFromTopic('singletopic')).toBe('singletopic');
    });

    it('returns both segments for two-segment topics', () => {
      expect(deriveEntityIdFromTopic('devices/tracker1')).toBe('devices/tracker1');
    });
  });

  // ---------- plugin interface shape ----------

  describe('plugin interface', () => {
    it('has type "mqtt"', () => {
      expect(mqttPlugin.type).toBe('mqtt');
    });

    it('has validateConfig function', () => {
      expect(typeof mqttPlugin.validateConfig).toBe('function');
    });

    it('has verify function', () => {
      expect(typeof mqttPlugin.verify).toBe('function');
    });

    it('has discoverEntities function', () => {
      expect(typeof mqttPlugin.discoverEntities).toBe('function');
    });

    it('has connect function', () => {
      expect(typeof mqttPlugin.connect).toBe('function');
    });

    it('discoverEntities returns empty array (MQTT is pub/sub)', async () => {
      const entities = await mqttPlugin.discoverEntities({ host: 'mqtt.example.com', port: 8883, format: 'owntracks', topics: ['owntracks/#'] }, '{}');
      expect(entities).toEqual([]);
    });
  });

  // ---------- registration ----------

  describe('registration', () => {
    beforeEach(() => {
      clearProviders();
    });

    it('registers itself in the provider registry', () => {
      registerMqttProvider();
      const provider = getProvider('mqtt');
      expect(provider).toBeDefined();
      expect(provider!.type).toBe('mqtt');
    });

    it('throws if registered twice', () => {
      registerMqttProvider();
      expect(() => registerMqttProvider()).toThrow('already registered');
    });
  });
});
