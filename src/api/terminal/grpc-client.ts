/**
 * gRPC client for connecting to the tmux worker TerminalService.
 *
 * Supports mTLS when TMUX_WORKER_MTLS_CERT, TMUX_WORKER_MTLS_KEY, and
 * TMUX_WORKER_MTLS_CA are configured. Falls back to insecure channel with
 * a warning when certs are not found.
 *
 * Issue #1685 — mTLS between API server and tmux worker
 */

import * as grpc from '@grpc/grpc-js';
import fs from 'node:fs';
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
      console.warn(
        `Failed to load mTLS certificates: ${(err as Error).message}. Falling back to insecure channel.`,
      );
      return grpc.credentials.createInsecure();
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

// ── Phase 3: Window/Pane management (#1677) ──────────────────

export function createWindow(req: CreateWindowRequest): Promise<WindowInfo> {
  return unaryCall('CreateWindow', req);
}

export function closeWindow(req: CloseWindowRequest): Promise<Record<string, never>> {
  return unaryCall('CloseWindow', req);
}

export function splitPane(req: SplitPaneRequest): Promise<PaneInfo> {
  return unaryCall('SplitPane', req);
}

export function closePane(req: ClosePaneRequest): Promise<Record<string, never>> {
  return unaryCall('ClosePane', req);
}

// ── Phase 3: Tunnel management (#1678) ───────────────────────

export function createTunnel(req: CreateTunnelRequest): Promise<TunnelInfo> {
  return unaryCall('CreateTunnel', req);
}

export function closeTunnel(req: CloseTunnelRequest): Promise<Record<string, never>> {
  return unaryCall('CloseTunnel', req);
}

export function listTunnels(req: ListTunnelsRequest): Promise<ListTunnelsResponse> {
  return unaryCall('ListTunnels', req);
}

// ── Phase 3: Host key verification (#1679) ───────────────────

export function approveHostKey(req: ApproveHostKeyRequest): Promise<Record<string, never>> {
  return unaryCall('ApproveHostKey', req);
}

export function rejectHostKey(req: RejectHostKeyRequest): Promise<Record<string, never>> {
  return unaryCall('RejectHostKey', req);
}
