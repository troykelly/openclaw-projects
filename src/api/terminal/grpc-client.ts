/**
 * gRPC client for connecting to the tmux worker TerminalService.
 *
 * Supports mTLS when TMUX_WORKER_MTLS_CERT, TMUX_WORKER_MTLS_KEY, and
 * TMUX_WORKER_MTLS_CA are configured. Falls back to insecure channel with
 * a warning when certs are not found.
 *
 * Issue #1685 — mTLS between API server and tmux worker
 * Issue #2128 — Trace ID propagation through gRPC metadata
 */

import * as grpc from '@grpc/grpc-js';
import fs from 'node:fs';
import { getTerminalServiceClient } from '../../tmux-worker/proto-loader.ts';
import { createGrpcMetadataWithTrace } from './trace-context.ts';
import type {
  TestConnectionRequest,
  TestConnectionResponse,
  CreateSessionRequest,
  SessionInfo,
  TerminateSessionRequest,
  ListSessionsRequest,
  ListSessionsResponse,
  GetSessionRequest,
  ResizeSessionRequest,
  SendCommandRequest,
  SendCommandResponse,
  SendKeysRequest,
  CapturePaneRequest,
  CapturePaneResponse,
  TerminalInput,
  TerminalOutput,
  CreateWindowRequest,
  WindowInfo,
  CloseWindowRequest,
  SplitPaneRequest,
  PaneInfo,
  ClosePaneRequest,
  CreateTunnelRequest,
  TunnelInfo,
  CloseTunnelRequest,
  ListTunnelsRequest,
  ListTunnelsResponse,
  ApproveHostKeyRequest,
  RejectHostKeyRequest,
} from '../../tmux-worker/types.ts';

/** Default gRPC deadline in milliseconds for unary RPCs. */
const DEFAULT_DEADLINE_MS = 30_000;

/** Lazy singleton gRPC client instance. */
let _client: grpc.Client | undefined;

/**
 * Build channel credentials — mTLS if certs are configured, insecure otherwise.
 */
export function buildClientCredentials(): grpc.ChannelCredentials {
  const certPath = process.env.TMUX_WORKER_MTLS_CERT ?? '';
  const keyPath = process.env.TMUX_WORKER_MTLS_KEY ?? '';
  const caPath = process.env.TMUX_WORKER_MTLS_CA ?? '';

  if (certPath && keyPath && caPath) {
    try {
      const rootCert = fs.readFileSync(caPath);
      const clientCert = fs.readFileSync(certPath);
      const clientKey = fs.readFileSync(keyPath);

      console.log('gRPC client using mTLS (mutual TLS)');
      return grpc.credentials.createSsl(rootCert, clientKey, clientCert);
    } catch (err) {
      // #2106: When mTLS is explicitly configured but certs fail to load,
      // throw to abort startup instead of silently degrading to insecure.
      throw new Error(
        `gRPC mTLS configured but certificates failed to load: ${(err as Error).message}. ` +
        `Fix cert paths (TMUX_WORKER_MTLS_CERT/KEY/CA) or remove them to explicitly run insecure.`,
      );
    }
  }

  console.warn(
    'gRPC mTLS not configured (TMUX_WORKER_MTLS_CERT/KEY/CA). Using insecure channel.',
  );
  return grpc.credentials.createInsecure();
}

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
      buildClientCredentials(),
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
 * Options for unary gRPC calls.
 */
interface UnaryCallOptions {
  timeoutMs?: number;
  /** Trace/correlation ID for distributed tracing (#2128). */
  traceId?: string;
}

/**
 * Wrap a gRPC unary call in a Promise.
 * Optionally propagates a trace ID via gRPC metadata (#2128).
 */
function unaryCall<TReq, TRes>(
  method: string,
  request: TReq,
  options?: UnaryCallOptions,
): Promise<TRes> {
  return new Promise<TRes>((resolve, reject) => {
    const client = getGrpcClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic gRPC method access
    const fn = (client as unknown as Record<string, (...args: unknown[]) => void>)[method];
    if (typeof fn !== 'function') {
      reject(new Error(`gRPC method ${method} not found on client`));
      return;
    }

    const callOptions: grpc.CallOptions = { deadline: deadline(options?.timeoutMs) };

    if (options?.traceId) {
      const metadata = createGrpcMetadataWithTrace(options.traceId);
      fn.call(
        client,
        request,
        metadata,
        callOptions,
        (err: grpc.ServiceError | null, response: TRes) => {
          if (err) reject(err);
          else resolve(response);
        },
      );
    } else {
      fn.call(
        client,
        request,
        callOptions,
        (err: grpc.ServiceError | null, response: TRes) => {
          if (err) reject(err);
          else resolve(response);
        },
      );
    }
  });
}

