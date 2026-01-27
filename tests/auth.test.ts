import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runMigrate } from './helpers/migrate.js';
import { buildServer } from '../src/api/server.js';

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
});
