import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from 'vitest';
import { runMigrate } from './helpers/migrate.ts';
import { buildServer } from '../src/api/server.ts';

describe('Postmark delivery for magic-link auth', () => {
  const app = buildServer();

  const originalEnv = { ...process.env };

  beforeAll(async () => {
    await runMigrate('up');
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    process.env = originalEnv;
  });

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.POSTMARK_ENABLE_TEST_SEND = '1';
    process.env.POSTMARK_TRANSACTIONAL_TOKEN = 'test-token';

    globalThis.fetch = vi.fn(async (_url: any, _init: any) => {
      return new Response(
        JSON.stringify({
          To: 'test@example.com',
          SubmittedAt: new Date().toISOString(),
          MessageID: '00000000-0000-0000-0000-000000000000',
          ErrorCode: 0,
          Message: 'OK',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.POSTMARK_ENABLE_TEST_SEND = undefined;
    process.env.POSTMARK_TRANSACTIONAL_TOKEN = undefined;
  });

  it('sends a transactional email via Postmark and does not return the loginUrl in the API response', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/request-link',
      payload: { email: 'test@example.com' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ ok: true });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    const [url, init] = (globalThis.fetch as any).mock.calls[0] as [string, any];
    expect(url).toBe('https://api.postmarkapp.com/email');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Postmark-Server-Token']).toBe('test-token');

    const body = JSON.parse(init.body);
    expect(body.From).toBe('Projects <projects@execdesk.ai>');
    expect(body.ReplyTo).toBe('quasar@execdesk.ai');
    expect(body.To).toBe('test@example.com');
    expect(body.Subject).toMatch(/login link/i);
    expect(body.TextBody).toMatch(/\/app\/auth\/consume\?token=/);
    expect(body.HtmlBody).toMatch(/\/app\/auth\/consume\?token=/);
  });
});
