/**
 * gRPC server for the TerminalService.
 *
 * Implements session lifecycle RPCs (Create, Terminate, List, Get, Resize)
 * and GetWorkerStatus. Remaining RPCs return UNIMPLEMENTED until later phases.
 *
 * Supports mTLS when GRPC_TLS_CERT, GRPC_TLS_KEY, and GRPC_TLS_CA are configured.
 * Falls back to insecure channel with a warning when certs are not found.
 */

import * as grpc from '@grpc/grpc-js';
import fs from 'node:fs';
import type pg from 'pg';
import { getTerminalServiceDefinition } from './proto-loader.ts';
import type { TmuxWorkerConfig } from './config.ts';
import type {
  WorkerStatus,
  CreateSessionRequest,
  TerminateSessionRequest,
  ListSessionsRequest,
  ListSessionsResponse,
  GetSessionRequest,
  ResizeSessionRequest,
  SessionInfo,
  TestConnectionRequest,
  TestConnectionResponse,
  SendCommandRequest,
  SendCommandResponse,
  SendKeysRequest,
  CapturePaneRequest,
  CapturePaneResponse,
  TerminalInput,
  TerminalOutput,
} from './types.ts';
import { TmuxManager } from './tmux/manager.ts';
import { SSHConnectionManager } from './ssh/client.ts';
import type { EntryRecorder } from './entry-recorder.ts';
import {
  handleCreateSession,
  handleTerminateSession,
  handleListSessions,
  handleGetSession,
  handleResizeSession,
} from './session-lifecycle.ts';
import {
  handleSendCommand,
  handleSendKeys,
  handleCapturePane,
  handleAttachSession,
} from './terminal-io.ts';

const startTime = Date.now();

/**
 * Create and configure the gRPC server with all TerminalService handlers.
 */
export function createGrpcServer(
  config: TmuxWorkerConfig,
  pool: pg.Pool,
  entryRecorder?: EntryRecorder,
): grpc.Server {
  const server = new grpc.Server({
    'grpc.max_send_message_length': 4 * 1024 * 1024, // 4MB
    'grpc.max_receive_message_length': 4 * 1024 * 1024,
  });

  const serviceDefinition = getTerminalServiceDefinition();
  const handlers = buildHandlers(config, pool, entryRecorder);

  server.addService(serviceDefinition, handlers);

  return server;
}

/**
 * Build server credentials — mTLS if certs are configured, insecure otherwise.
 */
export function buildServerCredentials(config: TmuxWorkerConfig): grpc.ServerCredentials {
  const certPath = config.grpcTlsCert;
  const keyPath = config.grpcTlsKey;
  const caPath = config.grpcTlsCa;

  if (certPath && keyPath && caPath) {
    try {
      const rootCert = fs.readFileSync(caPath);
      const serverCert = fs.readFileSync(certPath);
      const serverKey = fs.readFileSync(keyPath);

      const creds = grpc.ServerCredentials.createSsl(
        rootCert,
        [{ cert_chain: serverCert, private_key: serverKey }],
        true, // requireClientCert
      );
      console.log('gRPC server using mTLS (mutual TLS)');
      return creds;
    } catch (err) {
      console.warn(
        `Failed to load mTLS certificates: ${(err as Error).message}. Falling back to insecure channel.`,
      );
      return grpc.ServerCredentials.createInsecure();
    }
  }

  console.warn(
    'gRPC TLS certificates not configured (GRPC_TLS_CERT/KEY/CA). Using insecure channel.',
  );
  return grpc.ServerCredentials.createInsecure();
}

/**
 * Start the gRPC server listening on the configured port.
 */
