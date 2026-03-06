/**
 * gRPC bind address and production mTLS enforcement.
 *
 * Issue #2191, Sub-item 2 — Bind private interface by default; require mTLS in production.
 *
 * The gRPC worker previously bound to 0.0.0.0 (all interfaces) which is
 * insecure when TLS is not configured. Now defaults to 127.0.0.1 (loopback)
 * and requires mTLS when NODE_ENV=production.
 */

/** TLS configuration subset needed for validation. */
interface TlsConfig {
  grpcTlsCert: string;
  grpcTlsKey: string;
  grpcTlsCa: string;
}

/**
 * Get the gRPC bind address.
 *
 * Defaults to 127.0.0.1 (loopback only) for security.
 * Override with GRPC_BIND_ADDRESS to bind to other interfaces.
 */
export function getGrpcBindAddress(): string {
  return process.env.GRPC_BIND_ADDRESS ?? '127.0.0.1';
}

/**
 * Enforce mTLS configuration in production.
 *
 * Throws if NODE_ENV=production and TLS certificates are not configured.
 * In non-production environments, insecure mode is allowed (with warnings).
 */
export function requireMtlsInProduction(config: TlsConfig): void {
  if (process.env.NODE_ENV !== 'production') return;

  const hasCert = !!config.grpcTlsCert;
  const hasKey = !!config.grpcTlsKey;
  const hasCa = !!config.grpcTlsCa;

  if (!hasCert || !hasKey || !hasCa) {
    throw new Error(
      'gRPC mTLS is required in production. Set GRPC_TLS_CERT, GRPC_TLS_KEY, and GRPC_TLS_CA ' +
      'environment variables to TLS certificate paths. Insecure gRPC is not allowed when NODE_ENV=production.',
    );
  }
}
