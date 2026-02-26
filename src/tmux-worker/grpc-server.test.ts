/**
 * Tests for the tmux worker gRPC server.
 * Issue #1670.
 *
 * Verifies that the proto file loads correctly, the server starts,
 * and GetWorkerStatus returns valid data.
 */
import { describe, it, expect, afterAll } from 'vitest';
import * as grpc from '@grpc/grpc-js';
import {
  getTerminalServiceDefinition,
  getTerminalServiceClient,
  PROTO_PATH,
} from './proto-loader.ts';
import { createGrpcServer, startGrpcServer, stopGrpcServer } from './grpc-server.ts';
import type { TmuxWorkerConfig } from './config.ts';
import type { WorkerStatus } from './types.ts';
import pg from 'pg';
import fs from 'node:fs';

const { Pool } = pg;

// Use a random port to avoid conflicts
const TEST_GRPC_PORT = 50099;

const testConfig: TmuxWorkerConfig = {
  grpcPort: TEST_GRPC_PORT,
  enrollmentSshPort: 0,
  workerId: 'test-worker-1',
  healthPort: 0,
  encryptionKeyHex: '',
  databaseUrl: '',
  grpcTlsCert: '',
  grpcTlsKey: '',
  grpcTlsCa: '',
};

// Create a mock pool that doesn't connect to anything
const mockPool = new Pool({ connectionString: 'postgresql://localhost:5432/test' });

let server: grpc.Server | undefined;
let client: InstanceType<grpc.ServiceClientConstructor> | undefined;

afterAll(async () => {
  if (client) {
    client.close();
  }
  if (server) {
    await stopGrpcServer(server);
  }
  await mockPool.end().catch(() => {});
});

describe('tmux-worker/grpc-server', () => {
  it('proto file exists at expected path', () => {
    expect(fs.existsSync(PROTO_PATH)).toBe(true);
  });

  it('loads the service definition', () => {
    const definition = getTerminalServiceDefinition();
    expect(definition).toBeDefined();
    // Should have GetWorkerStatus among others
    expect(definition).toHaveProperty('GetWorkerStatus');
    expect(definition).toHaveProperty('CreateSession');
    expect(definition).toHaveProperty('AttachSession');
  });

  it('starts gRPC server and GetWorkerStatus responds', async () => {
    server = createGrpcServer(testConfig, mockPool);
    await startGrpcServer(server, TEST_GRPC_PORT, testConfig);

    const ClientConstructor = getTerminalServiceClient();
    client = new ClientConstructor(
      `localhost:${TEST_GRPC_PORT}`,
      grpc.credentials.createInsecure(),
    );

    const status = await new Promise<WorkerStatus>((resolve, reject) => {
      client!.GetWorkerStatus({}, (err: grpc.ServiceError | null, response: WorkerStatus) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(response);
      });
    });

    expect(status.worker_id).toBe('test-worker-1');
    expect(status.active_sessions).toBe(0);
    expect(Number(status.uptime_seconds)).toBeGreaterThanOrEqual(0);
    expect(status.version).toBe('0.1.0');
  });

  it('session lifecycle RPCs return INTERNAL (no DB) instead of UNIMPLEMENTED', async () => {
    // Session lifecycle RPCs are now implemented, but will fail with INTERNAL
    // errors since we have no real DB connection in this test.
    // This confirms the stubs were replaced with real handlers.
    expect(client).toBeDefined();

    const err = await new Promise<grpc.ServiceError>((resolve) => {
      client!.CreateSession(
        { connection_id: 'test', namespace: 'default' },
        (err: grpc.ServiceError | null) => {
          if (err) {
            resolve(err);
          }
        },
      );
    });

    // No longer UNIMPLEMENTED — now it tries to run real logic but fails
    // because the mock pool has no real DB behind it.
    expect(err.code).toBe(grpc.status.INTERNAL);
    expect(err.message).not.toContain('is not yet implemented');
  });

  it('remaining unimplemented RPCs still return UNIMPLEMENTED', async () => {
    expect(client).toBeDefined();

    const err = await new Promise<grpc.ServiceError>((resolve) => {
      client!.SendCommand(
        { session_id: 'test', command: 'echo hello' },
        (err: grpc.ServiceError | null) => {
          if (err) {
            resolve(err);
          }
        },
      );
    });

    expect(err.code).toBe(grpc.status.UNIMPLEMENTED);
    expect(err.message).toContain('SendCommand');
  });
});
