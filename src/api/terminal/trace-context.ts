/**
 * Trace context utilities for request correlation across WebSocket, REST, and gRPC boundaries.
 *
 * Issue #2128 — Request tracing across WebSocket -> REST -> gRPC boundary.
 *
 * Generates and propagates a correlation ID (trace ID) through all three
 * communication boundaries so that a single request can be traced end-to-end
 * in logs.
 */

import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import * as grpc from '@grpc/grpc-js';

/** HTTP header name for the correlation ID. */
export const TRACE_ID_HEADER = 'x-trace-id';

/** gRPC metadata key for the correlation ID. */
export const TRACE_ID_METADATA_KEY = 'x-trace-id';

/**
 * Generate a new trace ID (UUID v4).
 */
export function generateTraceId(): string {
  return randomUUID();
}

/** Maximum length for a client-provided trace ID. */
const MAX_TRACE_ID_LENGTH = 128;

/** Pattern for acceptable trace ID characters (alphanumeric, hyphens, underscores, dots). */
const TRACE_ID_PATTERN = /^[a-zA-Z0-9._-]+$/;

/**
 * Validate and sanitize a client-provided trace ID.
 * Returns the trace ID if it passes validation, or undefined.
 */
export function validateTraceId(value: string): string | undefined {
  if (value.length === 0 || value.length > MAX_TRACE_ID_LENGTH) return undefined;
  if (!TRACE_ID_PATTERN.test(value)) return undefined;
  return value;
}

/**
 * Extract trace ID from a Fastify request.
 * Returns the existing trace ID from headers (if valid), or generates a new one.
 */
export function extractOrCreateTraceId(req: FastifyRequest): string {
  const existing = req.headers[TRACE_ID_HEADER];
  if (typeof existing === 'string') {
    const validated = validateTraceId(existing);
    if (validated) return validated;
  }
  return generateTraceId();
}

/**
 * Create gRPC Metadata with the trace ID set.
 */
export function createGrpcMetadataWithTrace(traceId: string): grpc.Metadata {
  const metadata = new grpc.Metadata();
  metadata.set(TRACE_ID_METADATA_KEY, traceId);
  return metadata;
}

/**
 * Extract trace ID from gRPC metadata.
 * Returns the trace ID if present, or undefined.
 */
export function extractTraceIdFromGrpcMetadata(
  metadata: grpc.Metadata,
): string | undefined {
  const values = metadata.get(TRACE_ID_METADATA_KEY);
  if (values.length > 0) {
    return String(values[0]);
  }
  return undefined;
}

/**
 * Extract trace ID from a gRPC server call's metadata.
 */
export function extractTraceIdFromCall(
  call: grpc.ServerUnaryCall<unknown, unknown> | grpc.ServerDuplexStream<unknown, unknown> | grpc.ServerWritableStream<unknown, unknown>,
): string | undefined {
  return extractTraceIdFromGrpcMetadata(call.metadata);
}

/**
 * Create a structured log context object with the trace ID.
 * Use this to add trace context to log messages at each boundary.
 */
export function traceLogContext(traceId: string, boundary: 'websocket' | 'rest' | 'grpc'): {
  traceId: string;
  boundary: string;
} {
  return { traceId, boundary };
}
