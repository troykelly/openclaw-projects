/**
 * Tests for contact communication preferences and quiet hours (Issue #1269).
 * Verifies schema, create, update, get, and validation.
 */

import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { runMigrate } from './helpers/migrate.ts';

describe('Contact Communication Preferences (Issue #1269)', () => {
  const app = buildServer();
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  // ── Schema ──────────────────────────────────────────────

  describe('schema', () => {
    it('contact table has preferred_channel column', async () => {
      const result = await pool.query(
        `SELECT column_name, data_type, is_nullable, udt_name
         FROM information_schema.columns
         WHERE table_name = 'contact' AND column_name = 'preferred_channel'`,
      );
      expect(result.rows.length).toBe(1);
      const col = result.rows[0] as { column_name: string; data_type: string; is_nullable: string; udt_name: string };
      expect(col.is_nullable).toBe('YES');
      expect(col.udt_name).toBe('contact_channel');
    });

    it('contact table has quiet_hours_start and quiet_hours_end columns', async () => {
      const result = await pool.query(
        `SELECT column_name, data_type
         FROM information_schema.columns
         WHERE table_name = 'contact' AND column_name IN ('quiet_hours_start', 'quiet_hours_end')
         ORDER BY column_name`,
      );
      expect(result.rows.length).toBe(2);
      for (const row of result.rows) {
        const col = row as { column_name: string; data_type: string };
        expect(col.data_type).toBe('time without time zone');
      }
    });

    it('contact table has quiet_hours_timezone column', async () => {
      const result = await pool.query(
        `SELECT column_name, data_type
         FROM information_schema.columns
         WHERE table_name = 'contact' AND column_name = 'quiet_hours_timezone'`,
      );
      expect(result.rows.length).toBe(1);
      expect((result.rows[0] as { data_type: string }).data_type).toBe('text');
    });

    it('contact table has urgency_override_channel column', async () => {
      const result = await pool.query(
        `SELECT column_name, udt_name
         FROM information_schema.columns
         WHERE table_name = 'contact' AND column_name = 'urgency_override_channel'`,
      );
      expect(result.rows.length).toBe(1);
      expect((result.rows[0] as { udt_name: string }).udt_name).toBe('contact_channel');
    });

    it('contact table has notification_notes column', async () => {
      const result = await pool.query(
        `SELECT column_name, data_type
         FROM information_schema.columns
         WHERE table_name = 'contact' AND column_name = 'notification_notes'`,
      );
      expect(result.rows.length).toBe(1);
      expect((result.rows[0] as { data_type: string }).data_type).toBe('text');
    });

    it('contact_channel enum has expected values', async () => {
      const result = await pool.query(
        `SELECT unnest(enum_range(NULL::contact_channel))::text AS val ORDER BY val`,
      );
      const values = result.rows.map((r) => (r as { val: string }).val);
      expect(values).toContain('email');
      expect(values).toContain('sms');
      expect(values).toContain('telegram');
      expect(values).toContain('voice');
    });
  });

  // ── POST /api/contacts with comm prefs ──────────────────

  describe('POST /api/contacts with comm prefs', () => {
    it('creates a contact with preferred_channel', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: {
          displayName: 'Troy',
          preferred_channel: 'telegram',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.preferred_channel).toBe('telegram');
    });

    it('creates a contact with quiet hours', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: {
          displayName: 'Alex',
          quiet_hours_start: '23:00',
          quiet_hours_end: '08:00',
          quiet_hours_timezone: 'Australia/Sydney',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.quiet_hours_start).toBe('23:00:00');
      expect(body.quiet_hours_end).toBe('08:00:00');
      expect(body.quiet_hours_timezone).toBe('Australia/Sydney');
    });

    it('creates a contact with all comm pref fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: {
          displayName: 'Jordan',
          preferred_channel: 'email',
          quiet_hours_start: '22:00',
          quiet_hours_end: '07:00',
          quiet_hours_timezone: 'America/New_York',
          urgency_override_channel: 'voice',
          notification_notes: 'Prefers voice for bad news',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.preferred_channel).toBe('email');
      expect(body.quiet_hours_start).toBe('22:00:00');
      expect(body.quiet_hours_end).toBe('07:00:00');
      expect(body.quiet_hours_timezone).toBe('America/New_York');
      expect(body.urgency_override_channel).toBe('voice');
      expect(body.notification_notes).toBe('Prefers voice for bad news');
    });

    it('creates a contact without comm prefs (backward compatible)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { displayName: 'Legacy Contact' },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.preferred_channel).toBeNull();
      expect(body.quiet_hours_start).toBeNull();
      expect(body.quiet_hours_end).toBeNull();
      expect(body.quiet_hours_timezone).toBeNull();
      expect(body.urgency_override_channel).toBeNull();
      expect(body.notification_notes).toBeNull();
    });

    it('rejects invalid preferred_channel', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: {
          displayName: 'Bad Channel',
          preferred_channel: 'carrier_pigeon',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toContain('preferred_channel');
    });

    it('rejects invalid urgency_override_channel', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: {
          displayName: 'Bad Override',
          urgency_override_channel: 'fax',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toContain('urgency_override_channel');
    });
  });

  // ── GET /api/contacts/:id returns comm prefs ────────────

  describe('GET /api/contacts/:id returns comm prefs', () => {
    it('returns all comm pref fields', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: {
          displayName: 'Comm Prefs Test',
          preferred_channel: 'sms',
          quiet_hours_start: '21:00',
          quiet_hours_end: '06:30',
          quiet_hours_timezone: 'Europe/London',
          urgency_override_channel: 'voice',
          notification_notes: 'Text first, call if urgent',
        },
      });
      const contactId = createRes.json().id;

      const getRes = await app.inject({
        method: 'GET',
        url: `/api/contacts/${contactId}`,
      });

      expect(getRes.statusCode).toBe(200);
      const body = getRes.json();
      expect(body.preferred_channel).toBe('sms');
      expect(body.quiet_hours_start).toBe('21:00:00');
      expect(body.quiet_hours_end).toBe('06:30:00');
      expect(body.quiet_hours_timezone).toBe('Europe/London');
      expect(body.urgency_override_channel).toBe('voice');
      expect(body.notification_notes).toBe('Text first, call if urgent');
    });
  });

  // ── PATCH /api/contacts/:id updates comm prefs ──────────

  describe('PATCH /api/contacts/:id updates comm prefs', () => {
    it('updates preferred_channel', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { displayName: 'Update Test', preferred_channel: 'email' },
      });
      const contactId = createRes.json().id;

      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/contacts/${contactId}`,
        payload: { preferred_channel: 'telegram' },
      });

      expect(patchRes.statusCode).toBe(200);
      expect(patchRes.json().preferred_channel).toBe('telegram');
    });

    it('updates quiet hours', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { displayName: 'Quiet Hours Test' },
      });
      const contactId = createRes.json().id;

      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/contacts/${contactId}`,
        payload: {
          quiet_hours_start: '23:00',
          quiet_hours_end: '07:00',
          quiet_hours_timezone: 'Australia/Melbourne',
        },
      });

      expect(patchRes.statusCode).toBe(200);
      const body = patchRes.json();
      expect(body.quiet_hours_start).toBe('23:00:00');
      expect(body.quiet_hours_end).toBe('07:00:00');
      expect(body.quiet_hours_timezone).toBe('Australia/Melbourne');
    });

    it('clears preferred_channel by setting to null', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { displayName: 'Clear Test', preferred_channel: 'sms' },
      });
      const contactId = createRes.json().id;

      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/contacts/${contactId}`,
        payload: { preferred_channel: null },
      });

      expect(patchRes.statusCode).toBe(200);
      expect(patchRes.json().preferred_channel).toBeNull();
    });

    it('updates notification_notes', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { displayName: 'Notes Test' },
      });
      const contactId = createRes.json().id;

      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/contacts/${contactId}`,
        payload: { notification_notes: 'Prefers morning messages' },
      });

      expect(patchRes.statusCode).toBe(200);
      expect(patchRes.json().notification_notes).toBe('Prefers morning messages');
    });

    it('rejects invalid channel on update', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { displayName: 'Invalid Update' },
      });
      const contactId = createRes.json().id;

      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/contacts/${contactId}`,
        payload: { preferred_channel: 'invalid_channel' },
      });

      expect(patchRes.statusCode).toBe(400);
    });
  });

  // ── Quiet hours validation ──────────────────────────────

  describe('quiet hours validation', () => {
    it('requires both start and end when one is provided', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: {
          displayName: 'Partial Quiet Hours',
          quiet_hours_start: '23:00',
          // missing quiet_hours_end
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toContain('quiet_hours');
    });
  });
});
