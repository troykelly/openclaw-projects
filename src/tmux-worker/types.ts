/**
 * TypeScript type definitions for the TerminalService gRPC messages.
 *
 * These mirror the protobuf definitions in proto/terminal/v1/terminal.proto
 * for use in application code. The @grpc/proto-loader handles runtime
 * serialization; these types provide compile-time safety.
 *
 * Note: google.protobuf.Timestamp is deserialized by @grpc/proto-loader
 * (with longs: 'String') as { seconds: string; nanos: number }, NOT as
 * a plain ISO string. Issue #1860.
 */

// ─── Proto Timestamp ─────────────────────────────────────────

/**
 * Proto Timestamp as deserialized by @grpc/proto-loader with longs: 'String'.
 */
export interface ProtoTimestamp {
  seconds: string;
  nanos: number;
}

/**
 * Convert a Date (or ISO string) to a proto Timestamp.
 * Returns null for null/undefined input.
 */
export function toTimestamp(input: Date | string | null | undefined): ProtoTimestamp | null {
  if (input == null) return null;
  const date = typeof input === 'string' ? new Date(input) : input;
  const ms = date.getTime();
  const seconds = Math.floor(ms / 1000);
  const nanos = (ms % 1000) * 1_000_000;
  return { seconds: String(seconds), nanos };
}

/**
 * Convert a proto Timestamp to an ISO date string.
 * Returns null for null/undefined input.
 */
export function fromTimestamp(ts: ProtoTimestamp | null | undefined): string | null {
  if (ts == null) return null;
  const ms = Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1_000_000);
  return new Date(ms).toISOString();
}

// ─── Connection ─────────────────────────────────────────────

export interface TestConnectionRequest {
  connection_id: string;
}

export interface TestConnectionResponse {
  success: boolean;
  message: string;
  latency_ms: number;
  host_key_fingerprint: string;
}

// ─── Session lifecycle ──────────────────────────────────────

export type SessionStatus =
  | 'starting'
  | 'active'
  | 'idle'
  | 'disconnected'
  | 'terminated'
  | 'error'
  | 'pending_host_verification';

export interface CreateSessionRequest {
  connection_id: string;
  namespace: string;
  tmux_session_name: string;
  cols: number;
  rows: number;
  capture_on_command: boolean;
  embed_commands: boolean;
  embed_scrollback: boolean;
  capture_interval_s: number;
  tags: string[];
  notes: string;
}

export interface TerminateSessionRequest {
  session_id: string;
}

export interface ListSessionsRequest {
  namespace: string;
  connection_id: string;
  status_filter: string;
}

export interface ListSessionsResponse {
  sessions: SessionInfo[];
}

export interface GetSessionRequest {
  session_id: string;
}

export interface ResizeSessionRequest {
  session_id: string;
  cols: number;
  rows: number;
}

export interface SessionInfo {
  id: string;
  namespace: string;
  connection_id: string;
  tmux_session_name: string;
  worker_id: string;
  status: string;
  cols: number;
  rows: number;
  windows: WindowInfo[];
  started_at: ProtoTimestamp | null;
  last_activity_at: ProtoTimestamp | null;
  terminated_at: ProtoTimestamp | null;
  exit_code: number;
  error_message: string;
  tags: string[];
  notes: string;
}

// ─── Window / Pane ──────────────────────────────────────────

export interface CreateWindowRequest {
  session_id: string;
  window_name: string;
}

export interface CloseWindowRequest {
  session_id: string;
  window_index: number;
}

export interface SplitPaneRequest {
  session_id: string;
  window_index: number;
  horizontal: boolean;
}

export interface ClosePaneRequest {
  session_id: string;
  window_index: number;
  pane_index: number;
}

export interface WindowInfo {
  id: string;
  session_id: string;
  window_index: number;
  window_name: string;
  is_active: boolean;
  panes: PaneInfo[];
}

export interface PaneInfo {
  id: string;
  window_id: string;
  pane_index: number;
  is_active: boolean;
  pid: number;
  current_command: string;
}

// ─── Terminal I/O ───────────────────────────────────────────

export interface TerminalInput {
  session_id: string;
  data?: Buffer;
  resize?: TerminalResize;
}

export interface TerminalOutput {
  data?: Buffer;
  event?: TerminalEvent;
}

export interface TerminalResize {
  cols: number;
  rows: number;
}

export interface TerminalEvent {
  type: string;
  message: string;
  session_id: string;
  host_key: HostKeyInfo | null;
}

export interface HostKeyInfo {
  host: string;
  port: number;
  key_type: string;
  fingerprint: string;
  public_key: string;
}

// ─── Command execution ─────────────────────────────────────

export interface SendCommandRequest {
  session_id: string;
  command: string;
  timeout_s: number;
  pane_id: string;
}

export interface SendCommandResponse {
  output: string;
  timed_out: boolean;
  exit_code: number;
}

export interface SendKeysRequest {
  session_id: string;
  keys: string;
  pane_id: string;
}

// ─── Scrollback ─────────────────────────────────────────────

export interface CapturePaneRequest {
  session_id: string;
  pane_id: string;
  lines: number;
}

export interface CapturePaneResponse {
  content: string;
  lines_captured: number;
}

// ─── Tunnels ────────────────────────────────────────────────

export type TunnelDirection = 'local' | 'remote' | 'dynamic';
export type TunnelStatus = 'active' | 'failed' | 'closed';

export interface CreateTunnelRequest {
  connection_id: string;
  namespace: string;
  session_id: string;
  direction: string;
  bind_host: string;
  bind_port: number;
  target_host: string;
  target_port: number;
}

export interface CloseTunnelRequest {
  tunnel_id: string;
}

export interface ListTunnelsRequest {
  namespace: string;
  connection_id: string;
}

export interface ListTunnelsResponse {
  tunnels: TunnelInfo[];
}

export interface TunnelInfo {
  id: string;
  connection_id: string;
  session_id: string;
  direction: string;
  bind_host: string;
  bind_port: number;
  target_host: string;
  target_port: number;
  status: string;
  error_message: string;
}

// ─── Enrollment ─────────────────────────────────────────────

export interface EnrollmentEvent {
  connection_id: string;
  host: string;
  port: number;
  label: string;
  tags: string[];
  enrolled_at: ProtoTimestamp | null;
}

// ─── Host key verification ──────────────────────────────────

export interface ApproveHostKeyRequest {
  session_id: string;
  host: string;
  port: number;
  key_type: string;
  fingerprint: string;
  public_key: string;
}

export interface RejectHostKeyRequest {
  session_id: string;
}

// ─── Health ─────────────────────────────────────────────────

export interface WorkerStatus {
  worker_id: string;
  active_sessions: number;
  uptime_seconds: string; // int64 as string per proto-loader longs: String
  version: string;
}
