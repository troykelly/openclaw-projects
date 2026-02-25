/**
 * gRPC client for connecting to the tmux worker TerminalService.
 *
 * Uses insecure channel for now — mTLS comes in Phase 4 (Issue #1685).
 * The client is created lazily and cached for the server lifetime.
 */

import * as grpc from '@grpc/grpc-js';
import { getTerminalServiceClient } from '../../tmux-worker/proto-loader.ts';
import type {
  TestConnectionRequest,
  TestConnectionResponse,
  CreateSessionRequest,
  SessionInfo,
  TerminateSessionRequest,
  GetSessionRequest,
  ResizeSessionRequest,
  SendCommandRequest,
  SendCommandResponse,
  SendKeysRequest,
  CapturePaneRequest,
  CapturePaneResponse,
  TerminalInput,
  TerminalOutput,
} from '../../tmux-worker/types.ts';

/** Default gRPC deadline in milliseconds for unary RPCs. */
const DEFAULT_DEADLINE_MS = 30_000;

/** Lazy singleton gRPC client instance. */
let _client: grpc.Client | undefined;

/**
 * Get or create the gRPC client for the tmux worker.
 * Reads TMUX_WORKER_GRPC_URL from environment (default: localhost:50051).
 */
export function getGrpcClient(): grpc.Client {
  if (!_client) {
    const url = process.env.TMUX_WORKER_GRPC_URL ?? 'localhost:50051';
    const ClientConstructor = getTerminalServiceClient();
    _client = new ClientConstructor(
      url,
      grpc.credentials.createInsecure(),
      {
        'grpc.max_send_message_length': 4 * 1024 * 1024,
        'grpc.max_receive_message_length': 4 * 1024 * 1024,
      },
    );
  }
  return _client;
}

/**
 * Close the cached gRPC client. Call during server shutdown.
 */
export function closeGrpcClient(): void {
  if (_client) {
    _client.close();
    _client = undefined;
  }
}

/** Helper to create a deadline from a timeout in ms. */
function deadline(ms: number = DEFAULT_DEADLINE_MS): Date {
  return new Date(Date.now() + ms);
}

/**
 * Wrap a gRPC unary call in a Promise.
 */
function unaryCall<TReq, TRes>(
  method: string,
  request: TReq,
  timeoutMs?: number,
): Promise<TRes> {
  return new Promise<TRes>((resolve, reject) => {
    const client = getGrpcClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic gRPC method access
    const fn = (client as unknown as Record<string, (...args: unknown[]) => void>)[method];
    if (typeof fn !== 'function') {
      reject(new Error(`gRPC method ${method} not found on client`));
      return;
    }
    fn.call(
      client,
      request,
      { deadline: deadline(timeoutMs) },
      (err: grpc.ServiceError | null, response: TRes) => {
        if (err) {
          reject(err);
        } else {
          resolve(response);
        }
      },
    );
  });
}

// ── Typed RPC wrappers ────────────────────────────────────────

export function testConnection(req: TestConnectionRequest): Promise<TestConnectionResponse> {
  return unaryCall('TestConnection', req);
}

export function createSession(req: CreateSessionRequest): Promise<SessionInfo> {
  return unaryCall('CreateSession', req);
}

export function terminateSession(req: TerminateSessionRequest): Promise<Record<string, never>> {
  return unaryCall('TerminateSession', req);
}

export function getSession(req: GetSessionRequest): Promise<SessionInfo> {
  return unaryCall('GetSession', req);
}

export function resizeSession(req: ResizeSessionRequest): Promise<Record<string, never>> {
  return unaryCall('ResizeSession', req);
}

export function sendCommand(req: SendCommandRequest, timeoutMs?: number): Promise<SendCommandResponse> {
  return unaryCall('SendCommand', req, timeoutMs);
}

export function sendKeys(req: SendKeysRequest): Promise<Record<string, never>> {
  return unaryCall('SendKeys', req);
}

export function capturePane(req: CapturePaneRequest): Promise<CapturePaneResponse> {
  return unaryCall('CapturePane', req);
}

/**
 * Open a bidirectional stream for AttachSession.
 * Returns the duplex stream for the caller to manage.
 */
export function attachSession(): grpc.ClientDuplexStream<TerminalInput, TerminalOutput> {
  const client = getGrpcClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic gRPC method access
  const fn = (client as unknown as Record<string, (...args: unknown[]) => unknown>).AttachSession;
  if (typeof fn !== 'function') {
    throw new Error('gRPC method AttachSession not found on client');
  }
  return fn.call(client) as grpc.ClientDuplexStream<TerminalInput, TerminalOutput>;
}
