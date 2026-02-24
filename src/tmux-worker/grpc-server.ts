/**
 * gRPC server for the TerminalService.
 *
 * Initial implementation provides GetWorkerStatus (health) only.
 * All other RPCs return UNIMPLEMENTED status until later phases.
 */

import * as grpc from '@grpc/grpc-js';
import type pg from 'pg';
import { getTerminalServiceDefinition } from './proto-loader.ts';
import type { TmuxWorkerConfig } from './config.ts';
import type { WorkerStatus } from './types.ts';

const startTime = Date.now();

/**
 * Create and configure the gRPC server with all TerminalService handlers.
 */
export function createGrpcServer(
  config: TmuxWorkerConfig,
  pool: pg.Pool,
): grpc.Server {
  const server = new grpc.Server({
    'grpc.max_send_message_length': 4 * 1024 * 1024, // 4MB
    'grpc.max_receive_message_length': 4 * 1024 * 1024,
  });

  const serviceDefinition = getTerminalServiceDefinition();

  // Build handler map: only GetWorkerStatus is implemented,
  // all others return UNIMPLEMENTED.
  const handlers = buildHandlers(config, pool);

  server.addService(serviceDefinition, handlers);

  return server;
}

/**
 * Start the gRPC server listening on the configured port.
 */
export function startGrpcServer(
  server: grpc.Server,
  port: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.bindAsync(
      `0.0.0.0:${port}`,
      grpc.ServerCredentials.createInsecure(),
      (error, actualPort) => {
        if (error) {
          reject(error);
          return;
        }
        console.log(`gRPC server listening on port ${actualPort}`);
        resolve();
      },
    );
  });
}

/**
 * Gracefully shut down the gRPC server.
 */
export function stopGrpcServer(server: grpc.Server): Promise<void> {
  return new Promise<void>((resolve) => {
    server.tryShutdown(() => {
      resolve();
    });
  });
}

/**
 * Build the handler map for all TerminalService RPCs.
 */
function buildHandlers(
  config: TmuxWorkerConfig,
  _pool: pg.Pool,
): grpc.UntypedServiceImplementation {
  return {
    // ── Implemented ──────────────────────────────────────────
    GetWorkerStatus: (
      _call: grpc.ServerUnaryCall<Record<string, never>, WorkerStatus>,
      callback: grpc.sendUnaryData<WorkerStatus>,
    ) => {
      const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
      callback(null, {
        worker_id: config.workerId,
        active_sessions: 0,
        uptime_seconds: String(uptimeSeconds),
        version: '0.1.0',
      });
    },

    // ── Unimplemented stubs ──────────────────────────────────
    TestConnection: unimplemented('TestConnection'),
    CreateSession: unimplemented('CreateSession'),
    TerminateSession: unimplemented('TerminateSession'),
    ListSessions: unimplemented('ListSessions'),
    GetSession: unimplemented('GetSession'),
    ResizeSession: unimplemented('ResizeSession'),
    CreateWindow: unimplemented('CreateWindow'),
    CloseWindow: unimplemented('CloseWindow'),
    SplitPane: unimplemented('SplitPane'),
    ClosePane: unimplemented('ClosePane'),
    AttachSession: unimplementedStream('AttachSession'),
    SendCommand: unimplemented('SendCommand'),
    SendKeys: unimplemented('SendKeys'),
    CapturePane: unimplemented('CapturePane'),
    CreateTunnel: unimplemented('CreateTunnel'),
    CloseTunnel: unimplemented('CloseTunnel'),
    ListTunnels: unimplemented('ListTunnels'),
    GetEnrollmentListener: unimplementedServerStream('GetEnrollmentListener'),
    ApproveHostKey: unimplemented('ApproveHostKey'),
    RejectHostKey: unimplemented('RejectHostKey'),
  };
}

/**
 * Create an unimplemented handler for a unary RPC.
 */
function unimplemented(
  name: string,
): grpc.handleUnaryCall<unknown, unknown> {
  return (
    _call: grpc.ServerUnaryCall<unknown, unknown>,
    callback: grpc.sendUnaryData<unknown>,
  ) => {
    callback({
      code: grpc.status.UNIMPLEMENTED,
      message: `${name} is not yet implemented`,
    });
  };
}

/**
 * Create an unimplemented handler for a bidi-streaming RPC.
 */
function unimplementedStream(
  name: string,
): grpc.handleBidiStreamingCall<unknown, unknown> {
  return (call: grpc.ServerDuplexStream<unknown, unknown>) => {
    call.emit('error', {
      code: grpc.status.UNIMPLEMENTED,
      message: `${name} is not yet implemented`,
    });
  };
}

/**
 * Create an unimplemented handler for a server-streaming RPC.
 */
function unimplementedServerStream(
  name: string,
): grpc.handleServerStreamingCall<unknown, unknown> {
  return (call: grpc.ServerWritableStream<unknown, unknown>) => {
    call.emit('error', {
      code: grpc.status.UNIMPLEMENTED,
      message: `${name} is not yet implemented`,
    });
  };
}
