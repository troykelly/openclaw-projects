import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { createHash, randomBytes } from 'node:crypto';
import { createPool } from '../db.js';
import { sendMagicLinkEmail } from '../email/magicLink.js';
import {
  renderDashboardHome,
  renderInbox,
  renderLogin,
  renderWorkItemDetail,
  renderWorkItemNew,
  renderWorkItemsList,
} from './dashboard.js';

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
    reply.code(200).header('content-type', 'text/html; charset=utf-8').send(renderLogin());
    return null;
  }

  app.get('/health', async () => ({ ok: true }));

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
        await pool.end();
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
        return reply.redirect('/dashboard');
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

  app.get('/api/work-items', async (_req, reply) => {
    const pool = createPool();
    const result = await pool.query(
      `SELECT id::text as id, title, status, priority::text as priority, task_type::text as task_type,
              created_at, updated_at
         FROM work_item
        ORDER BY created_at DESC
        LIMIT 50`
    );
    await pool.end();
    return reply.send({ items: result.rows });
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

  app.get('/dashboard', async (req, reply) => {
    const email = await getSessionEmail(req);
    const html = email ? renderDashboardHome({ email }) : renderLogin();
    return reply.code(200).header('content-type', 'text/html; charset=utf-8').send(html);
  });

  app.get('/dashboard/inbox', async (req, reply) => {
    const email = await requireDashboardSession(req, reply);
    if (!email) return;
    return reply.code(200).header('content-type', 'text/html; charset=utf-8').send(renderInbox({ email }));
  });

  app.get('/dashboard/work-items', async (req, reply) => {
    const email = await requireDashboardSession(req, reply);
    if (!email) return;
    return reply
      .code(200)
      .header('content-type', 'text/html; charset=utf-8')
      .send(renderWorkItemsList({ email }));
  });

  app.get('/dashboard/work-items/new', async (req, reply) => {
    const email = await requireDashboardSession(req, reply);
    if (!email) return;
    return reply.code(200).header('content-type', 'text/html; charset=utf-8').send(renderWorkItemNew({ email }));
  });

  app.get('/dashboard/work-items/:id', async (req, reply) => {
    const email = await requireDashboardSession(req, reply);
    if (!email) return;
    return reply
      .code(200)
      .header('content-type', 'text/html; charset=utf-8')
      .send(renderWorkItemDetail({ email }));
  });
  app.post('/api/work-items', async (req, reply) => {
    const body = req.body as { title?: string; description?: string | null };
    if (!body?.title || body.title.trim().length === 0) {
      return reply.code(400).send({ error: 'title is required' });
    }

    const pool = createPool();
    const result = await pool.query(
      `INSERT INTO work_item (title, description)
       VALUES ($1, $2)
       RETURNING id::text as id, title, description, status, priority::text as priority, task_type::text as task_type`,
      [body.title.trim(), body.description ?? null]
    );
    await pool.end();

    return reply.code(201).send(result.rows[0]);
  });

  app.get('/api/work-items/:id', async (req, reply) => {
    const params = req.params as { id: string };
    const pool = createPool();
    const result = await pool.query(
      `SELECT id::text as id, title, description, status, priority::text as priority, task_type::text as task_type,
              created_at, updated_at, not_before, not_after
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
    };

    if (!body?.title || body.title.trim().length === 0) {
      return reply.code(400).send({ error: 'title is required' });
    }

    const pool = createPool();
    const result = await pool.query(
      `UPDATE work_item
          SET title = $2,
              description = $3,
              status = $4,
              priority = $5::work_item_priority,
              task_type = $6::work_item_task_type,
              not_before = $7::timestamptz,
              not_after = $8::timestamptz,
              updated_at = now()
        WHERE id = $1
      RETURNING id::text as id, title, description, status, priority::text as priority, task_type::text as task_type,
                created_at, updated_at, not_before, not_after`,
      [
        params.id,
        body.title.trim(),
        body.description ?? null,
        body.status ?? 'open',
        body.priority ?? 'P2',
        body.taskType ?? 'general',
        body.notBefore ?? null,
        body.notAfter ?? null,
      ]
    );
    await pool.end();

    if (result.rows.length === 0) return reply.code(404).send({ error: 'not found' });
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

  app.post('/api/work-items/:id/dependencies', async (req, reply) => {
    const params = req.params as { id: string };
    const body = req.body as { dependsOnWorkItemId?: string; kind?: string };
    if (!body?.dependsOnWorkItemId) {
      return reply.code(400).send({ error: 'dependsOnWorkItemId is required' });
    }

    const pool = createPool();
    const result = await pool.query(
      `INSERT INTO work_item_dependency (work_item_id, depends_on_work_item_id, kind)
       VALUES ($1, $2, $3)
       RETURNING id::text as id, work_item_id::text as work_item_id, depends_on_work_item_id::text as depends_on_work_item_id, kind`,
      [params.id, body.dependsOnWorkItemId, body.kind ?? 'depends_on']
    );
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
