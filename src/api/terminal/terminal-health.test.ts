/**
 * Unit tests for GET /api/terminal/health endpoint.
 *
 * Issue #1908 — Terminal worker health check.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

// Mock grpc-client before importing routes
vi.mock('./grpc-client.ts', () => ({
  getGrpcClient: vi.fn(),
  closeGrpcClient: vi.fn(),
  testConnection: vi.fn(),
  createSession: vi.fn(),
  terminateSession: vi.fn(),
  listSessions: vi.fn(),
  getSession: vi.fn(),
  resizeSession: vi.fn(),
  sendCommand: vi.fn(),
  sendKeys: vi.fn(),
  capturePane: vi.fn(),
  attachSession: vi.fn(),
  createWindow: vi.fn(),
  closeWindow: vi.fn(),
  splitPane: vi.fn(),
  closePane: vi.fn(),
  createTunnel: vi.fn(),
  closeTunnel: vi.fn(),
  listTunnels: vi.fn(),
  approveHostKey: vi.fn(),
  rejectHostKey: vi.fn(),
  buildClientCredentials: vi.fn(),
}));

// Mock auth modules to avoid real auth checks
vi.mock('../auth/middleware.ts', () => ({
  getAuthIdentity: vi.fn().mockResolvedValue(null),
}));

vi.mock('../auth/jwt.ts', () => ({
  isAuthDisabled: vi.fn().mockReturnValue(true),
  verifyAccessToken: vi.fn(),
}));

// Mock embeddings service
vi.mock('../embeddings/service.ts', () => ({
  createEmbeddingService: vi.fn().mockReturnValue({
    generateEmbedding: vi.fn(),
  }),
}));

// Mock activity module
vi.mock('./activity.ts', () => ({
  recordActivity: vi.fn().mockResolvedValue(undefined),
}));

// Mock semantic-search module
vi.mock('./semantic-search.ts', () => ({
  shouldUseSemantic: vi.fn().mockReturnValue(false),
  buildSemanticSearchQuery: vi.fn(),
  buildIlikeSearchQuery: vi.fn(),
}));

import * as grpcClient from './grpc-client.ts';
import { terminalRoutesPlugin } from './routes.ts';

function mockPool(): Pool {
  return { query: vi.fn() } as unknown as Pool;
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Decorate request with namespaceContext (simulates middleware)
  app.decorateRequest('namespaceContext', null);
  app.addHook('preHandler', async (req) => {
    req.namespaceContext = {
      storeNamespace: 'default',
      queryNamespaces: ['default'],
      isM2M: false,
      roles: { default: 'readwrite' },
    };
  });

  await app.register(terminalRoutesPlugin, { pool: mockPool() });
  await app.ready();
  return app;
}

describe('GET /api/terminal/health', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it('returns 200 { status: "ok" } when gRPC client is reachable', async () => {
    const mockClient = {
      waitForReady: vi.fn((_deadline: Date, cb: (err?: Error) => void) => {
        cb();
      }),
    };
    vi.mocked(grpcClient.getGrpcClient).mockReturnValue(mockClient as never);

    const res = await app.inject({
      method: 'GET',
      url: '/api/terminal/health',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toEqual({ status: 'ok' });
  });

  it('returns 503 { status: "unavailable" } when gRPC client is not reachable', async () => {
    const mockClient = {
      waitForReady: vi.fn((_deadline: Date, cb: (err?: Error) => void) => {
        cb(new Error('Connection refused'));
      }),
    };
    vi.mocked(grpcClient.getGrpcClient).mockReturnValue(mockClient as never);

    const res = await app.inject({
      method: 'GET',
      url: '/api/terminal/health',
    });

    expect(res.statusCode).toBe(503);
    const body = JSON.parse(res.payload);
    expect(body).toEqual({ status: 'unavailable' });
  });
});
