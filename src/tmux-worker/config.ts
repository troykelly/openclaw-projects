/**
 * TMux worker configuration loaded from environment variables.
 */

export interface TmuxWorkerConfig {
  /** gRPC listen port. */
  grpcPort: number;
  /** SSH enrollment listener port. */
  enrollmentSshPort: number;
  /** Worker instance identifier. */
  workerId: string;
  /** Health check HTTP port. */
  healthPort: number;
  /** Master encryption key (hex) for credential encryption. */
  encryptionKeyHex: string;
  /** Database connection string. */
  databaseUrl: string;
  /** Path to the gRPC TLS server certificate (PEM). */
  grpcTlsCert: string;
  /** Path to the gRPC TLS server private key (PEM). */
  grpcTlsKey: string;
  /** Path to the CA certificate for client verification (PEM). */
  grpcTlsCa: string;
  /** Path to persist the SSH enrollment host key. Empty = ephemeral. */
  enrollmentSshHostKeyPath: string;
  /** SSH host key type to generate: ed25519 (default), ecdsa, or rsa. */
  enrollmentSshHostKeyType: string;
}

/**
 * Load configuration from environment variables.
 * Falls back to sensible defaults where possible.
 */
export function loadConfig(): TmuxWorkerConfig {
  const grpcPort = parseInt(process.env.GRPC_PORT ?? '50051', 10);
  const enrollmentSshPort = parseInt(
    process.env.ENROLLMENT_SSH_PORT ?? '2222',
    10,
  );
  const healthPort = parseInt(
    process.env.TMUX_WORKER_HEALTH_PORT ?? '9002',
    10,
  );
  const workerId = process.env.WORKER_ID ?? `tmux-worker-${process.pid}`;
  const encryptionKeyHex = process.env.OAUTH_TOKEN_ENCRYPTION_KEY ?? '';

  // Build DATABASE_URL from PG* env vars if not explicitly set
  const databaseUrl =
    process.env.DATABASE_URL ??
    buildDatabaseUrl();

  const grpcTlsCert = process.env.GRPC_TLS_CERT ?? '';
  const grpcTlsKey = process.env.GRPC_TLS_KEY ?? '';
  const grpcTlsCa = process.env.GRPC_TLS_CA ?? '';
  const enrollmentSshHostKeyPath = process.env.ENROLLMENT_SSH_HOST_KEY_PATH ?? '';
  const enrollmentSshHostKeyType = process.env.ENROLLMENT_SSH_HOST_KEY_TYPE ?? 'ed25519';

  return {
    grpcPort,
    enrollmentSshPort,
    workerId,
    healthPort,
    encryptionKeyHex,
    databaseUrl,
    grpcTlsCert,
    grpcTlsKey,
    grpcTlsCa,
    enrollmentSshHostKeyPath,
    enrollmentSshHostKeyType,
  };
}

/**
 * Validate an encryption key hex string.
 * Returns { valid: true } on success, or { valid: false, error: string } on failure.
 *
 * Issue #1859 — Validate encryption key at worker startup
 */
export function validateEncryptionKey(hexKey: string): { valid: boolean; error?: string } {
  if (hexKey.length !== 64) {
    return {
      valid: false,
      error: `OAUTH_TOKEN_ENCRYPTION_KEY must be a 64-character hex string (32 bytes), got ${hexKey.length} characters`,
    };
  }
  if (!/^[0-9a-fA-F]{64}$/.test(hexKey)) {
    return {
      valid: false,
      error: 'OAUTH_TOKEN_ENCRYPTION_KEY must contain only hexadecimal characters (0-9, a-f, A-F)',
    };
  }
  return { valid: true };
}

/** Construct a DATABASE_URL from individual PG* environment variables. */
function buildDatabaseUrl(): string {
  const host = process.env.PGHOST ?? 'localhost';
  const port = process.env.PGPORT ?? '5432';
  const user = process.env.PGUSER ?? 'openclaw';
  const password = process.env.PGPASSWORD ?? '';
  const database = process.env.PGDATABASE ?? 'openclaw';

  return `postgresql://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}?sslmode=disable`;
}