// ── Typed RPC wrappers ────────────────────────────────────────
// All wrappers accept an optional traceId for distributed tracing (#2128).

export function testConnection(req: TestConnectionRequest, traceId?: string): Promise<TestConnectionResponse> {
  return unaryCall('TestConnection', req, { traceId });
}

export function createSession(req: CreateSessionRequest, traceId?: string): Promise<SessionInfo> {
  return unaryCall('CreateSession', req, { traceId });
}

export function terminateSession(req: TerminateSessionRequest, traceId?: string): Promise<Record<string, never>> {
  return unaryCall('TerminateSession', req, { traceId });
}

export function listSessions(req: ListSessionsRequest, traceId?: string): Promise<ListSessionsResponse> {
  return unaryCall('ListSessions', req, { traceId });
}

export function getSession(req: GetSessionRequest, traceId?: string): Promise<SessionInfo> {
  return unaryCall('GetSession', req, { traceId });
}

export function resizeSession(req: ResizeSessionRequest, traceId?: string): Promise<Record<string, never>> {
  return unaryCall('ResizeSession', req, { traceId });
}

export function sendCommand(req: SendCommandRequest, timeoutMs?: number, traceId?: string): Promise<SendCommandResponse> {
  return unaryCall('SendCommand', req, { timeoutMs, traceId });
}

export function sendKeys(req: SendKeysRequest, traceId?: string): Promise<Record<string, never>> {
  return unaryCall('SendKeys', req, { traceId });
}

export function capturePane(req: CapturePaneRequest, traceId?: string): Promise<CapturePaneResponse> {
  return unaryCall('CapturePane', req, { traceId });
}

/**
 * Open a bidirectional stream for AttachSession.
 * Returns the duplex stream for the caller to manage.
 * Optionally propagates a trace ID via gRPC metadata (#2128).
 */
export function attachSession(traceId?: string): grpc.ClientDuplexStream<TerminalInput, TerminalOutput> {
  const client = getGrpcClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic gRPC method access
  const fn = (client as unknown as Record<string, (...args: unknown[]) => unknown>).AttachSession;
  if (typeof fn !== 'function') {
    throw new Error('gRPC method AttachSession not found on client');
  }
  if (traceId) {
    const metadata = createGrpcMetadataWithTrace(traceId);
    return fn.call(client, metadata) as grpc.ClientDuplexStream<TerminalInput, TerminalOutput>;
  }
  return fn.call(client) as grpc.ClientDuplexStream<TerminalInput, TerminalOutput>;
}

// ── Phase 3: Window/Pane management (#1677) ──────────────────

export function createWindow(req: CreateWindowRequest, traceId?: string): Promise<WindowInfo> {
  return unaryCall('CreateWindow', req, { traceId });
}

export function closeWindow(req: CloseWindowRequest, traceId?: string): Promise<Record<string, never>> {
  return unaryCall('CloseWindow', req, { traceId });
}

export function splitPane(req: SplitPaneRequest, traceId?: string): Promise<PaneInfo> {
  return unaryCall('SplitPane', req, { traceId });
}

export function closePane(req: ClosePaneRequest, traceId?: string): Promise<Record<string, never>> {
  return unaryCall('ClosePane', req, { traceId });
}

// ── Phase 3: Tunnel management (#1678) ───────────────────────

export function createTunnel(req: CreateTunnelRequest, traceId?: string): Promise<TunnelInfo> {
  return unaryCall('CreateTunnel', req, { traceId });
}

export function closeTunnel(req: CloseTunnelRequest, traceId?: string): Promise<Record<string, never>> {
  return unaryCall('CloseTunnel', req, { traceId });
}

export function listTunnels(req: ListTunnelsRequest, traceId?: string): Promise<ListTunnelsResponse> {
  return unaryCall('ListTunnels', req, { traceId });
}

// ── Phase 3: Host key verification (#1679) ───────────────────

export function approveHostKey(req: ApproveHostKeyRequest, traceId?: string): Promise<Record<string, never>> {
  return unaryCall('ApproveHostKey', req, { traceId });
}

export function rejectHostKey(req: RejectHostKeyRequest, traceId?: string): Promise<Record<string, never>> {
  return unaryCall('RejectHostKey', req, { traceId });
}
