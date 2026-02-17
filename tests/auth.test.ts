import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runMigrate } from './helpers/migrate.ts';
import { buildServer } from '../src/api/server.ts';
import { createPool } from '../src/db.ts';
import { createHash, randomBytes } from 'node:crypto';

// JWT signing requires a secret.
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-bytes-long!!';

describe('Magic-link auth (JWT)', () => {
  const app = buildServer();

  beforeAll(async () => {
    await runMigrate('up');
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * Helper: create a magic link token directly in the DB.
   * Avoids race conditions with concurrent test suites truncating tables.
   */
  async function createMagicLinkToken(email: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const tokenSha = createHash('sha256').update(token).digest('hex');
    const pool = createPool({ max: 1 });
    await pool.query(
      `INSERT INTO auth_magic_link (email, token_sha256, expires_at)
       VALUES ($1, $2, now() + interval '15 minutes')`,
      [email, tokenSha],
    );
    await pool.end();
    return token;
  }

  it('issues a magic link and returns access_token on POST consume', async () => {
    const token = await createMagicLinkToken('test@example.com');

    const consume = await app.inject({
      method: 'POST',
      url: '/api/auth/consume',
      payload: { token },
    });

    expect(consume.statusCode).toBe(200);
    const body = consume.json() as { access_token?: string };
    expect(body.access_token).toBeTruthy();

    // Verify the access token works for /api/me
    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: {
        authorization: `Bearer ${body.access_token}`,
      },
    });

    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({ email: 'test@example.com' });
  });

  it('rejects tokens that have already been used (single-use)', async () => {
    const token = await createMagicLinkToken('single-use@example.com');

    // First use should succeed
    const firstConsume = await app.inject({
      method: 'POST',
      url: '/api/auth/consume',
      payload: { token },
    });
    expect(firstConsume.statusCode).toBe(200);

    // Second use should fail
    const secondConsume = await app.inject({
      method: 'POST',
      url: '/api/auth/consume',
      payload: { token },
    });
    expect(secondConsume.statusCode).toBe(400);
    expect(secondConsume.json()).toEqual({ error: 'invalid or expired token' });
  });

  it('rejects expired tokens (15m expiry)', async () => {
    const token = randomBytes(32).toString('base64url');
    const tokenSha = createHash('sha256').update(token).digest('hex');
    const pool = createPool({ max: 1 });
    // Insert with already-expired timestamp
    await pool.query(
      `INSERT INTO auth_magic_link (email, token_sha256, expires_at)
       VALUES ($1, $2, now() - interval '1 minute')`,
      ['expired@example.com', tokenSha],
    );
    await pool.end();

    const consume = await app.inject({
      method: 'POST',
      url: '/api/auth/consume',
      payload: { token },
    });
    expect(consume.statusCode).toBe(400);
    expect(consume.json()).toEqual({ error: 'invalid or expired token' });
  });

  it('sets HttpOnly refresh cookie on consume', async () => {
    const token = await createMagicLinkToken('cookie-test@example.com');

    const consume = await app.inject({
      method: 'POST',
      url: '/api/auth/consume',
      payload: { token },
    });

    expect(consume.statusCode).toBe(200);

    const setCookie = consume.headers['set-cookie'];
    expect(setCookie).toBeTruthy();

    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie!];
    const refreshCookie = cookies.find((c: string) => c.startsWith('projects_refresh='));
    expect(refreshCookie).toBeTruthy();

    const cookieLower = refreshCookie!.toLowerCase();

    // Verify security attributes
    expect(cookieLower).toContain('httponly');
    expect(cookieLower).toContain('samesite=strict');
    expect(cookieLower).toContain('path=/api/auth');

    // Verify 7-day max-age (604800 seconds)
    expect(refreshCookie).toMatch(/max-age=604800/i);
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
      method: 'POST',
      url: '/api/auth/consume',
      payload: {},
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
});
