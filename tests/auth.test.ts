import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runMigrate } from './helpers/migrate.ts';
import { buildServer } from '../src/api/server.ts';
import { createPool } from '../src/db.ts';

describe('Magic-link auth + sessions', () => {
  const app = buildServer();

  beforeAll(async () => {
    await runMigrate('up');
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('issues a magic link and creates a 7-day session on consume', async () => {
    const request = await app.inject({
      method: 'POST',
      url: '/api/auth/request-link',
      payload: { email: 'test@example.com' },
    });

    expect(request.statusCode).toBe(201);
    const { loginUrl } = request.json() as { loginUrl: string };
    expect(loginUrl).toMatch(/\/api\/auth\/consume\?token=/);

    const token = new URL(loginUrl).searchParams.get('token');
    expect(token).toBeTruthy();

    const consume = await app.inject({
      method: 'GET',
      url: `/api/auth/consume?token=${token}`,
      headers: { accept: 'application/json' },
    });

    expect(consume.statusCode).toBe(200);
    expect(consume.json()).toEqual({ ok: true });

    const setCookie = consume.headers['set-cookie'];
    expect(setCookie).toBeTruthy();

    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const sessionCookie = cookieHeader.split(';')[0];

    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: {
        cookie: sessionCookie,
      },
    });

    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({ email: 'test@example.com' });
  });

  it('rejects tokens that have already been used (single-use)', async () => {
    const request = await app.inject({
      method: 'POST',
      url: '/api/auth/request-link',
      payload: { email: 'single-use@example.com' },
    });

    expect(request.statusCode).toBe(201);
    const { loginUrl } = request.json() as { loginUrl: string };
    const token = new URL(loginUrl).searchParams.get('token');

    // First use should succeed
    const firstConsume = await app.inject({
      method: 'GET',
      url: `/api/auth/consume?token=${token}`,
      headers: { accept: 'application/json' },
    });
    expect(firstConsume.statusCode).toBe(200);

    // Second use should fail
    const secondConsume = await app.inject({
      method: 'GET',
      url: `/api/auth/consume?token=${token}`,
      headers: { accept: 'application/json' },
    });
    expect(secondConsume.statusCode).toBe(400);
    expect(secondConsume.json()).toEqual({ error: 'invalid or expired token' });
  });

  it('rejects expired tokens (15m expiry)', async () => {
    const request = await app.inject({
      method: 'POST',
      url: '/api/auth/request-link',
      payload: { email: 'expired@example.com' },
    });

    expect(request.statusCode).toBe(201);
    const { loginUrl } = request.json() as { loginUrl: string };
    const token = new URL(loginUrl).searchParams.get('token');

    // Manually expire the token in the database
    const pool = createPool({ max: 3 });
    await pool.query(
      `UPDATE auth_magic_link
          SET expires_at = now() - interval '1 minute'
        WHERE email = $1`,
      ['expired@example.com'],
    );
    await pool.end();

    // Attempting to use expired token should fail
    const consume = await app.inject({
      method: 'GET',
      url: `/api/auth/consume?token=${token}`,
      headers: { accept: 'application/json' },
    });
    expect(consume.statusCode).toBe(400);
    expect(consume.json()).toEqual({ error: 'invalid or expired token' });
  });

  it('sets secure cookie attributes (HttpOnly, SameSite)', async () => {
    const request = await app.inject({
      method: 'POST',
      url: '/api/auth/request-link',
      payload: { email: 'cookie-test@example.com' },
    });

    const { loginUrl } = request.json() as { loginUrl: string };
    const token = new URL(loginUrl).searchParams.get('token');

    const consume = await app.inject({
      method: 'GET',
      url: `/api/auth/consume?token=${token}`,
      headers: { accept: 'application/json' },
    });

    const setCookie = consume.headers['set-cookie'];
    expect(setCookie).toBeTruthy();

    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const cookieLower = cookieHeader.toLowerCase();

    // Verify security attributes
    expect(cookieLower).toContain('httponly');
    expect(cookieLower).toContain('samesite=lax');
    expect(cookieLower).toContain('path=/');

    // Verify 7-day max-age (604800 seconds)
    expect(cookieHeader).toMatch(/max-age=604800/i);
  });

  it('rejects requests without valid email', async () => {
    const noEmail = await app.inject({
      method: 'POST',
      url: '/api/auth/request-link',
      payload: {},
    });
    expect(noEmail.statusCode).toBe(400);
    expect(noEmail.json()).toEqual({ error: 'email is required' });

    const badEmail = await app.inject({
      method: 'POST',
      url: '/api/auth/request-link',
      payload: { email: 'notanemail' },
    });
    expect(badEmail.statusCode).toBe(400);
    expect(badEmail.json()).toEqual({ error: 'email is required' });
  });

  it('rejects consume requests without token', async () => {
    const noToken = await app.inject({
      method: 'GET',
      url: '/api/auth/consume',
      headers: { accept: 'application/json' },
    });
    expect(noToken.statusCode).toBe(400);
    expect(noToken.json()).toEqual({ error: 'token is required' });
  });

  it('rejects /api/me without session', async () => {
    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
    });
    expect(me.statusCode).toBe(401);
    expect(me.json()).toEqual({ error: 'unauthorized' });
  });

  it('rejects expired sessions', async () => {
    // Create a session via normal flow
    const request = await app.inject({
      method: 'POST',
      url: '/api/auth/request-link',
      payload: { email: 'expired-session@example.com' },
    });
    const { loginUrl } = request.json() as { loginUrl: string };
    const token = new URL(loginUrl).searchParams.get('token');

    const consume = await app.inject({
      method: 'GET',
      url: `/api/auth/consume?token=${token}`,
      headers: { accept: 'application/json' },
    });

    const setCookie = consume.headers['set-cookie'];
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const sessionCookie = cookieHeader.split(';')[0];

    // Manually expire the session
    const pool = createPool({ max: 3 });
    await pool.query(
      `UPDATE auth_session
          SET expires_at = now() - interval '1 minute'
        WHERE email = $1`,
      ['expired-session@example.com'],
    );
    await pool.end();

    // Session should now be rejected
    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: sessionCookie },
    });
    expect(me.statusCode).toBe(401);
  });

  it('rejects revoked sessions', async () => {
    // Create a session via normal flow
    const request = await app.inject({
      method: 'POST',
      url: '/api/auth/request-link',
      payload: { email: 'revoked-session@example.com' },
    });
    const { loginUrl } = request.json() as { loginUrl: string };
    const token = new URL(loginUrl).searchParams.get('token');

    const consume = await app.inject({
      method: 'GET',
      url: `/api/auth/consume?token=${token}`,
      headers: { accept: 'application/json' },
    });

    const setCookie = consume.headers['set-cookie'];
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const sessionCookie = cookieHeader.split(';')[0];

    // Manually revoke the session
    const pool = createPool({ max: 3 });
    await pool.query(
      `UPDATE auth_session
          SET revoked_at = now()
        WHERE email = $1`,
      ['revoked-session@example.com'],
    );
    await pool.end();

    // Session should now be rejected
    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: sessionCookie },
    });
    expect(me.statusCode).toBe(401);
  });
});