export function startGrpcServer(
  server: grpc.Server,
  port: number,
  config: TmuxWorkerConfig,
): Promise<void> {
  const credentials = buildServerCredentials(config);
  return new Promise<void>((resolve, reject) => {
    server.bindAsync(
      `0.0.0.0:${port}`,
      credentials,
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
 * Map error messages to appropriate gRPC status codes.
 * "not found" errors → NOT_FOUND; validation errors → INVALID_ARGUMENT;
 * everything else → INTERNAL.
 */
function mapErrorToGrpcStatus(err: unknown): { code: grpc.status; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (lower.includes('not found')) {
    return { code: grpc.status.NOT_FOUND, message };
  }
  if (lower.includes('invalid') || lower.includes('missing') || lower.includes('required')) {
    return { code: grpc.status.INVALID_ARGUMENT, message };
  }
  return { code: grpc.status.INTERNAL, message };
}

/**
 * Build the handler map for all TerminalService RPCs.
 *
 * Session lifecycle RPCs (Create, Terminate, List, Get, Resize) and
 * terminal I/O RPCs (AttachSession, SendCommand, SendKeys, CapturePane)
 * are fully implemented. TestConnection delegates to SSHConnectionManager.
 * Remaining RPCs are UNIMPLEMENTED for later phases.
 */
function buildHandlers(
  config: TmuxWorkerConfig,
  pool: pg.Pool,
  entryRecorder?: EntryRecorder,
): grpc.UntypedServiceImplementation {
  const tmuxManager = new TmuxManager();
  const sshManager = new SSHConnectionManager(pool, config.encryptionKeyHex);

  return {
    // ── Health ────────────────────────────────────────────────
    GetWorkerStatus: (
      _call: grpc.ServerUnaryCall<Record<string, never>, WorkerStatus>,
      callback: grpc.sendUnaryData<WorkerStatus>,
    ) => {
      const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
      callback(null, {
        worker_id: config.workerId,
        active_sessions: sshManager.activeConnectionCount,
        uptime_seconds: String(uptimeSeconds),
        version: '0.1.0',
      });
    },

    // ── Connection testing ───────────────────────────────────
    TestConnection: (
      call: grpc.ServerUnaryCall<TestConnectionRequest, TestConnectionResponse>,
      callback: grpc.sendUnaryData<TestConnectionResponse>,
    ) => {
      const req = call.request;
      sshManager
        .testConnection(req.connection_id)
        .then((result) => {
          callback(null, {
            success: result.success,
            message: result.message,
            latency_ms: result.latencyMs,
            host_key_fingerprint: result.hostKeyFingerprint,
          });
        })
        .catch((err) => {
          callback(mapErrorToGrpcStatus(err));
        });
    },

    // ── Session lifecycle ────────────────────────────────────
    CreateSession: (
      call: grpc.ServerUnaryCall<CreateSessionRequest, SessionInfo>,
      callback: grpc.sendUnaryData<SessionInfo>,
    ) => {
      const req = call.request;
      handleCreateSession(req, pool, tmuxManager, sshManager, config.workerId)
        .then((result) => callback(null, result))
        .catch((err) => {
          callback(mapErrorToGrpcStatus(err));
        });
    },

    TerminateSession: (
      call: grpc.ServerUnaryCall<TerminateSessionRequest, Record<string, never>>,
      callback: grpc.sendUnaryData<Record<string, never>>,
    ) => {
      const req = call.request;
      handleTerminateSession(req, pool, tmuxManager, sshManager)
        .then(() => callback(null, {}))
        .catch((err) => {
          callback(mapErrorToGrpcStatus(err));
        });
    },

    ListSessions: (
      call: grpc.ServerUnaryCall<ListSessionsRequest, ListSessionsResponse>,
      callback: grpc.sendUnaryData<ListSessionsResponse>,
    ) => {
      const req = call.request;
      handleListSessions(req, pool)
        .then((result) => callback(null, result))
        .catch((err) => {
          callback(mapErrorToGrpcStatus(err));
        });
    },

    GetSession: (
      call: grpc.ServerUnaryCall<GetSessionRequest, SessionInfo>,
      callback: grpc.sendUnaryData<SessionInfo>,
    ) => {
      const req = call.request;
      handleGetSession(req, pool)
        .then((result) => callback(null, result))
        .catch((err) => {
          callback(mapErrorToGrpcStatus(err));
        });
    },

    ResizeSession: (
      call: grpc.ServerUnaryCall<ResizeSessionRequest, Record<string, never>>,
      callback: grpc.sendUnaryData<Record<string, never>>,
    ) => {
      const req = call.request;
      handleResizeSession(req, pool, tmuxManager)
        .then(() => callback(null, {}))
        .catch((err) => {
          callback(mapErrorToGrpcStatus(err));
        });
    },

    // ── Terminal I/O ────────────────────────────────────────────
    AttachSession: (
      call: grpc.ServerDuplexStream<TerminalInput, TerminalOutput>,
    ) => {
      if (!entryRecorder) {
        call.emit('error', {
          code: grpc.status.INTERNAL,
          message: 'EntryRecorder not available',
        });
        return;
      }
      handleAttachSession(call, pool, tmuxManager, entryRecorder);
    },

    // ── Command execution ────────────────────────────────────────
    SendCommand: (
      call: grpc.ServerUnaryCall<SendCommandRequest, SendCommandResponse>,
      callback: grpc.sendUnaryData<SendCommandResponse>,
    ) => {
      if (!entryRecorder) {
        callback({ code: grpc.status.INTERNAL, message: 'EntryRecorder not available' });
        return;
      }
      const req = call.request;
      handleSendCommand(req, pool, tmuxManager, entryRecorder)
        .then((result) => callback(null, result))
        .catch((err) => {
          callback(mapErrorToGrpcStatus(err));
        });
    },

    SendKeys: (
      call: grpc.ServerUnaryCall<SendKeysRequest, Record<string, never>>,
      callback: grpc.sendUnaryData<Record<string, never>>,
    ) => {
      const req = call.request;
      handleSendKeys(req, pool, tmuxManager)
        .then(() => callback(null, {}))
        .catch((err) => {
          callback(mapErrorToGrpcStatus(err));
        });
    },

    CapturePane: (
      call: grpc.ServerUnaryCall<CapturePaneRequest, CapturePaneResponse>,
      callback: grpc.sendUnaryData<CapturePaneResponse>,
    ) => {
      if (!entryRecorder) {
        callback({ code: grpc.status.INTERNAL, message: 'EntryRecorder not available' });
        return;
      }
      const req = call.request;
      handleCapturePane(req, pool, tmuxManager, entryRecorder)
        .then((result) => callback(null, result))
        .catch((err) => {
          callback(mapErrorToGrpcStatus(err));
        });
    },

    // ── Unimplemented stubs (later phases) ───────────────────
    CreateWindow: unimplemented('CreateWindow'),
    CloseWindow: unimplemented('CloseWindow'),
    SplitPane: unimplemented('SplitPane'),
    ClosePane: unimplemented('ClosePane'),
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
