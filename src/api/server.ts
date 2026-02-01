import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool } from '../db.js';
import { sendMagicLinkEmail } from '../email/magicLink.js';

export type ProjectsApiOptions = {
  logger?: boolean;
};

export function buildServer(options: ProjectsApiOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  const sessionCookieName = 'projects_session';

  app.register(cookie, {
    // In production, set COOKIE_SECRET to enable signed cookies.
    secret: process.env.COOKIE_SECRET,
  });

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  app.register(fastifyStatic, {
    root: path.join(__dirname, 'static'),
    prefix: '/static/',
    decorateReply: false,
  });

  const appFrontendIndexHtml = readFileSync(
    path.join(__dirname, 'static', 'app', 'index.html'),
    'utf8'
  );

  function renderAppFrontendHtml(bootstrap: unknown | null): string {
    if (!bootstrap) return appFrontendIndexHtml;

    // Embed bootstrap JSON in the HTML response so Fastify inject tests can assert on data
    // without needing to execute client-side JS.
    const json = JSON.stringify(bootstrap).replace(/<\//g, '<\\/');
    const injection = `\n<script id="app-bootstrap" type="application/json">${json}</script>\n`;

    if (appFrontendIndexHtml.includes('</body>')) {
      return appFrontendIndexHtml.replace('</body>', `${injection}</body>`);
    }

    return `${appFrontendIndexHtml}${injection}`;
  }

  async function getSessionEmail(req: any): Promise<string | null> {
    const sessionId = (req.cookies as Record<string, string | undefined>)[sessionCookieName];
    if (!sessionId) return null;

    const pool = createPool();
    const result = await pool.query(
      `SELECT email
         FROM auth_session
        WHERE id = $1
          AND revoked_at IS NULL
          AND expires_at > now()`,
      [sessionId]
    );
    await pool.end();

    if (result.rows.length === 0) return null;
    return result.rows[0].email as string;
  }

  async function requireDashboardSession(req: any, reply: any): Promise<string | null> {
    const email = await getSessionEmail(req);
    if (email) return email;
    reply.code(200).header('content-type', 'text/html; charset=utf-8').send(renderLoginPage());
    return null;
  }

  function renderLoginPage(): string {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sign in - clawdbot-projects</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/static/app.css" />
</head>
<body class="min-h-screen bg-background text-foreground font-sans">
  <div class="flex min-h-screen flex-col items-center justify-center px-4">
    <div class="w-full max-w-md">
      <div class="mb-8 text-center">
        <h1 class="text-3xl font-bold tracking-tight">clawdbot</h1>
        <p class="mt-2 text-sm text-muted-foreground">Human-Agent Collaboration Workspace</p>
      </div>
      <div class="rounded-lg border border-border bg-surface p-6 shadow-sm">
        <div class="mb-6">
          <h2 class="text-xl font-semibold tracking-tight">Sign in</h2>
          <p class="mt-1 text-sm text-muted-foreground">Enter your email to receive a magic link.</p>
        </div>
        <form id="login-form" class="space-y-4">
          <div>
            <label class="sr-only" for="email">Email address</label>
            <input
              id="email"
              name="email"
              type="email"
              placeholder="you@example.com"
              autocomplete="email"
              required
              class="h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <button
            type="submit"
            class="h-10 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary"
          >
            Send magic link
          </button>
        </form>
        <p id="message" class="mt-4 text-sm text-center hidden"></p>
      </div>
    </div>
  </div>
  <script>
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('email').value;
      const msg = document.getElementById('message');
      const btn = e.target.querySelector('button');
      btn.disabled = true;
      btn.textContent = 'Sending...';
      try {
        const res = await fetch('/api/auth/request-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (res.ok) {
          msg.textContent = 'Check your email for the magic link!';
          msg.className = 'mt-4 text-sm text-center text-success';
        } else {
          msg.textContent = data.error || 'Failed to send link';
          msg.className = 'mt-4 text-sm text-center text-destructive';
        }
      } catch {
        msg.textContent = 'Network error. Please try again.';
        msg.className = 'mt-4 text-sm text-center text-destructive';
      }
      msg.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Send magic link';
    });
  </script>
</body>
</html>`;
  }

  app.get('/health', async () => ({ ok: true }));

  // New frontend (issue #52). These routes are protected by the existing dashboard session cookie.

  // Issue #129: New navigation routes
  app.get('/app/activity', async (req, reply) => {
    const email = await requireDashboardSession(req, reply);
    if (!email) return;

    const bootstrap = {
      route: { kind: 'activity' },
      me: { email },
    };

    return reply
      .code(200)
      .header('content-type', 'text/html; charset=utf-8')
      .send(renderAppFrontendHtml(bootstrap));
  });

  app.get('/app/timeline', async (req, reply) => {
    const email = await requireDashboardSession(req, reply);
    if (!email) return;

    const bootstrap = {
      route: { kind: 'timeline' },
      me: { email },
    };

    return reply
      .code(200)
      .header('content-type', 'text/html; charset=utf-8')
      .send(renderAppFrontendHtml(bootstrap));
  });

  app.get('/app/contacts', async (req, reply) => {
    const email = await requireDashboardSession(req, reply);
    if (!email) return;

    const bootstrap = {
      route: { kind: 'contacts' },
      me: { email },
    };

    return reply
      .code(200)
      .header('content-type', 'text/html; charset=utf-8')
      .send(renderAppFrontendHtml(bootstrap));
  });

  app.get('/app/kanban', async (req, reply) => {
    const email = await requireDashboardSession(req, reply);
    if (!email) return;

    const bootstrap = {
      route: { kind: 'kanban' },
      me: { email },
    };

    return reply
      .code(200)
      .header('content-type', 'text/html; charset=utf-8')
      .send(renderAppFrontendHtml(bootstrap));
  });

  app.get('/app/work-items', async (req, reply) => {
    const email = await requireDashboardSession(req, reply);
    if (!email) return;

    const pool = createPool();
    const result = await pool.query(
      `SELECT id::text as id,
              title,
              status,
              priority::text as priority,
              task_type::text as task_type,
              created_at,
              updated_at
         FROM work_item
        ORDER BY created_at DESC
        LIMIT 50`
    );
    await pool.end();

    return reply
      .code(200)
      .header('content-type', 'text/html; charset=utf-8')
      .send(
        renderAppFrontendHtml({
          route: { kind: 'work-items-list' },
          me: { email },
          workItems: result.rows,
        })
      );
  });

  app.get('/app/work-items/:id/timeline', async (req, reply) => {
    const email = await requireDashboardSession(req, reply);
    if (!email) return;

    const params = req.params as { id: string };

    // Render the SPA shell - timeline data will be fetched client-side
    const bootstrap = {
      route: { kind: 'timeline', id: params.id },
      me: { email },
    };

    return reply
      .code(200)
      .header('content-type', 'text/html; charset=utf-8')
      .send(renderAppFrontendHtml(bootstrap));
  });

  app.get('/app/work-items/:id/graph', async (req, reply) => {
    const email = await requireDashboardSession(req, reply);
    if (!email) return;

    const params = req.params as { id: string };

    // Render the SPA shell - graph data will be fetched client-side
    const bootstrap = {
      route: { kind: 'graph', id: params.id },
      me: { email },
    };

    return reply
      .code(200)
      .header('content-type', 'text/html; charset=utf-8')
      .send(renderAppFrontendHtml(bootstrap));
  });

  app.get('/app/work-items/:id', async (req, reply) => {
    const email = await requireDashboardSession(req, reply);
    if (!email) return;

    const params = req.params as { id: string };

    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // Some routes/tests may hit this endpoint with a non-UUID id. Avoid 500s by skipping DB lookups.
    if (!uuidRe.test(params.id)) {
      const bootstrap = {
        route: { kind: 'work-item-detail', id: params.id },
        me: { email },
        workItem: null,
        participants: [],
      };

      return reply
        .code(200)
        .header('content-type', 'text/html; charset=utf-8')
        .send(renderAppFrontendHtml(bootstrap));
    }

    const pool = createPool();
    const item = await pool.query(
      `SELECT id::text as id, title
         FROM work_item
        WHERE id = $1`,
      [params.id]
    );

    const participants = await pool.query(
      `SELECT participant, role
         FROM work_item_participant
        WHERE work_item_id = $1
        ORDER BY created_at DESC`,
      [params.id]
    );

    await pool.end();

    // Render the SPA shell but embed enough bootstrap data that server-side tests can assert on.
    const bootstrap = {
      route: { kind: 'work-item-detail', id: params.id },
      me: { email },
      workItem: item.rows[0] ?? null,
      participants: participants.rows,
    };

    return reply
      .code(200)
      .header('content-type', 'text/html; charset=utf-8')
      .send(renderAppFrontendHtml(bootstrap));
  });

  app.post('/api/auth/request-link', async (req, reply) => {
    const body = req.body as { email?: string };
    const email = body?.email?.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return reply.code(400).send({ error: 'email is required' });
    }

    const token = randomBytes(32).toString('base64url');
    const tokenSha = createHash('sha256').update(token).digest('hex');

    const pool = createPool();
    await pool.query(
      `INSERT INTO auth_magic_link (email, token_sha256, expires_at)
       VALUES ($1, $2, now() + interval '15 minutes')`,
      [email, tokenSha]
    );
    await pool.end();

    const baseUrl = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
    const loginUrl = `${baseUrl}/api/auth/consume?token=${token}`;

    const { delivered } = await sendMagicLinkEmail({ toEmail: email, loginUrl });

    // Only return the URL when email delivery isn't configured (or in non-production).
    // This prevents leaking a login token to whoever can see the response in production.
    const shouldReturnUrl = !delivered && process.env.NODE_ENV !== 'production';

    return reply.code(201).send({ ok: true, ...(shouldReturnUrl ? { loginUrl } : {}) });
  });

  app.get('/api/auth/consume', async (req, reply) => {
    const query = req.query as { token?: string };
    const token = query.token;
    if (!token) return reply.code(400).send({ error: 'token is required' });

    const tokenSha = createHash('sha256').update(token).digest('hex');

    const pool = createPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const link = await client.query(
        `SELECT id::text as id, email
           FROM auth_magic_link
          WHERE token_sha256 = $1
            AND used_at IS NULL
            AND expires_at > now()
          LIMIT 1`,
        [tokenSha]
      );

      if (link.rows.length === 0) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: 'invalid or expired token' });
      }

      const { id, email } = link.rows[0] as { id: string; email: string };

      await client.query(`UPDATE auth_magic_link SET used_at = now() WHERE id = $1`, [id]);

      const session = await client.query(
        `INSERT INTO auth_session (email, expires_at)
         VALUES ($1, now() + interval '7 days')
         RETURNING id::text as id, expires_at`,
        [email]
      );

      const sessionId = (session.rows[0] as { id: string }).id;

      await client.query('COMMIT');

      reply.setCookie(sessionCookieName, sessionId, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 60 * 60 * 24 * 7,
      });

      const accept = req.headers.accept || '';
      if (accept.includes('text/html')) {
        return reply.redirect('/app/work-items');
      }

      return reply.send({ ok: true });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
      await pool.end();
    }
  });

  app.get('/api/me', async (req, reply) => {
    const email = await getSessionEmail(req);
    if (!email) return reply.code(401).send({ error: 'unauthorized' });
    return reply.send({ email });
  });

  // Activity Feed API (issue #130)
  app.get('/api/activity', async (req, reply) => {
    const query = req.query as { limit?: string; offset?: string };
    const limit = Math.min(parseInt(query.limit || '50', 10), 100);
    const offset = parseInt(query.offset || '0', 10);

    const pool = createPool();
    const result = await pool.query(
      `SELECT a.id::text as id,
              a.activity_type::text as type,
              a.work_item_id::text as work_item_id,
              w.title as work_item_title,
              a.actor_email,
              a.description,
              a.created_at
         FROM work_item_activity a
         JOIN work_item w ON w.id = a.work_item_id
        ORDER BY a.created_at DESC
        LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    await pool.end();
    return reply.send({ items: result.rows });
  });

  app.get('/api/work-items/:id/activity', async (req, reply) => {
    const params = req.params as { id: string };
    const query = req.query as { limit?: string; offset?: string };
    const limit = Math.min(parseInt(query.limit || '50', 10), 100);
    const offset = parseInt(query.offset || '0', 10);

    const pool = createPool();

    // Check if work item exists
    const exists = await pool.query('SELECT 1 FROM work_item WHERE id = $1', [params.id]);
    if (exists.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'not found' });
    }

    const result = await pool.query(
      `SELECT a.id::text as id,
              a.activity_type::text as type,
              a.work_item_id::text as work_item_id,
              w.title as work_item_title,
              a.actor_email,
              a.description,
              a.created_at
         FROM work_item_activity a
         JOIN work_item w ON w.id = a.work_item_id
        WHERE a.work_item_id = $1
        ORDER BY a.created_at DESC
        LIMIT $2 OFFSET $3`,
      [params.id, limit, offset]
    );
    await pool.end();
    return reply.send({ items: result.rows });
  });

  app.get('/api/work-items', async (_req, reply) => {
    const pool = createPool();
    const result = await pool.query(
      `SELECT id::text as id,
              title,
              status,
              priority::text as priority,
              task_type::text as task_type,
              kind,
              parent_id::text as parent_id,
              created_at,
              updated_at,
              estimate_minutes,
              actual_minutes
         FROM work_item
        ORDER BY created_at DESC
        LIMIT 50`
    );
    await pool.end();
    return reply.send({ items: result.rows });
  });

  app.get('/api/backlog', async (req, reply) => {
    const query = req.query as {
      status?: string | string[];
      priority?: string | string[];
      kind?: string | string[];
    };

    // Normalize to arrays
    const statuses = query.status ? (Array.isArray(query.status) ? query.status : [query.status]) : null;
    const priorities = query.priority ? (Array.isArray(query.priority) ? query.priority : [query.priority]) : null;
    const kinds = query.kind ? (Array.isArray(query.kind) ? query.kind : [query.kind]) : null;

    const pool = createPool();

    // Build dynamic query
    const conditions: string[] = [];
    const params: (string | string[])[] = [];
    let paramIndex = 1;

    if (statuses && statuses.length > 0) {
      conditions.push(`status = ANY($${paramIndex})`);
      params.push(statuses);
      paramIndex++;
    }

    if (priorities && priorities.length > 0) {
      conditions.push(`priority::text = ANY($${paramIndex})`);
      params.push(priorities);
      paramIndex++;
    }

    if (kinds && kinds.length > 0) {
      conditions.push(`work_item_kind = ANY($${paramIndex})`);
      params.push(kinds);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT id::text as id,
              title,
              description,
              status,
              priority::text as priority,
              task_type::text as task_type,
              work_item_kind as kind,
              parent_work_item_id::text as parent_id,
              not_before,
              not_after,
              estimate_minutes,
              actual_minutes,
              created_at,
              updated_at
         FROM work_item
        ${whereClause}
        ORDER BY priority, created_at
        LIMIT 100`,
      params
    );
    await pool.end();
    return reply.send({ items: result.rows });
  });

  app.patch('/api/work-items/:id/status', async (req, reply) => {
    const params = req.params as { id: string };
    const body = req.body as { status?: string };

    if (!body?.status) {
      return reply.code(400).send({ error: 'status is required' });
    }

    const pool = createPool();
    const result = await pool.query(
      `UPDATE work_item
          SET status = $2,
              updated_at = now()
        WHERE id = $1
      RETURNING id::text as id, title, status, priority::text as priority, updated_at`,
      [params.id, body.status]
    );

    if (result.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'not found' });
    }

    const workItem = result.rows[0] as { id: string; title: string; status: string };

    // Record activity
    await pool.query(
      `INSERT INTO work_item_activity (work_item_id, activity_type, description)
       VALUES ($1, 'status_change', $2)`,
      [workItem.id, `Status changed to ${workItem.status}`]
    );

    await pool.end();

    return reply.send(result.rows[0]);
  });

  app.get('/api/inbox', async (_req, reply) => {
    const pool = createPool();
    const result = await pool.query(
      `SELECT wi.id::text as work_item_id,
              wi.title,
              wic.action::text as action,
              et.channel::text as channel,
              et.external_thread_key,
              em.body as last_message_body,
              em.received_at as last_message_received_at
         FROM work_item_communication wic
         JOIN work_item wi ON wi.id = wic.work_item_id
         JOIN external_thread et ON et.id = wic.thread_id
         LEFT JOIN external_message em ON em.id = wic.message_id
        ORDER BY wi.created_at DESC
        LIMIT 50`
    );
    await pool.end();
    return reply.send({ items: result.rows });
  });

  // Legacy dashboard routes - redirect to new React app
  app.get('/dashboard', async (_req, reply) => {
    return reply.redirect('/app/work-items');
  });

  app.get('/dashboard/*', async (_req, reply) => {
    return reply.redirect('/app/work-items');
  });
  app.post('/api/work-items', async (req, reply) => {
    const body = req.body as {
      title?: string;
      description?: string | null;
      kind?: string;
      parentId?: string | null;
      estimateMinutes?: number | null;
      actualMinutes?: number | null;
    };
    if (!body?.title || body.title.trim().length === 0) {
      return reply.code(400).send({ error: 'title is required' });
    }

    const kind = body.kind ?? 'issue';
    const allowedKinds = new Set(['project', 'initiative', 'epic', 'issue']);
    if (!allowedKinds.has(kind)) {
      return reply.code(400).send({ error: 'kind must be one of project|initiative|epic|issue' });
    }

    // Validate estimate/actual constraints before hitting DB
    const estimateMinutes = body.estimateMinutes ?? null;
    const actualMinutes = body.actualMinutes ?? null;

    if (estimateMinutes !== null) {
      if (typeof estimateMinutes !== 'number' || estimateMinutes < 0 || estimateMinutes > 525600) {
        return reply.code(400).send({ error: 'estimateMinutes must be between 0 and 525600' });
      }
    }

    if (actualMinutes !== null) {
      if (typeof actualMinutes !== 'number' || actualMinutes < 0 || actualMinutes > 525600) {
        return reply.code(400).send({ error: 'actualMinutes must be between 0 and 525600' });
      }
    }

    const pool = createPool();

    // Validate parent relationship before insert for a clearer 4xx than a DB exception.
    const parentId = body.parentId ?? null;
    if (parentId) {
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRe.test(parentId)) {
        await pool.end();
        return reply.code(400).send({ error: 'parentId must be a UUID' });
      }

      const parent = await pool.query(`SELECT kind FROM work_item WHERE id = $1`, [parentId]);
      if (parent.rows.length === 0) {
        await pool.end();
        return reply.code(400).send({ error: 'parent not found' });
      }
      const parentKind = (parent.rows[0] as { kind: string }).kind;

      if (kind === 'project') {
        await pool.end();
        return reply.code(400).send({ error: 'project cannot have parent' });
      }
      if (kind === 'initiative' && parentKind !== 'project') {
        await pool.end();
        return reply.code(400).send({ error: 'initiative parent must be project' });
      }
      if (kind === 'epic' && parentKind !== 'initiative') {
        await pool.end();
        return reply.code(400).send({ error: 'epic parent must be initiative' });
      }
      if (kind === 'issue' && parentKind !== 'epic') {
        await pool.end();
        return reply.code(400).send({ error: 'issue parent must be epic' });
      }
    } else {
      if (kind === 'epic') {
        await pool.end();
        return reply.code(400).send({ error: 'epic requires parent initiative' });
      }
      if (kind === 'issue') {
        // issues may be top-level for backwards compatibility
      }
    }

    const result = await pool.query(
      `INSERT INTO work_item (title, description, kind, parent_id, work_item_kind, parent_work_item_id, estimate_minutes, actual_minutes)
       VALUES ($1, $2, $3, $4, $5::work_item_kind, $4, $6, $7)
       RETURNING id::text as id, title, description, kind, parent_id::text as parent_id, estimate_minutes, actual_minutes`,
      [body.title.trim(), body.description ?? null, kind, parentId, kind, estimateMinutes, actualMinutes]
    );

    const workItem = result.rows[0] as { id: string; title: string };

    // Record activity
    await pool.query(
      `INSERT INTO work_item_activity (work_item_id, activity_type, description)
       VALUES ($1, 'created', $2)`,
      [workItem.id, `Created work item: ${workItem.title}`]
    );

    await pool.end();

    return reply.code(201).send(result.rows[0]);
  });

  app.patch('/api/work-items/:id/hierarchy', async (req, reply) => {
    const params = req.params as { id: string };
    const body = req.body as { kind?: string; parentId?: string | null };

    if (!body?.kind) {
      return reply.code(400).send({ error: 'kind is required' });
    }

    const kind = body.kind;
    const allowedKinds = new Set(['project', 'initiative', 'epic', 'issue']);
    if (!allowedKinds.has(kind)) {
      return reply.code(400).send({ error: 'kind must be one of project|initiative|epic|issue' });
    }

    const parentId = body.parentId ?? null;
    const pool = createPool();

    if (parentId) {
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRe.test(parentId)) {
        await pool.end();
        return reply.code(400).send({ error: 'parentId must be a UUID' });
      }

      const parent = await pool.query(`SELECT kind FROM work_item WHERE id = $1`, [parentId]);
      if (parent.rows.length === 0) {
        await pool.end();
        return reply.code(400).send({ error: 'parent not found' });
      }
      const parentKind = (parent.rows[0] as { kind: string }).kind;

      if (kind === 'project') {
        await pool.end();
        return reply.code(400).send({ error: 'project cannot have parent' });
      }
      if (kind === 'initiative' && parentKind !== 'project') {
        await pool.end();
        return reply.code(400).send({ error: 'initiative parent must be project' });
      }
      if (kind === 'epic' && parentKind !== 'initiative') {
        await pool.end();
        return reply.code(400).send({ error: 'epic parent must be initiative' });
      }
      if (kind === 'issue' && parentKind !== 'epic') {
        await pool.end();
        return reply.code(400).send({ error: 'issue parent must be epic' });
      }
    } else {
      if (kind === 'project') {
        // ok
      } else if (kind === 'initiative') {
        // initiatives may be top-level
      } else if (kind === 'epic') {
        await pool.end();
        return reply.code(400).send({ error: 'epic requires parent initiative' });
      }
    }

    const result = await pool.query(
      `UPDATE work_item
          SET kind = $2,
              parent_id = $3,
              work_item_kind = $4::work_item_kind,
              parent_work_item_id = $3,
              updated_at = now()
        WHERE id = $1
      RETURNING id::text as id, title, description, kind, parent_id::text as parent_id`,
      [params.id, kind, parentId, kind]
    );
    await pool.end();

    if (result.rows.length === 0) return reply.code(404).send({ error: 'not found' });
    return reply.send(result.rows[0]);
  });

  app.get('/api/work-items/:id', async (req, reply) => {
    const params = req.params as { id: string };
    const pool = createPool();
    const result = await pool.query(
      `SELECT id::text as id,
              title,
              description,
              status,
              priority::text as priority,
              task_type::text as task_type,
              kind,
              parent_id::text as parent_id,
              created_at,
              updated_at,
              not_before,
              not_after,
              estimate_minutes,
              actual_minutes
         FROM work_item
        WHERE id = $1`,
      [params.id]
    );
    await pool.end();

    if (result.rows.length === 0) return reply.code(404).send({ error: 'not found' });
    return reply.send(result.rows[0]);
  });

  app.put('/api/work-items/:id', async (req, reply) => {
    const params = req.params as { id: string };
    const body = req.body as {
      title?: string;
      description?: string | null;
      status?: string;
      priority?: string;
      taskType?: string;
      notBefore?: string | null;
      notAfter?: string | null;
      parentId?: string | null;
      estimateMinutes?: number | null;
      actualMinutes?: number | null;
    };

    if (!body?.title || body.title.trim().length === 0) {
      return reply.code(400).send({ error: 'title is required' });
    }

    // Validate estimate/actual constraints before hitting DB
    const estimateMinutesSpecified = Object.prototype.hasOwnProperty.call(body, 'estimateMinutes');
    const actualMinutesSpecified = Object.prototype.hasOwnProperty.call(body, 'actualMinutes');

    if (estimateMinutesSpecified && body.estimateMinutes !== null) {
      if (typeof body.estimateMinutes !== 'number' || body.estimateMinutes < 0 || body.estimateMinutes > 525600) {
        return reply.code(400).send({ error: 'estimateMinutes must be between 0 and 525600' });
      }
    }

    if (actualMinutesSpecified && body.actualMinutes !== null) {
      if (typeof body.actualMinutes !== 'number' || body.actualMinutes < 0 || body.actualMinutes > 525600) {
        return reply.code(400).send({ error: 'actualMinutes must be between 0 and 525600' });
      }
    }

    const pool = createPool();

    // Fetch current row so we can validate hierarchy semantics on parent changes.
    const existing = await pool.query(
      `SELECT kind, parent_id::text as parent_id, estimate_minutes, actual_minutes
         FROM work_item
        WHERE id = $1`,
      [params.id]
    );

    if (existing.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'not found' });
    }

    const {
      kind,
      parent_id: currentParentId,
      estimate_minutes: currentEstimate,
      actual_minutes: currentActual,
    } = existing.rows[0] as {
      kind: string;
      parent_id: string | null;
      estimate_minutes: number | null;
      actual_minutes: number | null;
    };

    // If parentId is omitted, keep the current value.
    const parentIdSpecified = Object.prototype.hasOwnProperty.call(body, 'parentId');
    const parentId = parentIdSpecified ? (body.parentId ?? null) : currentParentId;

    // If estimate/actual not specified, keep current values.
    const estimateMinutes = estimateMinutesSpecified ? (body.estimateMinutes ?? null) : currentEstimate;
    const actualMinutes = actualMinutesSpecified ? (body.actualMinutes ?? null) : currentActual;

    // Validate parentId format early so we can return 4xx rather than a DB exception.
    if (parentId) {
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRe.test(parentId)) {
        await pool.end();
        return reply.code(400).send({ error: 'parentId must be a UUID' });
      }
    }

    // Validate parent relationship before update for a clearer 4xx than a DB exception.
    let parentKind: string | null = null;
    if (parentId) {
      const parent = await pool.query(`SELECT kind FROM work_item WHERE id = $1`, [parentId]);
      if (parent.rows.length === 0) {
        await pool.end();
        return reply.code(400).send({ error: 'parent not found' });
      }
      parentKind = (parent.rows[0] as { kind: string }).kind;
    }

    if (kind === 'initiative') {
      if (parentId) {
        await pool.end();
        return reply.code(400).send({ error: 'initiative cannot have parent' });
      }
    }

    if (kind === 'epic') {
      if (!parentId) {
        await pool.end();
        return reply.code(400).send({ error: 'epic requires parent initiative' });
      }
      if (parentKind !== 'initiative') {
        await pool.end();
        return reply.code(400).send({ error: 'epic parent must be initiative' });
      }
    }

    if (kind === 'issue') {
      if (parentId && parentKind !== 'epic') {
        await pool.end();
        return reply.code(400).send({ error: 'issue parent must be epic' });
      }
    }

    const result = await pool.query(
      `UPDATE work_item
          SET title = $2,
              description = $3,
              status = $4,
              priority = $5::work_item_priority,
              task_type = $6::work_item_task_type,
              not_before = $7::timestamptz,
              not_after = $8::timestamptz,
              parent_id = $9,
              estimate_minutes = $10,
              actual_minutes = $11,
              updated_at = now()
        WHERE id = $1
      RETURNING id::text as id, title, description, status, priority::text as priority, task_type::text as task_type,
                kind, parent_id::text as parent_id,
                created_at, updated_at, not_before, not_after, estimate_minutes, actual_minutes`,
      [
        params.id,
        body.title.trim(),
        body.description ?? null,
        body.status ?? 'open',
        body.priority ?? 'P2',
        body.taskType ?? 'general',
        body.notBefore ?? null,
        body.notAfter ?? null,
        parentId,
        estimateMinutes,
        actualMinutes,
      ]
    );

    if (result.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'not found' });
    }

    const workItem = result.rows[0] as { id: string; title: string };

    // Record activity
    await pool.query(
      `INSERT INTO work_item_activity (work_item_id, activity_type, description)
       VALUES ($1, 'updated', $2)`,
      [workItem.id, `Updated work item: ${workItem.title}`]
    );

    await pool.end();
    return reply.send(result.rows[0]);
  });

app.delete('/api/work-items/:id', async (req, reply) => {
    const params = req.params as { id: string };
    const pool = createPool();
    const result = await pool.query(`DELETE FROM work_item WHERE id = $1 RETURNING id::text as id`, [params.id]);
    await pool.end();
    if (result.rows.length === 0) return reply.code(404).send({ error: 'not found' });
    return reply.code(204).send();
  });

  app.get('/api/work-items/:id/rollup', async (req, reply) => {
    const params = req.params as { id: string };
    const pool = createPool();

    // First check if the work item exists and get its kind
    const item = await pool.query(
      `SELECT id, work_item_kind FROM work_item WHERE id = $1`,
      [params.id]
    );

    if (item.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'not found' });
    }

    const kind = (item.rows[0] as { work_item_kind: string }).work_item_kind;

    // Select the appropriate rollup view based on kind
    let rollupView: string;
    switch (kind) {
      case 'project':
        rollupView = 'work_item_rollup_project';
        break;
      case 'initiative':
        rollupView = 'work_item_rollup_initiative';
        break;
      case 'epic':
        rollupView = 'work_item_rollup_epic';
        break;
      default:
        rollupView = 'work_item_rollup_issue';
    }

    const result = await pool.query(
      `SELECT work_item_id::text as work_item_id,
              total_estimate_minutes,
              total_actual_minutes
         FROM ${rollupView}
        WHERE work_item_id = $1`,
      [params.id]
    );
    await pool.end();

    if (result.rows.length === 0) {
      // The item exists but has no rollup (shouldn't happen, but handle gracefully)
      return reply.send({
        work_item_id: params.id,
        total_estimate_minutes: null,
        total_actual_minutes: null,
      });
    }

    return reply.send(result.rows[0]);
  });

  app.get('/api/work-items/:id/timeline', async (req, reply) => {
    const params = req.params as { id: string };
    const pool = createPool();

    // Check if root item exists
    const root = await pool.query(
      `SELECT id FROM work_item WHERE id = $1`,
      [params.id]
    );

    if (root.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'not found' });
    }

    // Get all descendants (including the root) with their hierarchy level
    const items = await pool.query(
      `WITH RECURSIVE descendants AS (
         -- Start with the root item
         SELECT id, parent_work_item_id, 0 as level
           FROM work_item
          WHERE id = $1
         UNION ALL
         -- Add children
         SELECT wi.id, wi.parent_work_item_id, d.level + 1
           FROM work_item wi
           JOIN descendants d ON wi.parent_work_item_id = d.id
       )
       SELECT wi.id::text as id,
              wi.title,
              wi.work_item_kind as kind,
              wi.status,
              wi.priority::text as priority,
              wi.parent_work_item_id::text as parent_id,
              d.level,
              wi.not_before,
              wi.not_after,
              wi.estimate_minutes,
              wi.actual_minutes,
              wi.created_at
         FROM descendants d
         JOIN work_item wi ON wi.id = d.id
        ORDER BY d.level, wi.not_before NULLS LAST, wi.created_at`,
      [params.id]
    );

    // Get all dependencies between items in this subtree
    const dependencies = await pool.query(
      `WITH RECURSIVE descendants AS (
         SELECT id FROM work_item WHERE id = $1
         UNION ALL
         SELECT wi.id FROM work_item wi
           JOIN descendants d ON wi.parent_work_item_id = d.id
       )
       SELECT wid.id::text as id,
              wid.work_item_id::text as from_id,
              wid.depends_on_work_item_id::text as to_id,
              wid.kind
         FROM work_item_dependency wid
        WHERE wid.work_item_id IN (SELECT id FROM descendants)
          AND wid.depends_on_work_item_id IN (SELECT id FROM descendants)`,
      [params.id]
    );

    await pool.end();

    return reply.send({
      items: items.rows,
      dependencies: dependencies.rows,
    });
  });

  app.get('/api/work-items/:id/dependency-graph', async (req, reply) => {
    const params = req.params as { id: string };
    const pool = createPool();

    // Check if root item exists
    const root = await pool.query(
      `SELECT id FROM work_item WHERE id = $1`,
      [params.id]
    );

    if (root.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'not found' });
    }

    // Get all descendants (including the root)
    const nodes = await pool.query(
      `WITH RECURSIVE descendants AS (
         SELECT id, parent_work_item_id, 0 as level
           FROM work_item
          WHERE id = $1
         UNION ALL
         SELECT wi.id, wi.parent_work_item_id, d.level + 1
           FROM work_item wi
           JOIN descendants d ON wi.parent_work_item_id = d.id
       )
       SELECT wi.id::text as id,
              wi.title,
              wi.work_item_kind as kind,
              wi.status,
              wi.priority::text as priority,
              wi.parent_work_item_id::text as parent_id,
              d.level,
              wi.not_before,
              wi.not_after,
              wi.estimate_minutes,
              wi.actual_minutes
         FROM descendants d
         JOIN work_item wi ON wi.id = d.id
        ORDER BY d.level, wi.created_at`,
      [params.id]
    );

    const itemIds = nodes.rows.map((n: { id: string }) => n.id);

    // Get all dependencies between items in this subtree
    const edges = await pool.query(
      `SELECT wid.id::text as id,
              wid.work_item_id::text as source,
              wid.depends_on_work_item_id::text as target,
              wid.kind
         FROM work_item_dependency wid
        WHERE wid.work_item_id = ANY($1)
          AND wid.depends_on_work_item_id = ANY($1)`,
      [itemIds]
    );

    // Identify blockers: open items that have open items depending on them
    const blockerIds = new Set<string>();
    const dependencyMap = new Map<string, string[]>(); // source -> [targets]

    for (const edge of edges.rows) {
      const { source, target } = edge as { source: string; target: string };
      if (!dependencyMap.has(source)) {
        dependencyMap.set(source, []);
      }
      dependencyMap.get(source)!.push(target);
    }

    // Mark items that are blocking other open items
    const nodeStatusMap = new Map<string, string | null>();
    for (const node of nodes.rows) {
      const { id, status } = node as { id: string; status: string | null };
      nodeStatusMap.set(id, status);
    }

    for (const [source, targets] of dependencyMap) {
      const sourceStatus = nodeStatusMap.get(source);
      if (sourceStatus === 'open' || sourceStatus === 'blocked') {
        for (const target of targets) {
          const targetStatus = nodeStatusMap.get(target);
          if (targetStatus === 'open' || targetStatus === 'blocked') {
            blockerIds.add(target);
          }
        }
      }
    }

    // Compute critical path using longest path through dependency graph
    // Critical path = longest chain of dependent items (by estimate sum or count)
    const criticalPath: Array<{ id: string; title: string; estimate_minutes: number | null }> = [];

    // Build adjacency list for reverse traversal (target -> sources that depend on it)
    const reverseAdjacency = new Map<string, string[]>();
    for (const [source, targets] of dependencyMap) {
      for (const target of targets) {
        if (!reverseAdjacency.has(target)) {
          reverseAdjacency.set(target, []);
        }
        reverseAdjacency.get(target)!.push(source);
      }
    }

    // Find nodes with no dependencies (leaf nodes in dependency graph)
    const leafNodes = itemIds.filter((id: string) => !dependencyMap.has(id) || dependencyMap.get(id)!.length === 0);

    // DFS to find longest path from each leaf, tracking by estimate sum
    function findLongestPath(nodeId: string, visited: Set<string>): Array<{ id: string; title: string; estimate_minutes: number | null }> {
      if (visited.has(nodeId)) return [];
      visited.add(nodeId);

      const node = nodes.rows.find((n: { id: string }) => n.id === nodeId) as {
        id: string;
        title: string;
        estimate_minutes: number | null;
      } | undefined;

      if (!node) return [];

      const dependents = reverseAdjacency.get(nodeId) || [];
      let longestSubPath: Array<{ id: string; title: string; estimate_minutes: number | null }> = [];
      let longestEstimate = 0;

      for (const depId of dependents) {
        const subPath = findLongestPath(depId, new Set(visited));
        const subEstimate = subPath.reduce((sum, n) => sum + (n.estimate_minutes || 0), 0);
        if (subEstimate > longestEstimate || (subEstimate === longestEstimate && subPath.length > longestSubPath.length)) {
          longestSubPath = subPath;
          longestEstimate = subEstimate;
        }
      }

      return [{ id: node.id, title: node.title, estimate_minutes: node.estimate_minutes }, ...longestSubPath];
    }

    // Find the longest path starting from any leaf
    let globalLongestPath: Array<{ id: string; title: string; estimate_minutes: number | null }> = [];
    let globalLongestEstimate = 0;

    for (const leafId of leafNodes) {
      const path = findLongestPath(leafId, new Set());
      const pathEstimate = path.reduce((sum, n) => sum + (n.estimate_minutes || 0), 0);
      if (pathEstimate > globalLongestEstimate || (pathEstimate === globalLongestEstimate && path.length > globalLongestPath.length)) {
        globalLongestPath = path;
        globalLongestEstimate = pathEstimate;
      }
    }

    // Mark nodes with is_blocker flag
    const nodesWithBlockerFlag = nodes.rows.map((node: { id: string }) => ({
      ...node,
      is_blocker: blockerIds.has(node.id),
    }));

    await pool.end();

    return reply.send({
      nodes: nodesWithBlockerFlag,
      edges: edges.rows,
      critical_path: globalLongestPath,
    });
  });

  app.get('/api/work-items/:id/dependencies', async (req, reply) => {
    const params = req.params as { id: string };
    const pool = createPool();
    const result = await pool.query(
      `SELECT wid.id::text as id,
              wid.work_item_id::text as work_item_id,
              wid.depends_on_work_item_id::text as depends_on_work_item_id,
              wid.kind,
              wi2.title as depends_on_title,
              wid.created_at
         FROM work_item_dependency wid
         JOIN work_item wi2 ON wi2.id = wid.depends_on_work_item_id
        WHERE wid.work_item_id = $1
        ORDER BY wid.created_at DESC`,
      [params.id]
    );
    await pool.end();
    return reply.send({ items: result.rows });
  });

  app.delete('/api/work-items/:id/dependencies/:dependencyId', async (req, reply) => {
    const params = req.params as { id: string; dependencyId: string };
    const pool = createPool();
    const result = await pool.query(
      `DELETE FROM work_item_dependency
        WHERE id = $1
          AND work_item_id = $2
      RETURNING id::text as id`,
      [params.dependencyId, params.id]
    );
    await pool.end();
    if (result.rows.length === 0) return reply.code(404).send({ error: 'not found' });
    return reply.code(204).send();
  });

  app.get('/api/work-items/:id/participants', async (req, reply) => {
    const params = req.params as { id: string };
    const pool = createPool();
    const result = await pool.query(
      `SELECT id::text as id, work_item_id::text as work_item_id, participant, role, created_at
         FROM work_item_participant
        WHERE work_item_id = $1
        ORDER BY created_at DESC`,
      [params.id]
    );
    await pool.end();
    return reply.send({ items: result.rows });
  });

  app.post('/api/work-items/:id/participants', async (req, reply) => {
    const params = req.params as { id: string };
    const body = req.body as { participant?: string; role?: string };
    if (!body?.participant || body.participant.trim().length === 0) {
      return reply.code(400).send({ error: 'participant is required' });
    }
    if (!body?.role || body.role.trim().length === 0) {
      return reply.code(400).send({ error: 'role is required' });
    }

    const pool = createPool();
    const result = await pool.query(
      `INSERT INTO work_item_participant (work_item_id, participant, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (work_item_id, participant, role)
       DO UPDATE SET participant = EXCLUDED.participant
       RETURNING id::text as id, work_item_id::text as work_item_id, participant, role, created_at`,
      [params.id, body.participant.trim(), body.role.trim()]
    );
    await pool.end();
    return reply.code(201).send(result.rows[0]);
  });

  app.delete('/api/work-items/:id/participants/:participantId', async (req, reply) => {
    const params = req.params as { id: string; participantId: string };
    const pool = createPool();
    const result = await pool.query(
      `DELETE FROM work_item_participant
        WHERE id = $1
          AND work_item_id = $2
      RETURNING id::text as id`,
      [params.participantId, params.id]
    );
    await pool.end();
    if (result.rows.length === 0) return reply.code(404).send({ error: 'not found' });
    return reply.code(204).send();
  });

  app.get('/api/work-items/:id/links', async (req, reply) => {
    const params = req.params as { id: string };
    const pool = createPool();
    const result = await pool.query(
      `SELECT id::text as id,
              work_item_id::text as work_item_id,
              provider,
              url,
              external_id,
              github_owner,
              github_repo,
              github_kind,
              github_number,
              github_node_id,
              github_project_node_id,
              created_at
         FROM work_item_external_link
        WHERE work_item_id = $1
        ORDER BY created_at DESC`,
      [params.id]
    );
    await pool.end();
    return reply.send({ items: result.rows });
  });

  app.post('/api/work-items/:id/links', async (req, reply) => {
    const params = req.params as { id: string };
    const body = req.body as {
      provider?: string;
      url?: string;
      externalId?: string;
      githubOwner?: string;
      githubRepo?: string;
      githubKind?: string;
      githubNumber?: number;
      githubNodeId?: string | null;
      githubProjectNodeId?: string | null;
    };

    if (!body?.provider || body.provider.trim().length === 0) {
      return reply.code(400).send({ error: 'provider is required' });
    }
    if (!body?.url || body.url.trim().length === 0) {
      return reply.code(400).send({ error: 'url is required' });
    }
    if (!body?.externalId || body.externalId.trim().length === 0) {
      return reply.code(400).send({ error: 'externalId is required' });
    }

    const provider = body.provider.trim();
    if (provider === 'github') {
      if (!body.githubOwner || !body.githubRepo || !body.githubKind) {
        return reply.code(400).send({ error: 'githubOwner, githubRepo, and githubKind are required' });
      }
      if (body.githubKind !== 'project' && !body.githubNumber) {
        return reply.code(400).send({ error: 'githubNumber is required for issues and PRs' });
      }
    }

    const pool = createPool();
    const result = await pool.query(
      `INSERT INTO work_item_external_link
        (work_item_id, provider, url, external_id, github_owner, github_repo, github_kind, github_number, github_node_id, github_project_node_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id::text as id,
                 work_item_id::text as work_item_id,
                 provider,
                 url,
                 external_id,
                 github_owner,
                 github_repo,
                 github_kind,
                 github_number,
                 github_node_id,
                 github_project_node_id,
                 created_at`,
      [
        params.id,
        provider,
        body.url.trim(),
        body.externalId.trim(),
        body.githubOwner?.trim() ?? null,
        body.githubRepo?.trim() ?? null,
        body.githubKind ?? null,
        body.githubNumber ?? null,
        body.githubNodeId ?? null,
        body.githubProjectNodeId ?? null,
      ]
    );
    await pool.end();
    return reply.code(201).send(result.rows[0]);
  });

  app.delete('/api/work-items/:id/links/:linkId', async (req, reply) => {
    const params = req.params as { id: string; linkId: string };
    const pool = createPool();
    const result = await pool.query(
      `DELETE FROM work_item_external_link
        WHERE id = $1
          AND work_item_id = $2
      RETURNING id::text as id`,
      [params.linkId, params.id]
    );
    await pool.end();
    if (result.rows.length === 0) return reply.code(404).send({ error: 'not found' });
    return reply.code(204).send();
  });

  app.post('/api/work-items/:id/dependencies', async (req, reply) => {
    const params = req.params as { id: string };
    const body = req.body as { dependsOnWorkItemId?: string; kind?: string };
    if (!body?.dependsOnWorkItemId) {
      return reply.code(400).send({ error: 'dependsOnWorkItemId is required' });
    }

    const dependsOnWorkItemId = body.dependsOnWorkItemId;

    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidRe.test(dependsOnWorkItemId)) {
      return reply.code(400).send({ error: 'dependsOnWorkItemId must be a UUID' });
    }

    if (dependsOnWorkItemId === params.id) {
      return reply.code(400).send({ error: 'dependency cannot reference itself' });
    }

    const kind = body.kind ?? 'depends_on';

    const pool = createPool();

    // Ensure both nodes exist so we can return a 4xx instead of relying on FK errors.
    const a = await pool.query(`SELECT 1 FROM work_item WHERE id = $1`, [params.id]);
    if (a.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'not found' });
    }

    const b = await pool.query(`SELECT 1 FROM work_item WHERE id = $1`, [dependsOnWorkItemId]);
    if (b.rows.length === 0) {
      await pool.end();
      return reply.code(400).send({ error: 'dependsOn work item not found' });
    }

    // Reject cycles for ordering/precedence relationships.
    const cycle = await pool.query(
      `WITH RECURSIVE walk(id) AS (
         SELECT depends_on_work_item_id
           FROM work_item_dependency
          WHERE work_item_id = $1
            AND kind = $3
         UNION
         SELECT dep.depends_on_work_item_id
           FROM work_item_dependency dep
           JOIN walk w ON w.id = dep.work_item_id
          WHERE dep.kind = $3
       )
       SELECT 1 FROM walk WHERE id = $2 LIMIT 1`,
      [dependsOnWorkItemId, params.id, kind]
    );

    if (cycle.rows.length > 0) {
      await pool.end();
      return reply.code(400).send({ error: 'dependency would create a cycle' });
    }

    const result = await pool.query(
      `INSERT INTO work_item_dependency (work_item_id, depends_on_work_item_id, kind)
       VALUES ($1, $2, $3)
       RETURNING id::text as id, work_item_id::text as work_item_id, depends_on_work_item_id::text as depends_on_work_item_id, kind`,
      [params.id, dependsOnWorkItemId, kind]
    );

    // Minimal scheduling: when establishing a precedence dependency, ensure the dependent cannot start
    // before the latest end (or start, if no end is defined) of its blockers.
    if (kind === 'depends_on') {
      const latest = await pool.query(
        `SELECT MAX(COALESCE(wi.not_after, wi.not_before)) as latest_blocker_time
           FROM work_item_dependency wid
           JOIN work_item wi ON wi.id = wid.depends_on_work_item_id
          WHERE wid.work_item_id = $1
            AND wid.kind = 'depends_on'`,
        [params.id]
      );

      const latestBlockerTimeUnknown: unknown = (latest.rows[0] as { latest_blocker_time: unknown } | undefined)
        ?.latest_blocker_time;

      let latestBlockerTimeIso: string | null = null;
      if (latestBlockerTimeUnknown instanceof Date) {
        latestBlockerTimeIso = latestBlockerTimeUnknown.toISOString();
      } else if (typeof latestBlockerTimeUnknown === 'string') {
        const parsed = new Date(latestBlockerTimeUnknown);
        if (!Number.isNaN(parsed.getTime())) {
          latestBlockerTimeIso = parsed.toISOString();
        }
      }

      if (latestBlockerTimeIso) {
        await pool.query(
          `UPDATE work_item
              SET not_before = CASE
                                WHEN not_before IS NULL OR not_before < $2::timestamptz THEN $2::timestamptz
                                ELSE not_before
                              END,
                  updated_at = now()
            WHERE id = $1`,
          [params.id, latestBlockerTimeIso]
        );
      }
    }

    await pool.end();

    return reply.code(201).send(result.rows[0]);
  });

  app.post('/api/contacts', async (req, reply) => {
    const body = req.body as { displayName?: string; notes?: string | null };
    if (!body?.displayName || body.displayName.trim().length === 0) {
      return reply.code(400).send({ error: 'displayName is required' });
    }

    const pool = createPool();
    const result = await pool.query(
      `INSERT INTO contact (display_name, notes)
       VALUES ($1, $2)
       RETURNING id::text as id, display_name, notes, created_at, updated_at`,
      [body.displayName.trim(), body.notes ?? null]
    );
    await pool.end();

    return reply.code(201).send(result.rows[0]);
  });

  // GET /api/contacts - List contacts with optional search and pagination
  app.get('/api/contacts', async (req, reply) => {
    const query = req.query as { search?: string; limit?: string; offset?: string };
    const limit = Math.min(parseInt(query.limit || '50', 10), 100);
    const offset = parseInt(query.offset || '0', 10);
    const search = query.search?.trim() || null;

    const pool = createPool();

    // Build query with optional search
    let whereClause = '';
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (search) {
      whereClause = `WHERE c.display_name ILIKE $${paramIndex} OR EXISTS (
        SELECT 1 FROM contact_endpoint ce2 WHERE ce2.contact_id = c.id AND ce2.endpoint_value ILIKE $${paramIndex}
      )`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Get total count
    const countResult = await pool.query(
      `SELECT COUNT(DISTINCT c.id) as total FROM contact c ${whereClause}`,
      params
    );
    const total = parseInt((countResult.rows[0] as { total: string }).total, 10);

    // Get contacts with endpoints
    const result = await pool.query(
      `SELECT c.id::text as id, c.display_name, c.notes, c.created_at,
              COALESCE(
                json_agg(
                  json_build_object('type', ce.endpoint_type::text, 'value', ce.endpoint_value)
                ) FILTER (WHERE ce.id IS NOT NULL),
                '[]'::json
              ) as endpoints
       FROM contact c
       LEFT JOIN contact_endpoint ce ON ce.contact_id = c.id
       ${whereClause}
       GROUP BY c.id
       ORDER BY c.display_name
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    await pool.end();

    return reply.send({ contacts: result.rows, total });
  });

  // GET /api/contacts/:id - Get single contact with endpoints
  app.get('/api/contacts/:id', async (req, reply) => {
    const params = req.params as { id: string };
    const pool = createPool();

    const result = await pool.query(
      `SELECT c.id::text as id, c.display_name, c.notes, c.created_at, c.updated_at,
              COALESCE(
                json_agg(
                  json_build_object('type', ce.endpoint_type::text, 'value', ce.endpoint_value)
                ) FILTER (WHERE ce.id IS NOT NULL),
                '[]'::json
              ) as endpoints
       FROM contact c
       LEFT JOIN contact_endpoint ce ON ce.contact_id = c.id
       WHERE c.id = $1
       GROUP BY c.id`,
      [params.id]
    );

    await pool.end();

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'not found' });
    }

    return reply.send(result.rows[0]);
  });

  // PATCH /api/contacts/:id - Update contact
  app.patch('/api/contacts/:id', async (req, reply) => {
    const params = req.params as { id: string };
    const body = req.body as { displayName?: string; notes?: string | null };

    const pool = createPool();

    // Check if contact exists
    const existing = await pool.query('SELECT id FROM contact WHERE id = $1', [params.id]);
    if (existing.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'not found' });
    }

    // Build update query
    const updates: string[] = [];
    const values: (string | null)[] = [];
    let paramIndex = 1;

    if (body.displayName !== undefined) {
      updates.push(`display_name = $${paramIndex}`);
      values.push(body.displayName.trim());
      paramIndex++;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'notes')) {
      updates.push(`notes = $${paramIndex}`);
      values.push(body.notes ?? null);
      paramIndex++;
    }

    if (updates.length === 0) {
      await pool.end();
      return reply.code(400).send({ error: 'no fields to update' });
    }

    updates.push('updated_at = now()');
    values.push(params.id);

    const result = await pool.query(
      `UPDATE contact SET ${updates.join(', ')} WHERE id = $${paramIndex}
       RETURNING id::text as id, display_name, notes, created_at, updated_at`,
      values
    );

    await pool.end();
    return reply.send(result.rows[0]);
  });

  // DELETE /api/contacts/:id - Delete contact
  app.delete('/api/contacts/:id', async (req, reply) => {
    const params = req.params as { id: string };
    const pool = createPool();

    const result = await pool.query(
      'DELETE FROM contact WHERE id = $1 RETURNING id::text as id',
      [params.id]
    );

    await pool.end();

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'not found' });
    }

    return reply.code(204).send();
  });

  // GET /api/contacts/:id/work-items - Get work items associated with a contact
  app.get('/api/contacts/:id/work-items', async (req, reply) => {
    const params = req.params as { id: string };
    const pool = createPool();

    // Check if contact exists
    const existing = await pool.query('SELECT id FROM contact WHERE id = $1', [params.id]);
    if (existing.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'not found' });
    }

    // Get work items linked via external_thread -> work_item_communication
    // A contact is linked to work items through: contact_endpoint -> external_thread -> work_item_communication -> work_item
    const result = await pool.query(
      `SELECT DISTINCT wi.id::text as id, wi.title, wi.status, wi.kind, wi.created_at
       FROM work_item wi
       JOIN work_item_communication wic ON wic.work_item_id = wi.id
       JOIN external_thread et ON et.id = wic.thread_id
       JOIN contact_endpoint ce ON ce.endpoint_type = et.channel AND ce.normalized_value = et.external_thread_key
       WHERE ce.contact_id = $1
       ORDER BY wi.created_at DESC`,
      [params.id]
    );

    await pool.end();
    return reply.send({ work_items: result.rows });
  });

  app.post('/api/contacts/:id/endpoints', async (req, reply) => {
    const params = req.params as { id: string };
    const body = req.body as {
      endpointType?: string;
      endpointValue?: string;
      metadata?: unknown;
    };

    if (!body?.endpointType || !body?.endpointValue) {
      return reply.code(400).send({ error: 'endpointType and endpointValue are required' });
    }

    const pool = createPool();

    const inserted = await pool.query(
      `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value, metadata)
       VALUES ($1, $2::contact_endpoint_type, $3, COALESCE($4::jsonb, '{}'::jsonb))
       RETURNING id::text as id, contact_id::text as contact_id, endpoint_type::text as endpoint_type,
                 endpoint_value, normalized_value, metadata`,
      [params.id, body.endpointType, body.endpointValue, body.metadata ? JSON.stringify(body.metadata) : null]
    );

    await pool.end();
    return reply.code(201).send(inserted.rows[0]);
  });

  // Ingestion: create (or reuse) contact+endpoint, create (or reuse) thread, insert message.
  app.post('/api/ingest/external-message', async (req, reply) => {
    const body = req.body as {
      contactDisplayName?: string;
      endpointType?: string;
      endpointValue?: string;
      externalThreadKey?: string;
      externalMessageKey?: string;
      direction?: 'inbound' | 'outbound';
      messageBody?: string | null;
      raw?: unknown;
      receivedAt?: string;
    };

    if (!body?.endpointType || !body?.endpointValue) {
      return reply.code(400).send({ error: 'endpointType and endpointValue are required' });
    }

    if (!body?.externalThreadKey || !body?.externalMessageKey || !body?.direction) {
      return reply
        .code(400)
        .send({ error: 'externalThreadKey, externalMessageKey, and direction are required' });
    }

    const pool = createPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const displayName = (body.contactDisplayName || 'Unknown').trim();

      // Try to find an existing endpoint (unique on (endpoint_type, normalized_value))
      const existingEndpoint = await client.query(
        `SELECT ce.id::text as id, ce.contact_id::text as contact_id
           FROM contact_endpoint ce
          WHERE ce.endpoint_type = $1::contact_endpoint_type
            AND ce.normalized_value = normalize_contact_endpoint_value($1::contact_endpoint_type, $2)
          LIMIT 1`,
        [body.endpointType, body.endpointValue]
      );

      let contactId: string;
      let endpointId: string;

      if (existingEndpoint.rows.length > 0) {
        endpointId = existingEndpoint.rows[0].id;
        contactId = existingEndpoint.rows[0].contact_id;
      } else {
        const contact = await client.query(
          `INSERT INTO contact (display_name)
           VALUES ($1)
           RETURNING id::text as id`,
          [displayName.length > 0 ? displayName : 'Unknown']
        );
        contactId = contact.rows[0].id;

        const endpoint = await client.query(
          `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value)
           VALUES ($1, $2::contact_endpoint_type, $3)
           RETURNING id::text as id`,
          [contactId, body.endpointType, body.endpointValue]
        );
        endpointId = endpoint.rows[0].id;
      }

      const thread = await client.query(
        `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
         VALUES ($1, $2::contact_endpoint_type, $3)
         ON CONFLICT (channel, external_thread_key)
         DO UPDATE SET endpoint_id = EXCLUDED.endpoint_id, updated_at = now()
         RETURNING id::text as id`,
        [endpointId, body.endpointType, body.externalThreadKey]
      );
      const threadId = thread.rows[0].id as string;

      const message = await client.query(
        `INSERT INTO external_message (thread_id, external_message_key, direction, body, raw, received_at)
         VALUES ($1, $2, $3::message_direction, $4, COALESCE($5::jsonb, '{}'::jsonb), COALESCE($6::timestamptz, now()))
         ON CONFLICT (thread_id, external_message_key)
         DO UPDATE SET body = EXCLUDED.body
         RETURNING id::text as id`,
        [
          threadId,
          body.externalMessageKey,
          body.direction,
          body.messageBody ?? null,
          body.raw ? JSON.stringify(body.raw) : null,
          body.receivedAt ?? null,
        ]
      );
      const messageId = message.rows[0].id as string;

      await client.query('COMMIT');
      return reply.code(201).send({
        contactId,
        endpointId,
        threadId,
        messageId,
      });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
      await pool.end();
    }
  });

  return app;
}
