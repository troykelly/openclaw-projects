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

  return {
    grpcPort,
    enrollmentSshPort,
    workerId,
    healthPort,
    encryptionKeyHex,
    databaseUrl,
  };
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
