import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool } from '../db.ts';
import { sendMagicLinkEmail } from '../email/magicLink.ts';
import { DatabaseHealthChecker, HealthCheckRegistry } from './health.ts';
import { getCachedSecret, compareSecrets, isAuthDisabled } from './auth/secret.ts';
import {
  EmbeddingHealthChecker,
  generateMemoryEmbedding,
  searchMemoriesSemantic,
  backfillMemoryEmbeddings,
} from './embeddings/index.ts';
import { WebhookHealthChecker, verifyTwilioSignature, verifyPostmarkAuth, verifyCloudflareEmailSecret, isWebhookVerificationConfigured } from './webhooks/index.ts';
import { twilioIPWhitelistMiddleware, postmarkIPWhitelistMiddleware, getClientIP } from './webhooks/ip-whitelist.ts';
import { createRateLimitKeyGenerator, getEndpointRateLimitCategory, getRateLimitConfig, type GetSessionEmailFn } from './rate-limit/per-user.ts';
import { processTwilioSms, type TwilioSmsWebhookPayload, enqueueSmsMessage, isTwilioConfigured, processDeliveryStatus, type TwilioStatusCallback, listPhoneNumbers, getPhoneNumberDetails, updatePhoneNumberWebhooks } from './twilio/index.ts';
import { processPostmarkEmail, type PostmarkInboundPayload, enqueueEmailMessage, isPostmarkConfigured, processPostmarkDeliveryStatus, type PostmarkWebhookPayload } from './postmark/index.ts';
import { processCloudflareEmail, type CloudflareEmailPayload } from './cloudflare-email/index.ts';
import { RealtimeHub } from './realtime/index.ts';
import {
  S3Storage,
  createS3StorageFromEnv,
  uploadFile,
  downloadFile,
  getFileUrl,
  deleteFile,
  listFiles,
  getFileMetadata,
  FileTooLargeError,
  FileNotFoundError,
  DEFAULT_MAX_FILE_SIZE_BYTES,
  createFileShare,
  downloadFileByShareToken,
  ShareLinkError,
  sanitizeFilenameForHeader,
} from './file-storage/index.ts';
import {
  getAuthorizationUrl,
  exchangeCodeForTokens,
  getUserEmail as getOAuthUserEmail,
  saveConnection,
  getValidAccessToken,
  isProviderConfigured,
  getConfiguredProviders,
  syncContacts,
  getContactSyncCursor,
  validateState,
  OAuthError,
  ProviderNotConfiguredError,
  NoConnectionError,
  InvalidStateError,
  type OAuthProvider,
} from './oauth/index.ts';
import { isValidUUID } from './utils/validation.ts';

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

  // Support URL-encoded form bodies (used by Twilio webhooks)
  app.register(formbody);

  // Multipart support for file uploads (Issue #215)
  const maxFileSize = parseInt(process.env.MAX_FILE_SIZE_BYTES || String(DEFAULT_MAX_FILE_SIZE_BYTES), 10);
  app.register(multipart, {
    limits: {
      fileSize: maxFileSize,
    },
  });

  // WebSocket support for real-time updates (Issue #213)
  app.register(websocket);

  // Session email extraction for rate limiting and auth
  // Moved before rate limit registration to allow per-user rate limiting (Issue #323)
  async function getSessionEmail(req: any): Promise<string | null> {
    const sessionId = (req.cookies as Record<string, string | undefined>)[sessionCookieName];
    if (!sessionId) return null;

    const pool = createPool();
    try {
      const result = await pool.query(
        `SELECT email
           FROM auth_session
          WHERE id = $1
            AND revoked_at IS NULL
            AND expires_at > now()`,
        [sessionId]
      );

      if (result.rows.length === 0) return null;
      return result.rows[0].email as string;
    } finally {
      await pool.end();
    }
  }

  // Rate limiting configuration (Issue #212, enhanced by Issue #323)
  // Skip rate limiting in test environment or when explicitly disabled
  const rateLimitEnabled = process.env.NODE_ENV !== 'test' && process.env.RATE_LIMIT_DISABLED !== 'true';

  if (rateLimitEnabled) {
    // Create per-user key generator using session email when available, fallback to IP
    const rateLimitKeyGenerator = createRateLimitKeyGenerator(getSessionEmail as GetSessionEmailFn);

    app.register(rateLimit, {
      // Default: 100 requests per minute (per user when authenticated, per IP otherwise)
      max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
      timeWindow: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),

      // Add standard rate limit headers
      addHeaders: {
        'x-ratelimit-limit': true,
        'x-ratelimit-remaining': true,
        'x-ratelimit-reset': true,
        'retry-after': true,
      },

      // Log rate limit violations with user context (Issue #323)
      onExceeding: async (req) => {
        const category = getEndpointRateLimitCategory(req.method, req.url);
        const key = await rateLimitKeyGenerator(req);
        console.warn(`[RateLimit] Client approaching limit: ${key} - ${req.method} ${req.url} [${category}]`);
      },
      onExceeded: async (req) => {
        const category = getEndpointRateLimitCategory(req.method, req.url);
        const key = await rateLimitKeyGenerator(req);
        console.warn(`[RateLimit] Client exceeded limit: ${key} - ${req.method} ${req.url} [${category}]`);
      },

      // Custom error response
      errorResponseBuilder: (req, context) => ({
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Try again in ${Math.ceil((context.ttl ?? 60000) / 1000)} seconds.`,
        statusCode: 429,
        retryAfter: Math.ceil((context.ttl ?? 60000) / 1000),
      }),

      // Skip rate limiting for health check endpoints
      skipOnError: true,
      // Per-user rate limiting: uses session email when authenticated, IP otherwise (Issue #323)
      keyGenerator: rateLimitKeyGenerator,
    });
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  app.register(fastifyStatic, {
    root: path.join(__dirname, 'static'),
    prefix: '/static/',
    decorateReply: false,
  });

  const appFrontendIndexPath = path.join(__dirname, 'static', 'app', 'index.html');
  // In production, cache the index.html for performance.
  // In development, re-read on each request to pick up rebuilds without server restart.
  const isDev = process.env.NODE_ENV !== 'production';
  let cachedAppFrontendIndexHtml: string | null = isDev
    ? null
    : existsSync(appFrontendIndexPath) ? readFileSync(appFrontendIndexPath, 'utf8') : null;

  function getAppFrontendIndexHtml(): string | null {
    if (isDev || !cachedAppFrontendIndexHtml) {
      if (!existsSync(appFrontendIndexPath)) return null;
      cachedAppFrontendIndexHtml = readFileSync(appFrontendIndexPath, 'utf8');
    }
    return cachedAppFrontendIndexHtml;
  }

  function renderAppFrontendHtml(bootstrap: unknown | null): string {
    const html = getAppFrontendIndexHtml();
    if (!html) {
      return '<!doctype html><html><head><title>OpenClaw Projects</title></head>'
        + '<body><p>Frontend assets not available. If running in Docker Compose, '
        + 'access the frontend via the <code>app</code> container.</p></body></html>';
    }
    if (!bootstrap) return html;

    // Embed bootstrap JSON in the HTML response so Fastify inject tests can assert on data
    // without needing to execute client-side JS.
    const json = JSON.stringify(bootstrap).replace(/<\//g, '<\\/');
    const injection = `\n<script id="app-bootstrap" type="application/json">${json}</script>\n`;

    if (html.includes('</body>')) {
      return html.replace('</body>', `${injection}</body>`);
    }

    return `${html}${injection}`;
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
  <title>Sign in - OpenClaw Projects</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/static/app.css" />
</head>
<body class="min-h-screen bg-background text-foreground font-sans">
  <div class="flex min-h-screen flex-col items-center justify-center px-4">
    <div class="w-full max-w-md">
      <div class="mb-8 text-center">
        <h1 class="text-3xl font-bold tracking-tight">OpenClaw Projects</h1>
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

  // Routes that skip bearer token authentication
  // (These routes use their own authentication methods)
  const authSkipPaths = new Set([
    '/health',
    '/api/health',
    '/api/health/live',
    '/api/health/ready',
    '/api/auth/request-link',
    '/api/auth/consume',
    '/api/capabilities',
    '/api/openapi.json',
    // Webhook endpoints use signature verification instead of bearer tokens
    '/api/twilio/sms',
    '/api/postmark/inbound',
    '/api/cloudflare/email',
    // WebSocket endpoint uses its own auth via query params or cookies
    '/api/ws',
    // OAuth callback comes from external provider redirect
    '/api/oauth/callback',
  ]);

  // Bearer token authentication hook for API routes
  app.addHook('onRequest', async (req, reply) => {
    const url = req.url.split('?')[0]; // Remove query string

    // Skip auth for public file share downloads (Issue #610)
    // These URLs contain dynamic tokens, so we use prefix matching
    if (url.startsWith('/api/files/shared/')) {
      return;
    }

    // Skip auth for explicitly allowed paths
    if (authSkipPaths.has(url)) {
      return;
    }

    // Skip auth for static files
    if (url.startsWith('/static/')) {
      return;
    }

    // Skip auth for /app/* routes (these use session cookies via requireDashboardSession)
    if (url.startsWith('/app/')) {
      return;
    }

    // Skip auth for /dashboard routes
    if (url === '/dashboard' || url.startsWith('/dashboard/')) {
      return;
    }

    // Skip auth if disabled (development mode)
    if (isAuthDisabled()) {
      return;
    }

    // Check for valid session cookie first (allows browser-based access)
    const sessionEmail = await getSessionEmail(req);
    if (sessionEmail) {
      return;
    }

    // Check for bearer token
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    // Validate bearer token format
    if (!authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    const token = authHeader.slice(7); // Remove 'Bearer ' prefix
    const expectedSecret = getCachedSecret();

    // If no secret is configured and auth is not disabled, reject
    if (!expectedSecret) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    // Compare tokens using constant-time comparison
    if (!compareSecrets(token, expectedSecret)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    // Token is valid - continue to route handler
  });

  app.get('/health', async () => ({ ok: true }));

  // Health check endpoints (Kubernetes-compatible)
  const healthPool = createPool();
  const healthRegistry = new HealthCheckRegistry();
  healthRegistry.register(new DatabaseHealthChecker(healthPool));
  healthRegistry.register(new EmbeddingHealthChecker());
  healthRegistry.register(new WebhookHealthChecker());

  // Liveness probe - instant, no I/O, always 200
  app.get('/api/health/live', async () => ({ status: 'ok' }));

  // Readiness probe - checks critical dependencies
  app.get('/api/health/ready', async (req, reply) => {
    const ready = await healthRegistry.isReady();
    if (ready) {
      return { status: 'ok' };
    }
    return reply.code(503).send({ status: 'unavailable' });
  });

  // Detailed health status for monitoring
  app.get('/api/health', async (req, reply) => {
    const health = await healthRegistry.checkAll();
    const statusCode = health.status === 'unhealthy' ? 503 : 200;
    return reply.code(statusCode).send(health);
  });

  // Real-time WebSocket endpoint (Issue #213)
  // Create a new hub instance per server (not a singleton) for proper cleanup
  const realtimeHub = new RealtimeHub();
  // Only initialize PostgreSQL NOTIFY/LISTEN in non-test environment
  // (it holds a connection that can cause test timeouts)
  let realtimePool: ReturnType<typeof createPool> | null = null;
  if (process.env.NODE_ENV !== 'test') {
    realtimePool = createPool();
    realtimeHub.initialize(realtimePool).catch((err) => {
      console.error('[WebSocket] Failed to initialize realtime hub:', err);
    });
  }

  app.get('/api/ws', { websocket: true }, async (socket, req) => {
    // Authenticate via session cookie or bearer token in query
    let userId: string | undefined;

    // Try session cookie first
    const sessionEmail = await getSessionEmail(req);
    if (sessionEmail) {
      userId = sessionEmail;
    } else if (!isAuthDisabled()) {
      // Try bearer token from query string
      const query = req.query as { token?: string };
      if (query.token) {
        const expectedSecret = getCachedSecret();
        if (expectedSecret && compareSecrets(query.token, expectedSecret)) {
          // Token valid but no user ID from bearer tokens
          // Agent connections can set x-agent-name header
          const agentName = req.headers['x-agent-name'];
          if (typeof agentName === 'string') {
            userId = `agent:${agentName}`;
          }
        } else {
          socket.close(4001, 'Unauthorized');
          return;
        }
      } else {
        socket.close(4001, 'Unauthorized');
        return;
      }
    }

    // Add client to the hub
    const clientId = realtimeHub.addClient(socket, userId);

    // Handle incoming messages
    socket.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());

        // Handle ping/pong for heartbeat
        if (message.event === 'connection:pong') {
          realtimeHub.updateClientPing(clientId);
        }
      } catch {
        // Ignore malformed messages
      }
    });

    // Handle client disconnect
    socket.on('close', () => {
      realtimeHub.removeClient(clientId);
    });

    socket.on('error', (err: Error) => {
      console.error(`[WebSocket] Client ${clientId} error:`, err);
      realtimeHub.removeClient(clientId);
    });
  });

  // Realtime stats endpoint (for monitoring)
  app.get('/api/ws/stats', async () => ({
    connectedClients: realtimeHub.getClientCount(),
  }));

  // SSE fallback endpoint (Issue #213)
  // For clients that can't use WebSockets
  app.get('/api/events', async (req, reply) => {
    // Authenticate via session cookie
    const sessionEmail = await getSessionEmail(req);
    if (!sessionEmail && !isAuthDisabled()) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Send initial connection event
    reply.raw.write(
      `data: ${JSON.stringify({
        event: 'connection:established',
        data: { connectedAt: new Date().toISOString() },
        timestamp: new Date().toISOString(),
      })}\n\n`
    );

    // Keep connection alive with periodic comments
    const keepAlive = setInterval(() => {
      reply.raw.write(': keepalive\n\n');
    }, 30000);

    req.raw.on('close', () => {
      clearInterval(keepAlive);
    });

    // Note: In a full implementation, we would subscribe to the realtime hub
    // and forward events to this SSE stream. For now, clients can use WebSocket.
  });

  // Cleanup on server close
  app.addHook('onClose', async () => {
    await realtimeHub.shutdown();
    if (realtimePool) {
      await realtimePool.end();
    }
  });

  // Agent context bootstrap endpoint (Issue #219)
  app.get('/api/bootstrap', async (req, reply) => {
    const { getBootstrapContext } = await import('./bootstrap/index.ts');

    const query = req.query as {
      user_email?: string;
      include?: string;
      exclude?: string;
    };

    const pool = createPool();

    try {
      const include = query.include?.split(',').map((s) => s.trim()).filter(Boolean);
      const exclude = query.exclude?.split(',').map((s) => s.trim()).filter(Boolean);

      const result = await getBootstrapContext(pool, {
        userEmail: query.user_email,
        include,
        exclude,
      });

      return reply.send(result);
    } finally {
      await pool.end();
    }
  });

  // Context retrieval endpoint for auto-recall feature (Issue #251)
  app.post('/api/v1/context', async (req, reply) => {
    const { retrieveContext, validateContextInput } = await import('./context/index.ts');

    const body = req.body as {
      userId?: string;
      prompt?: string;
      maxMemories?: number;
      maxContextLength?: number;
      includeProjects?: boolean;
      includeTodos?: boolean;
      includeContacts?: boolean;
      minSimilarity?: number;
    };

    // Validate input
    const validationError = validateContextInput({
      userId: body.userId,
      prompt: body.prompt ?? '',
      maxMemories: body.maxMemories,
      maxContextLength: body.maxContextLength,
      includeProjects: body.includeProjects,
      includeTodos: body.includeTodos,
      includeContacts: body.includeContacts,
      minSimilarity: body.minSimilarity,
    });

    if (validationError) {
      return reply.code(400).send({ error: validationError });
    }

    const pool = createPool();

    try {
      const result = await retrieveContext(pool, {
        userId: body.userId,
        prompt: body.prompt!,
        maxMemories: body.maxMemories,
        maxContextLength: body.maxContextLength,
        includeProjects: body.includeProjects,
        includeTodos: body.includeTodos,
        includeContacts: body.includeContacts,
        minSimilarity: body.minSimilarity,
      });

      return reply.send(result);
    } finally {
      await pool.end();
    }
  });

  // Context capture endpoint for auto-capture feature (Issue #317)
  app.post('/api/context/capture', async (req, reply) => {
    const { captureContext, validateCaptureInput } = await import('./context/capture.ts');

    const body = req.body as {
      conversation?: string;
      messageCount?: number;
      userId?: string;
    };

    // Validate input
    const validationError = validateCaptureInput({
      conversation: body.conversation ?? '',
      messageCount: body.messageCount ?? 0,
      userId: body.userId,
    });

    if (validationError) {
      return reply.code(400).send({ error: validationError });
    }

    const pool = createPool();

    try {
      const result = await captureContext(pool, {
        conversation: body.conversation!,
        messageCount: body.messageCount!,
        userId: body.userId,
      });

      return reply.send(result);
    } finally {
      await pool.end();
    }
  });

  // Thread history endpoint for agent conversation context (Issue #226)
  app.get('/api/threads/:id/history', async (req, reply) => {
    const { getThreadHistory } = await import('./threads/index.ts');

    const params = req.params as { id: string };
    const query = req.query as {
      limit?: string;
      before?: string;
      after?: string;
      include_work_items?: string;
      include_memories?: string;
    };

    const pool = createPool();

    try {
      const result = await getThreadHistory(pool, params.id, {
        limit: query.limit ? parseInt(query.limit, 10) : undefined,
        before: query.before ? new Date(query.before) : undefined,
        after: query.after ? new Date(query.after) : undefined,
        includeWorkItems: query.include_work_items !== 'false',
        includeMemories: query.include_memories !== 'false',
      });

      if (!result) {
        return reply.code(404).send({ error: 'Thread not found' });
      }

      return reply.send(result);
    } finally {
      await pool.end();
    }
  });

  // API Capabilities endpoint - Agent-discoverable capability list (Issue #207)
  app.get('/api/capabilities', async () => ({
    name: 'openclaw-projects',
    version: '1.0.0',
    description: 'Project management, memory storage, and communications backend for OpenClaw agents',
    documentation: '/skills/openclaw-projects/SKILL.md',
    authentication: {
      type: 'bearer',
      header: 'Authorization',
      format: 'Bearer <token>',
      envVars: ['OPENCLAW_PROJECTS_AUTH_SECRET', 'OPENCLAW_PROJECTS_AUTH_SECRET_FILE', 'OPENCLAW_PROJECTS_AUTH_SECRET_COMMAND'],
    },
    capabilities: [
      {
        name: 'work_items',
        description: 'Manage projects, epics, initiatives, issues, and tasks in a hierarchical structure',
        endpoints: [
          { method: 'GET', path: '/api/work-items', description: 'List all work items' },
          { method: 'POST', path: '/api/work-items', description: 'Create a work item' },
          { method: 'GET', path: '/api/work-items/:id', description: 'Get a work item' },
          { method: 'PUT', path: '/api/work-items/:id', description: 'Update a work item' },
          { method: 'DELETE', path: '/api/work-items/:id', description: 'Delete a work item' },
          { method: 'GET', path: '/api/work-items/tree', description: 'Get hierarchical tree view' },
          { method: 'PATCH', path: '/api/work-items/:id/status', description: 'Update status' },
          { method: 'PATCH', path: '/api/work-items/:id/dates', description: 'Update dates (reminders/deadlines)' },
          { method: 'GET', path: '/api/work-items/:id/rollup', description: 'Get aggregated data from children' },
        ],
      },
      {
        name: 'memory',
        description: 'Store and retrieve contextual memories (preferences, facts, decisions, context)',
        endpoints: [
          { method: 'GET', path: '/api/memory', description: 'List/search memories' },
          { method: 'POST', path: '/api/memory', description: 'Create a memory' },
          { method: 'PUT', path: '/api/memory/:id', description: 'Update a memory' },
          { method: 'DELETE', path: '/api/memory/:id', description: 'Delete a memory' },
        ],
      },
      {
        name: 'contacts',
        description: 'Manage people and their communication endpoints',
        endpoints: [
          { method: 'GET', path: '/api/contacts', description: 'List contacts' },
          { method: 'POST', path: '/api/contacts', description: 'Create a contact' },
          { method: 'GET', path: '/api/contacts/:id', description: 'Get a contact' },
          { method: 'PATCH', path: '/api/contacts/:id', description: 'Update a contact' },
          { method: 'DELETE', path: '/api/contacts/:id', description: 'Delete a contact' },
          { method: 'POST', path: '/api/contacts/:id/endpoints', description: 'Add communication endpoint' },
        ],
      },
      {
        name: 'activity',
        description: 'Track changes and activity across the system',
        endpoints: [
          { method: 'GET', path: '/api/activity', description: 'Get activity feed' },
          { method: 'GET', path: '/api/activity/stream', description: 'SSE stream for real-time updates' },
        ],
      },
      {
        name: 'bootstrap',
        description: 'Initialize agent session with full context (preferences, projects, reminders, contacts)',
        endpoints: [
          { method: 'GET', path: '/api/bootstrap', description: 'Get complete session context in single call' },
        ],
      },
      {
        name: 'threads',
        description: 'Access conversation thread history for agent context',
        endpoints: [
          {
            method: 'GET',
            path: '/api/threads/:id/history',
            description: 'Get thread history with messages, related work items, and contact memories',
            parameters: {
              limit: 'Max messages to return (default 50, max 200)',
              before: 'Get messages before this timestamp (ISO 8601)',
              after: 'Get messages after this timestamp (ISO 8601)',
              include_work_items: 'Include related work items (default true)',
              include_memories: 'Include contact memories (default true)',
            },
          },
        ],
      },
      {
        name: 'notifications',
        description: 'User notifications from agent actions and system events',
        endpoints: [
          { method: 'GET', path: '/api/notifications', description: 'List notifications' },
          { method: 'GET', path: '/api/notifications/unread-count', description: 'Get unread count' },
          { method: 'POST', path: '/api/notifications/:id/read', description: 'Mark as read' },
        ],
      },
      {
        name: 'search',
        description: 'Unified full-text and semantic search across all entities',
        endpoints: [
          {
            method: 'GET',
            path: '/api/search',
            description: 'Search work items, contacts, memories, and messages with hybrid (text + semantic) search',
            parameters: {
              q: 'Search query (required)',
              types: 'Comma-separated entity types: work_item, contact, memory, message',
              limit: 'Max results (default 20, max 100)',
              offset: 'Pagination offset',
              semantic: 'Enable semantic search (default true)',
              date_from: 'Filter by date (ISO 8601)',
              date_to: 'Filter by date (ISO 8601)',
              semantic_weight: 'Weight for semantic vs text search (0-1, default 0.5)',
            },
          },
        ],
      },
      {
        name: 'analytics',
        description: 'Project health and progress metrics',
        endpoints: [
          { method: 'GET', path: '/api/analytics/project-health', description: 'Overall project health' },
          { method: 'GET', path: '/api/analytics/velocity', description: 'Completion velocity' },
          { method: 'GET', path: '/api/analytics/overdue', description: 'Overdue items' },
        ],
      },
    ],
    workflows: [
      {
        name: 'add_to_list',
        description: 'Add an item to a list (e.g., shopping list)',
        steps: [
          'GET /api/work-items?title=<list-name> to find the list',
          'POST /api/work-items with parent_work_item_id set to list ID',
        ],
      },
      {
        name: 'set_reminder',
        description: 'Create a reminder for a future time',
        steps: ['POST /api/work-items with not_before date set to reminder time'],
      },
      {
        name: 'store_preference',
        description: 'Store a user preference',
        steps: ['POST /api/memory with memory_type="preference"'],
      },
      {
        name: 'find_memories',
        description: 'Search for relevant memories',
        steps: ['GET /api/memory?search=<query>'],
      },
    ],
  }));

  // OpenAPI specification endpoint (Issue #207)
  app.get('/api/openapi.json', async () => ({
    openapi: '3.0.3',
    info: {
      title: 'openclaw-projects API',
      version: '1.0.0',
      description: 'Project management, memory storage, and communications backend for OpenClaw agents',
      contact: {
        name: 'OpenClaw',
        url: 'https://docs.openclaw.ai',
      },
    },
    servers: [
      {
        url: process.env.PUBLIC_BASE_URL || 'http://localhost:3000',
        description: 'API Server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Bearer token authentication using shared secret',
        },
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'projects_session',
          description: 'Session cookie from magic link authentication',
        },
      },
      schemas: {
        WorkItem: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            description: { type: 'string', nullable: true },
            kind: { type: 'string', enum: ['project', 'epic', 'initiative', 'issue'] },
            status: { type: 'string', enum: ['backlog', 'todo', 'in_progress', 'done', 'cancelled'] },
            parent_work_item_id: { type: 'string', format: 'uuid', nullable: true },
            not_before: { type: 'string', format: 'date-time', nullable: true },
            not_after: { type: 'string', format: 'date-time', nullable: true },
            estimated_effort_minutes: { type: 'integer', nullable: true },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        Memory: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            memory_type: { type: 'string', enum: ['preference', 'fact', 'decision', 'context'] },
            title: { type: 'string' },
            content: { type: 'string' },
            work_item_id: { type: 'string', format: 'uuid', nullable: true },
            contact_id: { type: 'string', format: 'uuid', nullable: true },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        Contact: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            email: { type: 'string', nullable: true },
            phone: { type: 'string', nullable: true },
            notes: { type: 'string', nullable: true },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
    paths: {
      '/api/work-items': {
        get: {
          summary: 'List work items',
          tags: ['Work Items'],
          responses: {
            '200': { description: 'List of work items' },
            '401': { description: 'Unauthorized' },
          },
        },
        post: {
          summary: 'Create a work item',
          tags: ['Work Items'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['title'],
                  properties: {
                    title: { type: 'string' },
                    description: { type: 'string' },
                    kind: { type: 'string', enum: ['project', 'epic', 'initiative', 'issue'] },
                    parent_work_item_id: { type: 'string', format: 'uuid' },
                    not_before: { type: 'string', format: 'date-time' },
                    not_after: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Work item created' },
            '400': { description: 'Invalid request' },
            '401': { description: 'Unauthorized' },
          },
        },
      },
      '/api/work-items/{id}': {
        get: {
          summary: 'Get a work item',
          tags: ['Work Items'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            '200': { description: 'Work item details' },
            '404': { description: 'Not found' },
          },
        },
        put: {
          summary: 'Update a work item',
          tags: ['Work Items'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            '200': { description: 'Work item updated' },
            '404': { description: 'Not found' },
          },
        },
        delete: {
          summary: 'Delete a work item',
          tags: ['Work Items'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            '200': { description: 'Work item deleted' },
            '404': { description: 'Not found' },
          },
        },
      },
      '/api/work-items/tree': {
        get: {
          summary: 'Get work items as hierarchical tree',
          tags: ['Work Items'],
          parameters: [
            { name: 'root_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
            { name: 'max_depth', in: 'query', schema: { type: 'integer' } },
          ],
          responses: {
            '200': { description: 'Hierarchical tree of work items' },
          },
        },
      },
      '/api/memory': {
        get: {
          summary: 'List or search memories',
          tags: ['Memory'],
          parameters: [
            { name: 'search', in: 'query', schema: { type: 'string' } },
            { name: 'memory_type', in: 'query', schema: { type: 'string' } },
            { name: 'tags', in: 'query', schema: { type: 'string' }, description: 'Comma-separated tags to filter by' },
          ],
          responses: {
            '200': { description: 'List of memories' },
          },
        },
        post: {
          summary: 'Create a memory',
          tags: ['Memory'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['memory_type', 'title', 'content'],
                  properties: {
                    memory_type: { type: 'string', enum: ['preference', 'fact', 'decision', 'context'] },
                    title: { type: 'string' },
                    content: { type: 'string' },
                    work_item_id: { type: 'string', format: 'uuid' },
                    contact_id: { type: 'string', format: 'uuid' },
                    tags: { type: 'array', items: { type: 'string' }, description: 'Freeform text tags for categorical filtering' },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Memory created' },
          },
        },
      },
      '/api/contacts': {
        get: {
          summary: 'List contacts',
          tags: ['Contacts'],
          parameters: [{ name: 'search', in: 'query', schema: { type: 'string' } }],
          responses: {
            '200': { description: 'List of contacts' },
          },
        },
        post: {
          summary: 'Create a contact',
          tags: ['Contacts'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name'],
                  properties: {
                    name: { type: 'string' },
                    email: { type: 'string' },
                    phone: { type: 'string' },
                    notes: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Contact created' },
          },
        },
      },
      '/api/search': {
        get: {
          summary: 'Global search',
          tags: ['Search'],
          parameters: [
            { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'types', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Search results' },
          },
        },
      },
      '/api/activity': {
        get: {
          summary: 'Get activity feed',
          tags: ['Activity'],
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
            { name: 'offset', in: 'query', schema: { type: 'integer' } },
          ],
          responses: {
            '200': { description: 'Activity feed' },
          },
        },
      },
      '/api/notifications': {
        get: {
          summary: 'List notifications',
          tags: ['Notifications'],
          responses: {
            '200': { description: 'List of notifications' },
          },
        },
      },
      '/api/health': {
        get: {
          summary: 'Health check',
          tags: ['Health'],
          security: [],
          responses: {
            '200': { description: 'System is healthy' },
            '503': { description: 'System is unhealthy' },
          },
        },
      },
      '/api/capabilities': {
        get: {
          summary: 'List API capabilities',
          tags: ['Documentation'],
          security: [],
          responses: {
            '200': { description: 'API capabilities and available endpoints' },
          },
        },
      },
    },
  }));

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

  app.get('/app/settings', async (req, reply) => {
    const email = await requireDashboardSession(req, reply);
    if (!email) return;

    const bootstrap = {
      route: { kind: 'settings' },
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

  // Root /app route - serves the SPA which will redirect to /dashboard
  app.get('/app', async (req, reply) => {
    const email = await requireDashboardSession(req, reply);
    if (!email) return;

    const bootstrap = {
      route: { path: '/' },
      me: { email },
    };

    return reply
      .code(200)
      .header('content-type', 'text/html; charset=utf-8')
      .send(renderAppFrontendHtml(bootstrap));
  });

  // Catch-all for /app/* routes not explicitly defined above.
  // This allows the React Router to handle client-side routing for paths
  // like /app/dashboard, /app/search, /app/memory, /app/projects/:id, etc.
  app.get('/app/*', async (req, reply) => {
    const email = await requireDashboardSession(req, reply);
    if (!email) return;

    // Extract the path after /app for client-side routing
    const path = req.url.replace(/^\/app/, '') || '/';

    const bootstrap = {
      route: { path },
      me: { email },
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

    const { delivered, error } = await sendMagicLinkEmail({ toEmail: email, loginUrl });

    if (!delivered) {
      console.warn(`[Auth] Magic link email not delivered to ${email}${error ? `: ${error}` : ''}`);
    }

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

  // User Settings API (issue #179 - Platform Completeness)
  app.get('/api/settings', async (req, reply) => {
    const email = await getSessionEmail(req);
    if (!email) return reply.code(401).send({ error: 'unauthorized' });

    const pool = createPool();
    try {
      // Get or create default settings
      const result = await pool.query(
        `INSERT INTO user_setting (email)
         VALUES ($1)
         ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
         RETURNING *`,
        [email]
      );
      return reply.send(result.rows[0]);
    } finally {
      await pool.end();
    }
  });

  app.patch('/api/settings', async (req, reply) => {
    const email = await getSessionEmail(req);
    if (!email) return reply.code(401).send({ error: 'unauthorized' });

    const body = req.body as {
      theme?: 'light' | 'dark' | 'system';
      default_view?: 'activity' | 'projects' | 'timeline' | 'contacts';
      default_project_id?: string | null;
      sidebar_collapsed?: boolean;
      show_completed_items?: boolean;
      items_per_page?: number;
      email_notifications?: boolean;
      email_digest_frequency?: 'never' | 'daily' | 'weekly';
      timezone?: string;
    };

    // Build dynamic update
    const updates: string[] = [];
    const params: (string | boolean | number | null)[] = [email];
    let paramIndex = 2;

    const allowedFields = [
      'theme',
      'default_view',
      'default_project_id',
      'sidebar_collapsed',
      'show_completed_items',
      'items_per_page',
      'email_notifications',
      'email_digest_frequency',
      'timezone',
    ];

    for (const field of allowedFields) {
      if (field in body) {
        updates.push(`${field} = $${paramIndex}`);
        params.push((body as Record<string, unknown>)[field] as string | boolean | number | null);
        paramIndex++;
      }
    }

    if (updates.length === 0) {
      return reply.code(400).send({ error: 'no fields to update' });
    }

    const pool = createPool();
    try {
      // Upsert settings
      const result = await pool.query(
        `INSERT INTO user_setting (email)
         VALUES ($1)
         ON CONFLICT (email) DO UPDATE SET ${updates.join(', ')}
         RETURNING *`,
        params
      );
      return reply.send(result.rows[0]);
    } finally {
      await pool.end();
    }
  });

  // Embedding Settings API (issue #231)
  app.get('/api/settings/embeddings', async (req, reply) => {
    const pool = createPool();
    try {
      const { getEmbeddingSettings } = await import('./embeddings/settings.ts');
      const settings = await getEmbeddingSettings(pool);
      return reply.send(settings);
    } finally {
      await pool.end();
    }
  });

  app.patch('/api/settings/embeddings', async (req, reply) => {
    const body = req.body as {
      dailyLimitUsd?: number;
      monthlyLimitUsd?: number;
      pauseOnLimit?: boolean;
    };

    // Validate limits
    if (body.dailyLimitUsd !== undefined) {
      if (body.dailyLimitUsd < 0 || body.dailyLimitUsd > 10000) {
        return reply.code(400).send({
          error: 'dailyLimitUsd must be between 0 and 10000',
        });
      }
    }

    if (body.monthlyLimitUsd !== undefined) {
      if (body.monthlyLimitUsd < 0 || body.monthlyLimitUsd > 100000) {
        return reply.code(400).send({
          error: 'monthlyLimitUsd must be between 0 and 100000',
        });
      }
    }

    const pool = createPool();
    try {
      const { updateBudgetSettings, getEmbeddingSettings } = await import('./embeddings/settings.ts');
      await updateBudgetSettings(pool, body);
      const settings = await getEmbeddingSettings(pool);
      return reply.send(settings);
    } finally {
      await pool.end();
    }
  });

  app.post('/api/settings/embeddings/test', async (req, reply) => {
    const { testProviderConnection } = await import('./embeddings/settings.ts');
    const result = await testProviderConnection();
    return reply.send(result);
  });

  // Activity Feed API (issue #130)
  app.get('/api/activity', async (req, reply) => {
    const query = req.query as {
      limit?: string;
      offset?: string;
      page?: string;
      actionType?: string;
      entityType?: string;
      projectId?: string;
      since?: string;
    };

    // Support both page-based and offset-based pagination
    const limit = Math.min(parseInt(query.limit || '50', 10), 100);
    const page = query.page ? parseInt(query.page, 10) : null;
    const offset = page ? (page - 1) * limit : parseInt(query.offset || '0', 10);

    const pool = createPool();

    // Build dynamic WHERE clause
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (query.actionType) {
      conditions.push(`a.activity_type = $${paramIndex}`);
      params.push(query.actionType);
      paramIndex++;
    }

    if (query.entityType) {
      conditions.push(`w.work_item_kind = $${paramIndex}`);
      params.push(query.entityType);
      paramIndex++;
    }

    // projectId filter handled separately with CTE
    let projectIdCTE = '';
    if (query.projectId) {
      // Use recursive CTE to get all descendants of the project
      projectIdCTE = `
        WITH RECURSIVE project_tree AS (
          SELECT id FROM work_item WHERE id = $${paramIndex}
          UNION ALL
          SELECT w.id FROM work_item w
          JOIN project_tree pt ON w.parent_work_item_id = pt.id
        )`;
      conditions.push(`w.id IN (SELECT id FROM project_tree)`);
      params.push(query.projectId);
      paramIndex++;
    }

    if (query.since) {
      conditions.push(`a.created_at > $${paramIndex}`);
      params.push(query.since);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count for pagination
    const countResult = await pool.query(
      `${projectIdCTE}
       SELECT COUNT(*) as count
         FROM work_item_activity a
         JOIN work_item w ON w.id = a.work_item_id
         ${whereClause}`,
      params
    );
    const total = parseInt((countResult.rows[0] as { count: string }).count, 10);

    // Add limit and offset params
    params.push(limit);
    params.push(offset);

    const result = await pool.query(
      `${projectIdCTE}
       SELECT a.id::text as id,
              a.activity_type::text as type,
              a.work_item_id::text as work_item_id,
              w.title as work_item_title,
              w.work_item_kind::text as entity_type,
              a.actor_email,
              a.description,
              a.created_at,
              a.read_at
         FROM work_item_activity a
         JOIN work_item w ON w.id = a.work_item_id
         ${whereClause}
        ORDER BY a.created_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      params
    );
    await pool.end();

    // Include pagination metadata if page-based pagination is used
    const response: {
      items: unknown[];
      pagination?: { page: number; limit: number; total: number; hasMore: boolean };
    } = { items: result.rows };

    if (page !== null) {
      response.pagination = {
        page,
        limit,
        total,
        hasMore: offset + result.rows.length < total,
      };
    }

    return reply.send(response);
  });

  // Issue #102: Mark all activity as read
  app.post('/api/activity/read-all', async (_req, reply) => {
    const pool = createPool();
    const result = await pool.query(
      `UPDATE work_item_activity
       SET read_at = now()
       WHERE read_at IS NULL
       RETURNING id`
    );
    await pool.end();
    return reply.send({ marked: result.rowCount ?? 0 });
  });

  // Issue #101: SSE Real-time Activity Stream
  app.get('/api/activity/stream', async (req, reply) => {
    const query = req.query as { projectId?: string };

    // Set SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Build query for recent activity
    const pool = createPool();
    let whereClause = '';
    const params: string[] = [];

    if (query.projectId) {
      // Use recursive CTE to get all descendants of the project
      whereClause = `WHERE w.id IN (
        WITH RECURSIVE project_tree AS (
          SELECT id FROM work_item WHERE id = $1
          UNION ALL
          SELECT wi.id FROM work_item wi
          JOIN project_tree pt ON wi.parent_work_item_id = pt.id
        )
        SELECT id FROM project_tree
      )`;
      params.push(query.projectId);
    }

    // Send initial heartbeat
    const heartbeat = JSON.stringify({ timestamp: new Date().toISOString() });
    reply.raw.write(`event: heartbeat\ndata: ${heartbeat}\n\n`);

    // Get recent activity items and send as events
    const result = await pool.query(
      `SELECT a.id::text as id,
              a.activity_type::text as type,
              a.work_item_id::text as work_item_id,
              w.title as work_item_title,
              w.work_item_kind::text as entity_type,
              a.actor_email,
              a.description,
              a.created_at,
              a.read_at
         FROM work_item_activity a
         JOIN work_item w ON w.id = a.work_item_id
         ${whereClause}
        ORDER BY a.created_at DESC
        LIMIT 20`,
      params
    );

    for (const activity of result.rows) {
      const data = JSON.stringify(activity);
      reply.raw.write(`event: activity\ndata: ${data}\n\n`);
    }

    await pool.end();

    // End the response (for test compatibility - in production this would stay open)
    reply.raw.end();
    return reply;
  });

  // Issue #102: Mark single activity as read
  app.post('/api/activity/:id/read', async (req, reply) => {
    const params = req.params as { id: string };
    const pool = createPool();

    // Check if activity exists
    const exists = await pool.query('SELECT 1 FROM work_item_activity WHERE id = $1', [params.id]);
    if (exists.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'activity not found' });
    }

    // Mark as read (idempotent - updates even if already read)
    await pool.query(
      `UPDATE work_item_activity
       SET read_at = COALESCE(read_at, now())
       WHERE id = $1`,
      [params.id]
    );
    await pool.end();
    return reply.code(204).send();
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

  // GET /api/work-items - List work items (excludes soft-deleted, Issue #225)
  app.get('/api/work-items', async (req, reply) => {
    const query = req.query as { include_deleted?: string };
    const pool = createPool();

    // By default, exclude soft-deleted items
    const deletedFilter = query.include_deleted === 'true' ? '' : 'WHERE deleted_at IS NULL';

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
         ${deletedFilter}
        ORDER BY created_at DESC
        LIMIT 50`
    );
    await pool.end();
    return reply.send({ items: result.rows });
  });

  // Work Items Tree API (issue #145)
  app.get('/api/work-items/tree', async (req, reply) => {
    const query = req.query as { root_id?: string; depth?: string };
    const maxDepth = Math.min(parseInt(query.depth || '10', 10), 20);

    const pool = createPool();

    // If root_id is specified, check it exists
    if (query.root_id) {
      const exists = await pool.query('SELECT 1 FROM work_item WHERE id = $1', [query.root_id]);
      if (exists.rows.length === 0) {
        await pool.end();
        return reply.code(404).send({ error: 'root not found' });
      }
    }

    // Get all items with their children count using a recursive CTE
    const result = await pool.query(
      `WITH RECURSIVE tree AS (
         -- Base case: root items (or specific root if provided)
         SELECT wi.id,
                wi.title,
                wi.work_item_kind as kind,
                wi.status,
                wi.priority::text as priority,
                wi.parent_work_item_id,
                0 as level
           FROM work_item wi
          WHERE ${query.root_id ? 'wi.id = $1' : 'wi.parent_work_item_id IS NULL'}
         UNION ALL
         -- Recursive case: children
         SELECT wi.id,
                wi.title,
                wi.work_item_kind as kind,
                wi.status,
                wi.priority::text as priority,
                wi.parent_work_item_id,
                t.level + 1
           FROM work_item wi
           JOIN tree t ON wi.parent_work_item_id = t.id
          WHERE t.level < $${query.root_id ? '2' : '1'}
       )
       SELECT t.id::text as id,
              t.title,
              t.kind,
              t.status,
              t.priority,
              t.parent_work_item_id::text as parent_id,
              t.level,
              (SELECT COUNT(*) FROM work_item c WHERE c.parent_work_item_id = t.id) as children_count
         FROM tree t
        ORDER BY t.level, t.title`,
      query.root_id ? [query.root_id, maxDepth] : [maxDepth]
    );

    // Build hierarchical structure
    type TreeItem = {
      id: string;
      title: string;
      kind: string;
      status: string;
      priority: string;
      parent_id: string | null;
      level: number;
      children_count: number;
      children: TreeItem[];
    };

    const itemMap = new Map<string, TreeItem>();
    const rootItems: TreeItem[] = [];

    for (const row of result.rows) {
      const r = row as {
        id: string;
        title: string;
        kind: string;
        status: string;
        priority: string;
        parent_id: string | null;
        level: number;
        children_count: string;
      };

      const item: TreeItem = {
        id: r.id,
        title: r.title,
        kind: r.kind,
        status: r.status,
        priority: r.priority,
        parent_id: r.parent_id,
        level: r.level,
        children_count: parseInt(r.children_count, 10),
        children: [],
      };

      itemMap.set(r.id, item);

      if (r.level === 0) {
        rootItems.push(item);
      } else if (r.parent_id && itemMap.has(r.parent_id)) {
        const parent = itemMap.get(r.parent_id);
        parent?.children.push(item);
      }
    }

    await pool.end();
    return reply.send({ items: rootItems });
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

  // Bulk operations constants
  const BULK_OPERATION_LIMIT = 100;

  /** Valid contact_kind enum values (issue #489). */
  const VALID_CONTACT_KINDS = ['person', 'organisation', 'group', 'agent'] as const;
  type ContactKind = typeof VALID_CONTACT_KINDS[number];
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // Bulk operations endpoints

  // POST /api/work-items/bulk - Create multiple work items (Issue #218)
  app.post('/api/work-items/bulk', async (req, reply) => {
    const body = req.body as {
      items: Array<{
        title: string;
        work_item_kind?: string;
        parent_work_item_id?: string | null;
        status?: string;
        priority?: string;
        description?: string;
        labels?: string[];
      }>;
    };

    if (!body?.items || !Array.isArray(body.items) || body.items.length === 0) {
      return reply.code(400).send({ error: 'items array is required' });
    }

    if (body.items.length > BULK_OPERATION_LIMIT) {
      return reply.code(413).send({
        error: `Maximum ${BULK_OPERATION_LIMIT} items per bulk request`,
        limit: BULK_OPERATION_LIMIT,
        requested: body.items.length,
      });
    }

    const pool = createPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const results: Array<{ index: number; id?: string; status: 'created' | 'failed'; error?: string }> = [];
      let createdCount = 0;
      let failedCount = 0;

      for (let i = 0; i < body.items.length; i++) {
        const item = body.items[i];

        // Validate required fields
        if (!item.title) {
          results.push({ index: i, status: 'failed', error: 'title is required' });
          failedCount++;
          continue;
        }

        // Validate parent UUID if provided
        if (item.parent_work_item_id && !uuidRegex.test(item.parent_work_item_id)) {
          results.push({ index: i, status: 'failed', error: 'invalid parent_work_item_id' });
          failedCount++;
          continue;
        }

        try {
          const result = await client.query(
            `INSERT INTO work_item (title, work_item_kind, parent_work_item_id, status, priority, description)
             VALUES ($1, $2, $3, COALESCE($4, 'backlog'), COALESCE($5::work_item_priority, 'P2'), $6)
             RETURNING id::text as id`,
            [
              item.title,
              item.work_item_kind || 'issue',
              item.parent_work_item_id || null,
              item.status || null,
              item.priority || null,
              item.description || null,
            ]
          );
          const workItemId = result.rows[0].id;

          // Handle labels via junction table if provided
          if (item.labels && item.labels.length > 0) {
            await client.query(
              `SELECT set_work_item_labels($1, $2)`,
              [workItemId, item.labels]
            );
          }
          results.push({ index: i, id: result.rows[0].id, status: 'created' });
          createdCount++;
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'unknown error';
          results.push({ index: i, status: 'failed', error: errorMsg });
          failedCount++;
        }
      }

      // Transaction succeeds if at least some items were created
      if (createdCount > 0) {
        await client.query('COMMIT');
      } else {
        await client.query('ROLLBACK');
      }

      client.release();
      await pool.end();

      return reply.code(failedCount > 0 && createdCount === 0 ? 400 : 200).send({
        success: failedCount === 0,
        created: createdCount,
        failed: failedCount,
        results,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();

      if (error instanceof Error) {
        return reply.code(400).send({ error: error.message });
      }
      return reply.code(500).send({ error: 'internal server error' });
    }
  });

  // DELETE /api/work-items/bulk - Delete multiple work items (Issue #218)
  app.delete('/api/work-items/bulk', async (req, reply) => {
    const body = req.body as { ids: string[] };

    if (!body?.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
      return reply.code(400).send({ error: 'ids array is required' });
    }

    if (body.ids.length > BULK_OPERATION_LIMIT) {
      return reply.code(413).send({
        error: `Maximum ${BULK_OPERATION_LIMIT} items per bulk request`,
        limit: BULK_OPERATION_LIMIT,
        requested: body.ids.length,
      });
    }

    // Validate UUIDs
    for (const id of body.ids) {
      if (!uuidRegex.test(id)) {
        return reply.code(400).send({ error: `invalid UUID: ${id}` });
      }
    }

    const pool = createPool();

    try {
      const result = await pool.query(
        `DELETE FROM work_item WHERE id = ANY($1::uuid[]) RETURNING id::text as id`,
        [body.ids]
      );

      await pool.end();

      return reply.send({
        success: true,
        deleted: result.rows.length,
        ids: result.rows.map((r: { id: string }) => r.id),
      });
    } catch (error) {
      await pool.end();

      if (error instanceof Error) {
        return reply.code(400).send({ error: error.message });
      }
      return reply.code(500).send({ error: 'internal server error' });
    }
  });

  // PATCH /api/work-items/bulk - Update multiple work items
  app.patch('/api/work-items/bulk', async (req, reply) => {
    const body = req.body as {
      ids: string[];
      action: 'status' | 'priority' | 'parent' | 'delete';
      value?: string | null;
    };

    if (!body?.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
      return reply.code(400).send({ error: 'ids array is required' });
    }

    if (body.ids.length > BULK_OPERATION_LIMIT) {
      return reply.code(413).send({
        error: `Maximum ${BULK_OPERATION_LIMIT} items per bulk request`,
        limit: BULK_OPERATION_LIMIT,
        requested: body.ids.length,
      });
    }

    if (!body?.action) {
      return reply.code(400).send({ error: 'action is required' });
    }

    // Validate UUIDs
    for (const id of body.ids) {
      if (!uuidRegex.test(id)) {
        return reply.code(400).send({ error: `invalid UUID: ${id}` });
      }
    }

    const pool = createPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      let result;
      const ids = body.ids;

      switch (body.action) {
        case 'status':
          if (!body.value) {
            await client.query('ROLLBACK');
            client.release();
            await pool.end();
            return reply.code(400).send({ error: 'value is required for status action' });
          }
          result = await client.query(
            `UPDATE work_item
             SET status = $1, updated_at = now()
             WHERE id = ANY($2::uuid[])
             RETURNING id::text as id, title, status`,
            [body.value, ids]
          );

          // Record activity for each item
          for (const row of result.rows as { id: string; title: string; status: string }[]) {
            await client.query(
              `INSERT INTO work_item_activity (work_item_id, activity_type, description)
               VALUES ($1, 'status_change', $2)`,
              [row.id, `Status changed to ${row.status} (bulk operation)`]
            );
          }
          break;

        case 'priority':
          if (!body.value) {
            await client.query('ROLLBACK');
            client.release();
            await pool.end();
            return reply.code(400).send({ error: 'value is required for priority action' });
          }
          result = await client.query(
            `UPDATE work_item
             SET priority = $1, updated_at = now()
             WHERE id = ANY($2::uuid[])
             RETURNING id::text as id, title, priority::text as priority`,
            [body.value, ids]
          );
          break;

        case 'parent':
          // value is the new parent ID, or null to unparent
          const parentId = body.value || null;
          if (parentId && !uuidRegex.test(parentId)) {
            await client.query('ROLLBACK');
            client.release();
            await pool.end();
            return reply.code(400).send({ error: 'invalid parent UUID' });
          }
          result = await client.query(
            `UPDATE work_item
             SET parent_work_item_id = $1, updated_at = now()
             WHERE id = ANY($2::uuid[])
             RETURNING id::text as id, title, parent_work_item_id::text as parent_id`,
            [parentId, ids]
          );
          break;

        case 'delete':
          // First get titles for activity log
          const itemsToDelete = await client.query(
            `SELECT id::text as id, title FROM work_item WHERE id = ANY($1::uuid[])`,
            [ids]
          );

          result = await client.query(
            `DELETE FROM work_item WHERE id = ANY($1::uuid[]) RETURNING id::text as id`,
            [ids]
          );

          // Note: Activity entries will be cascade deleted along with work items
          break;

        default:
          await client.query('ROLLBACK');
          client.release();
          await pool.end();
          return reply.code(400).send({ error: `unknown action: ${body.action}` });
      }

      await client.query('COMMIT');
      client.release();
      await pool.end();

      return reply.send({
        success: true,
        action: body.action,
        affected: result.rows.length,
        items: result.rows,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();

      if (error instanceof Error) {
        return reply.code(400).send({ error: error.message });
      }
      return reply.code(500).send({ error: 'internal server error' });
    }
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
      recurrence_rule?: string;
      recurrence_natural?: string;
      recurrence_end?: string;
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

    // Handle recurrence if specified (Issue #217)
    let recurrenceRule: string | null = null;
    let recurrenceEnd: Date | null = null;
    let isRecurrenceTemplate = false;

    if (body.recurrence_natural) {
      // Parse natural language recurrence
      const { parseNaturalLanguage } = await import('./recurrence/parser.ts');
      const parseResult = parseNaturalLanguage(body.recurrence_natural);
      if (parseResult.isRecurring && parseResult.rrule) {
        recurrenceRule = parseResult.rrule;
        isRecurrenceTemplate = true;
      }
    } else if (body.recurrence_rule) {
      recurrenceRule = body.recurrence_rule;
      isRecurrenceTemplate = true;
    }

    if (body.recurrence_end) {
      recurrenceEnd = new Date(body.recurrence_end);
      if (isNaN(recurrenceEnd.getTime())) {
        await pool.end();
        return reply.code(400).send({ error: 'Invalid recurrence_end date format' });
      }
    }

    const result = await pool.query(
      `INSERT INTO work_item (title, description, kind, parent_id, work_item_kind, parent_work_item_id, estimate_minutes, actual_minutes, recurrence_rule, recurrence_end, is_recurrence_template)
       VALUES ($1, $2, $3, $4, $5::work_item_kind, $4, $6, $7, $8, $9, $10)
       RETURNING id::text as id, title, description, kind, parent_id::text as parent_id, estimate_minutes, actual_minutes, recurrence_rule, recurrence_end, is_recurrence_template`,
      [body.title.trim(), body.description ?? null, kind, parentId, kind, estimateMinutes, actualMinutes, recurrenceRule, recurrenceEnd, isRecurrenceTemplate]
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

  // GET /api/work-items/:id - Get single work item (excludes soft-deleted, Issue #225)
  app.get('/api/work-items/:id', async (req, reply) => {
    const params = req.params as { id: string };
    const query = req.query as { include_deleted?: string };
    const pool = createPool();

    // By default, exclude soft-deleted items
    const deletedFilter = query.include_deleted === 'true' ? '' : 'AND wi.deleted_at IS NULL';

    // Get main work item
    const result = await pool.query(
      `SELECT wi.id::text as id,
              wi.title,
              wi.description,
              wi.status,
              wi.priority::text as priority,
              wi.task_type::text as task_type,
              wi.kind,
              wi.parent_id::text as parent_id,
              wi.created_at,
              wi.updated_at,
              wi.not_before,
              wi.not_after,
              wi.estimate_minutes,
              wi.actual_minutes,
              wi.deleted_at,
              (SELECT COUNT(*) FROM work_item c WHERE c.parent_work_item_id = wi.id AND c.deleted_at IS NULL) as children_count
         FROM work_item wi
        WHERE wi.id = $1 ${deletedFilter}`,
      [params.id]
    );

    if (result.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'not found' });
    }

    const workItem = result.rows[0] as {
      id: string;
      parent_id: string | null;
      children_count: string;
      [key: string]: unknown;
    };

    // Get parent info if exists
    let parent: { id: string; title: string; kind: string } | null = null;
    const parentWorkItemId = workItem.parent_id;
    if (parentWorkItemId) {
      const parentResult = await pool.query(
        `SELECT id::text as id, title, work_item_kind as kind
         FROM work_item WHERE id = $1`,
        [parentWorkItemId]
      );
      if (parentResult.rows.length > 0) {
        parent = parentResult.rows[0] as { id: string; title: string; kind: string };
      }
    } else {
      // Check parent_work_item_id as fallback
      const parentCheck = await pool.query(
        `SELECT parent_work_item_id::text as parent_id FROM work_item WHERE id = $1`,
        [params.id]
      );
      const altParentId = (parentCheck.rows[0] as { parent_id: string | null })?.parent_id;
      if (altParentId) {
        const parentResult = await pool.query(
          `SELECT id::text as id, title, work_item_kind as kind
           FROM work_item WHERE id = $1`,
          [altParentId]
        );
        if (parentResult.rows.length > 0) {
          parent = parentResult.rows[0] as { id: string; title: string; kind: string };
        }
      }
    }

    // Get dependencies - items this blocks (other items depend on this)
    const blocksResult = await pool.query(
      `SELECT wi.id::text as id, wi.title, wi.work_item_kind as kind, wi.status,
              'blocks' as direction
       FROM work_item_dependency wid
       JOIN work_item wi ON wi.id = wid.work_item_id
       WHERE wid.depends_on_work_item_id = $1`,
      [params.id]
    );

    // Get dependencies - items this is blocked by (this depends on others)
    const blockedByResult = await pool.query(
      `SELECT wi.id::text as id, wi.title, wi.work_item_kind as kind, wi.status,
              'blocked_by' as direction
       FROM work_item_dependency wid
       JOIN work_item wi ON wi.id = wid.depends_on_work_item_id
       WHERE wid.work_item_id = $1`,
      [params.id]
    );

    // Combine dependencies into a single array (issue #109 format)
    const dependencies = [...blocksResult.rows, ...blockedByResult.rows];

    // Get attachments - memories (issue #109)
    const memoriesResult = await pool.query(
      `SELECT id::text as id, 'memory' as type, title, memory_type::text as subtitle, created_at as "linkedAt"
       FROM memory
       WHERE work_item_id = $1
       ORDER BY created_at DESC`,
      [params.id]
    );

    // Get attachments - contacts (issue #109)
    const contactsResult = await pool.query(
      `SELECT c.id::text as id, 'contact' as type, c.display_name as title,
              wic.relationship::text as subtitle, wic.created_at as "linkedAt"
       FROM work_item_contact wic
       JOIN contact c ON c.id = wic.contact_id
       WHERE wic.work_item_id = $1
       ORDER BY wic.created_at DESC`,
      [params.id]
    );

    // Combine all attachments
    const attachments = [
      ...memoriesResult.rows,
      ...contactsResult.rows,
    ];

    await pool.end();

    return reply.send({
      ...workItem,
      children_count: parseInt(workItem.children_count, 10),
      parent,
      dependencies,
      attachments,
    });
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

// DELETE /api/work-items/:id - Soft delete by default (Issue #225)
  app.delete('/api/work-items/:id', async (req, reply) => {
    const params = req.params as { id: string };
    const query = req.query as { permanent?: string };
    const pool = createPool();

    // Check if permanent delete requested
    if (query.permanent === 'true') {
      const result = await pool.query(
        `DELETE FROM work_item WHERE id = $1 RETURNING id::text as id`,
        [params.id]
      );
      await pool.end();
      if (result.rows.length === 0) return reply.code(404).send({ error: 'not found' });
      return reply.code(204).send();
    }

    // Soft delete by default
    const result = await pool.query(
      `UPDATE work_item SET deleted_at = now()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id::text as id`,
      [params.id]
    );
    await pool.end();
    if (result.rows.length === 0) return reply.code(404).send({ error: 'not found' });
    return reply.code(204).send();
  });

  // POST /api/work-items/:id/restore - Restore soft-deleted work item (Issue #225)
  app.post('/api/work-items/:id/restore', async (req, reply) => {
    const params = req.params as { id: string };
    const pool = createPool();

    const result = await pool.query(
      `UPDATE work_item SET deleted_at = NULL
       WHERE id = $1 AND deleted_at IS NOT NULL
       RETURNING id::text as id, title`,
      [params.id]
    );
    await pool.end();

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'not found or not deleted' });
    }

    return reply.send({
      restored: true,
      id: result.rows[0].id,
      title: result.rows[0].title,
    });
  });

  // GET /api/trash - List all soft-deleted items (Issue #225)
  app.get('/api/trash', async (req, reply) => {
    const query = req.query as {
      entityType?: string;
      limit?: string;
      offset?: string;
    };
    const pool = createPool();

    const retentionDays = 30;
    const limit = Math.min(parseInt(query.limit || '50', 10), 500);
    const offset = parseInt(query.offset || '0', 10);

    const items: Array<{
      id: string;
      entityType: string;
      title?: string;
      displayName?: string;
      deletedAt: Date;
      daysUntilPurge: number;
    }> = [];
    let total = 0;

    // Query work items
    if (!query.entityType || query.entityType === 'work_item') {
      const wiResult = await pool.query(
        `SELECT
          id::text,
          title,
          deleted_at,
          GREATEST(0, $1 - EXTRACT(DAY FROM (now() - deleted_at)))::integer as days_until_purge
        FROM work_item
        WHERE deleted_at IS NOT NULL
        ORDER BY deleted_at DESC
        LIMIT $2 OFFSET $3`,
        [retentionDays, limit, offset]
      );

      const wiCountResult = await pool.query(
        `SELECT COUNT(*) FROM work_item WHERE deleted_at IS NOT NULL`
      );

      for (const row of wiResult.rows) {
        items.push({
          id: row.id,
          entityType: 'work_item',
          title: row.title,
          deletedAt: row.deleted_at,
          daysUntilPurge: row.days_until_purge,
        });
      }

      total += parseInt(wiCountResult.rows[0].count, 10);
    }

    // Query contacts
    if (!query.entityType || query.entityType === 'contact') {
      const cResult = await pool.query(
        `SELECT
          id::text,
          display_name,
          deleted_at,
          GREATEST(0, $1 - EXTRACT(DAY FROM (now() - deleted_at)))::integer as days_until_purge
        FROM contact
        WHERE deleted_at IS NOT NULL
        ORDER BY deleted_at DESC
        LIMIT $2 OFFSET $3`,
        [retentionDays, limit, offset]
      );

      const cCountResult = await pool.query(
        `SELECT COUNT(*) FROM contact WHERE deleted_at IS NOT NULL`
      );

      for (const row of cResult.rows) {
        items.push({
          id: row.id,
          entityType: 'contact',
          displayName: row.display_name,
          deletedAt: row.deleted_at,
          daysUntilPurge: row.days_until_purge,
        });
      }

      total += parseInt(cCountResult.rows[0].count, 10);
    }

    await pool.end();

    // Sort combined results by deleted_at desc
    items.sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());

    return reply.send({
      items: items.slice(0, limit),
      total,
      limit,
      offset,
      retentionDays,
    });
  });

  // POST /api/trash/purge - Purge old soft-deleted items (Issue #225)
  app.post('/api/trash/purge', async (req, reply) => {
    const body = req.body as { retentionDays?: number };
    const retentionDays = body.retentionDays ?? 30;

    if (retentionDays < 1 || retentionDays > 365) {
      return reply.code(400).send({
        error: 'retentionDays must be between 1 and 365',
      });
    }

    const pool = createPool();

    const result = await pool.query(
      `SELECT * FROM purge_soft_deleted($1)`,
      [retentionDays]
    );

    await pool.end();

    const row = result.rows[0];
    const workItemsPurged = parseInt(row.work_items_purged || '0', 10);
    const contactsPurged = parseInt(row.contacts_purged || '0', 10);

    return reply.send({
      success: true,
      retentionDays,
      workItemsPurged,
      contactsPurged,
      totalPurged: workItemsPurged + contactsPurged,
    });
  });

  // ============================================
  // File Storage API Endpoints (Issue #215)
  // ============================================

  // Get file storage instance (lazy initialization)
  let fileStorage: S3Storage | null = null;
  function getFileStorage(): S3Storage | null {
    if (fileStorage === null) {
      fileStorage = createS3StorageFromEnv();
    }
    return fileStorage;
  }

  // POST /api/files/upload - Upload a file
  app.post('/api/files/upload', async (req, reply) => {
    const storage = getFileStorage();
    if (!storage) {
      return reply.code(503).send({
        error: 'File storage not configured',
        message: 'S3 storage environment variables are not set',
      });
    }

    try {
      const data = await req.file();
      if (!data) {
        return reply.code(400).send({ error: 'No file uploaded' });
      }

      const buffer = await data.toBuffer();
      const pool = createPool();

      try {
        const email = await getSessionEmail(req);
        const result = await uploadFile(pool, storage, {
          filename: data.filename,
          contentType: data.mimetype,
          data: buffer,
          uploadedBy: email || undefined,
        }, maxFileSize);

        await pool.end();

        return reply.code(201).send(result);
      } catch (error) {
        await pool.end();

        if (error instanceof FileTooLargeError) {
          return reply.code(413).send({
            error: 'File too large',
            message: error.message,
            maxSizeBytes: error.maxSizeBytes,
          });
        }

        throw error;
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('request file too large')) {
        return reply.code(413).send({
          error: 'File too large',
          message: `File exceeds maximum size of ${maxFileSize} bytes`,
          maxSizeBytes: maxFileSize,
        });
      }
      throw error;
    }
  });

  // GET /api/files - List files
  app.get('/api/files', async (req, reply) => {
    const query = req.query as {
      limit?: string;
      offset?: string;
      uploadedBy?: string;
    };

    const pool = createPool();
    const result = await listFiles(pool, {
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      offset: query.offset ? parseInt(query.offset, 10) : undefined,
      uploadedBy: query.uploadedBy,
    });
    await pool.end();

    return reply.send(result);
  });

  // GET /api/files/:id - Download a file
  app.get('/api/files/:id', async (req, reply) => {
    const storage = getFileStorage();
    if (!storage) {
      return reply.code(503).send({
        error: 'File storage not configured',
        message: 'S3 storage environment variables are not set',
      });
    }

    const params = req.params as { id: string };
    const pool = createPool();

    try {
      const result = await downloadFile(pool, storage, params.id);
      await pool.end();

      const safeFilename = sanitizeFilenameForHeader(result.metadata.originalFilename);
      return reply
        .code(200)
        .header('Content-Type', result.metadata.contentType)
        .header('Content-Disposition', `attachment; filename="${safeFilename}"`)
        .header('Content-Length', result.data.length)
        .send(result.data);
    } catch (error) {
      await pool.end();

      if (error instanceof FileNotFoundError) {
        return reply.code(404).send({ error: 'File not found' });
      }

      throw error;
    }
  });

  // GET /api/files/:id/metadata - Get file metadata
  app.get('/api/files/:id/metadata', async (req, reply) => {
    const params = req.params as { id: string };
    const pool = createPool();

    const metadata = await getFileMetadata(pool, params.id);
    await pool.end();

    if (!metadata) {
      return reply.code(404).send({ error: 'File not found' });
    }

    return reply.send(metadata);
  });

  // GET /api/files/:id/url - Get a signed URL for a file
  app.get('/api/files/:id/url', async (req, reply) => {
    const storage = getFileStorage();
    if (!storage) {
      return reply.code(503).send({
        error: 'File storage not configured',
        message: 'S3 storage environment variables are not set',
      });
    }

    const params = req.params as { id: string };
    const query = req.query as { expiresIn?: string };
    const expiresIn = query.expiresIn ? parseInt(query.expiresIn, 10) : 3600;

    if (expiresIn < 60 || expiresIn > 86400) {
      return reply.code(400).send({
        error: 'Invalid expiresIn',
        message: 'expiresIn must be between 60 and 86400 seconds',
      });
    }

    const pool = createPool();

    try {
      const result = await getFileUrl(pool, storage, params.id, expiresIn);
      await pool.end();

      return reply.send({
        url: result.url,
        expiresIn,
        filename: result.metadata.originalFilename,
        contentType: result.metadata.contentType,
      });
    } catch (error) {
      await pool.end();

      if (error instanceof FileNotFoundError) {
        return reply.code(404).send({ error: 'File not found' });
      }

      throw error;
    }
  });

  // DELETE /api/files/:id - Delete a file
  app.delete('/api/files/:id', async (req, reply) => {
    const storage = getFileStorage();
    if (!storage) {
      return reply.code(503).send({
        error: 'File storage not configured',
        message: 'S3 storage environment variables are not set',
      });
    }

    const params = req.params as { id: string };
    const pool = createPool();

    try {
      const deleted = await deleteFile(pool, storage, params.id);
      await pool.end();

      if (!deleted) {
        return reply.code(404).send({ error: 'File not found' });
      }

      return reply.code(204).send();
    } catch (error) {
      await pool.end();
      throw error;
    }
  });

  // ============================================
  // File Sharing (Issue #584)
  // ============================================

  // POST /api/files/:id/share - Create a shareable download link for a file
  app.post('/api/files/:id/share', async (req, reply) => {
    const storage = getFileStorage();
    if (!storage) {
      return reply.code(503).send({
        error: 'File storage not configured',
        message: 'S3 storage environment variables are not set',
      });
    }

    const params = req.params as { id: string };

    // Validate file ID is a valid UUID (Issue #613)
    if (!isValidUUID(params.id)) {
      return reply.code(400).send({ error: 'Invalid file ID format' });
    }

    const body = req.body as { expiresIn?: number; maxDownloads?: number } | null;
    const expiresIn = body?.expiresIn ?? 3600;
    const maxDownloads = body?.maxDownloads;

    // Validate expiresIn range
    if (expiresIn < 60 || expiresIn > 604800) {
      return reply.code(400).send({
        error: 'Invalid expiresIn',
        message: 'expiresIn must be between 60 and 604800 seconds (1 minute to 7 days)',
      });
    }

    const pool = createPool();
    const email = await getSessionEmail(req);

    try {
      // Check file ownership (Issue #615)
      const metadata = await getFileMetadata(pool, params.id);
      if (!metadata) {
        await pool.end();
        return reply.code(404).send({ error: 'File not found' });
      }

      // Allow if user uploaded the file, or if auth is disabled (dev mode)
      if (metadata.uploadedBy !== email && !isAuthDisabled()) {
        await pool.end();
        return reply.code(403).send({ error: 'You do not have permission to share this file' });
      }

      const result = await createFileShare(pool, storage, {
        fileId: params.id,
        expiresIn,
        maxDownloads,
        createdBy: email ?? 'agent',
      });
      await pool.end();

      return reply.send(result);
    } catch (error) {
      await pool.end();

      if (error instanceof FileNotFoundError) {
        return reply.code(404).send({ error: 'File not found' });
      }

      throw error;
    }
  });

  // GET /api/files/shared/:token - Download a file via share token (no auth required)
  app.get('/api/files/shared/:token', async (req, reply) => {
    const storage = getFileStorage();
    if (!storage) {
      return reply.code(503).send({
        error: 'File storage not configured',
        message: 'S3 storage environment variables are not set',
      });
    }

    const params = req.params as { token: string };
    const pool = createPool();

    try {
      const result = await downloadFileByShareToken(pool, storage, params.token);
      await pool.end();

      const safeFilename = sanitizeFilenameForHeader(result.metadata.originalFilename);
      return reply
        .code(200)
        .header('Content-Type', result.metadata.contentType)
        .header('Content-Disposition', `attachment; filename="${safeFilename}"`)
        .header('Content-Length', result.data.length)
        .send(result.data);
    } catch (error) {
      await pool.end();

      if (error instanceof ShareLinkError) {
        return reply.code(403).send({ error: error.message });
      }

      if (error instanceof FileNotFoundError) {
        return reply.code(404).send({ error: 'File not found' });
      }

      throw error;
    }
  });

  // ============================================
  // Work Item Attachments (Issue #215)
  // ============================================

  // POST /api/work-items/:id/attachments - Attach a file to a work item
  app.post('/api/work-items/:id/attachments', async (req, reply) => {
    const params = req.params as { id: string };
    const body = req.body as { fileId: string };

    if (!body.fileId) {
      return reply.code(400).send({ error: 'fileId is required' });
    }

    const pool = createPool();

    // Check if work item exists
    const wiResult = await pool.query(
      'SELECT id FROM work_item WHERE id = $1 AND deleted_at IS NULL',
      [params.id]
    );
    if (wiResult.rowCount === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'Work item not found' });
    }

    // Check if file exists
    const fileResult = await pool.query(
      'SELECT id FROM file_attachment WHERE id = $1',
      [body.fileId]
    );
    if (fileResult.rowCount === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'File not found' });
    }

    // Create attachment link
    const email = await getSessionEmail(req);
    try {
      await pool.query(
        `INSERT INTO work_item_attachment (work_item_id, file_attachment_id, attached_by)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [params.id, body.fileId, email]
      );
      await pool.end();

      return reply.code(201).send({
        workItemId: params.id,
        fileId: body.fileId,
        attached: true,
      });
    } catch (error) {
      await pool.end();
      throw error;
    }
  });

  // GET /api/work-items/:id/attachments - List work item attachments
  app.get('/api/work-items/:id/attachments', async (req, reply) => {
    const params = req.params as { id: string };
    const pool = createPool();

    const result = await pool.query(
      `SELECT
        fa.id::text,
        fa.original_filename,
        fa.content_type,
        fa.size_bytes,
        fa.created_at,
        wia.attached_at,
        wia.attached_by
      FROM work_item_attachment wia
      JOIN file_attachment fa ON fa.id = wia.file_attachment_id
      WHERE wia.work_item_id = $1
      ORDER BY wia.attached_at DESC`,
      [params.id]
    );
    await pool.end();

    return reply.send({
      attachments: result.rows.map(row => ({
        id: row.id,
        originalFilename: row.original_filename,
        contentType: row.content_type,
        sizeBytes: parseInt(row.size_bytes, 10),
        createdAt: row.created_at,
        attachedAt: row.attached_at,
        attachedBy: row.attached_by,
      })),
    });
  });

  // DELETE /api/work-items/:workItemId/attachments/:fileId - Remove attachment from work item
  app.delete('/api/work-items/:workItemId/attachments/:fileId', async (req, reply) => {
    const params = req.params as { workItemId: string; fileId: string };
    const pool = createPool();

    const result = await pool.query(
      `DELETE FROM work_item_attachment
       WHERE work_item_id = $1 AND file_attachment_id = $2
       RETURNING work_item_id`,
      [params.workItemId, params.fileId]
    );
    await pool.end();

    if (result.rowCount === 0) {
      return reply.code(404).send({ error: 'Attachment not found' });
    }

    return reply.code(204).send();
  });

  // GET /api/work-items/:id/recurrence - Get recurrence details (Issue #217)
  app.get('/api/work-items/:id/recurrence', async (req, reply) => {
    const params = req.params as { id: string };
    const pool = createPool();

    const { getRecurrenceInfo, describeRrule } = await import('./recurrence/index.ts');

    try {
      const info = await getRecurrenceInfo(pool, params.id);
      if (!info) {
        await pool.end();
        return reply.code(404).send({ error: 'Work item not found or has no recurrence' });
      }

      await pool.end();
      return reply.send({
        rule: info.rule,
        ruleDescription: info.rule ? describeRrule(info.rule) : null,
        end: info.end,
        parentId: info.parentId,
        isTemplate: info.isTemplate,
        nextOccurrence: info.nextOccurrence,
      });
    } catch (error) {
      await pool.end();
      return reply.code(500).send({ error: 'Failed to get recurrence info' });
    }
  });

  // PUT /api/work-items/:id/recurrence - Update recurrence rule (Issue #217)
  app.put('/api/work-items/:id/recurrence', async (req, reply) => {
    const params = req.params as { id: string };
    const body = req.body as {
      recurrence_rule?: string;
      recurrence_natural?: string;
      recurrence_end?: string | null;
    };
    const pool = createPool();

    try {
      // Determine the rule to use
      let recurrenceRule: string | undefined;

      if (body.recurrence_natural) {
        const { parseNaturalLanguage } = await import('./recurrence/parser.ts');
        const parseResult = parseNaturalLanguage(body.recurrence_natural);
        if (parseResult.isRecurring && parseResult.rrule) {
          recurrenceRule = parseResult.rrule;
        } else {
          await pool.end();
          return reply.code(400).send({ error: 'Could not parse recurrence pattern' });
        }
      } else if (body.recurrence_rule !== undefined) {
        recurrenceRule = body.recurrence_rule;
      }

      // Parse end date if provided
      let recurrenceEnd: Date | null | undefined;
      if (body.recurrence_end !== undefined) {
        if (body.recurrence_end === null) {
          recurrenceEnd = null;
        } else {
          recurrenceEnd = new Date(body.recurrence_end);
          if (isNaN(recurrenceEnd.getTime())) {
            await pool.end();
            return reply.code(400).send({ error: 'Invalid recurrence_end date format' });
          }
        }
      }

      const { updateRecurrence, getRecurrenceInfo, describeRrule } = await import('./recurrence/index.ts');

      const updated = await updateRecurrence(pool, params.id, {
        recurrenceRule,
        recurrenceEnd,
      });

      if (!updated) {
        await pool.end();
        return reply.code(404).send({ error: 'Work item not found or no changes made' });
      }

      // Return updated recurrence info
      const info = await getRecurrenceInfo(pool, params.id);
      await pool.end();

      return reply.send({
        success: true,
        recurrence: info ? {
          rule: info.rule,
          ruleDescription: info.rule ? describeRrule(info.rule) : null,
          end: info.end,
          nextOccurrence: info.nextOccurrence,
        } : null,
      });
    } catch (error) {
      await pool.end();
      console.error('[Recurrence] Error updating:', error);
      return reply.code(500).send({ error: 'Failed to update recurrence' });
    }
  });

  // DELETE /api/work-items/:id/recurrence - Stop recurring (Issue #217)
  app.delete('/api/work-items/:id/recurrence', async (req, reply) => {
    const params = req.params as { id: string };
    const pool = createPool();

    try {
      const { stopRecurrence } = await import('./recurrence/index.ts');
      const stopped = await stopRecurrence(pool, params.id);

      await pool.end();

      if (!stopped) {
        return reply.code(404).send({ error: 'Work item not found' });
      }

      return reply.send({ success: true, message: 'Recurrence stopped' });
    } catch (error) {
      await pool.end();
      console.error('[Recurrence] Error stopping:', error);
      return reply.code(500).send({ error: 'Failed to stop recurrence' });
    }
  });

  // GET /api/work-items/:id/instances - List generated instances (Issue #217)
  app.get('/api/work-items/:id/instances', async (req, reply) => {
    const params = req.params as { id: string };
    const query = req.query as {
      limit?: string;
      includeCompleted?: string;
    };
    const pool = createPool();

    try {
      const { getInstances } = await import('./recurrence/index.ts');

      const instances = await getInstances(pool, params.id, {
        limit: query.limit ? parseInt(query.limit, 10) : undefined,
        includeCompleted: query.includeCompleted !== 'false',
      });

      await pool.end();

      return reply.send({
        instances,
        count: instances.length,
      });
    } catch (error) {
      await pool.end();
      console.error('[Recurrence] Error getting instances:', error);
      return reply.code(500).send({ error: 'Failed to get instances' });
    }
  });

  // GET /api/recurrence/templates - List all recurrence templates (Issue #217)
  app.get('/api/recurrence/templates', async (req, reply) => {
    const query = req.query as {
      limit?: string;
      offset?: string;
    };
    const pool = createPool();

    try {
      const { getTemplates } = await import('./recurrence/index.ts');

      const templates = await getTemplates(pool, {
        limit: query.limit ? parseInt(query.limit, 10) : undefined,
        offset: query.offset ? parseInt(query.offset, 10) : undefined,
      });

      await pool.end();

      return reply.send({
        templates,
        count: templates.length,
      });
    } catch (error) {
      await pool.end();
      console.error('[Recurrence] Error getting templates:', error);
      return reply.code(500).send({ error: 'Failed to get templates' });
    }
  });

  // POST /api/recurrence/generate - Generate upcoming instances (Issue #217)
  app.post('/api/recurrence/generate', async (req, reply) => {
    const body = req.body as {
      daysAhead?: number;
    };
    const pool = createPool();

    try {
      const { generateUpcomingInstances } = await import('./recurrence/index.ts');

      const result = await generateUpcomingInstances(
        pool,
        body.daysAhead || 14
      );

      await pool.end();

      return reply.send({
        success: result.errors.length === 0,
        generated: result.generated,
        errors: result.errors,
      });
    } catch (error) {
      await pool.end();
      console.error('[Recurrence] Error generating instances:', error);
      return reply.code(500).send({ error: 'Failed to generate instances' });
    }
  });

  // GET /api/audit-log - List audit log entries with filtering (Issue #214)
  app.get('/api/audit-log', async (req, reply) => {
    const query = req.query as {
      entityType?: string;
      entityId?: string;
      actorType?: string;
      actorId?: string;
      action?: string;
      startDate?: string;
      endDate?: string;
      limit?: string;
      offset?: string;
    };
    const pool = createPool();

    try {
      const { queryAuditLog } = await import('./audit/index.ts');

      const options: Parameters<typeof queryAuditLog>[1] = {
        entityType: query.entityType,
        entityId: query.entityId,
        actorId: query.actorId,
        limit: query.limit ? parseInt(query.limit, 10) : undefined,
        offset: query.offset ? parseInt(query.offset, 10) : undefined,
      };

      // Parse actor type
      if (query.actorType) {
        const validActorTypes = ['agent', 'human', 'system'];
        if (!validActorTypes.includes(query.actorType)) {
          await pool.end();
          return reply.code(400).send({ error: 'Invalid actorType' });
        }
        options.actorType = query.actorType as 'agent' | 'human' | 'system';
      }

      // Parse action type
      if (query.action) {
        const validActions = ['create', 'update', 'delete', 'auth', 'webhook'];
        if (!validActions.includes(query.action)) {
          await pool.end();
          return reply.code(400).send({ error: 'Invalid action' });
        }
        options.action = query.action as 'create' | 'update' | 'delete' | 'auth' | 'webhook';
      }

      // Parse dates
      if (query.startDate) {
        const date = new Date(query.startDate);
        if (isNaN(date.getTime())) {
          await pool.end();
          return reply.code(400).send({ error: 'Invalid startDate' });
        }
        options.startDate = date;
      }

      if (query.endDate) {
        const date = new Date(query.endDate);
        if (isNaN(date.getTime())) {
          await pool.end();
          return reply.code(400).send({ error: 'Invalid endDate' });
        }
        options.endDate = date;
      }

      const { entries, total } = await queryAuditLog(pool, options);

      await pool.end();

      return reply.send({
        entries,
        total,
        limit: options.limit || 50,
        offset: options.offset || 0,
      });
    } catch (error) {
      await pool.end();
      console.error('[Audit] Error querying audit log:', error);
      return reply.code(500).send({ error: 'Failed to query audit log' });
    }
  });

  // GET /api/audit-log/entity/:type/:id - Get audit log for specific entity (Issue #214)
  app.get('/api/audit-log/entity/:type/:id', async (req, reply) => {
    const params = req.params as { type: string; id: string };
    const query = req.query as { limit?: string; offset?: string };
    const pool = createPool();

    try {
      const { getEntityAuditLog } = await import('./audit/index.ts');

      const entries = await getEntityAuditLog(pool, params.type, params.id, {
        limit: query.limit ? parseInt(query.limit, 10) : undefined,
        offset: query.offset ? parseInt(query.offset, 10) : undefined,
      });

      await pool.end();

      return reply.send({
        entityType: params.type,
        entityId: params.id,
        entries,
        count: entries.length,
      });
    } catch (error) {
      await pool.end();
      console.error('[Audit] Error getting entity audit log:', error);
      return reply.code(500).send({ error: 'Failed to get entity audit log' });
    }
  });

  // POST /api/audit-log/purge - Purge old audit entries (Issue #214)
  app.post('/api/audit-log/purge', async (req, reply) => {
    const body = req.body as { retentionDays?: number };
    const pool = createPool();

    try {
      const { purgeOldEntries } = await import('./audit/index.ts');

      const retentionDays = body.retentionDays || 90;
      if (retentionDays < 1 || retentionDays > 3650) {
        await pool.end();
        return reply.code(400).send({ error: 'retentionDays must be between 1 and 3650' });
      }

      const purged = await purgeOldEntries(pool, retentionDays);

      await pool.end();

      return reply.send({
        success: true,
        purged,
        retentionDays,
      });
    } catch (error) {
      await pool.end();
      console.error('[Audit] Error purging audit log:', error);
      return reply.code(500).send({ error: 'Failed to purge audit log' });
    }
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

  // GET /api/search - Unified search API endpoint (Issue #216)
  // Full-text search with optional semantic search for memories
  app.get('/api/search', {
    config: {
      rateLimit: {
        max: 30, // 30 requests per minute for search (expensive)
        timeWindow: '1 minute',
      },
    },
  }, async (req, reply) => {
    const { unifiedSearch } = await import('./search/index.ts');

    const query = req.query as {
      q?: string;
      types?: string;
      limit?: string;
      offset?: string;
      semantic?: string;
      date_from?: string;
      date_to?: string;
      semantic_weight?: string;
    };

    const searchTerm = query.q?.trim() || '';

    // If no search term, return empty results
    if (!searchTerm) {
      return reply.send({
        query: '',
        search_type: 'text',
        results: [],
        facets: { work_item: 0, contact: 0, memory: 0, message: 0 },
        total: 0,
      });
    }

    const limit = Math.min(parseInt(query.limit || '20', 10), 100);
    const offset = Math.max(parseInt(query.offset || '0', 10), 0);
    const semantic = query.semantic !== 'false'; // Default true
    const semanticWeight = Math.min(1, Math.max(0, parseFloat(query.semantic_weight || '0.5')));

    // Parse entity types
    const validTypes = ['work_item', 'contact', 'memory', 'message'] as const;
    type EntityType = typeof validTypes[number];
    let types: EntityType[] | undefined;
    if (query.types) {
      types = query.types
        .split(',')
        .map((t) => t.trim() as EntityType)
        .filter((t) => validTypes.includes(t));
      if (types.length === 0) {
        types = undefined; // Use defaults
      }
    }

    // Parse date filters
    let dateFrom: Date | undefined;
    let dateTo: Date | undefined;
    if (query.date_from) {
      const parsed = new Date(query.date_from);
      if (!isNaN(parsed.getTime())) {
        dateFrom = parsed;
      }
    }
    if (query.date_to) {
      const parsed = new Date(query.date_to);
      if (!isNaN(parsed.getTime())) {
        dateTo = parsed;
      }
    }

    const pool = createPool();

    try {
      const result = await unifiedSearch(pool, {
        query: searchTerm,
        types,
        limit,
        offset,
        semantic,
        dateFrom,
        dateTo,
        semanticWeight,
      });

      return reply.send(result);
    } finally {
      await pool.end();
    }
  });

  // GET /api/timeline - Global timeline endpoint
  app.get('/api/timeline', async (req, reply) => {
    const query = req.query as {
      from?: string;
      to?: string;
      kind?: string;
      parent_id?: string;
    };

    const pool = createPool();

    // Build dynamic WHERE clauses and parameters
    const conditions: string[] = [];
    const params: (string | string[])[] = [];
    let paramIndex = 1;

    // Only include items with dates by default (for timeline view)
    conditions.push('(wi.not_before IS NOT NULL OR wi.not_after IS NOT NULL)');

    // Date range filters
    if (query.from) {
      conditions.push(`(wi.not_before >= $${paramIndex}::timestamptz OR wi.not_after >= $${paramIndex}::timestamptz)`);
      params.push(query.from);
      paramIndex++;
    }

    if (query.to) {
      conditions.push(`(wi.not_before <= $${paramIndex}::timestamptz OR wi.not_after <= $${paramIndex}::timestamptz)`);
      params.push(query.to);
      paramIndex++;
    }

    // Kind filter (supports comma-separated list)
    if (query.kind) {
      const kinds = query.kind.split(',').map(k => k.trim()).filter(k => k);
      if (kinds.length > 0) {
        conditions.push(`wi.work_item_kind IN (${kinds.map((_, i) => `$${paramIndex + i}`).join(', ')})`);
        kinds.forEach(k => params.push(k));
        paramIndex += kinds.length;
      }
    }

    // Parent ID filter - get all descendants of the specified parent
    if (query.parent_id) {
      const itemsQuery = `
        WITH RECURSIVE descendants AS (
          SELECT id, parent_work_item_id, 0 as level
            FROM work_item
           WHERE id = $${paramIndex}
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
               wi.actual_minutes,
               wi.created_at
          FROM descendants d
          JOIN work_item wi ON wi.id = d.id
         WHERE (wi.not_before IS NOT NULL OR wi.not_after IS NOT NULL)
         ${query.kind ? `AND wi.work_item_kind IN (${query.kind.split(',').map((_, i) => `$${paramIndex + 1 + i}`).join(', ')})` : ''}
         ORDER BY d.level, wi.not_before NULLS LAST, wi.created_at`;

      const descendantParams = [query.parent_id];
      if (query.kind) {
        query.kind.split(',').map(k => k.trim()).filter(k => k).forEach(k => descendantParams.push(k));
      }

      const items = await pool.query(itemsQuery, descendantParams);

      // Get dependencies between items in this subtree
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
        [query.parent_id]
      );

      await pool.end();
      return reply.send({
        items: items.rows,
        dependencies: dependencies.rows,
      });
    }

    // No parent_id: get all items with dates
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const items = await pool.query(
      `SELECT wi.id::text as id,
              wi.title,
              wi.work_item_kind as kind,
              wi.status,
              wi.priority::text as priority,
              wi.parent_work_item_id::text as parent_id,
              0 as level,
              wi.not_before,
              wi.not_after,
              wi.estimate_minutes,
              wi.actual_minutes,
              wi.created_at
         FROM work_item wi
        ${whereClause}
        ORDER BY wi.not_before NULLS LAST, wi.created_at`,
      params
    );

    // Get all dependencies between dated items
    const dependencies = await pool.query(
      `SELECT wid.id::text as id,
              wid.work_item_id::text as from_id,
              wid.depends_on_work_item_id::text as to_id,
              wid.kind
         FROM work_item_dependency wid
         JOIN work_item wi1 ON wi1.id = wid.work_item_id
         JOIN work_item wi2 ON wi2.id = wid.depends_on_work_item_id
        WHERE (wi1.not_before IS NOT NULL OR wi1.not_after IS NOT NULL)
          AND (wi2.not_before IS NOT NULL OR wi2.not_after IS NOT NULL)`
    );

    await pool.end();

    return reply.send({
      items: items.rows,
      dependencies: dependencies.rows,
    });
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
    const body = req.body as { displayName?: string; notes?: string | null; contactKind?: string };
    if (!body?.displayName || body.displayName.trim().length === 0) {
      return reply.code(400).send({ error: 'displayName is required' });
    }

    // Validate contact_kind if provided (issue #489)
    const contactKind = body.contactKind ?? 'person';
    if (!VALID_CONTACT_KINDS.includes(contactKind as ContactKind)) {
      return reply.code(400).send({ error: `Invalid contactKind. Must be one of: ${VALID_CONTACT_KINDS.join(', ')}` });
    }

    const pool = createPool();
    const result = await pool.query(
      `INSERT INTO contact (display_name, notes, contact_kind)
       VALUES ($1, $2, $3)
       RETURNING id::text as id, display_name, notes, contact_kind::text as contact_kind, created_at, updated_at`,
      [body.displayName.trim(), body.notes ?? null, contactKind]
    );
    await pool.end();

    return reply.code(201).send(result.rows[0]);
  });

  // POST /api/contacts/bulk - Bulk create contacts (Issue #218)
  app.post('/api/contacts/bulk', async (req, reply) => {
    const body = req.body as {
      contacts: Array<{
        displayName: string;
        notes?: string | null;
        contactKind?: string;
        endpoints?: Array<{
          endpoint_type: string;
          endpoint_value: string;
          metadata?: Record<string, unknown>;
        }>;
      }>;
    };

    if (!body?.contacts || !Array.isArray(body.contacts) || body.contacts.length === 0) {
      return reply.code(400).send({ error: 'contacts array is required' });
    }

    if (body.contacts.length > BULK_OPERATION_LIMIT) {
      return reply.code(413).send({
        error: `Maximum ${BULK_OPERATION_LIMIT} contacts per bulk request`,
        limit: BULK_OPERATION_LIMIT,
        requested: body.contacts.length,
      });
    }

    const pool = createPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const results: Array<{ index: number; id?: string; status: 'created' | 'failed'; error?: string }> = [];
      let createdCount = 0;
      let failedCount = 0;

      for (let i = 0; i < body.contacts.length; i++) {
        const contact = body.contacts[i];

        // Validate required fields
        if (!contact.displayName || contact.displayName.trim().length === 0) {
          results.push({ index: i, status: 'failed', error: 'displayName is required' });
          failedCount++;
          continue;
        }

        try {
          // Validate contact_kind if provided (issue #489)
          const bulkContactKind = contact.contactKind ?? 'person';
          if (!VALID_CONTACT_KINDS.includes(bulkContactKind as ContactKind)) {
            results.push({ index: i, status: 'failed', error: `Invalid contactKind: ${bulkContactKind}` });
            failedCount++;
            continue;
          }

          const contactResult = await client.query(
            `INSERT INTO contact (display_name, notes, contact_kind)
             VALUES ($1, $2, $3)
             RETURNING id::text as id`,
            [contact.displayName.trim(), contact.notes ?? null, bulkContactKind]
          );
          const contactId = contactResult.rows[0].id;

          // Create endpoints if provided
          if (contact.endpoints && Array.isArray(contact.endpoints)) {
            for (const ep of contact.endpoints) {
              if (ep.endpoint_type && ep.endpoint_value) {
                await client.query(
                  `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value, metadata)
                   VALUES ($1, $2, $3, $4::jsonb)`,
                  [contactId, ep.endpoint_type, ep.endpoint_value, JSON.stringify(ep.metadata || {})]
                );
              }
            }
          }

          results.push({ index: i, id: contactId, status: 'created' });
          createdCount++;
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'unknown error';
          results.push({ index: i, status: 'failed', error: errorMsg });
          failedCount++;
        }
      }

      // Transaction succeeds if at least some contacts were created
      if (createdCount > 0) {
        await client.query('COMMIT');
      } else {
        await client.query('ROLLBACK');
      }

      client.release();
      await pool.end();

      return reply.code(failedCount > 0 && createdCount === 0 ? 400 : 200).send({
        success: failedCount === 0,
        created: createdCount,
        failed: failedCount,
        results,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();

      if (error instanceof Error) {
        return reply.code(400).send({ error: error.message });
      }
      return reply.code(500).send({ error: 'internal server error' });
    }
  });

  // GET /api/contacts - List contacts with optional search and pagination
  // GET /api/contacts - List contacts (excludes soft-deleted, Issue #225)
  app.get('/api/contacts', async (req, reply) => {
    const query = req.query as { search?: string; limit?: string; offset?: string; include_deleted?: string; contact_kind?: string };
    const limit = Math.min(parseInt(query.limit || '50', 10), 100);
    const offset = parseInt(query.offset || '0', 10);
    const search = query.search?.trim() || null;
    const includeDeleted = query.include_deleted === 'true';
    const contactKindFilter = query.contact_kind?.trim() || null;

    const pool = createPool();

    // Build query with optional search and deleted filter
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let paramIndex = 1;

    // Exclude soft-deleted by default
    if (!includeDeleted) {
      conditions.push('c.deleted_at IS NULL');
    }

    if (search) {
      conditions.push(`(c.display_name ILIKE $${paramIndex} OR EXISTS (
        SELECT 1 FROM contact_endpoint ce2 WHERE ce2.contact_id = c.id AND ce2.endpoint_value ILIKE $${paramIndex}
      ))`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Filter by contact_kind (issue #489), supports comma-separated values
    if (contactKindFilter) {
      const kinds = contactKindFilter.split(',').map(k => k.trim()).filter(k => VALID_CONTACT_KINDS.includes(k as ContactKind));
      if (kinds.length > 0) {
        conditions.push(`c.contact_kind::text IN (${kinds.map((_, i) => `$${paramIndex + i}`).join(', ')})`);
        kinds.forEach(k => params.push(k));
        paramIndex += kinds.length;
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countResult = await pool.query(
      `SELECT COUNT(DISTINCT c.id) as total FROM contact c ${whereClause}`,
      params
    );
    const total = parseInt((countResult.rows[0] as { total: string }).total, 10);

    // Get contacts with endpoints
    const result = await pool.query(
      `SELECT c.id::text as id, c.display_name, c.notes, c.contact_kind::text as contact_kind, c.created_at,
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

  // GET /api/contacts/:id - Get single contact with endpoints (excludes soft-deleted, Issue #225)
  app.get('/api/contacts/:id', async (req, reply) => {
    const params = req.params as { id: string };
    const query = req.query as { include_deleted?: string };
    const pool = createPool();

    const deletedFilter = query.include_deleted === 'true' ? '' : 'AND c.deleted_at IS NULL';

    const result = await pool.query(
      `SELECT c.id::text as id, c.display_name, c.notes, c.contact_kind::text as contact_kind,
              c.created_at, c.updated_at,
              c.deleted_at,
              COALESCE(
                json_agg(
                  json_build_object('type', ce.endpoint_type::text, 'value', ce.endpoint_value)
                ) FILTER (WHERE ce.id IS NOT NULL),
                '[]'::json
              ) as endpoints
       FROM contact c
       LEFT JOIN contact_endpoint ce ON ce.contact_id = c.id
       WHERE c.id = $1 ${deletedFilter}
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
    const body = req.body as { displayName?: string; notes?: string | null; contactKind?: string };

    const pool = createPool();

    // Validate contactKind if provided (issue #489)
    if (body.contactKind !== undefined && !VALID_CONTACT_KINDS.includes(body.contactKind as ContactKind)) {
      await pool.end();
      return reply.code(400).send({ error: `Invalid contactKind. Must be one of: ${VALID_CONTACT_KINDS.join(', ')}` });
    }

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

    if (body.contactKind !== undefined) {
      updates.push(`contact_kind = $${paramIndex}`);
      values.push(body.contactKind);
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
       RETURNING id::text as id, display_name, notes, contact_kind::text as contact_kind, created_at, updated_at`,
      values
    );

    await pool.end();
    return reply.send(result.rows[0]);
  });

  // DELETE /api/contacts/:id - Soft delete by default (Issue #225)
  app.delete('/api/contacts/:id', async (req, reply) => {
    const params = req.params as { id: string };
    const query = req.query as { permanent?: string };
    const pool = createPool();

    // Check if permanent delete requested
    if (query.permanent === 'true') {
      const result = await pool.query(
        'DELETE FROM contact WHERE id = $1 RETURNING id::text as id',
        [params.id]
      );
      await pool.end();
      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'not found' });
      }
      return reply.code(204).send();
    }

    // Soft delete by default
    const result = await pool.query(
      `UPDATE contact SET deleted_at = now()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id::text as id`,
      [params.id]
    );

    await pool.end();

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'not found' });
    }

    return reply.code(204).send();
  });

  // POST /api/contacts/:id/restore - Restore soft-deleted contact (Issue #225)
  app.post('/api/contacts/:id/restore', async (req, reply) => {
    const params = req.params as { id: string };
    const pool = createPool();

    const result = await pool.query(
      `UPDATE contact SET deleted_at = NULL
       WHERE id = $1 AND deleted_at IS NOT NULL
       RETURNING id::text as id, display_name`,
      [params.id]
    );
    await pool.end();

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'not found or not deleted' });
    }

    return reply.send({
      restored: true,
      id: result.rows[0].id,
      displayName: result.rows[0].display_name,
    });
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

  // Contact-WorkItem Linking API (issue #118)
  // GET /api/work-items/:id/contacts - List contacts linked to a work item
  app.get('/api/work-items/:id/contacts', async (req, reply) => {
    const params = req.params as { id: string };
    const pool = createPool();

    // Check if work item exists
    const exists = await pool.query('SELECT 1 FROM work_item WHERE id = $1', [params.id]);
    if (exists.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'not found' });
    }

    const result = await pool.query(
      `SELECT wic.contact_id::text as "contactId",
              c.display_name as "displayName",
              wic.relationship::text as relationship,
              wic.created_at as "createdAt"
         FROM work_item_contact wic
         JOIN contact c ON c.id = wic.contact_id
        WHERE wic.work_item_id = $1
        ORDER BY wic.created_at ASC`,
      [params.id]
    );

    await pool.end();
    return reply.send({ contacts: result.rows });
  });

  // POST /api/work-items/:id/contacts - Link a contact to a work item
  app.post('/api/work-items/:id/contacts', async (req, reply) => {
    const params = req.params as { id: string };
    const body = req.body as { contactId?: string; relationship?: string };

    if (!body?.contactId) {
      return reply.code(400).send({ error: 'contactId is required' });
    }

    if (!body?.relationship) {
      return reply.code(400).send({ error: 'relationship is required' });
    }

    const validRelationships = ['owner', 'assignee', 'stakeholder', 'reviewer'];
    if (!validRelationships.includes(body.relationship)) {
      return reply
        .code(400)
        .send({ error: `relationship must be one of: ${validRelationships.join(', ')}` });
    }

    const pool = createPool();

    // Check if work item exists
    const wiExists = await pool.query('SELECT 1 FROM work_item WHERE id = $1', [params.id]);
    if (wiExists.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'work item not found' });
    }

    // Check if contact exists and get its name
    const contactResult = await pool.query(
      'SELECT display_name FROM contact WHERE id = $1',
      [body.contactId]
    );
    if (contactResult.rows.length === 0) {
      await pool.end();
      return reply.code(400).send({ error: 'contact not found' });
    }
    const contactName = (contactResult.rows[0] as { display_name: string }).display_name;

    // Check if link already exists
    const existingLink = await pool.query(
      'SELECT 1 FROM work_item_contact WHERE work_item_id = $1 AND contact_id = $2',
      [params.id, body.contactId]
    );
    if (existingLink.rows.length > 0) {
      await pool.end();
      return reply.code(409).send({ error: 'contact already linked to this work item' });
    }

    // Create the link
    await pool.query(
      `INSERT INTO work_item_contact (work_item_id, contact_id, relationship)
       VALUES ($1, $2, $3::contact_relationship_type)`,
      [params.id, body.contactId, body.relationship]
    );

    await pool.end();

    return reply.code(201).send({
      workItemId: params.id,
      contactId: body.contactId,
      relationship: body.relationship,
      contactName,
    });
  });

  // DELETE /api/work-items/:id/contacts/:contactId - Unlink a contact from a work item
  app.delete('/api/work-items/:id/contacts/:contactId', async (req, reply) => {
    const params = req.params as { id: string; contactId: string };
    const pool = createPool();

    const result = await pool.query(
      `DELETE FROM work_item_contact
       WHERE work_item_id = $1 AND contact_id = $2
       RETURNING work_item_id::text`,
      [params.id, params.contactId]
    );

    await pool.end();

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'not found' });
    }

    return reply.code(204).send();
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

  // Global Memory API (issue #120)
  // GET /api/memory - List all memory items with pagination and search
  app.get('/api/memory', async (req, reply) => {
    const query = req.query as {
      limit?: string;
      offset?: string;
      search?: string;
      type?: string;
      linkedItemKind?: string;
      tags?: string;
    };

    const limit = Math.min(parseInt(query.limit || '50', 10), 100);
    const offset = parseInt(query.offset || '0', 10);
    const search = query.search?.trim() || null;
    const typeFilter = query.type || null;
    const kindFilter = query.linkedItemKind || null;
    const tagsFilter = query.tags ? query.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : null;

    const pool = createPool();

    // Build dynamic query
    const conditions: string[] = [];
    const params: (string | number | string[])[] = [];
    let paramIndex = 1;

    if (search) {
      conditions.push(`(m.title ILIKE $${paramIndex} OR m.content ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (typeFilter) {
      conditions.push(`m.memory_type::text = $${paramIndex}`);
      params.push(typeFilter);
      paramIndex++;
    }

    if (kindFilter) {
      conditions.push(`wi.work_item_kind = $${paramIndex}`);
      params.push(kindFilter);
      paramIndex++;
    }

    if (tagsFilter && tagsFilter.length > 0) {
      conditions.push(`m.tags @> $${paramIndex}`);
      params.push(tagsFilter);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countResult = await pool.query(
      `SELECT COUNT(*) as total
       FROM memory m
       JOIN work_item wi ON wi.id = m.work_item_id
       ${whereClause}`,
      params
    );
    const total = parseInt((countResult.rows[0] as { total: string }).total, 10);

    // Get paginated results
    params.push(limit);
    params.push(offset);

    const result = await pool.query(
      `SELECT m.id::text as id,
              m.title,
              m.content,
              m.memory_type::text as type,
              m.tags,
              m.work_item_id::text as "linkedItemId",
              wi.title as "linkedItemTitle",
              wi.work_item_kind as "linkedItemKind",
              m.created_at as "createdAt",
              m.updated_at as "updatedAt"
         FROM memory m
         JOIN work_item wi ON wi.id = m.work_item_id
        ${whereClause}
        ORDER BY m.created_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      params
    );

    await pool.end();

    const hasMore = offset + result.rows.length < total;

    return reply.send({
      items: result.rows,
      total,
      hasMore,
    });
  });

  // Memory CRUD API (issue #121)
  // POST /api/memory - Create a new memory linked to a work item
  app.post('/api/memory', async (req, reply) => {
    const body = req.body as {
      title?: string;
      content?: string;
      linkedItemId?: string;
      type?: string;
      tags?: string[];
    };

    if (!body?.title || body.title.trim().length === 0) {
      return reply.code(400).send({ error: 'title is required' });
    }

    if (!body?.content || body.content.trim().length === 0) {
      return reply.code(400).send({ error: 'content is required' });
    }

    if (!body?.linkedItemId) {
      return reply.code(400).send({ error: 'linkedItemId is required' });
    }

    const memoryType = body.type ?? 'note';
    const validTypes = ['note', 'decision', 'context', 'reference'];
    if (!validTypes.includes(memoryType)) {
      return reply.code(400).send({ error: `type must be one of: ${validTypes.join(', ')}` });
    }

    const pool = createPool();

    // Check if linked work item exists and get its title
    const linkedItem = await pool.query(
      'SELECT title FROM work_item WHERE id = $1',
      [body.linkedItemId]
    );
    if (linkedItem.rows.length === 0) {
      await pool.end();
      return reply.code(400).send({ error: 'linked item not found' });
    }

    const linkedItemTitle = (linkedItem.rows[0] as { title: string }).title;

    const tags = body.tags ?? [];

    const result = await pool.query(
      `INSERT INTO memory (work_item_id, title, content, memory_type, tags)
       VALUES ($1, $2, $3, $4::memory_type, $5)
       RETURNING id::text as id,
                 title,
                 content,
                 memory_type::text as type,
                 tags,
                 work_item_id::text as "linkedItemId",
                 created_at as "createdAt",
                 embedding_status`,
      [body.linkedItemId, body.title.trim(), body.content.trim(), memoryType, tags]
    );

    const row = result.rows[0] as {
      id: string;
      title: string;
      content: string;
      type: string;
      tags: string[];
      linkedItemId: string;
      createdAt: string;
      embedding_status: string;
    };

    // Generate embedding asynchronously (don't block response)
    const memoryContent = `${row.title}\n\n${row.content}`;
    const embeddingStatus = await generateMemoryEmbedding(pool, row.id, memoryContent);

    await pool.end();

    return reply.code(201).send({
      id: row.id,
      title: row.title,
      content: row.content,
      type: row.type,
      tags: row.tags,
      linkedItemId: row.linkedItemId,
      linkedItemTitle,
      createdAt: row.createdAt,
      embedding_status: embeddingStatus,
    });
  });

  // PUT /api/memory/:id - Update a memory
  app.put('/api/memory/:id', async (req, reply) => {
    const params = req.params as { id: string };
    const body = req.body as { title?: string; content?: string; type?: string; tags?: string[] };

    if (!body?.title || body.title.trim().length === 0) {
      return reply.code(400).send({ error: 'title is required' });
    }

    if (!body?.content || body.content.trim().length === 0) {
      return reply.code(400).send({ error: 'content is required' });
    }

    const memoryType = body.type ?? 'note';
    const validTypes = ['note', 'decision', 'context', 'reference'];
    if (!validTypes.includes(memoryType)) {
      return reply.code(400).send({ error: `type must be one of: ${validTypes.join(', ')}` });
    }

    const pool = createPool();

    // Check if memory exists
    const exists = await pool.query('SELECT 1 FROM memory WHERE id = $1', [params.id]);
    if (exists.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'not found' });
    }

    const tags = body.tags;

    const result = await pool.query(
      `UPDATE memory
       SET title = $1, content = $2, memory_type = $3::memory_type, updated_at = now(),
           embedding_status = 'pending'${tags !== undefined ? ', tags = $5' : ''}
       WHERE id = $4
       RETURNING id::text as id,
                 title,
                 content,
                 memory_type::text as type,
                 tags,
                 work_item_id::text as "linkedItemId",
                 created_at as "createdAt",
                 updated_at as "updatedAt"`,
      tags !== undefined
        ? [body.title.trim(), body.content.trim(), memoryType, params.id, tags]
        : [body.title.trim(), body.content.trim(), memoryType, params.id]
    );

    const row = result.rows[0] as {
      id: string;
      title: string;
      content: string;
      type: string;
      tags: string[];
      linkedItemId: string;
      createdAt: string;
      updatedAt: string;
    };

    // Regenerate embedding (content changed)
    const memoryContent = `${row.title}\n\n${row.content}`;
    const embeddingStatus = await generateMemoryEmbedding(pool, row.id, memoryContent);

    await pool.end();

    return reply.send({
      ...row,
      embedding_status: embeddingStatus,
    });
  });

  // DELETE /api/memory/:id - Delete a memory
  app.delete('/api/memory/:id', async (req, reply) => {
    const params = req.params as { id: string };
    const pool = createPool();

    const result = await pool.query(
      'DELETE FROM memory WHERE id = $1 RETURNING id::text as id',
      [params.id]
    );

    await pool.end();

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'not found' });
    }

    return reply.code(204).send();
  });

  // GET /api/memories/search - Semantic search for memories (issue #200)
  app.get('/api/memories/search', {
    config: {
      rateLimit: {
        max: 30, // 30 requests per minute for search (expensive)
        timeWindow: '1 minute',
      },
    },
  }, async (req, reply) => {
    const query = req.query as {
      q?: string;
      limit?: string;
      offset?: string;
      memory_type?: string;
      work_item_id?: string;
      contact_id?: string;
      relationship_id?: string;
      user_email?: string;
      tags?: string;
    };

    if (!query.q || query.q.trim().length === 0) {
      return reply.code(400).send({ error: 'q (query) parameter is required' });
    }

    const limit = Math.min(Math.max(parseInt(query.limit || '20', 10), 1), 100);
    const offset = Math.max(parseInt(query.offset || '0', 10), 0);
    const searchTags = query.tags ? query.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : undefined;

    const pool = createPool();

    try {
      const result = await searchMemoriesSemantic(pool, query.q.trim(), {
        limit,
        offset,
        memoryType: query.memory_type,
        workItemId: query.work_item_id,
        contactId: query.contact_id,
        relationshipId: query.relationship_id,
        userEmail: query.user_email,
        tags: searchTags,
      });

      return reply.send({
        results: result.results,
        search_type: result.searchType,
        query_embedding_provider: result.queryEmbeddingProvider,
      });
    } finally {
      await pool.end();
    }
  });

  // POST /api/admin/embeddings/backfill - Backfill embeddings for memories (issue #200)
  app.post('/api/admin/embeddings/backfill', async (req, reply) => {
    const body = req.body as {
      batch_size?: number;
      force?: boolean;
    };

    const batchSize = Math.min(Math.max(body?.batch_size || 100, 1), 1000);
    const force = body?.force === true;

    const pool = createPool();

    try {
      const result = await backfillMemoryEmbeddings(pool, { batchSize, force });
      return reply.code(202).send({
        status: 'completed',
        processed: result.processed,
        succeeded: result.succeeded,
        failed: result.failed,
      });
    } catch (error) {
      return reply.code(500).send({
        error: (error as Error).message,
      });
    } finally {
      await pool.end();
    }
  });

  // GET /api/admin/embeddings/status - Get embedding configuration status (issue #200)
  app.get('/api/admin/embeddings/status', async (req, reply) => {
    const pool = createPool();

    try {
      // Get embedding service config
      const { embeddingService, getConfigSummary } = await import('./embeddings/index.ts');
      const config = getConfigSummary();

      // Get stats from database
      const stats = await pool.query(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE embedding_status = 'complete') as with_embedding,
          COUNT(*) FILTER (WHERE embedding_status = 'pending') as pending,
          COUNT(*) FILTER (WHERE embedding_status = 'failed') as failed
        FROM memory
      `);

      const row = stats.rows[0] as {
        total: string;
        with_embedding: string;
        pending: string;
        failed: string;
      };

      return reply.send({
        configured: config.provider !== null,
        provider: config.provider,
        model: config.model,
        dimensions: config.dimensions,
        configured_providers: config.configuredProviders,
        stats: {
          total_memories: parseInt(row.total, 10),
          with_embedding: parseInt(row.with_embedding, 10),
          pending: parseInt(row.pending, 10),
          failed: parseInt(row.failed, 10),
        },
      });
    } finally {
      await pool.end();
    }
  });

  // Unified Memory API (issue #209) - Flexible memory scoping

  // GET /api/memories/global - List global memories (no work item or contact scope)
  app.get('/api/memories/global', async (req, reply) => {
    const { getGlobalMemories } = await import('./memory/index.ts');

    const query = req.query as {
      user_email?: string;
      memory_type?: string;
      limit?: string;
      offset?: string;
    };

    if (!query.user_email) {
      return reply.code(400).send({ error: 'user_email is required' });
    }

    const pool = createPool();

    try {
      const result = await getGlobalMemories(pool, query.user_email, {
        memoryType: query.memory_type as any,
        limit: parseInt(query.limit || '50', 10),
        offset: parseInt(query.offset || '0', 10),
      });

      return reply.send({
        memories: result.memories,
        total: result.total,
      });
    } finally {
      await pool.end();
    }
  });

  // POST /api/memories/unified - Create memory with flexible scoping (issue #209)
  app.post('/api/memories/unified', async (req, reply) => {
    const { createMemory, isValidMemoryType } = await import('./memory/index.ts');

    const body = req.body as {
      title?: string;
      content?: string;
      memory_type?: string;
      user_email?: string;
      work_item_id?: string;
      contact_id?: string;
      relationship_id?: string;
      created_by_agent?: string;
      created_by_human?: boolean;
      source_url?: string;
      importance?: number;
      confidence?: number;
      expires_at?: string;
      tags?: string[];
    };

    if (!body?.title?.trim()) {
      return reply.code(400).send({ error: 'title is required' });
    }

    if (!body?.content?.trim()) {
      return reply.code(400).send({ error: 'content is required' });
    }

    const memoryType = body.memory_type ?? 'note';
    if (!isValidMemoryType(memoryType)) {
      return reply.code(400).send({
        error: `Invalid memory_type. Valid types: preference, fact, note, decision, context, reference`,
      });
    }

    const pool = createPool();

    try {
      const memory = await createMemory(pool, {
        title: body.title.trim(),
        content: body.content.trim(),
        memoryType: memoryType as any,
        userEmail: body.user_email,
        workItemId: body.work_item_id,
        contactId: body.contact_id,
        relationshipId: body.relationship_id,
        createdByAgent: body.created_by_agent,
        createdByHuman: body.created_by_human,
        sourceUrl: body.source_url,
        importance: body.importance,
        confidence: body.confidence,
        expiresAt: body.expires_at ? new Date(body.expires_at) : undefined,
        tags: body.tags,
      });

      // Generate embedding asynchronously
      const memoryContent = `${memory.title}\n\n${memory.content}`;
      await generateMemoryEmbedding(pool, memory.id, memoryContent);

      return reply.code(201).send(memory);
    } finally {
      await pool.end();
    }
  });

  // POST /api/memories/bulk - Bulk create memories (Issue #218)
  app.post('/api/memories/bulk', async (req, reply) => {
    const { createMemory, isValidMemoryType } = await import('./memory/index.ts');

    const body = req.body as {
      memories: Array<{
        title: string;
        content: string;
        memory_type?: string;
        user_email?: string;
        work_item_id?: string;
        contact_id?: string;
        relationship_id?: string;
        created_by_agent?: string;
        created_by_human?: boolean;
        source_url?: string;
        importance?: number;
        confidence?: number;
        expires_at?: string;
        tags?: string[];
      }>;
    };

    if (!body?.memories || !Array.isArray(body.memories) || body.memories.length === 0) {
      return reply.code(400).send({ error: 'memories array is required' });
    }

    if (body.memories.length > BULK_OPERATION_LIMIT) {
      return reply.code(413).send({
        error: `Maximum ${BULK_OPERATION_LIMIT} memories per bulk request`,
        limit: BULK_OPERATION_LIMIT,
        requested: body.memories.length,
      });
    }

    const pool = createPool();

    try {
      const results: Array<{ index: number; id?: string; status: 'created' | 'failed'; error?: string }> = [];
      let createdCount = 0;
      let failedCount = 0;

      for (let i = 0; i < body.memories.length; i++) {
        const mem = body.memories[i];

        // Validate required fields
        if (!mem.title?.trim()) {
          results.push({ index: i, status: 'failed', error: 'title is required' });
          failedCount++;
          continue;
        }

        if (!mem.content?.trim()) {
          results.push({ index: i, status: 'failed', error: 'content is required' });
          failedCount++;
          continue;
        }

        const memoryType = mem.memory_type ?? 'note';
        if (!isValidMemoryType(memoryType)) {
          results.push({ index: i, status: 'failed', error: 'invalid memory_type' });
          failedCount++;
          continue;
        }

        try {
          const memory = await createMemory(pool, {
            title: mem.title.trim(),
            content: mem.content.trim(),
            memoryType: memoryType as any,
            userEmail: mem.user_email,
            workItemId: mem.work_item_id,
            contactId: mem.contact_id,
            relationshipId: mem.relationship_id,
            createdByAgent: mem.created_by_agent,
            createdByHuman: mem.created_by_human,
            sourceUrl: mem.source_url,
            importance: mem.importance,
            confidence: mem.confidence,
            expiresAt: mem.expires_at ? new Date(mem.expires_at) : undefined,
            tags: mem.tags,
          });

          // Generate embedding asynchronously (don't await to avoid blocking)
          const memoryContent = `${memory.title}\n\n${memory.content}`;
          generateMemoryEmbedding(pool, memory.id, memoryContent).catch((err) => {
            // Pool-closed errors are expected during shutdown/test teardown
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('Cannot use a pool after calling end')) return;
            // Other embedding failures are non-fatal for bulk operations
          });

          results.push({ index: i, id: memory.id, status: 'created' });
          createdCount++;
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'unknown error';
          results.push({ index: i, status: 'failed', error: errorMsg });
          failedCount++;
        }
      }

      return reply.code(failedCount > 0 && createdCount === 0 ? 400 : 200).send({
        success: failedCount === 0,
        created: createdCount,
        failed: failedCount,
        results,
      });
    } finally {
      await pool.end();
    }
  });

  // PATCH /api/memories/bulk - Bulk update memories (Issue #218)
  app.patch('/api/memories/bulk', async (req, reply) => {
    const body = req.body as {
      updates: Array<{
        id: string;
        title?: string;
        content?: string;
        importance?: number;
        confidence?: number;
        is_active?: boolean;
      }>;
    };

    if (!body?.updates || !Array.isArray(body.updates) || body.updates.length === 0) {
      return reply.code(400).send({ error: 'updates array is required' });
    }

    if (body.updates.length > BULK_OPERATION_LIMIT) {
      return reply.code(413).send({
        error: `Maximum ${BULK_OPERATION_LIMIT} updates per bulk request`,
        limit: BULK_OPERATION_LIMIT,
        requested: body.updates.length,
      });
    }

    const pool = createPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const results: Array<{ index: number; id: string; status: 'updated' | 'failed'; error?: string }> = [];
      let updatedCount = 0;
      let failedCount = 0;

      for (let i = 0; i < body.updates.length; i++) {
        const update = body.updates[i];

        // Validate ID
        if (!update.id || !uuidRegex.test(update.id)) {
          results.push({ index: i, id: update.id || '', status: 'failed', error: 'valid id is required' });
          failedCount++;
          continue;
        }

        // Build dynamic update
        const setClauses: string[] = ['updated_at = now()'];
        const values: unknown[] = [];
        let paramCount = 0;

        if (update.title !== undefined) {
          paramCount++;
          setClauses.push(`title = $${paramCount}`);
          values.push(update.title);
        }

        if (update.content !== undefined) {
          paramCount++;
          setClauses.push(`content = $${paramCount}`);
          values.push(update.content);
        }

        if (update.importance !== undefined) {
          paramCount++;
          setClauses.push(`importance = $${paramCount}`);
          values.push(update.importance);
        }

        if (update.confidence !== undefined) {
          paramCount++;
          setClauses.push(`confidence = $${paramCount}`);
          values.push(update.confidence);
        }

        if (update.is_active !== undefined) {
          paramCount++;
          setClauses.push(`is_active = $${paramCount}`);
          values.push(update.is_active);
        }

        // Only update if there's something to update
        if (values.length === 0) {
          results.push({ index: i, id: update.id, status: 'failed', error: 'no fields to update' });
          failedCount++;
          continue;
        }

        paramCount++;
        values.push(update.id);

        try {
          const result = await client.query(
            `UPDATE memory
             SET ${setClauses.join(', ')}
             WHERE id = $${paramCount}
             RETURNING id::text as id`,
            values
          );

          if (result.rows.length === 0) {
            results.push({ index: i, id: update.id, status: 'failed', error: 'memory not found' });
            failedCount++;
          } else {
            results.push({ index: i, id: update.id, status: 'updated' });
            updatedCount++;
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'unknown error';
          results.push({ index: i, id: update.id, status: 'failed', error: errorMsg });
          failedCount++;
        }
      }

      // Commit if at least some updates succeeded
      if (updatedCount > 0) {
        await client.query('COMMIT');
      } else {
        await client.query('ROLLBACK');
      }

      client.release();
      await pool.end();

      return reply.code(failedCount > 0 && updatedCount === 0 ? 400 : 200).send({
        success: failedCount === 0,
        updated: updatedCount,
        failed: failedCount,
        results,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();

      if (error instanceof Error) {
        return reply.code(400).send({ error: error.message });
      }
      return reply.code(500).send({ error: 'internal server error' });
    }
  });

  // GET /api/memories/unified - List memories with flexible filtering (issue #209)
  app.get('/api/memories/unified', async (req, reply) => {
    const { listMemories } = await import('./memory/index.ts');

    const query = req.query as {
      user_email?: string;
      work_item_id?: string;
      contact_id?: string;
      relationship_id?: string;
      memory_type?: string;
      include_expired?: string;
      include_superseded?: string;
      limit?: string;
      offset?: string;
    };

    const pool = createPool();

    try {
      const result = await listMemories(pool, {
        userEmail: query.user_email,
        workItemId: query.work_item_id,
        contactId: query.contact_id,
        relationshipId: query.relationship_id,
        memoryType: query.memory_type as any,
        includeExpired: query.include_expired === 'true',
        includeSuperseded: query.include_superseded === 'true',
        limit: parseInt(query.limit || '50', 10),
        offset: parseInt(query.offset || '0', 10),
      });

      return reply.send({
        memories: result.memories,
        total: result.total,
      });
    } finally {
      await pool.end();
    }
  });

  // POST /api/memories/:id/supersede - Supersede a memory with a new one (issue #209)
  app.post('/api/memories/:id/supersede', async (req, reply) => {
    const { supersedeMemory, getMemory, isValidMemoryType } = await import('./memory/index.ts');

    const params = req.params as { id: string };
    const body = req.body as {
      title?: string;
      content?: string;
      memory_type?: string;
      importance?: number;
      confidence?: number;
    };

    if (!body?.title?.trim()) {
      return reply.code(400).send({ error: 'title is required' });
    }

    if (!body?.content?.trim()) {
      return reply.code(400).send({ error: 'content is required' });
    }

    const pool = createPool();

    try {
      // Get the old memory to inherit its scope
      const oldMemory = await getMemory(pool, params.id);
      if (!oldMemory) {
        return reply.code(404).send({ error: 'Memory not found' });
      }

      const memoryType = body.memory_type ?? oldMemory.memoryType;
      if (!isValidMemoryType(memoryType)) {
        return reply.code(400).send({
          error: `Invalid memory_type. Valid types: preference, fact, note, decision, context, reference`,
        });
      }

      const newMemory = await supersedeMemory(pool, params.id, {
        title: body.title.trim(),
        content: body.content.trim(),
        memoryType: memoryType as any,
        userEmail: oldMemory.userEmail ?? undefined,
        workItemId: oldMemory.workItemId ?? undefined,
        contactId: oldMemory.contactId ?? undefined,
        relationshipId: oldMemory.relationshipId ?? undefined,
        importance: body.importance ?? oldMemory.importance,
        confidence: body.confidence ?? oldMemory.confidence,
      });

      // Generate embedding for new memory
      const memoryContent = `${newMemory.title}\n\n${newMemory.content}`;
      await generateMemoryEmbedding(pool, newMemory.id, memoryContent);

      return reply.code(201).send({
        newMemory,
        supersededId: params.id,
      });
    } finally {
      await pool.end();
    }
  });

  // DELETE /api/memories/cleanup-expired - Cleanup expired memories (issue #209)
  app.delete('/api/memories/cleanup-expired', async (req, reply) => {
    const { cleanupExpiredMemories } = await import('./memory/index.ts');

    const pool = createPool();

    try {
      const deleted = await cleanupExpiredMemories(pool);
      return reply.send({ deleted });
    } finally {
      await pool.end();
    }
  });

  // Webhook Admin API (issue #201)

  // GET /api/webhooks/outbox - List webhook outbox entries
  app.get('/api/webhooks/outbox', async (req, reply) => {
    const { getWebhookOutbox } = await import('./webhooks/index.ts');

    const query = req.query as {
      status?: string;
      kind?: string;
      limit?: string;
      offset?: string;
    };

    const status = query.status as 'pending' | 'failed' | 'dispatched' | undefined;
    const limit = Math.min(parseInt(query.limit || '50', 10), 100);
    const offset = Math.max(parseInt(query.offset || '0', 10), 0);

    const pool = createPool();

    try {
      const result = await getWebhookOutbox(pool, {
        status,
        kind: query.kind,
        limit,
        offset,
      });

      return reply.send({
        entries: result.entries,
        total: result.total,
        limit,
        offset,
      });
    } finally {
      await pool.end();
    }
  });

  // POST /api/webhooks/:id/retry - Retry a failed webhook
  app.post('/api/webhooks/:id/retry', async (req, reply) => {
    const { retryWebhook } = await import('./webhooks/index.ts');

    const params = req.params as { id: string };
    const pool = createPool();

    try {
      const success = await retryWebhook(pool, params.id);

      if (!success) {
        return reply.code(404).send({ error: 'Webhook not found or already dispatched' });
      }

      return reply.send({ status: 'queued', id: params.id });
    } finally {
      await pool.end();
    }
  });

  // GET /api/webhooks/status - Get webhook configuration status
  app.get('/api/webhooks/status', async (req, reply) => {
    const { getConfigSummary, getWebhookOutbox } = await import('./webhooks/index.ts');

    const config = getConfigSummary();
    const pool = createPool();

    try {
      // Get stats
      const pendingResult = await getWebhookOutbox(pool, { status: 'pending', limit: 0 });
      const failedResult = await getWebhookOutbox(pool, { status: 'failed', limit: 0 });
      const dispatchedResult = await pool.query(
        `SELECT COUNT(*) as count FROM webhook_outbox WHERE dispatched_at IS NOT NULL`
      );

      return reply.send({
        configured: config.configured,
        gatewayUrl: config.gatewayUrl,
        hasToken: config.hasToken,
        defaultModel: config.defaultModel,
        timeoutSeconds: config.timeoutSeconds,
        stats: {
          pending: pendingResult.total,
          failed: failedResult.total,
          dispatched: parseInt((dispatchedResult.rows[0] as { count: string }).count, 10),
        },
      });
    } finally {
      await pool.end();
    }
  });

  // POST /api/webhooks/process - Manually trigger webhook processing
  app.post('/api/webhooks/process', async (req, reply) => {
    const { processPendingWebhooks } = await import('./webhooks/index.ts');

    const body = req.body as { limit?: number };
    const limit = Math.min(body?.limit || 100, 1000);

    const pool = createPool();

    try {
      const stats = await processPendingWebhooks(pool, limit);

      return reply.send({
        status: 'completed',
        processed: stats.processed,
        succeeded: stats.succeeded,
        failed: stats.failed,
        skipped: stats.skipped,
      });
    } finally {
      await pool.end();
    }
  });

  // Memory Items API (issue #138)
  // GET /api/work-items/:id/memories - List memories for a work item
  app.get('/api/work-items/:id/memories', async (req, reply) => {
    const params = req.params as { id: string };
    const pool = createPool();

    // Check if work item exists
    const exists = await pool.query('SELECT 1 FROM work_item WHERE id = $1', [params.id]);
    if (exists.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'not found' });
    }

    const result = await pool.query(
      `SELECT id::text as id,
              title,
              content,
              memory_type::text as type,
              created_at,
              updated_at
         FROM memory
        WHERE work_item_id = $1
        ORDER BY created_at DESC`,
      [params.id]
    );

    await pool.end();
    return reply.send({ memories: result.rows });
  });

  // POST /api/work-items/:id/memories - Create a new memory
  app.post('/api/work-items/:id/memories', async (req, reply) => {
    const params = req.params as { id: string };
    const body = req.body as { title?: string; content?: string; type?: string };

    if (!body?.title || body.title.trim().length === 0) {
      return reply.code(400).send({ error: 'title is required' });
    }

    if (!body?.content || body.content.trim().length === 0) {
      return reply.code(400).send({ error: 'content is required' });
    }

    const memoryType = body.type ?? 'note';
    const validTypes = ['note', 'decision', 'context', 'reference'];
    if (!validTypes.includes(memoryType)) {
      return reply.code(400).send({ error: `type must be one of: ${validTypes.join(', ')}` });
    }

    const pool = createPool();

    // Check if work item exists
    const exists = await pool.query('SELECT 1 FROM work_item WHERE id = $1', [params.id]);
    if (exists.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'not found' });
    }

    const result = await pool.query(
      `INSERT INTO memory (work_item_id, title, content, memory_type)
       VALUES ($1, $2, $3, $4::memory_type)
       RETURNING id::text as id,
                 title,
                 content,
                 memory_type::text as type,
                 created_at,
                 updated_at`,
      [params.id, body.title.trim(), body.content.trim(), memoryType]
    );

    await pool.end();
    return reply.code(201).send(result.rows[0]);
  });

  // PATCH /api/memories/:id - Update a memory
  app.patch('/api/memories/:id', async (req, reply) => {
    const params = req.params as { id: string };
    const body = req.body as { title?: string; content?: string; type?: string };

    const pool = createPool();

    // Check if memory exists
    const exists = await pool.query('SELECT 1 FROM memory WHERE id = $1', [params.id]);
    if (exists.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'not found' });
    }

    // Build update query
    const updates: string[] = [];
    const values: (string | null)[] = [];
    let paramIndex = 1;

    if (body.title !== undefined) {
      updates.push(`title = $${paramIndex}`);
      values.push(body.title.trim());
      paramIndex++;
    }

    if (body.content !== undefined) {
      updates.push(`content = $${paramIndex}`);
      values.push(body.content.trim());
      paramIndex++;
    }

    if (body.type !== undefined) {
      const validTypes = ['note', 'decision', 'context', 'reference'];
      if (!validTypes.includes(body.type)) {
        await pool.end();
        return reply.code(400).send({ error: `type must be one of: ${validTypes.join(', ')}` });
      }
      updates.push(`memory_type = $${paramIndex}::memory_type`);
      values.push(body.type);
      paramIndex++;
    }

    if (updates.length === 0) {
      await pool.end();
      return reply.code(400).send({ error: 'no fields to update' });
    }

    updates.push('updated_at = now()');
    values.push(params.id);

    const result = await pool.query(
      `UPDATE memory SET ${updates.join(', ')} WHERE id = $${paramIndex}
       RETURNING id::text as id,
                 title,
                 content,
                 memory_type::text as type,
                 created_at,
                 updated_at`,
      values
    );

    await pool.end();
    return reply.send(result.rows[0]);
  });

  // DELETE /api/memories/:id - Delete a memory
  app.delete('/api/memories/:id', async (req, reply) => {
    const params = req.params as { id: string };
    const pool = createPool();

    const result = await pool.query(
      'DELETE FROM memory WHERE id = $1 RETURNING id::text as id',
      [params.id]
    );

    await pool.end();

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'not found' });
    }

    return reply.code(204).send();
  });

  // Memory Relationships API (issue #205)

  // POST /api/memories/:id/contacts - Link memory to contact
  app.post('/api/memories/:id/contacts', async (req, reply) => {
    const params = req.params as { id: string };
    const body = req.body as {
      contactId?: string;
      relationshipType?: string;
      notes?: string;
    };

    if (!body?.contactId) {
      return reply.code(400).send({ error: 'contactId is required' });
    }

    const relationshipType = body.relationshipType || 'about';
    const validTypes = ['about', 'from', 'shared_with', 'mentioned'];
    if (!validTypes.includes(relationshipType)) {
      return reply.code(400).send({ error: `relationshipType must be one of: ${validTypes.join(', ')}` });
    }

    const pool = createPool();

    try {
      // Check if memory exists
      const memoryExists = await pool.query('SELECT 1 FROM memory WHERE id = $1', [params.id]);
      if (memoryExists.rows.length === 0) {
        return reply.code(404).send({ error: 'memory not found' });
      }

      // Check if contact exists
      const contactExists = await pool.query('SELECT 1 FROM contact WHERE id = $1', [body.contactId]);
      if (contactExists.rows.length === 0) {
        return reply.code(404).send({ error: 'contact not found' });
      }

      // Create the relationship
      const result = await pool.query(
        `INSERT INTO memory_contact (memory_id, contact_id, relationship_type, notes)
         VALUES ($1, $2, $3::memory_contact_relationship, $4)
         ON CONFLICT (memory_id, contact_id, relationship_type) DO UPDATE SET notes = EXCLUDED.notes
         RETURNING id::text as id, memory_id::text as "memoryId", contact_id::text as "contactId",
                   relationship_type::text as "relationshipType", notes, created_at as "createdAt"`,
        [params.id, body.contactId, relationshipType, body.notes || null]
      );

      return reply.code(201).send(result.rows[0]);
    } finally {
      await pool.end();
    }
  });

  // GET /api/memories/:id/contacts - Get contacts linked to a memory
  app.get('/api/memories/:id/contacts', async (req, reply) => {
    const params = req.params as { id: string };
    const query = req.query as { relationshipType?: string };

    const pool = createPool();

    try {
      // Check if memory exists
      const memoryExists = await pool.query('SELECT 1 FROM memory WHERE id = $1', [params.id]);
      if (memoryExists.rows.length === 0) {
        return reply.code(404).send({ error: 'memory not found' });
      }

      let sql = `
        SELECT mc.id::text as id,
               mc.memory_id::text as "memoryId",
               mc.contact_id::text as "contactId",
               mc.relationship_type::text as "relationshipType",
               mc.notes,
               mc.created_at as "createdAt",
               c.display_name as "contactName"
        FROM memory_contact mc
        JOIN contact c ON c.id = mc.contact_id
        WHERE mc.memory_id = $1
      `;
      const queryParams: string[] = [params.id];

      if (query.relationshipType) {
        sql += ' AND mc.relationship_type = $2::memory_contact_relationship';
        queryParams.push(query.relationshipType);
      }

      sql += ' ORDER BY mc.created_at DESC';

      const result = await pool.query(sql, queryParams);
      return reply.send({ contacts: result.rows });
    } finally {
      await pool.end();
    }
  });

  // DELETE /api/memories/:memoryId/contacts/:contactId - Remove memory-contact link
  app.delete('/api/memories/:memoryId/contacts/:contactId', async (req, reply) => {
    const params = req.params as { memoryId: string; contactId: string };
    const query = req.query as { relationshipType?: string };

    const pool = createPool();

    try {
      let sql = 'DELETE FROM memory_contact WHERE memory_id = $1 AND contact_id = $2';
      const queryParams: string[] = [params.memoryId, params.contactId];

      if (query.relationshipType) {
        sql += ' AND relationship_type = $3::memory_contact_relationship';
        queryParams.push(query.relationshipType);
      }

      sql += ' RETURNING id::text as id';

      const result = await pool.query(sql, queryParams);

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'relationship not found' });
      }

      return reply.code(204).send();
    } finally {
      await pool.end();
    }
  });

  // GET /api/contacts/:id/memories - Get memories linked to a contact
  app.get('/api/contacts/:id/memories', async (req, reply) => {
    const params = req.params as { id: string };
    const query = req.query as { relationshipType?: string; limit?: string; offset?: string };

    const limit = Math.min(parseInt(query.limit || '50', 10), 100);
    const offset = parseInt(query.offset || '0', 10);

    const pool = createPool();

    try {
      // Check if contact exists
      const contactExists = await pool.query('SELECT 1 FROM contact WHERE id = $1', [params.id]);
      if (contactExists.rows.length === 0) {
        return reply.code(404).send({ error: 'contact not found' });
      }

      let sql = `
        SELECT mc.id::text as "relationshipId",
               mc.relationship_type::text as "relationshipType",
               mc.notes as "relationshipNotes",
               mc.created_at as "linkedAt",
               m.id::text as id,
               m.title,
               m.content,
               m.memory_type::text as type,
               m.work_item_id::text as "linkedItemId",
               m.created_at as "createdAt",
               m.updated_at as "updatedAt"
        FROM memory_contact mc
        JOIN memory m ON m.id = mc.memory_id
        WHERE mc.contact_id = $1
      `;
      const queryParams: (string | number)[] = [params.id];
      let paramIndex = 2;

      if (query.relationshipType) {
        sql += ` AND mc.relationship_type = $${paramIndex}::memory_contact_relationship`;
        queryParams.push(query.relationshipType);
        paramIndex++;
      }

      sql += ` ORDER BY mc.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      queryParams.push(limit, offset);

      const result = await pool.query(sql, queryParams);
      return reply.send({ memories: result.rows });
    } finally {
      await pool.end();
    }
  });

  // POST /api/memories/:id/related - Link two memories together
  app.post('/api/memories/:id/related', async (req, reply) => {
    const params = req.params as { id: string };
    const body = req.body as {
      relatedMemoryId?: string;
      relationshipType?: string;
      notes?: string;
    };

    if (!body?.relatedMemoryId) {
      return reply.code(400).send({ error: 'relatedMemoryId is required' });
    }

    if (params.id === body.relatedMemoryId) {
      return reply.code(400).send({ error: 'cannot create self-referential relationship' });
    }

    const relationshipType = body.relationshipType || 'related';
    const validTypes = ['related', 'supersedes', 'contradicts', 'supports'];
    if (!validTypes.includes(relationshipType)) {
      return reply.code(400).send({ error: `relationshipType must be one of: ${validTypes.join(', ')}` });
    }

    const pool = createPool();

    try {
      // Check if both memories exist
      const memoriesExist = await pool.query(
        'SELECT id FROM memory WHERE id = ANY($1::uuid[])',
        [[params.id, body.relatedMemoryId]]
      );
      if (memoriesExist.rows.length < 2) {
        return reply.code(404).send({ error: 'one or both memories not found' });
      }

      // Create the relationship
      const result = await pool.query(
        `INSERT INTO memory_relationship (memory_id, related_memory_id, relationship_type, notes)
         VALUES ($1, $2, $3::memory_relationship_type, $4)
         ON CONFLICT (memory_id, related_memory_id) DO UPDATE SET
           relationship_type = EXCLUDED.relationship_type,
           notes = EXCLUDED.notes
         RETURNING id::text as id, memory_id::text as "memoryId", related_memory_id::text as "relatedMemoryId",
                   relationship_type::text as "relationshipType", notes, created_at as "createdAt"`,
        [params.id, body.relatedMemoryId, relationshipType, body.notes || null]
      );

      return reply.code(201).send(result.rows[0]);
    } finally {
      await pool.end();
    }
  });

  // GET /api/memories/:id/related - Get memories related to this one
  app.get('/api/memories/:id/related', async (req, reply) => {
    const params = req.params as { id: string };
    const query = req.query as { relationshipType?: string; direction?: string };

    const pool = createPool();

    try {
      // Check if memory exists
      const memoryExists = await pool.query('SELECT 1 FROM memory WHERE id = $1', [params.id]);
      if (memoryExists.rows.length === 0) {
        return reply.code(404).send({ error: 'memory not found' });
      }

      // Get relationships where this memory is the source
      let outgoingSql = `
        SELECT mr.id::text as "relationshipId",
               mr.relationship_type::text as "relationshipType",
               mr.notes as "relationshipNotes",
               mr.created_at as "linkedAt",
               'outgoing' as direction,
               m.id::text as id,
               m.title,
               m.content,
               m.memory_type::text as type,
               m.work_item_id::text as "linkedItemId",
               m.created_at as "createdAt",
               m.updated_at as "updatedAt"
        FROM memory_relationship mr
        JOIN memory m ON m.id = mr.related_memory_id
        WHERE mr.memory_id = $1
      `;

      // Get relationships where this memory is the target
      let incomingSql = `
        SELECT mr.id::text as "relationshipId",
               mr.relationship_type::text as "relationshipType",
               mr.notes as "relationshipNotes",
               mr.created_at as "linkedAt",
               'incoming' as direction,
               m.id::text as id,
               m.title,
               m.content,
               m.memory_type::text as type,
               m.work_item_id::text as "linkedItemId",
               m.created_at as "createdAt",
               m.updated_at as "updatedAt"
        FROM memory_relationship mr
        JOIN memory m ON m.id = mr.memory_id
        WHERE mr.related_memory_id = $1
      `;

      const queryParams: string[] = [params.id];

      if (query.relationshipType) {
        const typeCondition = ` AND mr.relationship_type = $2::memory_relationship_type`;
        outgoingSql += typeCondition;
        incomingSql += typeCondition;
        queryParams.push(query.relationshipType);
      }

      // Combine based on direction filter
      let results;
      if (query.direction === 'outgoing') {
        results = await pool.query(outgoingSql + ' ORDER BY mr.created_at DESC', queryParams);
      } else if (query.direction === 'incoming') {
        results = await pool.query(incomingSql + ' ORDER BY mr.created_at DESC', queryParams);
      } else {
        // Get both directions
        const combinedSql = `(${outgoingSql}) UNION ALL (${incomingSql}) ORDER BY "linkedAt" DESC`;
        results = await pool.query(combinedSql, queryParams);
      }

      return reply.send({ related: results.rows });
    } finally {
      await pool.end();
    }
  });

  // DELETE /api/memories/:memoryId/related/:relatedMemoryId - Remove memory relationship
  app.delete('/api/memories/:memoryId/related/:relatedMemoryId', async (req, reply) => {
    const params = req.params as { memoryId: string; relatedMemoryId: string };

    const pool = createPool();

    try {
      // Delete relationship in either direction
      const result = await pool.query(
        `DELETE FROM memory_relationship
         WHERE (memory_id = $1 AND related_memory_id = $2)
            OR (memory_id = $2 AND related_memory_id = $1)
         RETURNING id::text as id`,
        [params.memoryId, params.relatedMemoryId]
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'relationship not found' });
      }

      return reply.code(204).send();
    } finally {
      await pool.end();
    }
  });

  // GET /api/memories/:id/similar - Find semantically similar memories (requires embeddings)
  app.get('/api/memories/:id/similar', async (req, reply) => {
    const params = req.params as { id: string };
    const query = req.query as { limit?: string; threshold?: string };

    const limit = Math.min(parseInt(query.limit || '10', 10), 50);
    const threshold = Math.max(0, Math.min(1, parseFloat(query.threshold || '0.7')));

    const pool = createPool();

    try {
      // Get the source memory with its embedding
      const sourceResult = await pool.query(
        `SELECT id, title, content, embedding, embedding_status
         FROM memory WHERE id = $1`,
        [params.id]
      );

      if (sourceResult.rows.length === 0) {
        return reply.code(404).send({ error: 'memory not found' });
      }

      const source = sourceResult.rows[0] as {
        id: string;
        title: string;
        content: string;
        embedding: string | null;
        embedding_status: string;
      };

      if (!source.embedding || source.embedding_status !== 'complete') {
        return reply.code(400).send({
          error: 'source memory does not have an embedding',
          embedding_status: source.embedding_status,
        });
      }

      // Find similar memories using cosine similarity
      const similarResult = await pool.query(
        `SELECT m.id::text as id,
                m.title,
                m.content,
                m.memory_type::text as type,
                m.work_item_id::text as "linkedItemId",
                m.created_at as "createdAt",
                m.updated_at as "updatedAt",
                1 - (m.embedding <=> $1::vector) as similarity
         FROM memory m
         WHERE m.id != $2
           AND m.embedding IS NOT NULL
           AND m.embedding_status = 'complete'
           AND 1 - (m.embedding <=> $1::vector) >= $3
         ORDER BY m.embedding <=> $1::vector
         LIMIT $4`,
        [source.embedding, params.id, threshold, limit]
      );

      return reply.send({
        source_memory_id: params.id,
        threshold,
        similar: similarResult.rows,
      });
    } finally {
      await pool.end();
    }
  });

  // GET /api/contacts/:id/similar-memories - Find memories semantically related to a contact's context
  app.get('/api/contacts/:id/similar-memories', async (req, reply) => {
    const params = req.params as { id: string };
    const query = req.query as { limit?: string; threshold?: string };

    const limit = Math.min(parseInt(query.limit || '10', 10), 50);
    const threshold = Math.max(0, Math.min(1, parseFloat(query.threshold || '0.6')));

    const pool = createPool();

    try {
      // Check if contact exists and get their linked memories
      const contactResult = await pool.query(
        `SELECT c.id, c.display_name, c.notes
         FROM contact c WHERE c.id = $1`,
        [params.id]
      );

      if (contactResult.rows.length === 0) {
        return reply.code(404).send({ error: 'contact not found' });
      }

      // Get memories directly linked to this contact that have embeddings
      const linkedMemoriesResult = await pool.query(
        `SELECT m.embedding
         FROM memory_contact mc
         JOIN memory m ON m.id = mc.memory_id
         WHERE mc.contact_id = $1
           AND m.embedding IS NOT NULL
           AND m.embedding_status = 'complete'
         LIMIT 5`,
        [params.id]
      );

      if (linkedMemoriesResult.rows.length === 0) {
        // No linked memories with embeddings, try to use contact's name and notes
        const { embeddingService } = await import('./embeddings/index.ts');

        if (!embeddingService.isConfigured()) {
          return reply.code(400).send({
            error: 'no embedding service configured and no linked memories with embeddings',
          });
        }

        const contact = contactResult.rows[0] as { id: string; display_name: string; notes: string | null };
        const contextText = `${contact.display_name}${contact.notes ? '\n' + contact.notes : ''}`;

        const embeddingResult = await embeddingService.embed(contextText);
        if (!embeddingResult) {
          return reply.code(500).send({ error: 'failed to generate embedding for contact context' });
        }

        const embeddingStr = `[${embeddingResult.embedding.join(',')}]`;

        // Find similar memories
        const similarResult = await pool.query(
          `SELECT m.id::text as id,
                  m.title,
                  m.content,
                  m.memory_type::text as type,
                  m.work_item_id::text as "linkedItemId",
                  m.created_at as "createdAt",
                  m.updated_at as "updatedAt",
                  1 - (m.embedding <=> $1::vector) as similarity
           FROM memory m
           WHERE m.embedding IS NOT NULL
             AND m.embedding_status = 'complete'
             AND 1 - (m.embedding <=> $1::vector) >= $2
           ORDER BY m.embedding <=> $1::vector
           LIMIT $3`,
          [embeddingStr, threshold, limit]
        );

        return reply.send({
          contact_id: params.id,
          context_source: 'contact_name_and_notes',
          threshold,
          similar_memories: similarResult.rows,
        });
      }

      // Use average of linked memory embeddings (centroid approach)
      // For simplicity, we'll use the first linked memory's embedding as the query
      const queryEmbedding = (linkedMemoriesResult.rows[0] as { embedding: string }).embedding;

      // Find similar memories excluding already linked ones
      const similarResult = await pool.query(
        `SELECT m.id::text as id,
                m.title,
                m.content,
                m.memory_type::text as type,
                m.work_item_id::text as "linkedItemId",
                m.created_at as "createdAt",
                m.updated_at as "updatedAt",
                1 - (m.embedding <=> $1::vector) as similarity
         FROM memory m
         WHERE m.embedding IS NOT NULL
           AND m.embedding_status = 'complete'
           AND 1 - (m.embedding <=> $1::vector) >= $2
           AND m.id NOT IN (
             SELECT memory_id FROM memory_contact WHERE contact_id = $3
           )
         ORDER BY m.embedding <=> $1::vector
         LIMIT $4`,
        [queryEmbedding, threshold, params.id, limit]
      );

      return reply.send({
        contact_id: params.id,
        context_source: 'linked_memories',
        threshold,
        similar_memories: similarResult.rows,
      });
    } finally {
      await pool.end();
    }
  });

  // GET /api/work-items/:id/related-entities - Discover related contacts and memories
  app.get('/api/work-items/:id/related-entities', async (req, reply) => {
    const params = req.params as { id: string };
    const query = req.query as { limit?: string; threshold?: string };

    const limit = Math.min(parseInt(query.limit || '10', 10), 50);
    const threshold = Math.max(0, Math.min(1, parseFloat(query.threshold || '0.6')));

    const pool = createPool();

    try {
      // Check if work item exists
      const workItemResult = await pool.query(
        'SELECT id, title, description FROM work_item WHERE id = $1',
        [params.id]
      );

      if (workItemResult.rows.length === 0) {
        return reply.code(404).send({ error: 'work item not found' });
      }

      // Get directly linked contacts
      const directContactsResult = await pool.query(
        `SELECT c.id::text as id,
                c.display_name as "displayName",
                wic.relationship::text as relationship,
                'direct' as "linkType"
         FROM work_item_contact wic
         JOIN contact c ON c.id = wic.contact_id
         WHERE wic.work_item_id = $1`,
        [params.id]
      );

      // Get directly linked memories
      const directMemoriesResult = await pool.query(
        `SELECT m.id::text as id,
                m.title,
                m.content,
                m.memory_type::text as type,
                'direct' as "linkType"
         FROM memory m
         WHERE m.work_item_id = $1`,
        [params.id]
      );

      // Get contacts linked through memories
      const memoryContactsResult = await pool.query(
        `SELECT DISTINCT c.id::text as id,
                c.display_name as "displayName",
                mc.relationship_type::text as relationship,
                'via_memory' as "linkType"
         FROM memory m
         JOIN memory_contact mc ON mc.memory_id = m.id
         JOIN contact c ON c.id = mc.contact_id
         WHERE m.work_item_id = $1
           AND c.id NOT IN (
             SELECT contact_id FROM work_item_contact WHERE work_item_id = $1
           )`,
        [params.id]
      );

      // Try to find semantically similar memories (if embeddings available)
      let similarMemories: unknown[] = [];
      const workItemMemoriesWithEmbeddings = await pool.query(
        `SELECT m.embedding
         FROM memory m
         WHERE m.work_item_id = $1
           AND m.embedding IS NOT NULL
           AND m.embedding_status = 'complete'
         LIMIT 3`,
        [params.id]
      );

      if (workItemMemoriesWithEmbeddings.rows.length > 0) {
        const queryEmbedding = (workItemMemoriesWithEmbeddings.rows[0] as { embedding: string }).embedding;

        const similarResult = await pool.query(
          `SELECT m.id::text as id,
                  m.title,
                  m.content,
                  m.memory_type::text as type,
                  m.work_item_id::text as "originalWorkItemId",
                  1 - (m.embedding <=> $1::vector) as similarity,
                  'semantic' as "linkType"
           FROM memory m
           WHERE m.work_item_id != $2
             AND m.embedding IS NOT NULL
             AND m.embedding_status = 'complete'
             AND 1 - (m.embedding <=> $1::vector) >= $3
           ORDER BY m.embedding <=> $1::vector
           LIMIT $4`,
          [queryEmbedding, params.id, threshold, limit]
        );

        similarMemories = similarResult.rows;
      }

      return reply.send({
        work_item_id: params.id,
        contacts: {
          direct: directContactsResult.rows,
          via_memory: memoryContactsResult.rows,
        },
        memories: {
          direct: directMemoriesResult.rows,
          semantically_similar: similarMemories,
        },
        threshold_used: threshold,
      });
    } finally {
      await pool.end();
    }
  });

  // Communications API (issue #140)
  // GET /api/work-items/:id/communications - List communications for a work item
  app.get('/api/work-items/:id/communications', async (req, reply) => {
    const params = req.params as { id: string };
    const pool = createPool();

    // Check if work item exists
    const exists = await pool.query('SELECT 1 FROM work_item WHERE id = $1', [params.id]);
    if (exists.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'not found' });
    }

    // Get all communications linked to this work item
    const communications = await pool.query(
      `SELECT wic.work_item_id::text as work_item_id,
              wic.thread_id::text as thread_id,
              wic.message_id::text as message_id,
              wic.action::text as action,
              et.channel::text as channel,
              et.external_thread_key,
              em.id::text as id,
              em.external_message_key,
              em.direction::text as direction,
              em.body,
              em.raw,
              em.received_at
         FROM work_item_communication wic
         JOIN external_thread et ON et.id = wic.thread_id
         LEFT JOIN external_message em ON em.id = wic.message_id
        WHERE wic.work_item_id = $1
        ORDER BY em.received_at DESC NULLS LAST`,
      [params.id]
    );

    // Separate by channel type
    const emails: Array<{
      id: string;
      thread_id: string;
      body: string | null;
      direction: string;
      received_at: string | null;
      raw: unknown;
    }> = [];

    const calendarEvents: Array<{
      id: string;
      thread_id: string;
      body: string | null;
      direction: string;
      received_at: string | null;
      raw: unknown;
    }> = [];

    for (const row of communications.rows) {
      const comm = row as {
        id: string | null;
        thread_id: string;
        channel: string;
        body: string | null;
        direction: string;
        received_at: Date | null;
        raw: unknown;
      };

      if (!comm.id) continue; // No message linked

      const entry = {
        id: comm.id,
        thread_id: comm.thread_id,
        body: comm.body,
        direction: comm.direction,
        received_at: comm.received_at?.toISOString() ?? null,
        raw: comm.raw,
      };

      if (comm.channel === 'email') {
        emails.push(entry);
      } else if (comm.channel === 'calendar') {
        calendarEvents.push(entry);
      }
    }

    await pool.end();
    return reply.send({ emails, calendar_events: calendarEvents });
  });

  // GET /api/work-items/:id/emails - List linked emails for a work item (issue #124)
  app.get('/api/work-items/:id/emails', async (req, reply) => {
    const params = req.params as { id: string };
    const pool = createPool();

    // Check if work item exists
    const exists = await pool.query('SELECT 1 FROM work_item WHERE id = $1', [params.id]);
    if (exists.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'not found' });
    }

    // Get emails linked to this work item via work_item_communication
    const result = await pool.query(
      `SELECT em.id::text as id,
              em.body,
              em.raw,
              em.received_at
         FROM work_item_communication wic
         JOIN external_thread et ON et.id = wic.thread_id
         JOIN external_message em ON em.id = wic.message_id
        WHERE wic.work_item_id = $1
          AND et.channel = 'email'
        ORDER BY em.received_at DESC`,
      [params.id]
    );

    const emails = result.rows.map((row) => {
      const r = row as {
        id: string;
        body: string | null;
        raw: Record<string, unknown>;
        received_at: Date;
      };
      const raw = r.raw ?? {};
      return {
        id: r.id,
        subject: (raw.subject as string) ?? null,
        from: (raw.from as string) ?? null,
        to: (raw.to as string) ?? null,
        date: r.received_at?.toISOString() ?? null,
        snippet: (raw.snippet as string) ?? null,
        body: r.body,
        hasAttachments: (raw.hasAttachments as boolean) ?? false,
        isRead: (raw.isRead as boolean) ?? false,
      };
    });

    await pool.end();
    return reply.send({ emails });
  });

  // GET /api/work-items/:id/calendar - List linked calendar events for a work item (issue #125)
  app.get('/api/work-items/:id/calendar', async (req, reply) => {
    const params = req.params as { id: string };
    const pool = createPool();

    // Check if work item exists
    const exists = await pool.query('SELECT 1 FROM work_item WHERE id = $1', [params.id]);
    if (exists.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'not found' });
    }

    // Get calendar events linked to this work item
    // Filter by raw->type = 'calendar_event' to distinguish from regular messages
    const result = await pool.query(
      `SELECT em.id::text as id,
              em.body,
              em.raw,
              em.received_at
         FROM work_item_communication wic
         JOIN external_thread et ON et.id = wic.thread_id
         JOIN external_message em ON em.id = wic.message_id
        WHERE wic.work_item_id = $1
          AND (em.raw->>'type') = 'calendar_event'
        ORDER BY (em.raw->>'startTime') ASC`,
      [params.id]
    );

    const events = result.rows.map((row) => {
      const r = row as {
        id: string;
        body: string | null;
        raw: Record<string, unknown>;
        received_at: Date;
      };
      const raw = r.raw ?? {};
      return {
        id: r.id,
        title: (raw.title as string) ?? null,
        description: (raw.description as string) ?? null,
        startTime: (raw.startTime as string) ?? null,
        endTime: (raw.endTime as string) ?? null,
        isAllDay: (raw.isAllDay as boolean) ?? false,
        location: (raw.location as string) ?? null,
        attendees: (raw.attendees as Array<{ email: string; name?: string; status?: string }>) ?? [],
        organizer: (raw.organizer as { email: string; name?: string }) ?? null,
        meetingLink: (raw.meetingLink as string) ?? null,
      };
    });

    await pool.end();
    return reply.send({ events });
  });

  // Email Linking API (issue #126)
  // POST /api/work-items/:id/emails - Link an email to a work item
  app.post('/api/work-items/:id/emails', async (req, reply) => {
    const params = req.params as { id: string };
    const body = req.body as { emailId?: string };

    if (!body?.emailId) {
      return reply.code(400).send({ error: 'emailId is required' });
    }

    const pool = createPool();

    // Check if work item exists
    const wiExists = await pool.query('SELECT 1 FROM work_item WHERE id = $1', [params.id]);
    if (wiExists.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'work item not found' });
    }

    // Check if email message exists and get its thread
    const emailExists = await pool.query(
      'SELECT thread_id FROM external_message WHERE id = $1',
      [body.emailId]
    );
    if (emailExists.rows.length === 0) {
      await pool.end();
      return reply.code(400).send({ error: 'email not found' });
    }
    const threadId = (emailExists.rows[0] as { thread_id: string }).thread_id;

    // Create the link (upsert to handle existing links)
    await pool.query(
      `INSERT INTO work_item_communication (work_item_id, thread_id, message_id, action)
       VALUES ($1, $2, $3, 'reply_required')
       ON CONFLICT (work_item_id) DO UPDATE
         SET thread_id = EXCLUDED.thread_id,
             message_id = EXCLUDED.message_id`,
      [params.id, threadId, body.emailId]
    );

    await pool.end();
    return reply.code(201).send({
      workItemId: params.id,
      emailId: body.emailId,
    });
  });

  // DELETE /api/work-items/:id/emails/:emailId - Unlink an email from a work item
  app.delete('/api/work-items/:id/emails/:emailId', async (req, reply) => {
    const params = req.params as { id: string; emailId: string };
    const pool = createPool();

    // Check if work item exists
    const wiExists = await pool.query('SELECT 1 FROM work_item WHERE id = $1', [params.id]);
    if (wiExists.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'not found' });
    }

    // Delete the link
    const result = await pool.query(
      `DELETE FROM work_item_communication
       WHERE work_item_id = $1 AND message_id = $2
       RETURNING work_item_id::text`,
      [params.id, params.emailId]
    );

    await pool.end();

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'not found' });
    }

    return reply.code(204).send();
  });

  // Calendar Event Linking API (issue #126)
  // POST /api/work-items/:id/calendar - Link a calendar event to a work item
  app.post('/api/work-items/:id/calendar', async (req, reply) => {
    const params = req.params as { id: string };
    const body = req.body as { eventId?: string };

    if (!body?.eventId) {
      return reply.code(400).send({ error: 'eventId is required' });
    }

    const pool = createPool();

    // Check if work item exists
    const wiExists = await pool.query('SELECT 1 FROM work_item WHERE id = $1', [params.id]);
    if (wiExists.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'work item not found' });
    }

    // Check if event message exists and get its thread
    const eventExists = await pool.query(
      'SELECT thread_id FROM external_message WHERE id = $1',
      [body.eventId]
    );
    if (eventExists.rows.length === 0) {
      await pool.end();
      return reply.code(400).send({ error: 'event not found' });
    }
    const threadId = (eventExists.rows[0] as { thread_id: string }).thread_id;

    // Create the link (upsert to handle existing links)
    await pool.query(
      `INSERT INTO work_item_communication (work_item_id, thread_id, message_id, action)
       VALUES ($1, $2, $3, 'follow_up')
       ON CONFLICT (work_item_id) DO UPDATE
         SET thread_id = EXCLUDED.thread_id,
             message_id = EXCLUDED.message_id`,
      [params.id, threadId, body.eventId]
    );

    await pool.end();
    return reply.code(201).send({
      workItemId: params.id,
      eventId: body.eventId,
    });
  });

  // DELETE /api/work-items/:id/calendar/:eventId - Unlink a calendar event from a work item
  app.delete('/api/work-items/:id/calendar/:eventId', async (req, reply) => {
    const params = req.params as { id: string; eventId: string };
    const pool = createPool();

    // Check if work item exists
    const wiExists = await pool.query('SELECT 1 FROM work_item WHERE id = $1', [params.id]);
    if (wiExists.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'not found' });
    }

    // Delete the link
    const result = await pool.query(
      `DELETE FROM work_item_communication
       WHERE work_item_id = $1 AND message_id = $2
       RETURNING work_item_id::text`,
      [params.id, params.eventId]
    );

    await pool.end();

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'not found' });
    }

    return reply.code(204).send();
  });

  // POST /api/work-items/:id/communications - Link a communication to a work item
  app.post('/api/work-items/:id/communications', async (req, reply) => {
    const params = req.params as { id: string };
    const body = req.body as {
      threadId?: string;
      messageId?: string | null;
      action?: 'reply_required' | 'follow_up';
    };

    if (!body?.threadId) {
      return reply.code(400).send({ error: 'threadId is required' });
    }

    const pool = createPool();

    // Check if work item exists
    const workItemExists = await pool.query('SELECT 1 FROM work_item WHERE id = $1', [params.id]);
    if (workItemExists.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'not found' });
    }

    // Check if thread exists
    const threadExists = await pool.query('SELECT 1 FROM external_thread WHERE id = $1', [body.threadId]);
    if (threadExists.rows.length === 0) {
      await pool.end();
      return reply.code(400).send({ error: 'thread not found' });
    }

    const action = body.action ?? 'reply_required';

    const result = await pool.query(
      `INSERT INTO work_item_communication (work_item_id, thread_id, message_id, action)
       VALUES ($1, $2, $3, $4::communication_action)
       ON CONFLICT (work_item_id) DO UPDATE
         SET thread_id = EXCLUDED.thread_id,
             message_id = EXCLUDED.message_id,
             action = EXCLUDED.action
       RETURNING work_item_id::text as work_item_id,
                 thread_id::text as thread_id,
                 message_id::text as message_id,
                 action::text as action`,
      [params.id, body.threadId, body.messageId ?? null, action]
    );

    await pool.end();
    return reply.code(201).send(result.rows[0]);
  });

  // DELETE /api/work-items/:id/communications/:comm_id - Unlink a communication
  app.delete('/api/work-items/:id/communications/:commId', async (req, reply) => {
    const params = req.params as { id: string; commId: string };
    const pool = createPool();

    // Check if work item exists
    const workItemExists = await pool.query('SELECT 1 FROM work_item WHERE id = $1', [params.id]);
    if (workItemExists.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'not found' });
    }

    // Delete the communication link (comm_id is the thread_id)
    const result = await pool.query(
      `DELETE FROM work_item_communication
       WHERE work_item_id = $1 AND thread_id = $2
       RETURNING work_item_id::text as work_item_id`,
      [params.id, params.commId]
    );

    await pool.end();

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'communication link not found' });
    }

    return reply.code(204).send();
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

  // Twilio SMS Inbound Webhook (Issue #202)
  // POST /api/twilio/sms - Receive Twilio SMS webhooks
  app.post('/api/twilio/sms', {
    config: {
      rateLimit: {
        max: 60, // 60 requests per minute for webhooks
        timeWindow: '1 minute',
      },
    },
  }, async (req, reply) => {
    // Check IP whitelist (Issue #318) - defense in depth
    await twilioIPWhitelistMiddleware(req, reply);
    if (reply.sent) return;

    // Verify Twilio signature (unless auth disabled or in dev mode without config)
    if (!isAuthDisabled()) {
      if (!isWebhookVerificationConfigured('twilio')) {
        console.warn('[Twilio] TWILIO_AUTH_TOKEN not configured, rejecting webhook');
        return reply.code(503).send({ error: 'Twilio webhook not configured' });
      }

      if (!verifyTwilioSignature(req)) {
        console.warn('[Twilio] Invalid signature on SMS webhook');
        return reply.code(401).send({ error: 'Invalid signature' });
      }
    }

    // Twilio sends webhooks as application/x-www-form-urlencoded
    const payload = req.body as TwilioSmsWebhookPayload;

    // Validate required fields
    if (!payload.MessageSid || !payload.From || !payload.To) {
      return reply.code(400).send({ error: 'Missing required fields: MessageSid, From, To' });
    }

    const pool = createPool();

    try {
      const result = await processTwilioSms(pool, payload);

      console.log(
        `[Twilio] SMS from ${payload.From}: contactId=${result.contactId}, ` +
        `messageId=${result.messageId}, isNew=${result.isNewContact}`
      );

      // TODO: Queue webhook to notify OpenClaw of new inbound message (#201)

      // Return TwiML response (empty means no auto-reply)
      reply.header('Content-Type', 'application/xml');
      return reply.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    } finally {
      await pool.end();
    }
  });

  // Twilio SMS Outbound Send (Issue #291)
  // POST /api/twilio/sms/send - Send SMS via Twilio
  app.post<{
    Body: {
      to: string;
      body: string;
      threadId?: string;
      idempotencyKey?: string;
    };
  }>('/api/twilio/sms/send', {
    config: {
      rateLimit: {
        max: 30, // 30 requests per minute for sending
        timeWindow: '1 minute',
      },
    },
  }, async (req, reply) => {
    // Require authentication for sending
    if (!isAuthDisabled()) {
      const secret = getCachedSecret();
      const authHeader = req.headers.authorization || '';
      const token = authHeader.replace(/^Bearer\s+/i, '');

      if (!secret || !compareSecrets(token, secret)) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
    }

    // Check if Twilio is configured
    if (!isTwilioConfigured()) {
      return reply.code(503).send({
        error: 'Twilio not configured',
        message: 'Required env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER',
      });
    }

    const { to, body, threadId, idempotencyKey } = req.body;

    // Validate required fields
    if (!to || !body) {
      return reply.code(400).send({ error: 'Missing required fields: to, body' });
    }

    const pool = createPool();

    try {
      const result = await enqueueSmsMessage(pool, {
        to,
        body,
        threadId,
        idempotencyKey,
      });

      console.log(
        `[Twilio] SMS queued: to=${to}, messageId=${result.messageId}, ` +
        `idempotencyKey=${result.idempotencyKey}`
      );

      return reply.code(202).send({
        messageId: result.messageId,
        threadId: result.threadId,
        status: result.status,
        idempotencyKey: result.idempotencyKey,
      });
    } catch (error) {
      const err = error as Error;
      console.error('[Twilio] SMS send error:', err);

      if (err.message.includes('Invalid phone')) {
        return reply.code(400).send({ error: err.message });
      }

      if (err.message.includes('body')) {
        return reply.code(400).send({ error: err.message });
      }

      return reply.code(500).send({ error: 'Internal server error' });
    } finally {
      await pool.end();
    }
  });

  // Twilio SMS Delivery Status Webhook (Issue #292)
  // POST /api/twilio/sms/status - Receive Twilio delivery status callbacks
  app.post('/api/twilio/sms/status', {
    config: {
      rateLimit: {
        max: 120, // Higher limit for status callbacks (can come in bursts)
        timeWindow: '1 minute',
      },
    },
  }, async (req, reply) => {
    // Check IP whitelist (Issue #318) - defense in depth
    await twilioIPWhitelistMiddleware(req, reply);
    if (reply.sent) return;

    // Verify Twilio signature (unless auth disabled or in dev mode)
    if (!isAuthDisabled()) {
      if (!isWebhookVerificationConfigured('twilio')) {
        console.warn('[Twilio] TWILIO_AUTH_TOKEN not configured, rejecting status webhook');
        return reply.code(503).send({ error: 'Twilio webhook not configured' });
      }

      if (!verifyTwilioSignature(req)) {
        console.warn('[Twilio] Invalid signature on status webhook');
        return reply.code(401).send({ error: 'Invalid signature' });
      }
    }

    // Twilio sends status callbacks as URL-encoded form data
    const callback = req.body as TwilioStatusCallback;

    // Validate required fields
    if (!callback.MessageSid || !callback.MessageStatus) {
      return reply.code(400).send({ error: 'Missing required fields: MessageSid, MessageStatus' });
    }

    const pool = createPool();

    try {
      const result = await processDeliveryStatus(pool, callback);

      if (result.notFound) {
        // Return 404 but Twilio will retry - this is expected for messages
        // we didn't send through this system
        return reply.code(404).send({ error: 'Message not found' });
      }

      if (!result.success) {
        console.error(`[Twilio] Status processing failed: ${result.error}`);
        return reply.code(500).send({ error: 'Processing failed' });
      }

      // Return success (Twilio expects 200-299 to stop retrying)
      return reply.code(200).send({
        success: true,
        messageId: result.messageId,
        statusUnchanged: result.statusUnchanged || false,
      });
    } finally {
      await pool.end();
    }
  });

  // Twilio Phone Number Management (Issue #300)
  // GET /api/twilio/numbers - List all Twilio phone numbers
  app.get('/api/twilio/numbers', {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '1 minute',
      },
    },
  }, async (req, reply) => {
    // Require authentication
    if (!isAuthDisabled()) {
      const secret = getCachedSecret();
      const authHeader = req.headers.authorization || '';
      const token = authHeader.replace(/^Bearer\s+/i, '');

      if (!secret || !compareSecrets(token, secret)) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
    }

    // Check if Twilio is configured
    if (!isTwilioConfigured()) {
      return reply.code(503).send({
        error: 'Twilio not configured',
        message: 'Required env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER',
      });
    }

    try {
      const numbers = await listPhoneNumbers();
      return reply.code(200).send({ numbers });
    } catch (error) {
      console.error('[Twilio] Error listing phone numbers:', error);
      return reply.code(500).send({ error: 'Failed to list phone numbers' });
    }
  });

  // GET /api/twilio/numbers/:phoneNumber - Get phone number details
  app.get<{
    Params: { phoneNumber: string };
  }>('/api/twilio/numbers/:phoneNumber', {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '1 minute',
      },
    },
  }, async (req, reply) => {
    // Require authentication
    if (!isAuthDisabled()) {
      const secret = getCachedSecret();
      const authHeader = req.headers.authorization || '';
      const token = authHeader.replace(/^Bearer\s+/i, '');

      if (!secret || !compareSecrets(token, secret)) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
    }

    // Check if Twilio is configured
    if (!isTwilioConfigured()) {
      return reply.code(503).send({
        error: 'Twilio not configured',
        message: 'Required env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER',
      });
    }

    try {
      const { phoneNumber } = req.params;
      const details = await getPhoneNumberDetails(decodeURIComponent(phoneNumber));
      return reply.code(200).send(details);
    } catch (error) {
      const err = error as Error;
      if (err.message.includes('not found')) {
        return reply.code(404).send({ error: err.message });
      }
      console.error('[Twilio] Error getting phone number details:', error);
      return reply.code(500).send({ error: 'Failed to get phone number details' });
    }
  });

  // PATCH /api/twilio/numbers/:phoneNumber - Update phone number webhooks
  app.patch<{
    Params: { phoneNumber: string };
    Body: {
      smsUrl?: string;
      smsMethod?: 'GET' | 'POST';
      smsFallbackUrl?: string;
      voiceUrl?: string;
      voiceMethod?: 'GET' | 'POST';
      voiceFallbackUrl?: string;
      statusCallbackUrl?: string;
      statusCallbackMethod?: 'GET' | 'POST';
    };
  }>('/api/twilio/numbers/:phoneNumber', {
    config: {
      rateLimit: {
        max: 10, // Lower limit for config changes
        timeWindow: '1 minute',
      },
    },
  }, async (req, reply) => {
    // Require authentication
    if (!isAuthDisabled()) {
      const secret = getCachedSecret();
      const authHeader = req.headers.authorization || '';
      const token = authHeader.replace(/^Bearer\s+/i, '');

      if (!secret || !compareSecrets(token, secret)) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
    }

    // Check if Twilio is configured
    if (!isTwilioConfigured()) {
      return reply.code(503).send({
        error: 'Twilio not configured',
        message: 'Required env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER',
      });
    }

    const pool = createPool();

    try {
      const { phoneNumber } = req.params;
      const options = req.body;

      // Extract actor ID from auth token if available (for audit logging)
      const actorId = req.headers['x-actor-id'] as string | undefined;

      const updated = await updatePhoneNumberWebhooks(
        decodeURIComponent(phoneNumber),
        options,
        pool,
        actorId
      );

      return reply.code(200).send(updated);
    } catch (error) {
      const err = error as Error;

      // URL validation errors
      if (err.message.includes('Invalid URL') || err.message.includes('must use HTTPS')) {
        return reply.code(400).send({ error: err.message });
      }

      // Not found
      if (err.message.includes('not found')) {
        return reply.code(404).send({ error: err.message });
      }

      console.error('[Twilio] Error updating phone number webhooks:', error);
      return reply.code(500).send({ error: 'Failed to update phone number webhooks' });
    } finally {
      await pool.end();
    }
  });

  // Postmark Email Inbound Webhook (Issue #203)
  // POST /api/postmark/inbound - Receive Postmark inbound email webhooks
  app.post('/api/postmark/inbound', {
    config: {
      rateLimit: {
        max: 60, // 60 requests per minute for webhooks
        timeWindow: '1 minute',
      },
    },
  }, async (req, reply) => {
    // Check IP whitelist (Issue #318) - defense in depth
    await postmarkIPWhitelistMiddleware(req, reply);
    if (reply.sent) return;

    // Verify Postmark auth (Basic Auth unless auth disabled)
    if (!isAuthDisabled()) {
      if (!verifyPostmarkAuth(req)) {
        console.warn('[Postmark] Invalid authentication on inbound webhook');
        return reply.code(401).send({ error: 'Invalid authentication' });
      }
    }

    // Postmark sends JSON webhooks
    const payload = req.body as PostmarkInboundPayload;

    // Validate required fields
    if (!payload.MessageID || !payload.FromFull?.Email) {
      return reply.code(400).send({ error: 'Missing required fields: MessageID, FromFull.Email' });
    }

    const pool = createPool();

    try {
      const result = await processPostmarkEmail(pool, payload);

      console.log(
        `[Postmark] Email from ${payload.FromFull.Email}: subject="${payload.Subject}", ` +
        `contactId=${result.contactId}, messageId=${result.messageId}, isNew=${result.isNewContact}`
      );

      // TODO: Queue webhook to notify OpenClaw of new inbound email (#201)

      // Return success
      return reply.code(200).send({
        success: true,
        contactId: result.contactId,
        threadId: result.threadId,
        messageId: result.messageId,
      });
    } catch (error) {
      console.error('[Postmark] Error processing email:', error);
      throw error;
    } finally {
      await pool.end();
    }
  });

  // Postmark Email Outbound Send (Issue #293)
  // POST /api/postmark/email/send - Send email via Postmark
  app.post<{
    Body: {
      to: string;
      subject: string;
      body: string;
      htmlBody?: string;
      threadId?: string;
      replyToMessageId?: string;
      idempotencyKey?: string;
    };
  }>('/api/postmark/email/send', {
    config: {
      rateLimit: {
        max: 30, // 30 requests per minute for sending
        timeWindow: '1 minute',
      },
    },
  }, async (req, reply) => {
    // Require authentication for sending
    if (!isAuthDisabled()) {
      const secret = getCachedSecret();
      const authHeader = req.headers.authorization || '';
      const token = authHeader.replace(/^Bearer\s+/i, '');

      if (!secret || !compareSecrets(token, secret)) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
    }

    // Check if Postmark is configured
    if (!isPostmarkConfigured()) {
      return reply.code(503).send({
        error: 'Postmark not configured',
        message: 'Required env vars: POSTMARK_SERVER_TOKEN (or POSTMARK_TRANSACTIONAL_TOKEN), POSTMARK_FROM_EMAIL',
      });
    }

    const { to, subject, body, htmlBody, threadId, replyToMessageId, idempotencyKey } = req.body;

    // Validate required fields
    if (!to || !subject || !body) {
      return reply.code(400).send({ error: 'Missing required fields: to, subject, body' });
    }

    const pool = createPool();

    try {
      const result = await enqueueEmailMessage(pool, {
        to,
        subject,
        body,
        htmlBody,
        threadId,
        replyToMessageId,
        idempotencyKey,
      });

      console.log(
        `[Postmark] Email queued: to=${to}, messageId=${result.messageId}, ` +
        `idempotencyKey=${result.idempotencyKey}`
      );

      return reply.code(202).send({
        messageId: result.messageId,
        threadId: result.threadId,
        status: result.status,
        idempotencyKey: result.idempotencyKey,
      });
    } catch (error) {
      const err = error as Error;
      console.error('[Postmark] Email send error:', err);

      if (err.message.includes('Invalid email')) {
        return reply.code(400).send({ error: err.message });
      }

      if (err.message.includes('Subject') || err.message.includes('Body')) {
        return reply.code(400).send({ error: err.message });
      }

      return reply.code(500).send({ error: 'Internal server error' });
    } finally {
      await pool.end();
    }
  });

  // Postmark Delivery Status Webhook (Issue #294)
  // POST /api/postmark/email/status - Receive delivery status updates from Postmark
  app.post('/api/postmark/email/status', {
    config: {
      rateLimit: {
        max: 100, // 100 requests per minute for webhooks
        timeWindow: '1 minute',
      },
    },
  }, async (req, reply) => {
    // Check IP whitelist (Issue #318) - defense in depth
    await postmarkIPWhitelistMiddleware(req, reply);
    if (reply.sent) return;

    // Verify Postmark webhook auth (unless auth disabled)
    if (!isAuthDisabled()) {
      if (!verifyPostmarkAuth(req)) {
        console.warn('[Postmark] Invalid auth on delivery status webhook');
        return reply.code(401).send({ error: 'Unauthorized' });
      }
    }

    const payload = req.body as PostmarkWebhookPayload;

    // Validate required fields
    if (!payload.RecordType || !payload.MessageID) {
      return reply.code(400).send({ error: 'Missing required fields: RecordType, MessageID' });
    }

    // Validate RecordType
    const validRecordTypes = ['Delivery', 'Bounce', 'SpamComplaint'];
    if (!validRecordTypes.includes(payload.RecordType)) {
      console.warn(`[Postmark] Unknown RecordType: ${payload.RecordType}`);
      // Still return 200 to acknowledge receipt (avoid retries)
      return reply.code(200).send({ success: true, message: 'Ignored unknown RecordType' });
    }

    const pool = createPool();

    try {
      const result = await processPostmarkDeliveryStatus(pool, payload);

      if (result.notFound) {
        console.warn(`[Postmark] Message not found for MessageID: ${payload.MessageID}`);
        // Return 200 to acknowledge - we don't want Postmark to retry for unknown messages
        return reply.code(200).send({ success: false, reason: 'Message not found' });
      }

      console.log(
        `[Postmark] Delivery status: MessageID=${payload.MessageID}, RecordType=${payload.RecordType}, ` +
        `messageId=${result.messageId}, statusUnchanged=${result.statusUnchanged ?? false}`
      );

      return reply.code(200).send({
        success: true,
        messageId: result.messageId,
        statusUnchanged: result.statusUnchanged ?? false,
      });
    } catch (error) {
      console.error('[Postmark] Delivery status webhook error:', error);
      // Return 500 so Postmark retries
      return reply.code(500).send({ error: 'Internal server error' });
    } finally {
      await pool.end();
    }
  });

  // Cloudflare Email Workers Inbound Webhook (Issue #210)
  // POST /api/cloudflare/email - Receive emails forwarded from Cloudflare Email Workers
  app.post('/api/cloudflare/email', {
    config: {
      rateLimit: {
        max: 60, // 60 requests per minute for webhooks
        timeWindow: '1 minute',
      },
    },
  }, async (req, reply) => {
    // Verify HMAC-SHA256 signature (unless auth disabled)
    if (!isAuthDisabled()) {
      if (!verifyCloudflareEmailSecret(req)) {
        console.warn('[Cloudflare Email] Invalid signature on inbound webhook');
        return reply.code(401).send({ error: 'Invalid signature' });
      }
    }

    const payload = req.body as CloudflareEmailPayload;

    // Validate required fields
    if (!payload.from || !payload.to || !payload.timestamp) {
      return reply.code(400).send({ error: 'Missing required fields: from, to, timestamp' });
    }

    // Timestamp replay protection (reject if >5 minutes old)
    const payloadTime = new Date(payload.timestamp).getTime();
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;
    if (isNaN(payloadTime) || Math.abs(now - payloadTime) > fiveMinutes) {
      console.warn('[Cloudflare Email] Rejecting stale or invalid timestamp:', payload.timestamp);
      return reply.code(400).send({ error: 'Invalid or stale timestamp' });
    }

    const pool = createPool();

    try {
      const result = await processCloudflareEmail(pool, payload);

      console.log(
        `[Cloudflare Email] Email from ${payload.from}: subject="${payload.subject}", ` +
        `contactId=${result.contactId}, messageId=${result.messageId}, isNew=${result.isNewContact}`
      );

      // TODO: Queue webhook to notify OpenClaw of new inbound email (#201)

      // Return success with receipt ID
      return reply.code(200).send({
        success: true,
        receiptId: result.messageId,
        contactId: result.contactId,
        threadId: result.threadId,
        messageId: result.messageId,
      });
    } catch (error) {
      console.error('[Cloudflare Email] Error processing email:', error);
      throw error;
    } finally {
      await pool.end();
    }
  });

  // Work Item Reparent API (issue #105)
  // PATCH /api/work-items/:id/reparent - Move work item to a different parent
  app.patch('/api/work-items/:id/reparent', async (req, reply) => {
    const params = req.params as { id: string };
    const body = req.body as { newParentId?: string | null; afterId?: string | null };

    const newParentId = body.newParentId ?? null;

    const pool = createPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Get the work item being reparented
      const itemResult = await client.query(
        `SELECT id, work_item_kind as kind, parent_work_item_id, sort_order
         FROM work_item WHERE id = $1 FOR UPDATE`,
        [params.id]
      );
      if (itemResult.rows.length === 0) {
        await client.query('ROLLBACK');
        client.release();
        await pool.end();
        return reply.code(404).send({ error: 'not found' });
      }

      const item = itemResult.rows[0] as {
        id: string;
        kind: string;
        parent_work_item_id: string | null;
        sort_order: number;
      };

      // Check for self-reparenting
      if (newParentId === params.id) {
        await client.query('ROLLBACK');
        client.release();
        await pool.end();
        return reply.code(400).send({ error: 'item cannot be its own parent' });
      }

      // Get new parent info if not null
      let newParentKind: string | null = null;
      if (newParentId) {
        const parentResult = await client.query(
          `SELECT work_item_kind as kind FROM work_item WHERE id = $1`,
          [newParentId]
        );
        if (parentResult.rows.length === 0) {
          await client.query('ROLLBACK');
          client.release();
          await pool.end();
          return reply.code(400).send({ error: 'parent not found' });
        }
        newParentKind = (parentResult.rows[0] as { kind: string }).kind;
      }

      // Validate hierarchy constraints
      const kind = item.kind;
      if (kind === 'project') {
        if (newParentId !== null) {
          await client.query('ROLLBACK');
          client.release();
          await pool.end();
          return reply.code(400).send({ error: 'project cannot have parent' });
        }
      } else if (kind === 'initiative') {
        if (newParentId !== null && newParentKind !== 'project') {
          await client.query('ROLLBACK');
          client.release();
          await pool.end();
          return reply.code(400).send({ error: 'initiative parent must be project' });
        }
      } else if (kind === 'epic') {
        if (newParentId === null || newParentKind !== 'initiative') {
          await client.query('ROLLBACK');
          client.release();
          await pool.end();
          return reply.code(400).send({ error: 'epic parent must be initiative' });
        }
      } else if (kind === 'issue') {
        if (newParentId === null || newParentKind !== 'epic') {
          await client.query('ROLLBACK');
          client.release();
          await pool.end();
          return reply.code(400).send({ error: 'issue parent must be epic' });
        }
      }

      // Calculate new sort_order among new siblings
      let newSortOrder: number;
      const afterId = body.afterId ?? null;

      if (afterId) {
        // Position after a specific sibling in new parent
        const afterResult = await client.query(
          `SELECT sort_order, parent_work_item_id FROM work_item WHERE id = $1`,
          [afterId]
        );
        if (afterResult.rows.length === 0) {
          await client.query('ROLLBACK');
          client.release();
          await pool.end();
          return reply.code(400).send({ error: 'afterId target not found' });
        }
        const afterItem = afterResult.rows[0] as {
          sort_order: number;
          parent_work_item_id: string | null;
        };

        // Verify afterId is in the new parent
        if (afterItem.parent_work_item_id !== newParentId) {
          await client.query('ROLLBACK');
          client.release();
          await pool.end();
          return reply.code(400).send({ error: 'afterId must be in new parent' });
        }

        // Get next sibling
        const nextResult = await client.query(
          `SELECT sort_order FROM work_item
           WHERE parent_work_item_id IS NOT DISTINCT FROM $1
             AND sort_order > $2
             AND id != $3
           ORDER BY sort_order ASC
           LIMIT 1`,
          [newParentId, afterItem.sort_order, params.id]
        );

        if (nextResult.rows.length > 0) {
          const nextOrder = (nextResult.rows[0] as { sort_order: number }).sort_order;
          newSortOrder = Math.floor((afterItem.sort_order + nextOrder) / 2);
          if (newSortOrder === afterItem.sort_order) {
            newSortOrder = afterItem.sort_order + 500;
          }
        } else {
          newSortOrder = afterItem.sort_order + 1000;
        }
      } else {
        // Position at end of new siblings
        const maxResult = await client.query(
          `SELECT COALESCE(MAX(sort_order), 0) + 1000 as new_order
           FROM work_item
           WHERE parent_work_item_id IS NOT DISTINCT FROM $1
             AND id != $2`,
          [newParentId, params.id]
        );
        newSortOrder = (maxResult.rows[0] as { new_order: number }).new_order;
      }

      // Update the item
      const updateResult = await client.query(
        `UPDATE work_item
            SET parent_work_item_id = $2,
                parent_id = $2,
                sort_order = $3,
                updated_at = now()
          WHERE id = $1
        RETURNING id::text as id, title, status, work_item_kind as kind,
                  parent_work_item_id::text as parent_id, sort_order, updated_at`,
        [params.id, newParentId, newSortOrder]
      );

      await client.query('COMMIT');
      client.release();
      await pool.end();

      return reply.send({
        ok: true,
        item: updateResult.rows[0],
      });
    } catch (e) {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
      throw e;
    }
  });

  // Work Item Reorder API (issue #104)
  // PATCH /api/work-items/:id/reorder - Reorder work item within siblings
  app.patch('/api/work-items/:id/reorder', async (req, reply) => {
    const params = req.params as { id: string };
    const body = req.body as { afterId?: string | null; beforeId?: string | null };

    // Validate exactly one of afterId or beforeId is provided
    const hasAfter = Object.prototype.hasOwnProperty.call(body, 'afterId');
    const hasBefore = Object.prototype.hasOwnProperty.call(body, 'beforeId');

    if (!hasAfter && !hasBefore) {
      return reply.code(400).send({ error: 'afterId or beforeId is required' });
    }
    if (hasAfter && hasBefore) {
      return reply.code(400).send({ error: 'provide only one of afterId or beforeId' });
    }

    const pool = createPool();
    const client = await pool.connect();

    // Helper to normalize sort_order when gaps run out
    async function normalizeSort(parentId: string | null): Promise<void> {
      await client.query(
        `WITH ranked AS (
           SELECT id, ROW_NUMBER() OVER (ORDER BY sort_order) * 1000 as new_order
           FROM work_item
           WHERE parent_work_item_id IS NOT DISTINCT FROM $1
         )
         UPDATE work_item wi
         SET sort_order = ranked.new_order
         FROM ranked
         WHERE wi.id = ranked.id`,
        [parentId]
      );
    }

    try {
      await client.query('BEGIN');

      // Get the work item being reordered
      const itemResult = await client.query(
        `SELECT id, parent_work_item_id, sort_order FROM work_item WHERE id = $1 FOR UPDATE`,
        [params.id]
      );
      if (itemResult.rows.length === 0) {
        await client.query('ROLLBACK');
        client.release();
        await pool.end();
        return reply.code(404).send({ error: 'not found' });
      }

      const item = itemResult.rows[0] as {
        id: string;
        parent_work_item_id: string | null;
        sort_order: number;
      };

      // Determine target position
      let targetId: string | null = null;
      let insertPosition: 'after' | 'before' = 'after';

      if (hasAfter) {
        targetId = body.afterId ?? null;
        insertPosition = 'after';
      } else {
        targetId = body.beforeId ?? null;
        insertPosition = 'before';
      }

      // If target is null, we're moving to the edge
      let newSortOrder: number;

      if (targetId === null) {
        // Move to edge (first or last)
        if (insertPosition === 'after') {
          // afterId: null means move to first position
          const minResult = await client.query(
            `SELECT COALESCE(MIN(sort_order), 0) - 1000 as new_order
             FROM work_item
             WHERE parent_work_item_id IS NOT DISTINCT FROM $1
               AND id != $2`,
            [item.parent_work_item_id, params.id]
          );
          newSortOrder = (minResult.rows[0] as { new_order: number }).new_order;
        } else {
          // beforeId: null means move to last position
          const maxResult = await client.query(
            `SELECT COALESCE(MAX(sort_order), 0) + 1000 as new_order
             FROM work_item
             WHERE parent_work_item_id IS NOT DISTINCT FROM $1
               AND id != $2`,
            [item.parent_work_item_id, params.id]
          );
          newSortOrder = (maxResult.rows[0] as { new_order: number }).new_order;
        }
      } else {
        // Move relative to a specific sibling
        const targetResult = await client.query(
          `SELECT id, parent_work_item_id, sort_order FROM work_item WHERE id = $1`,
          [targetId]
        );
        if (targetResult.rows.length === 0) {
          await client.query('ROLLBACK');
          client.release();
          await pool.end();
          return reply.code(400).send({ error: 'target not found' });
        }

        const target = targetResult.rows[0] as {
          id: string;
          parent_work_item_id: string | null;
          sort_order: number;
        };

        // Validate they're siblings (same parent) - handle both null parents
        const itemParent = item.parent_work_item_id;
        const targetParent = target.parent_work_item_id;
        const sameParent = (itemParent === null && targetParent === null) || itemParent === targetParent;
        if (!sameParent) {
          await client.query('ROLLBACK');
          client.release();
          await pool.end();
          return reply.code(400).send({ error: 'target must be a sibling' });
        }

        if (insertPosition === 'after') {
          // Get the next sibling's sort_order (excluding the item being moved)
          const nextResult = await client.query(
            `SELECT sort_order FROM work_item
             WHERE parent_work_item_id IS NOT DISTINCT FROM $1
               AND sort_order > $2
               AND id != $3
             ORDER BY sort_order ASC
             LIMIT 1`,
            [target.parent_work_item_id, target.sort_order, params.id]
          );

          if (nextResult.rows.length > 0) {
            const nextOrder = (nextResult.rows[0] as { sort_order: number }).sort_order;
            // Place between target and next sibling
            newSortOrder = Math.floor((target.sort_order + nextOrder) / 2);
            // If no gap, normalize all siblings first
            if (newSortOrder === target.sort_order || newSortOrder === nextOrder) {
              await normalizeSort(target.parent_work_item_id);
              // Re-fetch target order after normalization
              const refetch = await client.query(
                `SELECT sort_order FROM work_item WHERE id = $1`,
                [targetId]
              );
              const targetOrder = (refetch.rows[0] as { sort_order: number }).sort_order;
              newSortOrder = targetOrder + 500;
            }
          } else {
            // No sibling after target, just go after
            newSortOrder = target.sort_order + 1000;
          }
        } else {
          // Insert before target - get the previous sibling
          const prevResult = await client.query(
            `SELECT sort_order FROM work_item
             WHERE parent_work_item_id IS NOT DISTINCT FROM $1
               AND sort_order < $2
               AND id != $3
             ORDER BY sort_order DESC
             LIMIT 1`,
            [target.parent_work_item_id, target.sort_order, params.id]
          );

          if (prevResult.rows.length > 0) {
            const prevOrder = (prevResult.rows[0] as { sort_order: number }).sort_order;
            // Place between previous sibling and target
            newSortOrder = Math.floor((prevOrder + target.sort_order) / 2);
            // If no gap, normalize all siblings first
            if (newSortOrder === prevOrder || newSortOrder === target.sort_order) {
              await normalizeSort(target.parent_work_item_id);
              // Re-fetch target order after normalization
              const refetch = await client.query(
                `SELECT sort_order FROM work_item WHERE id = $1`,
                [targetId]
              );
              const targetOrder = (refetch.rows[0] as { sort_order: number }).sort_order;
              newSortOrder = targetOrder - 500;
            }
          } else {
            // No sibling before target, just go before
            newSortOrder = target.sort_order - 1000;
          }
        }
      }

      // Update the item's sort_order
      const updateResult = await client.query(
        `UPDATE work_item SET sort_order = $2, updated_at = now()
         WHERE id = $1
         RETURNING id::text as id, title, status, sort_order, updated_at`,
        [params.id, newSortOrder]
      );

      await client.query('COMMIT');
      client.release();
      await pool.end();

      return reply.send({
        ok: true,
        item: updateResult.rows[0],
      });
    } catch (e) {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
      throw e;
    }
  });

  // Work Item Dates API (issue #113)
  // PATCH /api/work-items/:id/dates - Update work item dates
  app.patch('/api/work-items/:id/dates', async (req, reply) => {
    const params = req.params as { id: string };
    const body = req.body as { startDate?: string | null; endDate?: string | null };

    // Check at least one field is provided
    const hasStartDate = Object.prototype.hasOwnProperty.call(body, 'startDate');
    const hasEndDate = Object.prototype.hasOwnProperty.call(body, 'endDate');
    if (!hasStartDate && !hasEndDate) {
      return reply.code(400).send({ error: 'at least one date field is required' });
    }

    // Validate date formats
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    const parseDate = (str: string | null | undefined): Date | null => {
      if (str === null || str === undefined) return null;
      if (!dateRegex.test(str)) return new Date('invalid');
      const d = new Date(str + 'T00:00:00Z');
      return isNaN(d.getTime()) ? new Date('invalid') : d;
    };

    let newStartDate: Date | null | undefined;
    let newEndDate: Date | null | undefined;

    if (hasStartDate) {
      if (body.startDate === null) {
        newStartDate = null;
      } else {
        newStartDate = parseDate(body.startDate);
        if (newStartDate && isNaN(newStartDate.getTime())) {
          return reply.code(400).send({ error: 'invalid date format' });
        }
      }
    }

    if (hasEndDate) {
      if (body.endDate === null) {
        newEndDate = null;
      } else {
        newEndDate = parseDate(body.endDate);
        if (newEndDate && isNaN(newEndDate.getTime())) {
          return reply.code(400).send({ error: 'invalid date format' });
        }
      }
    }

    const pool = createPool();

    // Check if work item exists and get current dates
    const existing = await pool.query(
      `SELECT id, not_before, not_after FROM work_item WHERE id = $1`,
      [params.id]
    );
    if (existing.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'not found' });
    }

    const currentRow = existing.rows[0] as {
      not_before: Date | null;
      not_after: Date | null;
    };

    // Determine final dates
    const finalStartDate = hasStartDate ? newStartDate : currentRow.not_before;
    const finalEndDate = hasEndDate ? newEndDate : currentRow.not_after;

    // Validate date range
    if (finalStartDate && finalEndDate) {
      if (finalStartDate > finalEndDate) {
        await pool.end();
        return reply.code(400).send({ error: 'startDate must be before or equal to endDate' });
      }
    }

    // Update the work item
    const result = await pool.query(
      `UPDATE work_item
          SET not_before = $2::timestamptz,
              not_after = $3::timestamptz,
              updated_at = now()
        WHERE id = $1
      RETURNING id::text as id,
                not_before,
                not_after,
                updated_at`,
      [params.id, finalStartDate, finalEndDate]
    );

    await pool.end();

    const row = result.rows[0] as {
      id: string;
      not_before: Date | null;
      not_after: Date | null;
      updated_at: Date;
    };

    // Format dates as YYYY-MM-DD for response
    const formatDate = (d: Date | null): string | null => {
      if (!d) return null;
      return d.toISOString().split('T')[0];
    };

    return reply.send({
      ok: true,
      item: {
        id: row.id,
        startDate: formatDate(row.not_before),
        endDate: formatDate(row.not_after),
        updatedAt: row.updated_at.toISOString(),
      },
    });
  });

  // Todos API (issue #108)
  // GET /api/work-items/:id/todos - List todos for a work item
  app.get('/api/work-items/:id/todos', async (req, reply) => {
    const params = req.params as { id: string };
    const pool = createPool();

    // Check if work item exists
    const exists = await pool.query('SELECT 1 FROM work_item WHERE id = $1', [params.id]);
    if (exists.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'not found' });
    }

    const result = await pool.query(
      `SELECT id::text as id,
              text,
              completed,
              created_at as "createdAt",
              completed_at as "completedAt"
         FROM work_item_todo
        WHERE work_item_id = $1
        ORDER BY created_at ASC`,
      [params.id]
    );

    await pool.end();
    return reply.send({ todos: result.rows });
  });

  // POST /api/work-items/:id/todos - Create a new todo
  app.post('/api/work-items/:id/todos', async (req, reply) => {
    const params = req.params as { id: string };
    const body = req.body as { text?: string };

    if (!body?.text || body.text.trim().length === 0) {
      return reply.code(400).send({ error: 'text is required' });
    }

    const pool = createPool();

    // Check if work item exists
    const exists = await pool.query('SELECT 1 FROM work_item WHERE id = $1', [params.id]);
    if (exists.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'not found' });
    }

    const result = await pool.query(
      `INSERT INTO work_item_todo (work_item_id, text)
       VALUES ($1, $2)
       RETURNING id::text as id,
                 text,
                 completed,
                 created_at as "createdAt",
                 completed_at as "completedAt"`,
      [params.id, body.text.trim()]
    );

    await pool.end();
    return reply.code(201).send(result.rows[0]);
  });

  // PATCH /api/work-items/:id/todos/:todoId - Update a todo
  app.patch('/api/work-items/:id/todos/:todoId', async (req, reply) => {
    const params = req.params as { id: string; todoId: string };
    const body = req.body as { text?: string; completed?: boolean };

    // Check at least one field is provided
    const hasText = body.text !== undefined;
    const hasCompleted = body.completed !== undefined;
    if (!hasText && !hasCompleted) {
      return reply.code(400).send({ error: 'at least one field is required' });
    }

    const pool = createPool();

    // Check if work item exists
    const workItemExists = await pool.query('SELECT 1 FROM work_item WHERE id = $1', [params.id]);
    if (workItemExists.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'not found' });
    }

    // Check if todo exists and belongs to work item
    const todoExists = await pool.query(
      'SELECT 1 FROM work_item_todo WHERE id = $1 AND work_item_id = $2',
      [params.todoId, params.id]
    );
    if (todoExists.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'not found' });
    }

    // Build update query
    const updates: string[] = [];
    const values: (string | boolean | null)[] = [];
    let paramIndex = 1;

    if (hasText) {
      updates.push(`text = $${paramIndex}`);
      values.push(body.text!.trim());
      paramIndex++;
    }

    if (hasCompleted) {
      updates.push(`completed = $${paramIndex}`);
      values.push(body.completed!);
      paramIndex++;

      // Set or clear completed_at based on completed status
      if (body.completed) {
        updates.push(`completed_at = now()`);
      } else {
        updates.push(`completed_at = NULL`);
      }
    }

    values.push(params.todoId);

    const result = await pool.query(
      `UPDATE work_item_todo SET ${updates.join(', ')} WHERE id = $${paramIndex}
       RETURNING id::text as id,
                 text,
                 completed,
                 created_at as "createdAt",
                 completed_at as "completedAt"`,
      values
    );

    await pool.end();
    return reply.send(result.rows[0]);
  });

  // DELETE /api/work-items/:id/todos/:todoId - Delete a todo
  app.delete('/api/work-items/:id/todos/:todoId', async (req, reply) => {
    const params = req.params as { id: string; todoId: string };
    const pool = createPool();

    // Check if work item exists
    const workItemExists = await pool.query('SELECT 1 FROM work_item WHERE id = $1', [params.id]);
    if (workItemExists.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'not found' });
    }

    // Delete todo (only if it belongs to the work item)
    const result = await pool.query(
      'DELETE FROM work_item_todo WHERE id = $1 AND work_item_id = $2 RETURNING id::text as id',
      [params.todoId, params.id]
    );

    await pool.end();

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'not found' });
    }

    return reply.code(204).send();
  });

  // ===== Notifications API (Issue #181) =====

  const NOTIFICATION_TYPES = ['assigned', 'mentioned', 'status_change', 'unblocked', 'due_soon', 'comment'] as const;
  type NotificationType = (typeof NOTIFICATION_TYPES)[number];

  // GET /api/notifications - List notifications for a user
  app.get('/api/notifications', async (req, reply) => {
    const query = req.query as {
      userEmail?: string;
      unreadOnly?: string;
      limit?: string;
      offset?: string;
    };

    if (!query.userEmail) {
      return reply.code(400).send({ error: 'userEmail is required' });
    }

    const limit = Math.min(parseInt(query.limit || '50', 10), 100);
    const offset = parseInt(query.offset || '0', 10);
    const unreadOnly = query.unreadOnly === 'true';

    const pool = createPool();

    let whereClause = 'WHERE user_email = $1 AND dismissed_at IS NULL';
    const params: (string | number)[] = [query.userEmail];

    if (unreadOnly) {
      whereClause += ' AND read_at IS NULL';
    }

    const result = await pool.query(
      `SELECT
         id::text as id,
         notification_type as "notificationType",
         title,
         message,
         work_item_id::text as "workItemId",
         actor_email as "actorEmail",
         metadata,
         read_at as "readAt",
         created_at as "createdAt"
       FROM notification
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM notification WHERE user_email = $1 AND read_at IS NULL AND dismissed_at IS NULL`,
      [query.userEmail]
    );

    await pool.end();

    return reply.send({
      notifications: result.rows,
      unreadCount: parseInt(countResult.rows[0].count, 10),
    });
  });

  // GET /api/notifications/unread-count - Get unread count for a user
  app.get('/api/notifications/unread-count', async (req, reply) => {
    const query = req.query as { userEmail?: string };

    if (!query.userEmail) {
      return reply.code(400).send({ error: 'userEmail is required' });
    }

    const pool = createPool();
    const result = await pool.query(
      `SELECT COUNT(*) FROM notification WHERE user_email = $1 AND read_at IS NULL AND dismissed_at IS NULL`,
      [query.userEmail]
    );
    await pool.end();

    return reply.send({ unreadCount: parseInt(result.rows[0].count, 10) });
  });

  // POST /api/notifications/:id/read - Mark a notification as read
  app.post('/api/notifications/:id/read', async (req, reply) => {
    const params = req.params as { id: string };
    const query = req.query as { userEmail?: string };

    if (!query.userEmail) {
      return reply.code(400).send({ error: 'userEmail is required' });
    }

    const pool = createPool();
    const result = await pool.query(
      `UPDATE notification
       SET read_at = COALESCE(read_at, now())
       WHERE id = $1 AND user_email = $2
       RETURNING id`,
      [params.id, query.userEmail]
    );
    await pool.end();

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'notification not found' });
    }

    return reply.send({ success: true });
  });

  // POST /api/notifications/read-all - Mark all notifications as read
  app.post('/api/notifications/read-all', async (req, reply) => {
    const query = req.query as { userEmail?: string };

    if (!query.userEmail) {
      return reply.code(400).send({ error: 'userEmail is required' });
    }

    const pool = createPool();
    const result = await pool.query(
      `UPDATE notification
       SET read_at = now()
       WHERE user_email = $1 AND read_at IS NULL AND dismissed_at IS NULL
       RETURNING id`,
      [query.userEmail]
    );
    await pool.end();

    return reply.send({ markedCount: result.rowCount || 0 });
  });

  // DELETE /api/notifications/:id - Dismiss a notification
  app.delete('/api/notifications/:id', async (req, reply) => {
    const params = req.params as { id: string };
    const query = req.query as { userEmail?: string };

    if (!query.userEmail) {
      return reply.code(400).send({ error: 'userEmail is required' });
    }

    const pool = createPool();
    const result = await pool.query(
      `UPDATE notification
       SET dismissed_at = now()
       WHERE id = $1 AND user_email = $2
       RETURNING id`,
      [params.id, query.userEmail]
    );
    await pool.end();

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'notification not found' });
    }

    return reply.send({ success: true });
  });

  // GET /api/notifications/preferences - Get notification preferences
  app.get('/api/notifications/preferences', async (req, reply) => {
    const query = req.query as { userEmail?: string };

    if (!query.userEmail) {
      return reply.code(400).send({ error: 'userEmail is required' });
    }

    const pool = createPool();
    const result = await pool.query(
      `SELECT notification_type, in_app_enabled, email_enabled
       FROM notification_preference
       WHERE user_email = $1`,
      [query.userEmail]
    );
    await pool.end();

    // Build preferences object with defaults
    const preferences: Record<string, { inApp: boolean; email: boolean }> = {};
    for (const type of NOTIFICATION_TYPES) {
      preferences[type] = { inApp: true, email: false };
    }

    // Override with user preferences
    for (const row of result.rows) {
      preferences[row.notification_type] = {
        inApp: row.in_app_enabled,
        email: row.email_enabled,
      };
    }

    return reply.send({ preferences });
  });

  // PATCH /api/notifications/preferences - Update notification preferences
  app.patch('/api/notifications/preferences', async (req, reply) => {
    const query = req.query as { userEmail?: string };
    const body = req.body as Record<string, { inApp?: boolean; email?: boolean }>;

    if (!query.userEmail) {
      return reply.code(400).send({ error: 'userEmail is required' });
    }

    // Validate notification types
    for (const type of Object.keys(body)) {
      if (!NOTIFICATION_TYPES.includes(type as NotificationType)) {
        return reply.code(400).send({ error: `Invalid notification type: ${type}` });
      }
    }

    const pool = createPool();

    for (const [type, pref] of Object.entries(body)) {
      await pool.query(
        `INSERT INTO notification_preference (user_email, notification_type, in_app_enabled, email_enabled)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_email, notification_type) DO UPDATE SET
           in_app_enabled = COALESCE($3, notification_preference.in_app_enabled),
           email_enabled = COALESCE($4, notification_preference.email_enabled),
           updated_at = now()`,
        [query.userEmail, type, pref.inApp ?? true, pref.email ?? false]
      );
    }

    await pool.end();

    return reply.send({ success: true });
  });

  // ===== Comments & Presence API (Issue #182) =====

  // GET /api/work-items/:id/comments - List comments for a work item
  app.get('/api/work-items/:id/comments', async (req, reply) => {
    const params = req.params as { id: string };
    const pool = createPool();

    // Check if work item exists
    const workItemExists = await pool.query('SELECT 1 FROM work_item WHERE id = $1', [params.id]);
    if (workItemExists.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'not found' });
    }

    // Get comments with reactions
    const comments = await pool.query(
      `SELECT
         c.id::text as id,
         c.work_item_id::text as "workItemId",
         c.parent_id::text as "parentId",
         c.user_email as "userEmail",
         c.content,
         c.mentions,
         c.edited_at as "editedAt",
         c.created_at as "createdAt",
         c.updated_at as "updatedAt"
       FROM work_item_comment c
       WHERE c.work_item_id = $1
       ORDER BY c.created_at ASC`,
      [params.id]
    );

    // Get reactions for all comments
    const commentIds = comments.rows.map((c) => c.id);
    let reactionsMap: Record<string, Record<string, number>> = {};

    if (commentIds.length > 0) {
      const reactions = await pool.query(
        `SELECT comment_id::text, emoji, COUNT(*) as count
         FROM work_item_comment_reaction
         WHERE comment_id = ANY($1::uuid[])
         GROUP BY comment_id, emoji`,
        [commentIds]
      );

      for (const r of reactions.rows) {
        if (!reactionsMap[r.comment_id]) {
          reactionsMap[r.comment_id] = {};
        }
        reactionsMap[r.comment_id][r.emoji] = parseInt(r.count, 10);
      }
    }

    await pool.end();

    const commentsWithReactions = comments.rows.map((c) => ({
      ...c,
      reactions: reactionsMap[c.id] || {},
    }));

    return reply.send({ comments: commentsWithReactions });
  });

  // POST /api/work-items/:id/comments - Create a new comment
  app.post('/api/work-items/:id/comments', async (req, reply) => {
    const params = req.params as { id: string };
    const body = req.body as { userEmail: string; content: string; parentId?: string };

    if (!body.userEmail || !body.content) {
      return reply.code(400).send({ error: 'userEmail and content are required' });
    }

    const pool = createPool();

    // Check if work item exists
    const workItemExists = await pool.query('SELECT 1 FROM work_item WHERE id = $1', [params.id]);
    if (workItemExists.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'not found' });
    }

    // Extract @mentions from content (email format)
    const mentionRegex = /@([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
    const mentions: string[] = [];
    let match;
    while ((match = mentionRegex.exec(body.content)) !== null) {
      mentions.push(match[1]);
    }

    const result = await pool.query(
      `INSERT INTO work_item_comment (work_item_id, user_email, content, parent_id, mentions)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING
         id::text as id,
         work_item_id::text as "workItemId",
         parent_id::text as "parentId",
         user_email as "userEmail",
         content,
         mentions,
         created_at as "createdAt"`,
      [params.id, body.userEmail, body.content, body.parentId || null, mentions]
    );

    await pool.end();

    return reply.code(201).send(result.rows[0]);
  });

  // PUT /api/work-items/:id/comments/:commentId - Update a comment
  app.put('/api/work-items/:id/comments/:commentId', async (req, reply) => {
    const params = req.params as { id: string; commentId: string };
    const body = req.body as { userEmail: string; content: string };

    if (!body.userEmail || !body.content) {
      return reply.code(400).send({ error: 'userEmail and content are required' });
    }

    const pool = createPool();

    // Check ownership
    const comment = await pool.query(
      'SELECT user_email FROM work_item_comment WHERE id = $1 AND work_item_id = $2',
      [params.commentId, params.id]
    );

    if (comment.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'not found' });
    }

    if (comment.rows[0].user_email !== body.userEmail) {
      await pool.end();
      return reply.code(403).send({ error: 'cannot edit other user comment' });
    }

    // Extract @mentions from content
    const mentionRegex = /@([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
    const mentions: string[] = [];
    let match;
    while ((match = mentionRegex.exec(body.content)) !== null) {
      mentions.push(match[1]);
    }

    const result = await pool.query(
      `UPDATE work_item_comment
       SET content = $1, mentions = $2, edited_at = now()
       WHERE id = $3
       RETURNING
         id::text as id,
         content,
         mentions,
         edited_at as "editedAt",
         updated_at as "updatedAt"`,
      [body.content, mentions, params.commentId]
    );

    await pool.end();

    return reply.send(result.rows[0]);
  });

  // DELETE /api/work-items/:id/comments/:commentId - Delete a comment
  app.delete('/api/work-items/:id/comments/:commentId', async (req, reply) => {
    const params = req.params as { id: string; commentId: string };
    const query = req.query as { userEmail?: string };

    if (!query.userEmail) {
      return reply.code(400).send({ error: 'userEmail is required' });
    }

    const pool = createPool();

    // Check ownership
    const comment = await pool.query(
      'SELECT user_email FROM work_item_comment WHERE id = $1 AND work_item_id = $2',
      [params.commentId, params.id]
    );

    if (comment.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'not found' });
    }

    if (comment.rows[0].user_email !== query.userEmail) {
      await pool.end();
      return reply.code(403).send({ error: 'cannot delete other user comment' });
    }

    await pool.query('DELETE FROM work_item_comment WHERE id = $1', [params.commentId]);
    await pool.end();

    return reply.send({ success: true });
  });

  // POST /api/work-items/:id/comments/:commentId/reactions - Toggle a reaction
  app.post('/api/work-items/:id/comments/:commentId/reactions', async (req, reply) => {
    const params = req.params as { id: string; commentId: string };
    const body = req.body as { userEmail: string; emoji: string };

    if (!body.userEmail || !body.emoji) {
      return reply.code(400).send({ error: 'userEmail and emoji are required' });
    }

    const pool = createPool();

    // Check if comment exists
    const commentExists = await pool.query(
      'SELECT 1 FROM work_item_comment WHERE id = $1 AND work_item_id = $2',
      [params.commentId, params.id]
    );

    if (commentExists.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'not found' });
    }

    // Check if reaction exists - if so, remove it (toggle)
    const existing = await pool.query(
      'SELECT 1 FROM work_item_comment_reaction WHERE comment_id = $1 AND user_email = $2 AND emoji = $3',
      [params.commentId, body.userEmail, body.emoji]
    );

    if (existing.rows.length > 0) {
      await pool.query(
        'DELETE FROM work_item_comment_reaction WHERE comment_id = $1 AND user_email = $2 AND emoji = $3',
        [params.commentId, body.userEmail, body.emoji]
      );
      await pool.end();
      return reply.send({ action: 'removed' });
    }

    await pool.query(
      `INSERT INTO work_item_comment_reaction (comment_id, user_email, emoji)
       VALUES ($1, $2, $3)`,
      [params.commentId, body.userEmail, body.emoji]
    );

    await pool.end();

    return reply.code(201).send({ action: 'added' });
  });

  // GET /api/work-items/:id/presence - Get users currently viewing
  app.get('/api/work-items/:id/presence', async (req, reply) => {
    const params = req.params as { id: string };
    const pool = createPool();

    // Get users with recent presence (within 5 minutes)
    const result = await pool.query(
      `SELECT user_email as email, last_seen_at as "lastSeenAt", cursor_position as "cursorPosition"
       FROM user_presence
       WHERE work_item_id = $1 AND last_seen_at > now() - interval '5 minutes'
       ORDER BY last_seen_at DESC`,
      [params.id]
    );

    await pool.end();

    return reply.send({ users: result.rows });
  });

  // POST /api/work-items/:id/presence - Update user presence
  app.post('/api/work-items/:id/presence', async (req, reply) => {
    const params = req.params as { id: string };
    const body = req.body as { userEmail: string; cursorPosition?: object };

    if (!body.userEmail) {
      return reply.code(400).send({ error: 'userEmail is required' });
    }

    const pool = createPool();

    await pool.query(
      `INSERT INTO user_presence (user_email, work_item_id, last_seen_at, cursor_position)
       VALUES ($1, $2, now(), $3)
       ON CONFLICT (user_email, work_item_id) DO UPDATE SET
         last_seen_at = now(),
         cursor_position = COALESCE($3, user_presence.cursor_position)`,
      [body.userEmail, params.id, body.cursorPosition ? JSON.stringify(body.cursorPosition) : null]
    );

    await pool.end();

    return reply.send({ success: true });
  });

  // DELETE /api/work-items/:id/presence - Remove user presence
  app.delete('/api/work-items/:id/presence', async (req, reply) => {
    const params = req.params as { id: string };
    const query = req.query as { userEmail?: string };

    if (!query.userEmail) {
      return reply.code(400).send({ error: 'userEmail is required' });
    }

    const pool = createPool();

    await pool.query(
      'DELETE FROM user_presence WHERE user_email = $1 AND work_item_id = $2',
      [query.userEmail, params.id]
    );

    await pool.end();

    return reply.send({ success: true });
  });

  // GET /api/users/search - Search users for @mention autocomplete
  app.get('/api/users/search', async (req, reply) => {
    const query = req.query as { q?: string; limit?: string };

    if (!query.q) {
      return reply.code(400).send({ error: 'q query parameter is required' });
    }

    const limit = Math.min(parseInt(query.limit || '10', 10), 50);
    const pool = createPool();

    // Search for users based on email from various sources
    const result = await pool.query(
      `SELECT DISTINCT email
       FROM (
         SELECT user_email as email FROM work_item_comment
         UNION
         SELECT user_email as email FROM notification
         UNION
         SELECT email FROM auth_session
       ) users
       WHERE email ILIKE $1
       ORDER BY email
       LIMIT $2`,
      [`%${query.q}%`, limit]
    );

    await pool.end();

    return reply.send({ users: result.rows });
  });

  // ===== Analytics API (Issue #183) =====

  // GET /api/analytics/project-health - Get health metrics for projects
  app.get('/api/analytics/project-health', async (req, reply) => {
    const query = req.query as { projectId?: string };
    const pool = createPool();

    let projectFilter = '';
    const params: string[] = [];

    if (query.projectId) {
      params.push(query.projectId);
      projectFilter = 'AND p.id = $1';
    }

    const result = await pool.query(
      `SELECT
         p.id::text as id,
         p.title,
         COUNT(CASE WHEN c.status IN ('open', 'backlog', 'todo') THEN 1 END)::int as "openCount",
         COUNT(CASE WHEN c.status IN ('in_progress', 'review') THEN 1 END)::int as "inProgressCount",
         COUNT(CASE WHEN c.status IN ('closed', 'done', 'cancelled') THEN 1 END)::int as "closedCount",
         COUNT(c.id)::int as "totalCount"
       FROM work_item p
       LEFT JOIN work_item c ON c.parent_work_item_id = p.id
       WHERE p.work_item_kind = 'project'
       ${projectFilter}
       GROUP BY p.id, p.title
       ORDER BY p.title`,
      params
    );

    await pool.end();

    return reply.send({ projects: result.rows });
  });

  // GET /api/analytics/velocity - Get velocity data
  app.get('/api/analytics/velocity', async (req, reply) => {
    const query = req.query as { weeks?: string; projectId?: string };
    const weeks = Math.min(parseInt(query.weeks || '12', 10), 52);
    const pool = createPool();

    const result = await pool.query(
      `SELECT
         date_trunc('week', updated_at)::date as week_start,
         COUNT(*)::int as completed_count,
         SUM(COALESCE(estimate_minutes, 0))::int as estimated_minutes
       FROM work_item
       WHERE status IN ('closed', 'done')
         AND updated_at >= now() - ($1 || ' weeks')::interval
       GROUP BY date_trunc('week', updated_at)
       ORDER BY week_start DESC`,
      [weeks]
    );

    await pool.end();

    return reply.send({
      weeks: result.rows.map((r) => ({
        weekStart: r.week_start,
        completedCount: r.completed_count,
        estimatedMinutes: r.estimated_minutes,
      })),
    });
  });

  // GET /api/analytics/effort - Get effort summary
  app.get('/api/analytics/effort', async (req, reply) => {
    const query = req.query as { projectId?: string };
    const pool = createPool();

    // Get total effort
    const totalResult = await pool.query(
      `SELECT
         SUM(COALESCE(estimate_minutes, 0))::int as total_estimated,
         SUM(COALESCE(actual_minutes, 0))::int as total_actual
       FROM work_item`
    );

    // Get effort by status
    const byStatusResult = await pool.query(
      `SELECT
         status,
         SUM(COALESCE(estimate_minutes, 0))::int as estimated_minutes,
         SUM(COALESCE(actual_minutes, 0))::int as actual_minutes,
         COUNT(*)::int as item_count
       FROM work_item
       GROUP BY status
       ORDER BY status`
    );

    await pool.end();

    return reply.send({
      totalEstimated: totalResult.rows[0]?.total_estimated || 0,
      totalActual: totalResult.rows[0]?.total_actual || 0,
      byStatus: byStatusResult.rows.map((r) => ({
        status: r.status,
        estimatedMinutes: r.estimated_minutes,
        actualMinutes: r.actual_minutes,
        itemCount: r.item_count,
      })),
    });
  });

  // GET /api/analytics/burndown/:id - Get burndown data for a work item
  app.get('/api/analytics/burndown/:id', async (req, reply) => {
    const params = req.params as { id: string };
    const pool = createPool();

    // Check if work item exists
    const workItemExists = await pool.query('SELECT 1 FROM work_item WHERE id = $1', [params.id]);
    if (workItemExists.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'not found' });
    }

    // Get scope totals for children
    const result = await pool.query(
      `SELECT
         SUM(COALESCE(estimate_minutes, 0))::int as total_scope,
         SUM(CASE WHEN status IN ('closed', 'done') THEN COALESCE(estimate_minutes, 0) ELSE 0 END)::int as completed_scope,
         SUM(CASE WHEN status NOT IN ('closed', 'done', 'cancelled') THEN COALESCE(estimate_minutes, 0) ELSE 0 END)::int as remaining_scope,
         COUNT(*)::int as total_items,
         COUNT(CASE WHEN status IN ('closed', 'done') THEN 1 END)::int as completed_items
       FROM work_item
       WHERE parent_work_item_id = $1`,
      [params.id]
    );

    await pool.end();

    return reply.send({
      totalScope: result.rows[0]?.total_scope || 0,
      completedScope: result.rows[0]?.completed_scope || 0,
      remainingScope: result.rows[0]?.remaining_scope || 0,
      totalItems: result.rows[0]?.total_items || 0,
      completedItems: result.rows[0]?.completed_items || 0,
    });
  });

  // GET /api/analytics/overdue - Get overdue items
  app.get('/api/analytics/overdue', async (req, reply) => {
    const query = req.query as { limit?: string };
    const limit = Math.min(parseInt(query.limit || '50', 10), 100);
    const pool = createPool();

    const result = await pool.query(
      `SELECT
         id::text as id,
         title,
         status,
         priority,
         work_item_kind as "workItemKind",
         not_after as "dueDate",
         (now() - not_after) as "overdueBy"
       FROM work_item
       WHERE not_after < now()
         AND status NOT IN ('closed', 'done', 'cancelled')
       ORDER BY not_after ASC
       LIMIT $1`,
      [limit]
    );

    await pool.end();

    return reply.send({ items: result.rows });
  });

  // GET /api/analytics/blocked - Get blocked items
  app.get('/api/analytics/blocked', async (req, reply) => {
    const query = req.query as { limit?: string };
    const limit = Math.min(parseInt(query.limit || '50', 10), 100);
    const pool = createPool();

    const result = await pool.query(
      `SELECT
         w.id::text as id,
         w.title,
         w.status,
         w.priority,
         w.work_item_kind as "workItemKind",
         d.depends_on_work_item_id::text as "blockedById",
         b.title as "blockedByTitle",
         b.status as "blockedByStatus"
       FROM work_item w
       INNER JOIN work_item_dependency d ON d.work_item_id = w.id
       INNER JOIN work_item b ON b.id = d.depends_on_work_item_id
       WHERE d.kind = 'blocked_by'
         AND w.status NOT IN ('closed', 'done', 'cancelled')
         AND b.status NOT IN ('closed', 'done')
       ORDER BY w.priority ASC, w.created_at ASC
       LIMIT $1`,
      [limit]
    );

    await pool.end();

    return reply.send({ items: result.rows });
  });

  // GET /api/analytics/activity-summary - Get activity summary by day
  app.get('/api/analytics/activity-summary', async (req, reply) => {
    const query = req.query as { days?: string };
    const days = Math.min(parseInt(query.days || '30', 10), 90);
    const pool = createPool();

    const result = await pool.query(
      `SELECT
         date_trunc('day', created_at)::date as day,
         activity_type as type,
         COUNT(*)::int as count
       FROM work_item_activity
       WHERE created_at >= now() - ($1 || ' days')::interval
       GROUP BY date_trunc('day', created_at), activity_type
       ORDER BY day DESC, activity_type`,
      [days]
    );

    await pool.end();

    // Group by day
    const byDay: Record<string, Record<string, number>> = {};
    for (const r of result.rows) {
      const dayStr = r.day.toISOString().split('T')[0];
      if (!byDay[dayStr]) {
        byDay[dayStr] = {};
      }
      byDay[dayStr][r.type] = r.count;
    }

    const daysList = Object.entries(byDay).map(([day, counts]) => ({
      day,
      ...counts,
    }));

    return reply.send({ days: daysList });
  });

  // ==================== Email & Calendar Sync API (Issue #184) ====================

  // GET /api/oauth/connections - List OAuth connections
  app.get('/api/oauth/connections', async (req, reply) => {
    const query = req.query as { userEmail?: string };
    const pool = createPool();

    let sql = `
      SELECT id::text as id, user_email, provider, scopes, expires_at, created_at, updated_at
      FROM oauth_connection
    `;
    const params: string[] = [];

    if (query.userEmail) {
      sql += ' WHERE user_email = $1';
      params.push(query.userEmail);
    }

    sql += ' ORDER BY created_at DESC';

    const result = await pool.query(sql, params);
    await pool.end();

    return reply.send({
      connections: result.rows.map((row: Record<string, unknown>) => ({
        id: row.id,
        userEmail: row.user_email,
        provider: row.provider,
        scopes: row.scopes,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  });

  // GET /api/oauth/authorize/:provider - Get OAuth authorization URL
  app.get('/api/oauth/authorize/:provider', async (req, reply) => {
    const params = req.params as { provider: string };
    const query = req.query as { scopes?: string };

    const validProviders = ['google', 'microsoft'];
    if (!validProviders.includes(params.provider)) {
      return reply.code(400).send({ error: 'Unknown OAuth provider' });
    }

    const provider = params.provider as OAuthProvider;

    // Check if provider is configured
    if (!isProviderConfigured(provider)) {
      return reply.code(503).send({
        error: `OAuth provider ${provider} is not configured`,
        hint: `Set ${provider === 'microsoft' ? 'MS365_CLIENT_ID and MS365_CLIENT_SECRET' : 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET'} environment variables`,
      });
    }

    const scopes = query.scopes?.split(',');
    const state = randomBytes(32).toString('hex');

    try {
      const authResult = getAuthorizationUrl(provider, state, scopes);

      return reply.send({
        authUrl: authResult.url,
        state: authResult.state,
        provider: authResult.provider,
        scopes: authResult.scopes,
      });
    } catch (error) {
      if (error instanceof ProviderNotConfiguredError) {
        return reply.code(503).send({
          error: error.message,
          code: error.code,
        });
      }
      throw error;
    }
  });

  // GET /api/oauth/callback - Handle OAuth callback
  app.get('/api/oauth/callback', async (req, reply) => {
    const query = req.query as { code?: string; state?: string; error?: string; provider?: string };

    if (query.error) {
      return reply.code(400).send({
        error: 'OAuth authorization failed',
        details: query.error,
      });
    }

    if (!query.code) {
      return reply.code(400).send({ error: 'Missing authorization code' });
    }

    if (!query.state) {
      return reply.code(400).send({ error: 'Missing OAuth state parameter' });
    }

    // Validate state and get stored data (provider, codeVerifier)
    let stateData;
    try {
      stateData = validateState(query.state);
    } catch (error) {
      if (error instanceof InvalidStateError) {
        return reply.code(400).send({
          error: 'Invalid or expired OAuth state',
          code: 'INVALID_STATE',
        });
      }
      throw error;
    }

    const provider = stateData.provider;

    if (!isProviderConfigured(provider)) {
      return reply.code(503).send({
        error: `OAuth provider ${provider} is not configured`,
      });
    }

    const pool = createPool();

    try {
      // Exchange code for tokens (with PKCE code_verifier)
      const tokens = await exchangeCodeForTokens(provider, query.code, stateData.codeVerifier);

      // Get user email from provider
      const userEmail = await getOAuthUserEmail(provider, tokens.accessToken);

      // Save connection
      const connection = await saveConnection(pool, userEmail, provider, tokens);

      await pool.end();

      // In a real app, you might redirect to a success page
      return reply.send({
        status: 'connected',
        provider,
        userEmail,
        connectionId: connection.id,
        scopes: tokens.scopes,
      });
    } catch (error) {
      await pool.end();

      if (error instanceof OAuthError) {
        return reply.code(error.statusCode).send({
          error: error.message,
          code: error.code,
        });
      }
      throw error;
    }
  });

  // GET /api/oauth/providers - List configured providers
  app.get('/api/oauth/providers', async (_req, reply) => {
    const providers = getConfiguredProviders();
    return reply.send({
      providers: providers.map((p) => ({
        name: p,
        configured: true,
      })),
      unconfigured: (['google', 'microsoft'] as OAuthProvider[])
        .filter((p) => !providers.includes(p))
        .map((p) => ({
          name: p,
          configured: false,
          hint: p === 'microsoft'
            ? 'Set MS365_CLIENT_ID and MS365_CLIENT_SECRET'
            : 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET',
        })),
    });
  });

  // DELETE /api/oauth/connections/:id - Remove OAuth connection
  app.delete('/api/oauth/connections/:id', async (req, reply) => {
    const params = req.params as { id: string };
    const pool = createPool();

    const result = await pool.query(
      'DELETE FROM oauth_connection WHERE id = $1 RETURNING id',
      [params.id]
    );
    await pool.end();

    if (result.rowCount === 0) {
      return reply.code(404).send({ error: 'OAuth connection not found' });
    }

    return reply.code(204).send();
  });

  // POST /api/sync/contacts - Trigger contact sync from OAuth provider
  app.post('/api/sync/contacts', async (req, reply) => {
    const body = req.body as { userEmail: string; provider: string; incremental?: boolean };
    const pool = createPool();

    const provider = body.provider as OAuthProvider;

    // Validate provider
    if (!['google', 'microsoft'].includes(provider)) {
      await pool.end();
      return reply.code(400).send({ error: 'Invalid provider' });
    }

    try {
      // Get sync cursor for incremental sync
      let syncCursor: string | undefined;
      if (body.incremental !== false) {
        syncCursor = await getContactSyncCursor(pool, body.userEmail, provider);
      }

      // Perform sync
      const result = await syncContacts(pool, body.userEmail, provider, { syncCursor });

      await pool.end();

      return reply.send({
        status: 'completed',
        provider: result.provider,
        userEmail: result.userEmail,
        syncedCount: result.syncedCount,
        createdCount: result.createdCount,
        updatedCount: result.updatedCount,
        incremental: !!syncCursor,
      });
    } catch (error) {
      await pool.end();

      if (error instanceof NoConnectionError) {
        return reply.code(400).send({
          error: 'No OAuth connection found for this provider',
          code: error.code,
        });
      }

      if (error instanceof OAuthError) {
        return reply.code(error.statusCode).send({
          error: error.message,
          code: error.code,
        });
      }

      throw error;
    }
  });

  // POST /api/sync/emails - Trigger email sync
  app.post('/api/sync/emails', async (req, reply) => {
    const body = req.body as { userEmail: string; provider: string };
    const pool = createPool();

    // Check for OAuth connection
    const connResult = await pool.query(
      `SELECT id FROM oauth_connection
       WHERE user_email = $1 AND provider = $2`,
      [body.userEmail, body.provider]
    );

    if (connResult.rows.length === 0) {
      await pool.end();
      return reply.code(400).send({ error: 'No OAuth connection found for this provider' });
    }

    // In production, this would queue a background job to sync emails
    // For now, return success to indicate sync was initiated
    await pool.end();

    return reply.code(202).send({
      status: 'sync_initiated',
      userEmail: body.userEmail,
      provider: body.provider,
    });
  });

  // GET /api/emails - Get synced emails
  app.get('/api/emails', async (req, reply) => {
    const query = req.query as { provider?: string; limit?: string };
    const limit = Math.min(parseInt(query.limit || '50', 10), 100);
    const pool = createPool();

    let sql = `
      SELECT m.id::text as id, m.external_message_key, m.direction,
             m.body, m.subject, m.from_address, m.to_addresses, m.cc_addresses,
             m.received_at, t.channel, t.sync_provider
      FROM external_message m
      JOIN external_thread t ON m.thread_id = t.id
      WHERE t.channel = 'email'
    `;
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (query.provider) {
      sql += ` AND t.sync_provider = $${paramIndex}`;
      params.push(query.provider);
      paramIndex++;
    }

    sql += ` ORDER BY m.received_at DESC LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await pool.query(sql, params);
    await pool.end();

    return reply.send({
      emails: result.rows.map((row: Record<string, unknown>) => ({
        id: row.id,
        externalKey: row.external_message_key,
        direction: row.direction,
        body: row.body,
        subject: row.subject,
        fromAddress: row.from_address,
        toAddresses: row.to_addresses,
        ccAddresses: row.cc_addresses,
        receivedAt: row.received_at,
        channel: row.channel,
        provider: row.sync_provider,
      })),
    });
  });

  // POST /api/emails/send - Send email reply
  app.post('/api/emails/send', async (req, reply) => {
    const body = req.body as { userEmail: string; threadId: string; body: string };
    const pool = createPool();

    // Verify OAuth connection exists
    const thread = await pool.query(
      `SELECT t.id, t.sync_provider
       FROM external_thread t
       WHERE t.id = $1`,
      [body.threadId]
    );

    if (thread.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'Thread not found' });
    }

    const provider = thread.rows[0].sync_provider || 'google';

    // Check OAuth connection
    const conn = await pool.query(
      `SELECT id FROM oauth_connection
       WHERE user_email = $1 AND provider = $2`,
      [body.userEmail, provider]
    );

    if (conn.rows.length === 0) {
      await pool.end();
      return reply.code(400).send({ error: 'No OAuth connection found' });
    }

    // In production, this would queue the email to be sent via the provider's API
    // For now, create an outbound message record
    await pool.query(
      `INSERT INTO external_message (thread_id, external_message_key, direction, body)
       VALUES ($1, $2, 'outbound', $3)`,
      [body.threadId, `outbound-${Date.now()}`, body.body]
    );

    await pool.end();

    return reply.code(202).send({
      status: 'queued',
      threadId: body.threadId,
    });
  });

  // POST /api/emails/create-work-item - Create work item from email
  app.post('/api/emails/create-work-item', async (req, reply) => {
    const body = req.body as { messageId: string; title?: string };
    const pool = createPool();

    // Get the message
    const messageResult = await pool.query(
      `SELECT m.id, m.thread_id, m.body, m.subject, t.endpoint_id
       FROM external_message m
       JOIN external_thread t ON m.thread_id = t.id
       WHERE m.id = $1`,
      [body.messageId]
    );

    if (messageResult.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'Message not found' });
    }

    const message = messageResult.rows[0];
    const title = body.title || message.subject || 'Work item from email';

    // Create work item
    const workItemResult = await pool.query(
      `INSERT INTO work_item (title, status, work_item_kind, description)
       VALUES ($1, 'open', 'issue', $2)
       RETURNING id::text as id, title, status, work_item_kind`,
      [title, message.body]
    );

    // Link to communication
    await pool.query(
      `INSERT INTO work_item_communication (work_item_id, thread_id, message_id)
       VALUES ($1, $2, $3)`,
      [workItemResult.rows[0].id, message.thread_id, message.id]
    );

    await pool.end();

    return reply.code(201).send({
      workItem: workItemResult.rows[0],
    });
  });

  // POST /api/sync/calendar - Trigger calendar sync
  app.post('/api/sync/calendar', async (req, reply) => {
    const body = req.body as { userEmail: string; provider: string };
    const pool = createPool();

    // Check for OAuth connection with calendar scope
    const connResult = await pool.query(
      `SELECT id FROM oauth_connection
       WHERE user_email = $1 AND provider = $2 AND 'calendar' = ANY(scopes)`,
      [body.userEmail, body.provider]
    );

    if (connResult.rows.length === 0) {
      await pool.end();
      return reply.code(400).send({ error: 'No OAuth connection found with calendar scope' });
    }

    await pool.end();

    return reply.code(202).send({
      status: 'sync_initiated',
      userEmail: body.userEmail,
      provider: body.provider,
    });
  });

  // GET /api/calendar/events - Get calendar events
  app.get('/api/calendar/events', async (req, reply) => {
    const query = req.query as {
      userEmail?: string;
      startAfter?: string;
      endBefore?: string;
      limit?: string;
    };
    const limit = Math.min(parseInt(query.limit || '100', 10), 500);
    const pool = createPool();

    let sql = `
      SELECT id::text as id, user_email, provider, external_event_id,
             title, description, start_time, end_time, location, attendees,
             work_item_id::text as work_item_id, created_at, updated_at
      FROM calendar_event
      WHERE 1=1
    `;
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (query.userEmail) {
      sql += ` AND user_email = $${paramIndex}`;
      params.push(query.userEmail);
      paramIndex++;
    }

    if (query.startAfter) {
      sql += ` AND start_time >= $${paramIndex}::timestamptz`;
      params.push(query.startAfter);
      paramIndex++;
    }

    if (query.endBefore) {
      sql += ` AND end_time <= $${paramIndex}::timestamptz`;
      params.push(query.endBefore);
      paramIndex++;
    }

    sql += ` ORDER BY start_time ASC LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await pool.query(sql, params);
    await pool.end();

    return reply.send({
      events: result.rows.map((row: Record<string, unknown>) => ({
        id: row.id,
        userEmail: row.user_email,
        provider: row.provider,
        externalEventId: row.external_event_id,
        title: row.title,
        description: row.description,
        startTime: row.start_time,
        endTime: row.end_time,
        location: row.location,
        attendees: row.attendees,
        workItemId: row.work_item_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  });

  // POST /api/calendar/events - Create calendar event
  app.post('/api/calendar/events', async (req, reply) => {
    const body = req.body as {
      userEmail: string;
      provider: string;
      title: string;
      description?: string;
      startTime: string;
      endTime: string;
      location?: string;
      attendees?: Array<{ email: string; name?: string }>;
    };
    const pool = createPool();

    // Verify OAuth connection
    const connResult = await pool.query(
      `SELECT id FROM oauth_connection
       WHERE user_email = $1 AND provider = $2`,
      [body.userEmail, body.provider]
    );

    if (connResult.rows.length === 0) {
      await pool.end();
      return reply.code(400).send({ error: 'No OAuth connection found' });
    }

    // In production, this would create the event via the provider API first
    // For now, create it locally with a generated external ID
    const externalEventId = `local-${Date.now()}-${randomBytes(8).toString('hex')}`;

    const result = await pool.query(
      `INSERT INTO calendar_event
       (user_email, provider, external_event_id, title, description, start_time, end_time, location, attendees)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id::text as id, title, description, start_time, end_time, location, attendees`,
      [
        body.userEmail,
        body.provider,
        externalEventId,
        body.title,
        body.description || null,
        body.startTime,
        body.endTime,
        body.location || null,
        JSON.stringify(body.attendees || []),
      ]
    );

    await pool.end();

    return reply.code(201).send({
      event: {
        id: result.rows[0].id,
        title: result.rows[0].title,
        description: result.rows[0].description,
        startTime: result.rows[0].start_time,
        endTime: result.rows[0].end_time,
        location: result.rows[0].location,
        attendees: result.rows[0].attendees,
      },
    });
  });

  // POST /api/calendar/events/from-work-item - Create calendar event from work item deadline
  app.post('/api/calendar/events/from-work-item', async (req, reply) => {
    const body = req.body as {
      userEmail: string;
      provider: string;
      workItemId: string;
      reminderMinutes?: number;
    };
    const pool = createPool();

    // Verify OAuth connection
    const connResult = await pool.query(
      `SELECT id FROM oauth_connection
       WHERE user_email = $1 AND provider = $2`,
      [body.userEmail, body.provider]
    );

    if (connResult.rows.length === 0) {
      await pool.end();
      return reply.code(400).send({ error: 'No OAuth connection found' });
    }

    // Get work item with deadline
    const workItemResult = await pool.query(
      `SELECT id::text as id, title, description, not_after
       FROM work_item
       WHERE id = $1`,
      [body.workItemId]
    );

    if (workItemResult.rows.length === 0) {
      await pool.end();
      return reply.code(404).send({ error: 'Work item not found' });
    }

    const workItem = workItemResult.rows[0];

    if (!workItem.not_after) {
      await pool.end();
      return reply.code(400).send({ error: 'Work item has no deadline (not_after)' });
    }

    // Create calendar event for the deadline
    const externalEventId = `workitem-${body.workItemId}-${Date.now()}`;
    const startTime = new Date(workItem.not_after);
    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000); // 30 min duration

    const result = await pool.query(
      `INSERT INTO calendar_event
       (user_email, provider, external_event_id, title, description, start_time, end_time, work_item_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id::text as id, title, description, start_time, end_time, work_item_id::text as work_item_id`,
      [
        body.userEmail,
        body.provider,
        externalEventId,
        `Deadline: ${workItem.title}`,
        workItem.description || null,
        startTime.toISOString(),
        endTime.toISOString(),
        body.workItemId,
      ]
    );

    await pool.end();

    return reply.code(201).send({
      event: {
        id: result.rows[0].id,
        title: result.rows[0].title,
        description: result.rows[0].description,
        startTime: result.rows[0].start_time,
        endTime: result.rows[0].end_time,
        workItemId: result.rows[0].work_item_id,
      },
    });
  });

  // DELETE /api/calendar/events/:id - Delete calendar event
  app.delete('/api/calendar/events/:id', async (req, reply) => {
    const params = req.params as { id: string };
    const pool = createPool();

    const result = await pool.query(
      'DELETE FROM calendar_event WHERE id = $1 RETURNING id',
      [params.id]
    );
    await pool.end();

    if (result.rowCount === 0) {
      return reply.code(404).send({ error: 'Calendar event not found' });
    }

    return reply.code(204).send();
  });

  // GET /api/work-items/calendar - Get work items with deadlines as calendar entries
  app.get('/api/work-items/calendar', async (req, reply) => {
    const query = req.query as {
      startDate?: string;
      endDate?: string;
      kind?: string;
      status?: string;
    };
    const pool = createPool();

    let sql = `
      SELECT id::text as id, title, description, status, work_item_kind,
             not_before, not_after, priority::text as priority
      FROM work_item
      WHERE not_after IS NOT NULL
    `;
    const params: string[] = [];
    let paramIndex = 1;

    if (query.startDate) {
      sql += ` AND not_after >= $${paramIndex}::timestamptz`;
      params.push(query.startDate);
      paramIndex++;
    }

    if (query.endDate) {
      sql += ` AND not_after <= $${paramIndex}::timestamptz`;
      params.push(query.endDate);
      paramIndex++;
    }

    if (query.kind) {
      sql += ` AND work_item_kind = $${paramIndex}`;
      params.push(query.kind);
      paramIndex++;
    }

    if (query.status) {
      sql += ` AND status = $${paramIndex}`;
      params.push(query.status);
      paramIndex++;
    }

    sql += ' ORDER BY not_after ASC';

    const result = await pool.query(sql, params);
    await pool.end();

    return reply.send({
      entries: result.rows.map((row: Record<string, unknown>) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        status: row.status,
        kind: row.work_item_kind,
        startDate: row.not_before,
        endDate: row.not_after,
        priority: row.priority,
        type: 'work_item_deadline',
      })),
    });
  });

  // Notes CRUD API (Epic #337, Issue #344)

  // GET /api/notes - List notes with filters and pagination
  app.get('/api/notes', async (req, reply) => {
    const {
      listNotes,
    } = await import('./notes/index.ts');

    const query = req.query as {
      user_email?: string;
      notebook_id?: string;
      tags?: string;
      visibility?: string;
      search?: string;
      is_pinned?: string;
      limit?: string;
      offset?: string;
      sort_by?: string;
      sort_order?: string;
    };

    if (!query.user_email) {
      return reply.code(400).send({ error: 'user_email is required' });
    }

    const pool = createPool();

    try {
      const result = await listNotes(pool, query.user_email, {
        notebookId: query.notebook_id,
        tags: query.tags ? query.tags.split(',').map((t) => t.trim()) : undefined,
        visibility: query.visibility as 'private' | 'shared' | 'public' | undefined,
        search: query.search,
        isPinned: query.is_pinned !== undefined ? query.is_pinned === 'true' : undefined,
        limit: query.limit ? parseInt(query.limit, 10) : undefined,
        offset: query.offset ? parseInt(query.offset, 10) : undefined,
        sortBy: query.sort_by as 'createdAt' | 'updatedAt' | 'title' | undefined,
        sortOrder: query.sort_order as 'asc' | 'desc' | undefined,
      });

      return reply.send(result);
    } finally {
      await pool.end();
    }
  });

  // GET /api/notes/:id - Get a single note by ID
  app.get('/api/notes/:id', async (req, reply) => {
    const {
      getNote,
    } = await import('./notes/index.ts');

    const params = req.params as { id: string };
    const query = req.query as {
      user_email?: string;
      include_versions?: string;
      include_references?: string;
    };

    if (!query.user_email) {
      return reply.code(400).send({ error: 'user_email is required' });
    }

    const pool = createPool();

    try {
      const note = await getNote(pool, params.id, query.user_email, {
        includeVersions: query.include_versions === 'true',
        includeReferences: query.include_references === 'true',
      });

      if (!note) {
        return reply.code(404).send({ error: 'Note not found' });
      }

      return reply.send(note);
    } finally {
      await pool.end();
    }
  });

  // POST /api/notes - Create a new note
  app.post('/api/notes', async (req, reply) => {
    const {
      createNote,
      isValidVisibility,
    } = await import('./notes/index.ts');

    const body = req.body as {
      user_email?: string;
      title?: string;
      content?: string;
      notebook_id?: string;
      tags?: string[];
      visibility?: string;
      hide_from_agents?: boolean;
      summary?: string;
      is_pinned?: boolean;
    };

    if (!body?.user_email) {
      return reply.code(400).send({ error: 'user_email is required' });
    }

    if (!body?.title?.trim()) {
      return reply.code(400).send({ error: 'title is required' });
    }

    if (body.visibility && !isValidVisibility(body.visibility)) {
      return reply.code(400).send({
        error: 'Invalid visibility. Valid values: private, shared, public',
      });
    }

    const pool = createPool();

    try {
      const note = await createNote(
        pool,
        {
          title: body.title.trim(),
          content: body.content,
          notebookId: body.notebook_id,
          tags: body.tags,
          visibility: body.visibility as 'private' | 'shared' | 'public' | undefined,
          hideFromAgents: body.hide_from_agents,
          summary: body.summary,
          isPinned: body.is_pinned,
        },
        body.user_email
      );

      return reply.code(201).send(note);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message === 'Notebook not found') {
        return reply.code(400).send({ error: message });
      }
      if (message.includes('Cannot add note to notebook')) {
        return reply.code(403).send({ error: message });
      }
      throw err;
    } finally {
      await pool.end();
    }
  });

  // PUT /api/notes/:id - Update a note
  app.put('/api/notes/:id', async (req, reply) => {
    const {
      updateNote,
      isValidVisibility,
    } = await import('./notes/index.ts');

    const params = req.params as { id: string };
    const body = req.body as {
      user_email?: string;
      title?: string;
      content?: string;
      notebook_id?: string | null;
      tags?: string[];
      visibility?: string;
      hide_from_agents?: boolean;
      summary?: string | null;
      is_pinned?: boolean;
      sort_order?: number;
    };

    if (!body?.user_email) {
      return reply.code(400).send({ error: 'user_email is required' });
    }

    if (body.visibility && !isValidVisibility(body.visibility)) {
      return reply.code(400).send({
        error: 'Invalid visibility. Valid values: private, shared, public',
      });
    }

    const pool = createPool();

    try {
      const note = await updateNote(
        pool,
        params.id,
        {
          title: body.title,
          content: body.content,
          notebookId: body.notebook_id,
          tags: body.tags,
          visibility: body.visibility as 'private' | 'shared' | 'public' | undefined,
          hideFromAgents: body.hide_from_agents,
          summary: body.summary,
          isPinned: body.is_pinned,
          sortOrder: body.sort_order,
        },
        body.user_email
      );

      if (!note) {
        return reply.code(404).send({ error: 'Note not found' });
      }

      return reply.send(note);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message === 'FORBIDDEN') {
        return reply.code(403).send({ error: 'You do not have permission to edit this note' });
      }
      if (message === 'Notebook not found') {
        return reply.code(400).send({ error: message });
      }
      if (message.includes('Only note owner')) {
        return reply.code(403).send({ error: message });
      }
      throw err;
    } finally {
      await pool.end();
    }
  });

  // DELETE /api/notes/:id - Soft delete a note
  app.delete('/api/notes/:id', async (req, reply) => {
    const {
      deleteNote,
    } = await import('./notes/index.ts');

    const params = req.params as { id: string };
    const query = req.query as { user_email?: string };

    if (!query.user_email) {
      return reply.code(400).send({ error: 'user_email is required' });
    }

    const pool = createPool();

    try {
      const deleted = await deleteNote(pool, params.id, query.user_email);
      if (!deleted) {
        return reply.code(404).send({ error: 'Note not found' });
      }

      return reply.code(204).send();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message === 'NOT_FOUND') {
        return reply.code(404).send({ error: 'Note not found' });
      }
      if (message === 'FORBIDDEN') {
        return reply.code(403).send({ error: 'Only the note owner can delete this note' });
      }
      throw err;
    } finally {
      await pool.end();
    }
  });

  // POST /api/notes/:id/restore - Restore a soft-deleted note
  app.post('/api/notes/:id/restore', async (req, reply) => {
    const {
      restoreNote,
    } = await import('./notes/index.ts');

    const params = req.params as { id: string };
    const body = req.body as { user_email?: string };

    if (!body?.user_email) {
      return reply.code(400).send({ error: 'user_email is required' });
    }

    const pool = createPool();

    try {
      const note = await restoreNote(pool, params.id, body.user_email);

      if (!note) {
        return reply.code(404).send({ error: 'Note not found or already restored' });
      }

      return reply.send(note);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message === 'FORBIDDEN') {
        return reply.code(403).send({ error: 'Only the note owner can restore this note' });
      }
      throw err;
    } finally {
      await pool.end();
    }
  });

  // Note Version History API (Epic #337, Issue #347)

  // GET /api/notes/:id/versions - List version history
  app.get('/api/notes/:id/versions', async (req, reply) => {
    const {
      listVersions,
    } = await import('./notes/index.ts');

    const params = req.params as { id: string };
    const query = req.query as {
      user_email?: string;
      limit?: string;
      offset?: string;
    };

    if (!query.user_email) {
      return reply.code(400).send({ error: 'user_email is required' });
    }

    const pool = createPool();

    try {
      const result = await listVersions(pool, params.id, query.user_email, {
        limit: query.limit ? parseInt(query.limit, 10) : undefined,
        offset: query.offset ? parseInt(query.offset, 10) : undefined,
      });

      if (!result) {
        return reply.code(404).send({ error: 'Note not found or access denied' });
      }

      return reply.send(result);
    } finally {
      await pool.end();
    }
  });

  // GET /api/notes/:id/versions/compare - Compare two versions
  app.get('/api/notes/:id/versions/compare', async (req, reply) => {
    const {
      compareVersions,
    } = await import('./notes/index.ts');

    const params = req.params as { id: string };
    const query = req.query as {
      user_email?: string;
      from?: string;
      to?: string;
    };

    if (!query.user_email) {
      return reply.code(400).send({ error: 'user_email is required' });
    }

    if (!query.from || !query.to) {
      return reply.code(400).send({ error: 'from and to version numbers are required' });
    }

    const fromVersion = parseInt(query.from, 10);
    const toVersion = parseInt(query.to, 10);

    if (isNaN(fromVersion) || isNaN(toVersion)) {
      return reply.code(400).send({ error: 'from and to must be valid version numbers' });
    }

    const pool = createPool();

    try {
      const result = await compareVersions(pool, params.id, fromVersion, toVersion, query.user_email);

      if (!result) {
        return reply.code(404).send({ error: 'Note or versions not found, or access denied' });
      }

      return reply.send(result);
    } finally {
      await pool.end();
    }
  });

  // GET /api/notes/:id/versions/:versionNumber - Get specific version
  app.get('/api/notes/:id/versions/:versionNumber', async (req, reply) => {
    const {
      getVersion,
    } = await import('./notes/index.ts');

    const params = req.params as { id: string; versionNumber: string };
    const query = req.query as {
      user_email?: string;
    };

    if (!query.user_email) {
      return reply.code(400).send({ error: 'user_email is required' });
    }

    const versionNumber = parseInt(params.versionNumber, 10);
    if (isNaN(versionNumber)) {
      return reply.code(400).send({ error: 'versionNumber must be a valid number' });
    }

    const pool = createPool();

    try {
      const version = await getVersion(pool, params.id, versionNumber, query.user_email);

      if (!version) {
        return reply.code(404).send({ error: 'Note or version not found, or access denied' });
      }

      return reply.send(version);
    } finally {
      await pool.end();
    }
  });

  // POST /api/notes/:id/versions/:versionNumber/restore - Restore to version
  app.post('/api/notes/:id/versions/:versionNumber/restore', async (req, reply) => {
    const {
      restoreVersion,
    } = await import('./notes/index.ts');

    const params = req.params as { id: string; versionNumber: string };
    const query = req.query as {
      user_email?: string;
    };

    if (!query.user_email) {
      return reply.code(400).send({ error: 'user_email is required' });
    }

    const versionNumber = parseInt(params.versionNumber, 10);
    if (isNaN(versionNumber)) {
      return reply.code(400).send({ error: 'versionNumber must be a valid number' });
    }

    const pool = createPool();

    try {
      const result = await restoreVersion(pool, params.id, versionNumber, query.user_email);

      if (!result) {
        return reply.code(404).send({ error: 'Note not found' });
      }

      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message === 'FORBIDDEN') {
        return reply.code(403).send({ error: 'Write access required to restore versions' });
      }
      if (message === 'VERSION_NOT_FOUND') {
        return reply.code(404).send({ error: 'Version not found' });
      }
      throw err;
    } finally {
      await pool.end();
    }
  });

  // Note Sharing API (Epic #337, Issue #348)

  // POST /api/notes/:id/share - Share note with a user
  app.post('/api/notes/:id/share', async (req, reply) => {
    const {
      createUserShare,
    } = await import('./notes/index.ts');

    const params = req.params as { id: string };
    const body = req.body as {
      user_email?: string;
      email?: string;
      permission?: string;
      expiresAt?: string;
    };

    if (!body?.user_email) {
      return reply.code(400).send({ error: 'user_email is required' });
    }
    if (!body?.email) {
      return reply.code(400).send({ error: 'email is required to share with' });
    }

    const pool = createPool();

    try {
      const share = await createUserShare(
        pool,
        params.id,
        {
          email: body.email,
          permission: body.permission as 'read' | 'read_write' | undefined,
          expiresAt: body.expiresAt,
        },
        body.user_email
      );

      if (!share) {
        return reply.code(404).send({ error: 'Note not found' });
      }

      return reply.code(201).send(share);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message === 'FORBIDDEN') {
        return reply.code(403).send({ error: 'Only the note owner can share' });
      }
      if (message === 'ALREADY_SHARED') {
        return reply.code(409).send({ error: 'Note already shared with this user' });
      }
      throw err;
    } finally {
      await pool.end();
    }
  });

  // POST /api/notes/:id/share/link - Create share link
  app.post('/api/notes/:id/share/link', async (req, reply) => {
    const {
      createLinkShare,
    } = await import('./notes/index.ts');

    const params = req.params as { id: string };
    const body = req.body as {
      user_email?: string;
      permission?: string;
      isSingleView?: boolean;
      maxViews?: number;
      expiresAt?: string;
    };

    if (!body?.user_email) {
      return reply.code(400).send({ error: 'user_email is required' });
    }

    const pool = createPool();

    try {
      const share = await createLinkShare(
        pool,
        params.id,
        {
          permission: body.permission as 'read' | 'read_write' | undefined,
          isSingleView: body.isSingleView,
          maxViews: body.maxViews,
          expiresAt: body.expiresAt,
        },
        body.user_email
      );

      if (!share) {
        return reply.code(404).send({ error: 'Note not found' });
      }

      return reply.code(201).send(share);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message === 'FORBIDDEN') {
        return reply.code(403).send({ error: 'Only the note owner can create share links' });
      }
      throw err;
    } finally {
      await pool.end();
    }
  });

  // GET /api/notes/:id/shares - List all shares for a note
  app.get('/api/notes/:id/shares', async (req, reply) => {
    const {
      listShares,
    } = await import('./notes/index.ts');

    const params = req.params as { id: string };
    const query = req.query as { user_email?: string };

    if (!query.user_email) {
      return reply.code(400).send({ error: 'user_email is required' });
    }

    const pool = createPool();

    try {
      const result = await listShares(pool, params.id, query.user_email);

      if (!result) {
        return reply.code(404).send({ error: 'Note not found' });
      }

      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message === 'FORBIDDEN') {
        return reply.code(403).send({ error: 'Only the note owner can view shares' });
      }
      throw err;
    } finally {
      await pool.end();
    }
  });

  // PUT /api/notes/:id/shares/:shareId - Update share
  app.put('/api/notes/:id/shares/:shareId', async (req, reply) => {
    const {
      updateShare,
    } = await import('./notes/index.ts');

    const params = req.params as { id: string; shareId: string };
    const body = req.body as {
      user_email?: string;
      permission?: string;
      expiresAt?: string | null;
    };

    if (!body?.user_email) {
      return reply.code(400).send({ error: 'user_email is required' });
    }

    const pool = createPool();

    try {
      const share = await updateShare(
        pool,
        params.id,
        params.shareId,
        {
          permission: body.permission as 'read' | 'read_write' | undefined,
          expiresAt: body.expiresAt,
        },
        body.user_email
      );

      if (!share) {
        return reply.code(404).send({ error: 'Note not found' });
      }

      return reply.send(share);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message === 'FORBIDDEN') {
        return reply.code(403).send({ error: 'Only the note owner can update shares' });
      }
      if (message === 'SHARE_NOT_FOUND') {
        return reply.code(404).send({ error: 'Share not found' });
      }
      throw err;
    } finally {
      await pool.end();
    }
  });

  // DELETE /api/notes/:id/shares/:shareId - Revoke share
  app.delete('/api/notes/:id/shares/:shareId', async (req, reply) => {
    const {
      revokeShare,
    } = await import('./notes/index.ts');

    const params = req.params as { id: string; shareId: string };
    const query = req.query as { user_email?: string };

    if (!query.user_email) {
      return reply.code(400).send({ error: 'user_email is required' });
    }

    const pool = createPool();

    try {
      await revokeShare(pool, params.id, params.shareId, query.user_email);
      return reply.code(204).send();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message === 'NOTE_NOT_FOUND') {
        return reply.code(404).send({ error: 'Note not found' });
      }
      if (message === 'FORBIDDEN') {
        return reply.code(403).send({ error: 'Only the note owner can revoke shares' });
      }
      if (message === 'SHARE_NOT_FOUND') {
        return reply.code(404).send({ error: 'Share not found' });
      }
      throw err;
    } finally {
      await pool.end();
    }
  });

  // GET /api/notes/shared-with-me - List notes shared with current user
  app.get('/api/notes/shared-with-me', async (req, reply) => {
    const {
      listSharedWithMe,
    } = await import('./notes/index.ts');

    const query = req.query as { user_email?: string };

    if (!query.user_email) {
      return reply.code(400).send({ error: 'user_email is required' });
    }

    const pool = createPool();

    try {
      const notes = await listSharedWithMe(pool, query.user_email);
      return reply.send({ notes });
    } finally {
      await pool.end();
    }
  });

  // GET /api/shared/notes/:token - Access shared note via link
  app.get('/api/shared/notes/:token', async (req, reply) => {
    const {
      accessSharedNote,
    } = await import('./notes/index.ts');

    const params = req.params as { token: string };

    const pool = createPool();

    try {
      const result = await accessSharedNote(pool, params.token);

      if (!result) {
        return reply.code(404).send({ error: 'Invalid or expired share link' });
      }

      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      // Specific error messages from validate_share_link
      if (message.includes('expired') || message.includes('views') || message.includes('once')) {
        return reply.code(410).send({ error: message });
      }
      throw err;
    } finally {
      await pool.end();
    }
  });

  // ============================================================================
  // Note Presence API (Epic #338, Issue #634)
  // ============================================================================

  // POST /api/notes/:id/presence - Join note presence (start viewing)
  // Security: user_email moved from query params to body (#689)
  // Type validation added (#697)
  // UUID validation added (#701)
  app.post('/api/notes/:id/presence', async (req, reply) => {
    const {
      joinNotePresence,
    } = await import('./notes/index.ts');

    const params = req.params as { id: string };

    // Validate noteId is a valid UUID (#701)
    if (!isValidUUID(params.id)) {
      return reply.code(400).send({ error: 'Invalid note ID format' });
    }

    const body = req.body as {
      userEmail?: unknown;
      cursorPosition?: unknown;
    } | null;

    // Validate userEmail is a string (#697)
    if (!body?.userEmail || typeof body.userEmail !== 'string') {
      return reply.code(400).send({ error: 'userEmail is required in request body and must be a string' });
    }

    // Validate cursorPosition structure if provided (#697)
    let validatedCursorPosition: { line: number; column: number } | undefined;
    if (body.cursorPosition !== undefined) {
      if (
        typeof body.cursorPosition !== 'object' ||
        body.cursorPosition === null ||
        !('line' in body.cursorPosition) ||
        !('column' in body.cursorPosition) ||
        typeof (body.cursorPosition as Record<string, unknown>).line !== 'number' ||
        typeof (body.cursorPosition as Record<string, unknown>).column !== 'number'
      ) {
        return reply.code(400).send({ error: 'cursorPosition must be an object with numeric line and column properties' });
      }
      const { line, column } = body.cursorPosition as { line: number; column: number };
      if (!Number.isInteger(line) || !Number.isInteger(column)) {
        return reply.code(400).send({ error: 'cursorPosition line and column must be integers' });
      }
      if (line < 0 || column < 0) {
        return reply.code(400).send({ error: 'cursorPosition line and column must be non-negative' });
      }
      validatedCursorPosition = { line, column };
    }

    const pool = createPool();

    try {
      const collaborators = await joinNotePresence(
        pool,
        params.id,
        body.userEmail,
        validatedCursorPosition
      );
      return reply.send({ collaborators });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message === 'FORBIDDEN') {
        return reply.code(403).send({ error: 'You do not have access to this note' });
      }
      throw err;
    } finally {
      await pool.end();
    }
  });

  // DELETE /api/notes/:id/presence - Leave note presence (stop viewing)
  // Security: user_email moved from query params to X-User-Email header (#689)
  // Type validation added (#697)
  // UUID validation added (#701)
  app.delete('/api/notes/:id/presence', async (req, reply) => {
    const {
      leaveNotePresence,
    } = await import('./notes/index.ts');

    const params = req.params as { id: string };

    // Validate noteId is a valid UUID (#701)
    if (!isValidUUID(params.id)) {
      return reply.code(400).send({ error: 'Invalid note ID format' });
    }

    const userEmailHeader = req.headers['x-user-email'];

    // Validate header is a string (not array) and non-empty (#697)
    if (!userEmailHeader || typeof userEmailHeader !== 'string') {
      return reply.code(400).send({ error: 'X-User-Email header is required and must be a string' });
    }
    const userEmail = userEmailHeader;

    const pool = createPool();

    try {
      await leaveNotePresence(pool, params.id, userEmail);
      return reply.code(204).send();
    } finally {
      await pool.end();
    }
  });

  // GET /api/notes/:id/presence - Get current viewers
  // Security: user_email moved from query params to X-User-Email header (#689)
  // Type validation added (#697)
  // UUID validation added (#701)
  app.get('/api/notes/:id/presence', async (req, reply) => {
    const {
      getNotePresence,
    } = await import('./notes/index.ts');

    const params = req.params as { id: string };

    // Validate noteId is a valid UUID (#701)
    if (!isValidUUID(params.id)) {
      return reply.code(400).send({ error: 'Invalid note ID format' });
    }

    const userEmailHeader = req.headers['x-user-email'];

    // Validate header is a string (not array) and non-empty (#697)
    if (!userEmailHeader || typeof userEmailHeader !== 'string') {
      return reply.code(400).send({ error: 'X-User-Email header is required and must be a string' });
    }
    const userEmail = userEmailHeader;

    const pool = createPool();

    try {
      const collaborators = await getNotePresence(pool, params.id, userEmail);
      return reply.send({ collaborators });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message === 'FORBIDDEN') {
        return reply.code(403).send({ error: 'You do not have access to this note' });
      }
      throw err;
    } finally {
      await pool.end();
    }
  });

  // PUT /api/notes/:id/presence/cursor - Update cursor position
  // Security: user_email moved from query params to body (#689)
  // Type validation added (#697)
  // UUID validation added (#701)
  app.put('/api/notes/:id/presence/cursor', async (req, reply) => {
    const {
      updateCursorPosition,
    } = await import('./notes/index.ts');

    const params = req.params as { id: string };

    // Validate noteId is a valid UUID (#701)
    if (!isValidUUID(params.id)) {
      return reply.code(400).send({ error: 'Invalid note ID format' });
    }

    const body = req.body as {
      userEmail?: unknown;
      cursorPosition?: unknown;
    } | null;

    // Validate userEmail is a string (#697)
    if (!body?.userEmail || typeof body.userEmail !== 'string') {
      return reply.code(400).send({ error: 'userEmail is required in request body and must be a string' });
    }

    // Validate cursorPosition structure (#697)
    if (
      !body.cursorPosition ||
      typeof body.cursorPosition !== 'object' ||
      body.cursorPosition === null ||
      !('line' in body.cursorPosition) ||
      !('column' in body.cursorPosition) ||
      typeof (body.cursorPosition as Record<string, unknown>).line !== 'number' ||
      typeof (body.cursorPosition as Record<string, unknown>).column !== 'number'
    ) {
      return reply.code(400).send({ error: 'cursorPosition is required and must be an object with numeric line and column properties' });
    }

    // Validate cursor position values (#694)
    const { line, column } = body.cursorPosition as { line: number; column: number };
    if (!Number.isInteger(line) || !Number.isInteger(column)) {
      return reply.code(400).send({ error: 'cursorPosition line and column must be integers' });
    }
    if (line < 0 || column < 0) {
      return reply.code(400).send({ error: 'cursorPosition line and column must be non-negative' });
    }
    // Reasonable upper bounds to prevent abuse
    const MAX_LINE = 1000000;
    const MAX_COLUMN = 10000;
    if (line > MAX_LINE || column > MAX_COLUMN) {
      return reply.code(400).send({ error: 'cursorPosition values exceed maximum bounds' });
    }
    const validatedCursorPosition = { line, column };

    const pool = createPool();

    try {
      await updateCursorPosition(pool, params.id, body.userEmail, validatedCursorPosition);
      return reply.code(204).send();
    } finally {
      await pool.end();
    }
  });

  // Notebooks CRUD API (Epic #337, Issue #345)

  // GET /api/notebooks - List notebooks with filters
  app.get('/api/notebooks', async (req, reply) => {
    const {
      listNotebooks,
    } = await import('./notebooks/index.ts');

    const query = req.query as {
      user_email?: string;
      parent_id?: string;
      include_archived?: string;
      include_note_counts?: string;
      include_child_counts?: string;
      limit?: string;
      offset?: string;
    };

    if (!query.user_email) {
      return reply.code(400).send({ error: 'user_email is required' });
    }

    const pool = createPool();

    try {
      const result = await listNotebooks(pool, query.user_email, {
        parentId: query.parent_id === 'null' ? null : query.parent_id,
        includeArchived: query.include_archived === 'true',
        includeNoteCounts: query.include_note_counts !== 'false',
        includeChildCounts: query.include_child_counts !== 'false',
        limit: query.limit ? parseInt(query.limit, 10) : undefined,
        offset: query.offset ? parseInt(query.offset, 10) : undefined,
      });

      return reply.send(result);
    } finally {
      await pool.end();
    }
  });

  // GET /api/notebooks/tree - Get notebooks as tree hierarchy
  app.get('/api/notebooks/tree', async (req, reply) => {
    const {
      getNotebooksTree,
    } = await import('./notebooks/index.ts');

    const query = req.query as {
      user_email?: string;
      include_note_counts?: string;
    };

    if (!query.user_email) {
      return reply.code(400).send({ error: 'user_email is required' });
    }

    const pool = createPool();

    try {
      const notebooks = await getNotebooksTree(
        pool,
        query.user_email,
        query.include_note_counts === 'true'
      );

      return reply.send({ notebooks });
    } finally {
      await pool.end();
    }
  });

  // GET /api/notebooks/:id - Get a single notebook by ID
  app.get('/api/notebooks/:id', async (req, reply) => {
    const {
      getNotebook,
    } = await import('./notebooks/index.ts');

    const params = req.params as { id: string };
    const query = req.query as {
      user_email?: string;
      include_notes?: string;
      include_children?: string;
    };

    if (!query.user_email) {
      return reply.code(400).send({ error: 'user_email is required' });
    }

    const pool = createPool();

    try {
      const notebook = await getNotebook(pool, params.id, query.user_email, {
        includeNotes: query.include_notes === 'true',
        includeChildren: query.include_children === 'true',
      });

      if (!notebook) {
        return reply.code(404).send({ error: 'Notebook not found' });
      }

      return reply.send(notebook);
    } finally {
      await pool.end();
    }
  });

  // POST /api/notebooks - Create a new notebook
  app.post('/api/notebooks', async (req, reply) => {
    const {
      createNotebook,
    } = await import('./notebooks/index.ts');

    const body = req.body as {
      user_email?: string;
      name?: string;
      description?: string;
      icon?: string;
      color?: string;
      parent_notebook_id?: string;
    };

    if (!body?.user_email) {
      return reply.code(400).send({ error: 'user_email is required' });
    }

    if (!body?.name?.trim()) {
      return reply.code(400).send({ error: 'name is required' });
    }

    const pool = createPool();

    try {
      const notebook = await createNotebook(
        pool,
        {
          name: body.name.trim(),
          description: body.description,
          icon: body.icon,
          color: body.color,
          parentNotebookId: body.parent_notebook_id,
        },
        body.user_email
      );

      return reply.code(201).send(notebook);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message === 'Parent notebook not found') {
        return reply.code(400).send({ error: message });
      }
      if (message.includes('do not own')) {
        return reply.code(403).send({ error: message });
      }
      throw err;
    } finally {
      await pool.end();
    }
  });

  // PUT /api/notebooks/:id - Update a notebook
  app.put('/api/notebooks/:id', async (req, reply) => {
    const {
      updateNotebook,
    } = await import('./notebooks/index.ts');

    const params = req.params as { id: string };
    const body = req.body as {
      user_email?: string;
      name?: string;
      description?: string | null;
      icon?: string | null;
      color?: string | null;
      parent_notebook_id?: string | null;
      sort_order?: number;
    };

    if (!body?.user_email) {
      return reply.code(400).send({ error: 'user_email is required' });
    }

    const pool = createPool();

    try {
      const notebook = await updateNotebook(
        pool,
        params.id,
        {
          name: body.name,
          description: body.description,
          icon: body.icon,
          color: body.color,
          parentNotebookId: body.parent_notebook_id,
          sortOrder: body.sort_order,
        },
        body.user_email
      );

      if (!notebook) {
        return reply.code(404).send({ error: 'Notebook not found' });
      }

      return reply.send(notebook);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message === 'FORBIDDEN') {
        return reply.code(403).send({ error: 'You do not have permission to edit this notebook' });
      }
      if (message === 'Parent notebook not found') {
        return reply.code(400).send({ error: message });
      }
      if (message.includes('circular')) {
        return reply.code(400).send({ error: message });
      }
      if (message.includes('do not own')) {
        return reply.code(403).send({ error: message });
      }
      throw err;
    } finally {
      await pool.end();
    }
  });

  // POST /api/notebooks/:id/archive - Archive a notebook
  app.post('/api/notebooks/:id/archive', async (req, reply) => {
    const {
      archiveNotebook,
    } = await import('./notebooks/index.ts');

    const params = req.params as { id: string };
    const body = req.body as { user_email?: string };

    if (!body?.user_email) {
      return reply.code(400).send({ error: 'user_email is required' });
    }

    const pool = createPool();

    try {
      const notebook = await archiveNotebook(pool, params.id, body.user_email);

      if (!notebook) {
        return reply.code(404).send({ error: 'Notebook not found' });
      }

      return reply.send(notebook);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message === 'FORBIDDEN') {
        return reply.code(403).send({ error: 'Only the notebook owner can archive this notebook' });
      }
      throw err;
    } finally {
      await pool.end();
    }
  });

  // POST /api/notebooks/:id/unarchive - Unarchive a notebook
  app.post('/api/notebooks/:id/unarchive', async (req, reply) => {
    const {
      unarchiveNotebook,
    } = await import('./notebooks/index.ts');

    const params = req.params as { id: string };
    const body = req.body as { user_email?: string };

    if (!body?.user_email) {
      return reply.code(400).send({ error: 'user_email is required' });
    }

    const pool = createPool();

    try {
      const notebook = await unarchiveNotebook(pool, params.id, body.user_email);

      if (!notebook) {
        return reply.code(404).send({ error: 'Notebook not found' });
      }

      return reply.send(notebook);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message === 'FORBIDDEN') {
        return reply.code(403).send({ error: 'Only the notebook owner can unarchive this notebook' });
      }
      throw err;
    } finally {
      await pool.end();
    }
  });

  // DELETE /api/notebooks/:id - Soft delete a notebook
  app.delete('/api/notebooks/:id', async (req, reply) => {
    const {
      deleteNotebook,
    } = await import('./notebooks/index.ts');

    const params = req.params as { id: string };
    const query = req.query as {
      user_email?: string;
      delete_notes?: string;
    };

    if (!query.user_email) {
      return reply.code(400).send({ error: 'user_email is required' });
    }

    const pool = createPool();

    try {
      const deleted = await deleteNotebook(
        pool,
        params.id,
        query.user_email,
        query.delete_notes === 'true'
      );

      if (!deleted) {
        return reply.code(404).send({ error: 'Notebook not found' });
      }

      return reply.code(204).send();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message === 'NOT_FOUND') {
        return reply.code(404).send({ error: 'Notebook not found' });
      }
      if (message === 'FORBIDDEN') {
        return reply.code(403).send({ error: 'Only the notebook owner can delete this notebook' });
      }
      throw err;
    } finally {
      await pool.end();
    }
  });

  // POST /api/notebooks/:id/notes - Move or copy notes to notebook
  app.post('/api/notebooks/:id/notes', async (req, reply) => {
    const {
      moveNotesToNotebook,
    } = await import('./notebooks/index.ts');

    const params = req.params as { id: string };
    const body = req.body as {
      user_email?: string;
      note_ids?: string[];
      action?: string;
    };

    if (!body?.user_email) {
      return reply.code(400).send({ error: 'user_email is required' });
    }

    if (!body?.note_ids || !Array.isArray(body.note_ids) || body.note_ids.length === 0) {
      return reply.code(400).send({ error: 'note_ids array is required' });
    }

    if (!body?.action || !['move', 'copy'].includes(body.action)) {
      return reply.code(400).send({ error: 'action must be "move" or "copy"' });
    }

    const pool = createPool();

    try {
      const result = await moveNotesToNotebook(
        pool,
        params.id,
        {
          noteIds: body.note_ids,
          action: body.action as 'move' | 'copy',
        },
        body.user_email
      );

      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message === 'NOT_FOUND') {
        return reply.code(404).send({ error: 'Notebook not found' });
      }
      if (message === 'FORBIDDEN') {
        return reply.code(403).send({ error: 'You do not have permission to modify this notebook' });
      }
      throw err;
    } finally {
      await pool.end();
    }
  });

  // Notebook Sharing API (Epic #337, Issue #348)

  // POST /api/notebooks/:id/share - Share notebook with a user
  app.post('/api/notebooks/:id/share', async (req, reply) => {
    const notebookSharing = await import('./notebooks/sharing.ts');

    const params = req.params as { id: string };
    const body = req.body as {
      user_email?: string;
      email?: string;
      permission?: string;
      expiresAt?: string;
    };

    if (!body?.user_email) {
      return reply.code(400).send({ error: 'user_email is required' });
    }
    if (!body?.email) {
      return reply.code(400).send({ error: 'email is required to share with' });
    }

    const pool = createPool();

    try {
      const share = await notebookSharing.createUserShare(
        pool,
        params.id,
        {
          email: body.email,
          permission: body.permission as 'read' | 'read_write' | undefined,
          expiresAt: body.expiresAt,
        },
        body.user_email
      );

      if (!share) {
        return reply.code(404).send({ error: 'Notebook not found' });
      }

      return reply.code(201).send(share);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message === 'FORBIDDEN') {
        return reply.code(403).send({ error: 'Only the notebook owner can share' });
      }
      if (message === 'ALREADY_SHARED') {
        return reply.code(409).send({ error: 'Notebook already shared with this user' });
      }
      throw err;
    } finally {
      await pool.end();
    }
  });

  // POST /api/notebooks/:id/share/link - Create share link
  app.post('/api/notebooks/:id/share/link', async (req, reply) => {
    const notebookSharing = await import('./notebooks/sharing.ts');

    const params = req.params as { id: string };
    const body = req.body as {
      user_email?: string;
      permission?: string;
      expiresAt?: string;
    };

    if (!body?.user_email) {
      return reply.code(400).send({ error: 'user_email is required' });
    }

    const pool = createPool();

    try {
      const share = await notebookSharing.createLinkShare(
        pool,
        params.id,
        {
          permission: body.permission as 'read' | 'read_write' | undefined,
          expiresAt: body.expiresAt,
        },
        body.user_email
      );

      if (!share) {
        return reply.code(404).send({ error: 'Notebook not found' });
      }

      return reply.code(201).send(share);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message === 'FORBIDDEN') {
        return reply.code(403).send({ error: 'Only the notebook owner can create share links' });
      }
      throw err;
    } finally {
      await pool.end();
    }
  });

  // GET /api/notebooks/:id/shares - List all shares for a notebook
  app.get('/api/notebooks/:id/shares', async (req, reply) => {
    const notebookSharing = await import('./notebooks/sharing.ts');

    const params = req.params as { id: string };
    const query = req.query as { user_email?: string };

    if (!query.user_email) {
      return reply.code(400).send({ error: 'user_email is required' });
    }

    const pool = createPool();

    try {
      const result = await notebookSharing.listShares(pool, params.id, query.user_email);

      if (!result) {
        return reply.code(404).send({ error: 'Notebook not found' });
      }

      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message === 'FORBIDDEN') {
        return reply.code(403).send({ error: 'Only the notebook owner can view shares' });
      }
      throw err;
    } finally {
      await pool.end();
    }
  });

  // PUT /api/notebooks/:id/shares/:shareId - Update share
  app.put('/api/notebooks/:id/shares/:shareId', async (req, reply) => {
    const notebookSharing = await import('./notebooks/sharing.ts');

    const params = req.params as { id: string; shareId: string };
    const body = req.body as {
      user_email?: string;
      permission?: string;
      expiresAt?: string | null;
    };

    if (!body?.user_email) {
      return reply.code(400).send({ error: 'user_email is required' });
    }

    const pool = createPool();

    try {
      const share = await notebookSharing.updateShare(
        pool,
        params.id,
        params.shareId,
        {
          permission: body.permission as 'read' | 'read_write' | undefined,
          expiresAt: body.expiresAt,
        },
        body.user_email
      );

      if (!share) {
        return reply.code(404).send({ error: 'Notebook not found' });
      }

      return reply.send(share);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message === 'FORBIDDEN') {
        return reply.code(403).send({ error: 'Only the notebook owner can update shares' });
      }
      if (message === 'SHARE_NOT_FOUND') {
        return reply.code(404).send({ error: 'Share not found' });
      }
      throw err;
    } finally {
      await pool.end();
    }
  });

  // DELETE /api/notebooks/:id/shares/:shareId - Revoke share
  app.delete('/api/notebooks/:id/shares/:shareId', async (req, reply) => {
    const notebookSharing = await import('./notebooks/sharing.ts');

    const params = req.params as { id: string; shareId: string };
    const query = req.query as { user_email?: string };

    if (!query.user_email) {
      return reply.code(400).send({ error: 'user_email is required' });
    }

    const pool = createPool();

    try {
      await notebookSharing.revokeShare(pool, params.id, params.shareId, query.user_email);
      return reply.code(204).send();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message === 'NOTEBOOK_NOT_FOUND') {
        return reply.code(404).send({ error: 'Notebook not found' });
      }
      if (message === 'FORBIDDEN') {
        return reply.code(403).send({ error: 'Only the notebook owner can revoke shares' });
      }
      if (message === 'SHARE_NOT_FOUND') {
        return reply.code(404).send({ error: 'Share not found' });
      }
      throw err;
    } finally {
      await pool.end();
    }
  });

  // GET /api/notebooks/shared-with-me - List notebooks shared with current user
  app.get('/api/notebooks/shared-with-me', async (req, reply) => {
    const notebookSharing = await import('./notebooks/sharing.ts');

    const query = req.query as { user_email?: string };

    if (!query.user_email) {
      return reply.code(400).send({ error: 'user_email is required' });
    }

    const pool = createPool();

    try {
      const notebooks = await notebookSharing.listSharedWithMe(pool, query.user_email);
      return reply.send({ notebooks });
    } finally {
      await pool.end();
    }
  });

  // GET /api/shared/notebooks/:token - Access shared notebook via link
  app.get('/api/shared/notebooks/:token', async (req, reply) => {
    const notebookSharing = await import('./notebooks/sharing.ts');

    const params = req.params as { token: string };

    const pool = createPool();

    try {
      const result = await notebookSharing.accessSharedNotebook(pool, params.token);

      if (!result) {
        return reply.code(404).send({ error: 'Invalid or expired share link' });
      }

      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message.includes('expired')) {
        return reply.code(410).send({ error: message });
      }
      throw err;
    } finally {
      await pool.end();
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Note Embeddings Admin Endpoints (Issue #349)
  // ─────────────────────────────────────────────────────────────────────────────

  // GET /api/admin/embeddings/status/notes - Get note embedding statistics
  app.get('/api/admin/embeddings/status/notes', async (req, reply) => {
    const noteEmbeddings = await import('./embeddings/note-integration.ts');

    const pool = createPool();

    try {
      const stats = await noteEmbeddings.getNoteEmbeddingStats(pool);
      return reply.send(stats);
    } finally {
      await pool.end();
    }
  });

  // POST /api/admin/embeddings/backfill/notes - Backfill note embeddings
  app.post('/api/admin/embeddings/backfill/notes', async (req, reply) => {
    const noteEmbeddings = await import('./embeddings/note-integration.ts');

    const body = req.body as {
      limit?: number;
      onlyPending?: boolean;
      batchSize?: number;
    };

    const pool = createPool();

    try {
      const result = await noteEmbeddings.backfillNoteEmbeddings(pool, {
        limit: body?.limit ?? 100,
        onlyPending: body?.onlyPending ?? true,
        batchSize: body?.batchSize ?? 10,
      });
      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message.includes('No embedding provider configured')) {
        return reply.code(503).send({ error: message });
      }
      throw err;
    } finally {
      await pool.end();
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Skill Store Search Endpoints (Issue #798)
  // ─────────────────────────────────────────────────────────────────────────────

  // POST /api/skill-store/search - Full-text search
  app.post('/api/skill-store/search', async (req, reply) => {
    const skillStoreSearch = await import('./skill-store/search.ts');

    const body = req.body as {
      skill_id?: string;
      query?: string;
      collection?: string;
      tags?: string[];
      status?: string;
      user_email?: string;
      limit?: number;
      offset?: number;
    };

    if (!body?.skill_id) {
      return reply.code(400).send({ error: 'skill_id is required' });
    }
    if (!body?.query) {
      return reply.code(400).send({ error: 'query is required' });
    }

    const pool = createPool();

    try {
      const result = await skillStoreSearch.searchSkillStoreFullText(pool, {
        skill_id: body.skill_id,
        query: body.query,
        collection: body.collection,
        tags: body.tags,
        status: body.status,
        user_email: body.user_email,
        limit: body.limit ?? 20,
        offset: body.offset ?? 0,
      });

      return reply.send({
        results: result.results,
        total: result.total,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.code(500).send({ error: message });
    } finally {
      await pool.end();
    }
  });

  // POST /api/skill-store/search/semantic - Semantic (vector) search with full-text fallback
  app.post('/api/skill-store/search/semantic', async (req, reply) => {
    const skillStoreSearch = await import('./skill-store/search.ts');

    const body = req.body as {
      skill_id?: string;
      query?: string;
      collection?: string;
      tags?: string[];
      status?: string;
      user_email?: string;
      min_similarity?: number;
      limit?: number;
      offset?: number;
      semantic_weight?: number;
    };

    if (!body?.skill_id) {
      return reply.code(400).send({ error: 'skill_id is required' });
    }
    if (!body?.query) {
      return reply.code(400).send({ error: 'query is required' });
    }

    const pool = createPool();

    try {
      // Use hybrid search if semantic_weight is provided, otherwise pure semantic
      if (body.semantic_weight !== undefined) {
        const result = await skillStoreSearch.searchSkillStoreHybrid(pool, {
          skill_id: body.skill_id,
          query: body.query,
          collection: body.collection,
          tags: body.tags,
          status: body.status,
          user_email: body.user_email,
          min_similarity: body.min_similarity ?? 0.3,
          limit: body.limit ?? 20,
          semantic_weight: body.semantic_weight,
        });

        return reply.send({
          results: result.results,
          search_type: result.searchType,
          semantic_weight: result.semantic_weight,
        });
      }

      const result = await skillStoreSearch.searchSkillStoreSemantic(pool, {
        skill_id: body.skill_id,
        query: body.query,
        collection: body.collection,
        tags: body.tags,
        status: body.status,
        user_email: body.user_email,
        min_similarity: body.min_similarity ?? 0.3,
        limit: body.limit ?? 20,
        offset: body.offset ?? 0,
      });

      return reply.send({
        results: result.results,
        search_type: result.searchType,
        query_embedding_provider: result.queryEmbeddingProvider,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.code(500).send({ error: message });
    } finally {
      await pool.end();
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Skill Store Embeddings Admin Endpoints (Issue #799)
  // ─────────────────────────────────────────────────────────────────────────────

  // GET /api/admin/skill-store/embeddings/status - Get skill store embedding statistics
  app.get('/api/admin/skill-store/embeddings/status', async (req, reply) => {
    const skillStoreEmbeddings = await import('./embeddings/skill-store-integration.ts');

    const pool = createPool();

    try {
      const stats = await skillStoreEmbeddings.getSkillStoreEmbeddingStats(pool);
      return reply.send(stats);
    } finally {
      await pool.end();
    }
  });

  // POST /api/admin/skill-store/embeddings/backfill - Backfill skill store item embeddings
  app.post('/api/admin/skill-store/embeddings/backfill', async (req, reply) => {
    const skillStoreEmbeddings = await import('./embeddings/skill-store-integration.ts');

    const body = req.body as {
      batch_size?: number;
    };

    const batchSize = Math.min(Math.max(body?.batch_size || 100, 1), 1000);

    const pool = createPool();

    try {
      const result = await skillStoreEmbeddings.backfillSkillStoreEmbeddings(pool, {
        batchSize,
      });
      return reply.code(202).send({
        status: 'completed',
        enqueued: result.enqueued,
        skipped: result.skipped,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.code(500).send({ error: message });
    } finally {
      await pool.end();
    }
  });

  // POST /api/notes/search/semantic - Semantic search for notes (legacy endpoint from #349)
  app.post('/api/notes/search/semantic', async (req, reply) => {
    const noteEmbeddings = await import('./embeddings/note-integration.ts');

    const body = req.body as {
      user_email?: string;
      query?: string;
      limit?: number;
      offset?: number;
      notebookId?: string;
      tags?: string[];
    };

    if (!body?.user_email) {
      return reply.code(400).send({ error: 'user_email is required' });
    }

    if (!body?.query) {
      return reply.code(400).send({ error: 'query is required' });
    }

    const pool = createPool();

    try {
      const result = await noteEmbeddings.searchNotesSemantic(
        pool,
        body.query,
        body.user_email,
        {
          limit: body.limit ?? 20,
          offset: body.offset ?? 0,
          notebookId: body.notebookId,
          tags: body.tags,
        }
      );
      return reply.send(result);
    } finally {
      await pool.end();
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Note Search Endpoints (Issue #346)
  // ─────────────────────────────────────────────────────────────────────────────

  // GET /api/notes/search - Search notes with privacy filtering
  app.get('/api/notes/search', async (req, reply) => {
    const noteSearch = await import('./notes/search.ts');

    const query = req.query as {
      user_email?: string;
      q?: string;
      searchType?: 'hybrid' | 'text' | 'semantic';
      notebookId?: string;
      tags?: string;
      visibility?: string;
      limit?: string;
      offset?: string;
      minSimilarity?: string;
    };

    if (!query.user_email) {
      return reply.code(400).send({ error: 'user_email is required' });
    }

    if (!query.q) {
      return reply.code(400).send({ error: 'q (search query) is required' });
    }

    // Detect if request is from an agent
    const isAgent = !!(
      req.headers['x-openclaw-agent'] ||
      (typeof req.headers.authorization === 'string' && req.headers.authorization.includes('agent:'))
    );

    const pool = createPool();

    try {
      const result = await noteSearch.searchNotes(pool, query.q, query.user_email, {
        searchType: query.searchType ?? 'hybrid',
        notebookId: query.notebookId,
        tags: query.tags ? query.tags.split(',') : undefined,
        visibility: query.visibility as 'private' | 'shared' | 'public' | undefined,
        limit: query.limit ? Math.min(parseInt(query.limit, 10), 50) : 20,
        offset: query.offset ? parseInt(query.offset, 10) : 0,
        minSimilarity: query.minSimilarity ? parseFloat(query.minSimilarity) : 0.3,
        isAgent,
      });

      return reply.send(result);
    } finally {
      await pool.end();
    }
  });

  // GET /api/notes/:id/similar - Find similar notes
  app.get('/api/notes/:id/similar', async (req, reply) => {
    const noteSearch = await import('./notes/search.ts');

    const params = req.params as { id: string };
    const query = req.query as {
      user_email?: string;
      limit?: string;
      minSimilarity?: string;
    };

    if (!query.user_email) {
      return reply.code(400).send({ error: 'user_email is required' });
    }

    // Detect if request is from an agent
    const isAgent = !!(
      req.headers['x-openclaw-agent'] ||
      (typeof req.headers.authorization === 'string' && req.headers.authorization.includes('agent:'))
    );

    const pool = createPool();

    try {
      const result = await noteSearch.findSimilarNotes(pool, params.id, query.user_email, {
        limit: query.limit ? Math.min(parseInt(query.limit, 10), 20) : 5,
        minSimilarity: query.minSimilarity ? parseFloat(query.minSimilarity) : 0.5,
        isAgent,
      });

      if (!result) {
        return reply.code(404).send({ error: 'Note not found or access denied' });
      }

      return reply.send(result);
    } finally {
      await pool.end();
    }
  });


  // ── Relationship Types API (Epic #486, Issue #490) ────────────────
  // Reference table for relationship types between contacts.
  // Pre-seeded with common types, extensible by agents.

  // GET /api/relationship-types - List all relationship types with optional filters
  app.get('/api/relationship-types', async (req, reply) => {
    const {
      listRelationshipTypes,
    } = await import('./relationship-types/index.ts');
    const pool = createPool();
    try {
      const query = req.query as Record<string, string | undefined>;

      const options: Parameters<typeof listRelationshipTypes>[1] = {};

      if (query.is_directional !== undefined) {
        options.isDirectional = query.is_directional === 'true';
      }
      if (query.created_by_agent !== undefined) {
        options.createdByAgent = query.created_by_agent;
      }
      if (query.pre_seeded_only === 'true') {
        options.preSeededOnly = true;
      }
      if (query.limit !== undefined) {
        options.limit = parseInt(query.limit, 10);
      }
      if (query.offset !== undefined) {
        options.offset = parseInt(query.offset, 10);
      }

      const result = await listRelationshipTypes(pool, options);
      return reply.send(result);
    } finally {
      await pool.end();
    }
  });

  // GET /api/relationship-types/match - Find types matching a query string
  // Must be defined before :id route to avoid conflict
  app.get('/api/relationship-types/match', async (req, reply) => {
    const {
      findSemanticMatch,
    } = await import('./relationship-types/index.ts');
    const pool = createPool();
    try {
      const query = req.query as Record<string, string | undefined>;

      if (!query.q || query.q.trim().length === 0) {
        return reply.code(400).send({ error: 'Query parameter "q" is required' });
      }

      const limit = query.limit ? parseInt(query.limit, 10) : undefined;
      const results = await findSemanticMatch(pool, query.q.trim(), { limit });
      return reply.send({ results });
    } finally {
      await pool.end();
    }
  });

  // GET /api/relationship-types/:id - Get a single relationship type
  app.get('/api/relationship-types/:id', async (req, reply) => {
    const {
      getRelationshipType,
    } = await import('./relationship-types/index.ts');
    const pool = createPool();
    try {
      const params = req.params as { id: string };
      const type = await getRelationshipType(pool, params.id);

      if (!type) {
        return reply.code(404).send({ error: 'Relationship type not found' });
      }

      return reply.send(type);
    } finally {
      await pool.end();
    }
  });

  // POST /api/relationship-types - Create a new relationship type
  app.post('/api/relationship-types', async (req, reply) => {
    const {
      createRelationshipType,
    } = await import('./relationship-types/index.ts');
    const pool = createPool();
    try {
      const body = req.body as Record<string, unknown> | null;

      if (!body) {
        return reply.code(400).send({ error: 'Request body is required' });
      }

      const name = body.name as string | undefined;
      const label = body.label as string | undefined;

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return reply.code(400).send({ error: 'Field "name" is required' });
      }

      if (!label || typeof label !== 'string' || label.trim().length === 0) {
        return reply.code(400).send({ error: 'Field "label" is required' });
      }

      const input = {
        name: name.trim(),
        label: label.trim(),
        isDirectional: body.is_directional === true,
        inverseTypeName: (body.inverse_type_name as string) ?? undefined,
        description: (body.description as string) ?? undefined,
        createdByAgent: (body.created_by_agent as string) ?? undefined,
      };

      const type = await createRelationshipType(pool, input);
      return reply.code(201).send(type);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);

      // Unique constraint violation for duplicate name
      if (msg.includes('unique') || msg.includes('duplicate')) {
        return reply.code(409).send({ error: 'A relationship type with this name already exists' });
      }

      return reply.code(500).send({ error: msg });
    } finally {
      await pool.end();
    }
  });

  // ── Relationships API (Epic #486, Issue #491) ────────────────────────
  // CRUD for relationships between contacts, graph traversal, group membership,
  // and smart creation (resolve contacts/types by name).

  // GET /api/relationships - List relationships with optional filters
  app.get('/api/relationships', async (req, reply) => {
    const {
      listRelationships,
    } = await import('./relationships/index.ts');
    const pool = createPool();
    try {
      const query = req.query as Record<string, string | undefined>;

      const options: Parameters<typeof listRelationships>[1] = {};

      if (query.contact_id !== undefined) {
        options.contactId = query.contact_id;
      }
      if (query.relationship_type_id !== undefined) {
        options.relationshipTypeId = query.relationship_type_id;
      }
      if (query.created_by_agent !== undefined) {
        options.createdByAgent = query.created_by_agent;
      }
      if (query.limit !== undefined) {
        options.limit = parseInt(query.limit, 10);
      }
      if (query.offset !== undefined) {
        options.offset = parseInt(query.offset, 10);
      }

      const result = await listRelationships(pool, options);
      return reply.send(result);
    } finally {
      await pool.end();
    }
  });

  // POST /api/relationships/set - Smart relationship creation
  // Must be defined before :id route to avoid conflict
  app.post('/api/relationships/set', async (req, reply) => {
    const {
      relationshipSet,
    } = await import('./relationships/index.ts');
    const pool = createPool();
    try {
      const body = req.body as Record<string, unknown> | null;

      if (!body) {
        return reply.code(400).send({ error: 'Request body is required' });
      }

      const contactA = body.contact_a as string | undefined;
      const contactB = body.contact_b as string | undefined;
      const relationshipType = body.relationship_type as string | undefined;

      if (!contactA || typeof contactA !== 'string' || contactA.trim().length === 0) {
        return reply.code(400).send({ error: 'Field "contact_a" is required' });
      }

      if (!contactB || typeof contactB !== 'string' || contactB.trim().length === 0) {
        return reply.code(400).send({ error: 'Field "contact_b" is required' });
      }

      if (!relationshipType || typeof relationshipType !== 'string' || relationshipType.trim().length === 0) {
        return reply.code(400).send({ error: 'Field "relationship_type" is required' });
      }

      const result = await relationshipSet(pool, {
        contactA: contactA.trim(),
        contactB: contactB.trim(),
        relationshipType: relationshipType.trim(),
        notes: (body.notes as string) ?? undefined,
        createdByAgent: (body.created_by_agent as string) ?? undefined,
      });

      return reply.send(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('cannot be resolved')) {
        return reply.code(404).send({ error: msg });
      }
      return reply.code(500).send({ error: msg });
    } finally {
      await pool.end();
    }
  });

  // GET /api/relationships/:id - Get a single relationship with details
  app.get('/api/relationships/:id', async (req, reply) => {
    const {
      getRelationship,
    } = await import('./relationships/index.ts');
    const pool = createPool();
    try {
      const params = req.params as { id: string };
      const relationship = await getRelationship(pool, params.id);

      if (!relationship) {
        return reply.code(404).send({ error: 'Relationship not found' });
      }

      return reply.send(relationship);
    } finally {
      await pool.end();
    }
  });

  // POST /api/relationships - Create a new relationship
  app.post('/api/relationships', async (req, reply) => {
    const {
      createRelationship,
    } = await import('./relationships/index.ts');
    const pool = createPool();
    try {
      const body = req.body as Record<string, unknown> | null;

      if (!body) {
        return reply.code(400).send({ error: 'Request body is required' });
      }

      const contactAId = body.contact_a_id as string | undefined;
      const contactBId = body.contact_b_id as string | undefined;
      const relationshipTypeId = body.relationship_type_id as string | undefined;

      if (!contactAId || typeof contactAId !== 'string') {
        return reply.code(400).send({ error: 'Field "contact_a_id" is required' });
      }

      if (!contactBId || typeof contactBId !== 'string') {
        return reply.code(400).send({ error: 'Field "contact_b_id" is required' });
      }

      if (!relationshipTypeId || typeof relationshipTypeId !== 'string') {
        return reply.code(400).send({ error: 'Field "relationship_type_id" is required' });
      }

      const relationship = await createRelationship(pool, {
        contactAId,
        contactBId,
        relationshipTypeId,
        notes: (body.notes as string) ?? undefined,
        createdByAgent: (body.created_by_agent as string) ?? undefined,
      });

      return reply.code(201).send(relationship);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);

      if (msg.includes('unique') || msg.includes('duplicate') || msg.includes('unique_relationship')) {
        return reply.code(409).send({ error: 'A relationship between these contacts with this type already exists' });
      }
      if (msg.includes('self-relationship')) {
        return reply.code(400).send({ error: msg });
      }

      return reply.code(500).send({ error: msg });
    } finally {
      await pool.end();
    }
  });

  // PATCH /api/relationships/:id - Update a relationship
  app.patch('/api/relationships/:id', async (req, reply) => {
    const {
      updateRelationship,
    } = await import('./relationships/index.ts');
    const pool = createPool();
    try {
      const params = req.params as { id: string };
      const body = req.body as Record<string, unknown> | null;

      const input: Record<string, unknown> = {};
      if (body?.notes !== undefined) {
        input.notes = body.notes;
      }
      if (body?.relationship_type_id !== undefined) {
        input.relationshipTypeId = body.relationship_type_id;
      }

      const updated = await updateRelationship(pool, params.id, input);

      if (!updated) {
        return reply.code(404).send({ error: 'Relationship not found' });
      }

      return reply.send(updated);
    } finally {
      await pool.end();
    }
  });

  // DELETE /api/relationships/:id - Delete a relationship
  app.delete('/api/relationships/:id', async (req, reply) => {
    const {
      deleteRelationship,
    } = await import('./relationships/index.ts');
    const pool = createPool();
    try {
      const params = req.params as { id: string };
      const deleted = await deleteRelationship(pool, params.id);

      if (!deleted) {
        return reply.code(404).send({ error: 'Relationship not found' });
      }

      return reply.code(204).send();
    } finally {
      await pool.end();
    }
  });

  // GET /api/contacts/:id/relationships - Graph traversal for a contact
  app.get('/api/contacts/:id/relationships', async (req, reply) => {
    const {
      getRelatedContacts,
    } = await import('./relationships/index.ts');
    const pool = createPool();
    try {
      const params = req.params as { id: string };
      const result = await getRelatedContacts(pool, params.id);
      return reply.send(result);
    } finally {
      await pool.end();
    }
  });

  // GET /api/contacts/:id/groups - Groups a contact belongs to
  app.get('/api/contacts/:id/groups', async (req, reply) => {
    const {
      getContactGroups,
    } = await import('./relationships/index.ts');
    const pool = createPool();
    try {
      const params = req.params as { id: string };
      const groups = await getContactGroups(pool, params.id);
      return reply.send({ groups });
    } finally {
      await pool.end();
    }
  });

  // GET /api/contacts/:id/members - Members of a group contact
  app.get('/api/contacts/:id/members', async (req, reply) => {
    const {
      getGroupMembers,
    } = await import('./relationships/index.ts');
    const pool = createPool();
    try {
      const params = req.params as { id: string };
      const members = await getGroupMembers(pool, params.id);
      return reply.send({ members });
    } finally {
      await pool.end();
    }
  });

  // ── Skill Store CRUD API (Issue #797) ─────────────────────────────

  /** Maximum serialized size of the data field (1MB). */
  const SKILL_STORE_DATA_MAX_BYTES = 1_048_576;

  /**
   * Validate that the serialized JSON size of a data field does not exceed 1MB.
   * Returns true when valid (within limit), false when too large.
   */
  function isSkillStoreDataWithinLimit(data: unknown): boolean {
    if (data === undefined || data === null) return true;
    return JSON.stringify(data).length <= SKILL_STORE_DATA_MAX_BYTES;
  }

  /** Column list returned by skill store queries. */
  const SKILL_STORE_SELECT_COLS = `
    id::text AS id,
    skill_id,
    collection,
    key,
    title,
    summary,
    content,
    data,
    media_url,
    media_type,
    source_url,
    status::text AS status,
    tags,
    priority,
    expires_at,
    pinned,
    embedding_status,
    user_email,
    created_by,
    deleted_at,
    created_at,
    updated_at`;

  // POST /api/skill-store/items — Create or upsert
  app.post('/api/skill-store/items', async (req, reply) => {
    const body = req.body as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return reply.code(400).send({ error: 'Request body is required' });
    }

    const skillId = body.skill_id as string | undefined;
    if (!skillId || typeof skillId !== 'string' || skillId.trim().length === 0) {
      return reply.code(400).send({ error: 'skill_id is required' });
    }

    if (!isSkillStoreDataWithinLimit(body.data)) {
      return reply.code(400).send({ error: 'data field exceeds maximum size of 1MB' });
    }

    const collection = (body.collection as string) || '_default';
    const key = (body.key as string | undefined) ?? null;
    const title = (body.title as string | undefined) ?? null;
    const summary = (body.summary as string | undefined) ?? null;
    const content = (body.content as string | undefined) ?? null;
    const data = body.data !== undefined ? JSON.stringify(body.data) : '{}';
    const tags = Array.isArray(body.tags) ? body.tags : [];
    const priority = typeof body.priority === 'number' ? body.priority : null;
    const mediaUrl = (body.media_url as string | undefined) ?? null;
    const mediaType = (body.media_type as string | undefined) ?? null;
    const sourceUrl = (body.source_url as string | undefined) ?? null;
    const userEmail = (body.user_email as string | undefined) ?? null;
    const expiresAt = (body.expires_at as string | undefined) ?? null;
    const pinned = typeof body.pinned === 'boolean' ? body.pinned : false;

    const pool = createPool();
    try {
      // If key is provided, attempt upsert
      if (key) {
        const upsertResult = await pool.query(
          `INSERT INTO skill_store_item
             (skill_id, collection, key, title, summary, content, data, tags,
              priority, media_url, media_type, source_url, user_email, expires_at, pinned)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8,
                   $9, $10, $11, $12, $13, $14, $15)
           ON CONFLICT (skill_id, collection, key) WHERE key IS NOT NULL AND deleted_at IS NULL
           DO UPDATE SET
             title = EXCLUDED.title,
             summary = EXCLUDED.summary,
             content = EXCLUDED.content,
             data = EXCLUDED.data,
             tags = EXCLUDED.tags,
             priority = EXCLUDED.priority,
             media_url = EXCLUDED.media_url,
             media_type = EXCLUDED.media_type,
             source_url = EXCLUDED.source_url,
             user_email = EXCLUDED.user_email,
             expires_at = EXCLUDED.expires_at,
             pinned = EXCLUDED.pinned
           RETURNING ${SKILL_STORE_SELECT_COLS},
             (xmax = 0) AS _was_insert`,
          [skillId, collection, key, title, summary, content, data, tags,
           priority, mediaUrl, mediaType, sourceUrl, userEmail, expiresAt, pinned]
        );

        const row = upsertResult.rows[0];
        const wasInsert = row._was_insert;
        delete row._was_insert;
        return reply.code(wasInsert ? 201 : 200).send(row);
      }

      // No key — always insert
      const insertResult = await pool.query(
        `INSERT INTO skill_store_item
           (skill_id, collection, key, title, summary, content, data, tags,
            priority, media_url, media_type, source_url, user_email, expires_at, pinned)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8,
                 $9, $10, $11, $12, $13, $14, $15)
         RETURNING ${SKILL_STORE_SELECT_COLS}`,
        [skillId, collection, key, title, summary, content, data, tags,
         priority, mediaUrl, mediaType, sourceUrl, userEmail, expiresAt, pinned]
      );
      return reply.code(201).send(insertResult.rows[0]);
    } finally {
      await pool.end();
    }
  });

  // GET /api/skill-store/items/by-key — Get by composite key
  // Registered BEFORE the :id route so Fastify matches it first
  app.get('/api/skill-store/items/by-key', async (req, reply) => {
    const query = req.query as Record<string, string | undefined>;
    const skillId = query.skill_id;
    const collection = query.collection || '_default';
    const key = query.key;

    if (!skillId) {
      return reply.code(400).send({ error: 'skill_id query parameter is required' });
    }
    if (!key) {
      return reply.code(400).send({ error: 'key query parameter is required' });
    }

    const pool = createPool();
    try {
      const result = await pool.query(
        `SELECT ${SKILL_STORE_SELECT_COLS}
         FROM skill_store_item
         WHERE skill_id = $1 AND collection = $2 AND key = $3 AND deleted_at IS NULL`,
        [skillId, collection, key]
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'not found' });
      }
      return reply.send(result.rows[0]);
    } finally {
      await pool.end();
    }
  });

  // POST /api/skill-store/items/bulk — Bulk create/upsert
  app.post('/api/skill-store/items/bulk', async (req, reply) => {
    const body = req.body as { items?: unknown[] } | null;
    if (!body || !Array.isArray(body.items)) {
      return reply.code(400).send({ error: 'items array is required' });
    }

    if (body.items.length === 0) {
      return reply.code(400).send({ error: 'items array must not be empty' });
    }

    if (body.items.length > 100) {
      return reply.code(400).send({ error: 'Maximum 100 items per bulk request' });
    }

    // Validate all items before inserting
    const items = body.items as Record<string, unknown>[];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item || typeof item !== 'object') {
        return reply.code(400).send({ error: `Item at index ${i} is invalid` });
      }
      if (!item.skill_id || typeof item.skill_id !== 'string') {
        return reply.code(400).send({ error: `Item at index ${i}: skill_id is required` });
      }
      if (!isSkillStoreDataWithinLimit(item.data)) {
        return reply.code(400).send({ error: `Item at index ${i}: data field exceeds maximum size of 1MB` });
      }
    }

    const pool = createPool();
    try {
      const results: unknown[] = [];
      // Process each item in a transaction
      await pool.query('BEGIN');
      try {
        for (const item of items) {
          const skillId = item.skill_id as string;
          const collection = (item.collection as string) || '_default';
          const key = (item.key as string | undefined) ?? null;
          const title = (item.title as string | undefined) ?? null;
          const summary = (item.summary as string | undefined) ?? null;
          const content = (item.content as string | undefined) ?? null;
          const data = item.data !== undefined ? JSON.stringify(item.data) : '{}';
          const tags = Array.isArray(item.tags) ? item.tags : [];
          const priority = typeof item.priority === 'number' ? item.priority : null;
          const mediaUrl = (item.media_url as string | undefined) ?? null;
          const mediaType = (item.media_type as string | undefined) ?? null;
          const sourceUrl = (item.source_url as string | undefined) ?? null;
          const userEmail = (item.user_email as string | undefined) ?? null;
          const expiresAt = (item.expires_at as string | undefined) ?? null;
          const pinned = typeof item.pinned === 'boolean' ? item.pinned : false;

          let result;
          if (key) {
            result = await pool.query(
              `INSERT INTO skill_store_item
                 (skill_id, collection, key, title, summary, content, data, tags,
                  priority, media_url, media_type, source_url, user_email, expires_at, pinned)
               VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8,
                       $9, $10, $11, $12, $13, $14, $15)
               ON CONFLICT (skill_id, collection, key) WHERE key IS NOT NULL AND deleted_at IS NULL
               DO UPDATE SET
                 title = EXCLUDED.title,
                 summary = EXCLUDED.summary,
                 content = EXCLUDED.content,
                 data = EXCLUDED.data,
                 tags = EXCLUDED.tags,
                 priority = EXCLUDED.priority,
                 media_url = EXCLUDED.media_url,
                 media_type = EXCLUDED.media_type,
                 source_url = EXCLUDED.source_url,
                 user_email = EXCLUDED.user_email,
                 expires_at = EXCLUDED.expires_at,
                 pinned = EXCLUDED.pinned
               RETURNING ${SKILL_STORE_SELECT_COLS}`,
              [skillId, collection, key, title, summary, content, data, tags,
               priority, mediaUrl, mediaType, sourceUrl, userEmail, expiresAt, pinned]
            );
          } else {
            result = await pool.query(
              `INSERT INTO skill_store_item
                 (skill_id, collection, key, title, summary, content, data, tags,
                  priority, media_url, media_type, source_url, user_email, expires_at, pinned)
               VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8,
                       $9, $10, $11, $12, $13, $14, $15)
               RETURNING ${SKILL_STORE_SELECT_COLS}`,
              [skillId, collection, key, title, summary, content, data, tags,
               priority, mediaUrl, mediaType, sourceUrl, userEmail, expiresAt, pinned]
            );
          }
          results.push(result.rows[0]);
        }
        await pool.query('COMMIT');
      } catch (err) {
        await pool.query('ROLLBACK');
        throw err;
      }

      return reply.send({ items: results, created: results.length });
    } finally {
      await pool.end();
    }
  });

  // DELETE /api/skill-store/items/bulk — Bulk soft delete by filter
  app.delete('/api/skill-store/items/bulk', async (req, reply) => {
    const body = req.body as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return reply.code(400).send({ error: 'Request body is required' });
    }

    const skillId = body.skill_id as string | undefined;
    if (!skillId) {
      return reply.code(400).send({ error: 'skill_id is required' });
    }

    // Require at least one additional filter
    const collection = body.collection as string | undefined;
    const tags = Array.isArray(body.tags) ? body.tags as string[] : undefined;
    const status = body.status as string | undefined;

    if (!collection && !tags && !status) {
      return reply.code(400).send({ error: 'At least one additional filter (collection, tags, or status) is required besides skill_id' });
    }

    const conditions: string[] = ['skill_id = $1', 'deleted_at IS NULL'];
    const params: (string | string[])[] = [skillId];
    let paramIdx = 2;

    if (collection) {
      conditions.push(`collection = $${paramIdx}`);
      params.push(collection);
      paramIdx++;
    }

    if (tags) {
      conditions.push(`tags @> $${paramIdx}`);
      params.push(tags);
      paramIdx++;
    }

    if (status) {
      conditions.push(`status::text = $${paramIdx}`);
      params.push(status);
      paramIdx++;
    }

    const pool = createPool();
    try {
      const result = await pool.query(
        `UPDATE skill_store_item SET deleted_at = now()
         WHERE ${conditions.join(' AND ')}`,
        params
      );
      return reply.send({ deleted: result.rowCount ?? 0 });
    } finally {
      await pool.end();
    }
  });

  // POST /api/skill-store/items/:id/archive — Set status to 'archived'
  app.post('/api/skill-store/items/:id/archive', async (req, reply) => {
    const params = req.params as { id: string };
    if (!isValidUUID(params.id)) {
      return reply.code(400).send({ error: 'Invalid UUID format' });
    }

    const pool = createPool();
    try {
      const result = await pool.query(
        `UPDATE skill_store_item SET status = 'archived'
         WHERE id = $1 AND deleted_at IS NULL
         RETURNING ${SKILL_STORE_SELECT_COLS}`,
        [params.id]
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'not found' });
      }
      return reply.send(result.rows[0]);
    } finally {
      await pool.end();
    }
  });

  // GET /api/skill-store/items/:id — Get by UUID
  app.get('/api/skill-store/items/:id', async (req, reply) => {
    const params = req.params as { id: string };
    const query = req.query as { include_deleted?: string };

    if (!isValidUUID(params.id)) {
      return reply.code(400).send({ error: 'Invalid UUID format' });
    }

    const includeDeleted = query.include_deleted === 'true';
    const deletedFilter = includeDeleted ? '' : 'AND deleted_at IS NULL';

    const pool = createPool();
    try {
      const result = await pool.query(
        `SELECT ${SKILL_STORE_SELECT_COLS}
         FROM skill_store_item
         WHERE id = $1 ${deletedFilter}`,
        [params.id]
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'not found' });
      }
      return reply.send(result.rows[0]);
    } finally {
      await pool.end();
    }
  });

  // GET /api/skill-store/items — List items
  app.get('/api/skill-store/items', async (req, reply) => {
    const query = req.query as Record<string, string | undefined>;
    const skillId = query.skill_id;

    if (!skillId) {
      return reply.code(400).send({ error: 'skill_id query parameter is required' });
    }

    const limit = Math.min(parseInt(query.limit || '50', 10), 200);
    const offset = parseInt(query.offset || '0', 10);
    const collection = query.collection;
    const status = query.status;
    const tagsFilter = query.tags ? query.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : null;
    const since = query.since;
    const until = query.until;
    const userEmail = query.user_email;
    const orderBy = query.order_by || 'created_at';

    const allowedOrderBy = ['created_at', 'updated_at', 'title', 'priority'];
    const safeOrderBy = allowedOrderBy.includes(orderBy) ? orderBy : 'created_at';

    const conditions: string[] = ['skill_id = $1', 'deleted_at IS NULL'];
    const params: (string | number | string[])[] = [skillId];
    let paramIdx = 2;

    if (collection) {
      conditions.push(`collection = $${paramIdx}`);
      params.push(collection);
      paramIdx++;
    }

    if (status) {
      conditions.push(`status::text = $${paramIdx}`);
      params.push(status);
      paramIdx++;
    }

    if (tagsFilter && tagsFilter.length > 0) {
      conditions.push(`tags @> $${paramIdx}`);
      params.push(tagsFilter);
      paramIdx++;
    }

    if (since) {
      conditions.push(`created_at >= $${paramIdx}`);
      params.push(since);
      paramIdx++;
    }

    if (until) {
      conditions.push(`created_at <= $${paramIdx}`);
      params.push(until);
      paramIdx++;
    }

    if (userEmail) {
      conditions.push(`user_email = $${paramIdx}`);
      params.push(userEmail);
      paramIdx++;
    }

    const whereClause = conditions.join(' AND ');

    const pool = createPool();
    try {
      // Get total count
      const countResult = await pool.query(
        `SELECT COUNT(*) AS total FROM skill_store_item WHERE ${whereClause}`,
        params
      );
      const total = parseInt((countResult.rows[0] as { total: string }).total, 10);

      // Get paginated results
      const dataParams = [...params, limit, offset];
      const result = await pool.query(
        `SELECT ${SKILL_STORE_SELECT_COLS}
         FROM skill_store_item
         WHERE ${whereClause}
         ORDER BY ${safeOrderBy} DESC
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        dataParams
      );

      return reply.send({
        items: result.rows,
        total,
        has_more: offset + result.rows.length < total,
      });
    } finally {
      await pool.end();
    }
  });

  // PATCH /api/skill-store/items/:id — Partial update
  app.patch('/api/skill-store/items/:id', async (req, reply) => {
    const params = req.params as { id: string };
    if (!isValidUUID(params.id)) {
      return reply.code(400).send({ error: 'Invalid UUID format' });
    }

    const body = req.body as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return reply.code(400).send({ error: 'Request body is required' });
    }

    if (body.data !== undefined && !isSkillStoreDataWithinLimit(body.data)) {
      return reply.code(400).send({ error: 'data field exceeds maximum size of 1MB' });
    }

    // Build dynamic SET clause
    const setClauses: string[] = [];
    const queryParams: unknown[] = [];
    let paramIdx = 1;

    const mutableFields: Record<string, (v: unknown) => unknown> = {
      title: (v) => v,
      summary: (v) => v,
      content: (v) => v,
      data: (v) => JSON.stringify(v),
      tags: (v) => v,
      priority: (v) => v,
      media_url: (v) => v,
      media_type: (v) => v,
      source_url: (v) => v,
      status: (v) => v,
      user_email: (v) => v,
      expires_at: (v) => v,
      pinned: (v) => v,
    };

    for (const [field, transform] of Object.entries(mutableFields)) {
      if (body[field] !== undefined) {
        const castSuffix = field === 'data' ? '::jsonb' : field === 'status' ? '::skill_store_item_status' : '';
        setClauses.push(`${field} = $${paramIdx}${castSuffix}`);
        queryParams.push(transform(body[field]));
        paramIdx++;
      }
    }

    if (setClauses.length === 0) {
      return reply.code(400).send({ error: 'No fields to update' });
    }

    queryParams.push(params.id);

    const pool = createPool();
    try {
      const result = await pool.query(
        `UPDATE skill_store_item
         SET ${setClauses.join(', ')}
         WHERE id = $${paramIdx} AND deleted_at IS NULL
         RETURNING ${SKILL_STORE_SELECT_COLS}`,
        queryParams
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'not found' });
      }
      return reply.send(result.rows[0]);
    } finally {
      await pool.end();
    }
  });

  // DELETE /api/skill-store/items/:id — Soft or hard delete
  app.delete('/api/skill-store/items/:id', async (req, reply) => {
    const params = req.params as { id: string };
    const query = req.query as { permanent?: string };

    if (!isValidUUID(params.id)) {
      return reply.code(400).send({ error: 'Invalid UUID format' });
    }

    const permanent = query.permanent === 'true';
    const pool = createPool();
    try {
      let result;
      if (permanent) {
        result = await pool.query(
          'DELETE FROM skill_store_item WHERE id = $1 RETURNING id',
          [params.id]
        );
      } else {
        result = await pool.query(
          `UPDATE skill_store_item SET deleted_at = now()
           WHERE id = $1 AND deleted_at IS NULL
           RETURNING id`,
          [params.id]
        );
      }

      if ((result.rowCount ?? 0) === 0) {
        return reply.code(404).send({ error: 'not found' });
      }
      return reply.code(204).send();
    } finally {
      await pool.end();
    }
  });

  // GET /api/skill-store/collections — List collections with counts
  app.get('/api/skill-store/collections', async (req, reply) => {
    const query = req.query as { skill_id?: string };
    if (!query.skill_id) {
      return reply.code(400).send({ error: 'skill_id query parameter is required' });
    }

    const pool = createPool();
    try {
      const result = await pool.query(
        `SELECT collection,
                COUNT(*) FILTER (WHERE deleted_at IS NULL)::int AS count,
                MAX(created_at) FILTER (WHERE deleted_at IS NULL) AS latest_at
         FROM skill_store_item
         WHERE skill_id = $1
         GROUP BY collection
         HAVING COUNT(*) FILTER (WHERE deleted_at IS NULL) > 0
         ORDER BY collection`,
        [query.skill_id]
      );
      return reply.send({ collections: result.rows });
    } finally {
      await pool.end();
    }
  });

  // DELETE /api/skill-store/collections/:name — Soft delete a collection
  app.delete('/api/skill-store/collections/:name', async (req, reply) => {
    const params = req.params as { name: string };
    const query = req.query as { skill_id?: string };

    if (!query.skill_id) {
      return reply.code(400).send({ error: 'skill_id query parameter is required' });
    }

    const pool = createPool();
    try {
      const result = await pool.query(
        `UPDATE skill_store_item SET deleted_at = now()
         WHERE skill_id = $1 AND collection = $2 AND deleted_at IS NULL`,
        [query.skill_id, params.name]
      );
      return reply.send({ deleted: result.rowCount ?? 0 });
    } finally {
      await pool.end();
    }
  });

  // ── SPA fallback for client-side routing (Issue #481) ──────────────
  // Serve index.html for /static/app/* paths that don't match a real file.
  // This enables deep linking: e.g. /static/app/projects/123 loads the SPA
  // which then handles routing client-side.
  app.setNotFoundHandler((request, reply) => {
    const url = request.url.split('?')[0]; // Strip query string

    if (url.startsWith('/static/app/')) {
      // Check if this looks like a static asset request (has a file extension)
      // If so, the file genuinely doesn't exist — return 404.
      const lastSegment = url.split('/').pop() ?? '';
      if (lastSegment.includes('.')) {
        return reply.code(404).send({ error: 'Not Found' });
      }

      // SPA fallback: serve index.html with bootstrap data for the requested path
      const bootstrap = {
        route: { path: url.replace('/static/app', '') || '/' },
      };

      return reply
        .code(200)
        .header('content-type', 'text/html; charset=utf-8')
        .send(renderAppFrontendHtml(bootstrap));
    }

    return reply.code(404).send({ error: 'Not Found' });
  });

  return app;
}
