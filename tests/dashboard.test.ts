import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runMigrate } from './helpers/migrate.js';
import { buildServer } from '../src/api/server.js';

describe('/dashboard UI', () => {
  const app = buildServer();

  beforeAll(async () => {
    runMigrate('up');
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('shows login UI when not authenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/dashboard' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('Dashboard login');
  });

  it('shows dashboard when authenticated', async () => {
    const request = await app.inject({
      method: 'POST',
      url: '/api/auth/request-link',
      payload: { email: 'dash@example.com' },
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

    const dash = await app.inject({
      method: 'GET',
      url: '/dashboard',
      headers: { cookie: sessionCookie },
    });

    expect(dash.statusCode).toBe(200);
    expect(dash.body).toContain('Dashboard');
    expect(dash.body).toContain('Logged in as');
  });
});
