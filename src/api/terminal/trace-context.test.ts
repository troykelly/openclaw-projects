/**
 * Tests for trace context utilities.
 * Issue #2128 — Request tracing across WebSocket -> REST -> gRPC boundary.
 */

import { describe, it, expect } from 'vitest';
import * as grpc from '@grpc/grpc-js';
import {
  generateTraceId,
  extractOrCreateTraceId,
  createGrpcMetadataWithTrace,
  extractTraceIdFromGrpcMetadata,
  traceLogContext,
  TRACE_ID_HEADER,
  TRACE_ID_METADATA_KEY,
} from './trace-context.ts';
import type { FastifyRequest } from 'fastify';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('trace-context', () => {
  describe('generateTraceId', () => {
    it('generates a valid UUID', () => {
      const id = generateTraceId();
      expect(id).toMatch(UUID_REGEX);
    });

    it('generates unique IDs', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateTraceId()));
      expect(ids.size).toBe(100);
    });
  });

  describe('extractOrCreateTraceId', () => {
    it('returns existing trace ID from request headers', () => {
      const existingId = 'test-trace-id-123';
      const req = {
        headers: { [TRACE_ID_HEADER]: existingId },
      } as unknown as FastifyRequest;

      expect(extractOrCreateTraceId(req)).toBe(existingId);
    });

    it('generates a new trace ID when header is absent', () => {
      const req = { headers: {} } as unknown as FastifyRequest;
      const id = extractOrCreateTraceId(req);
      expect(id).toMatch(UUID_REGEX);
    });

    it('generates a new trace ID when header is empty string', () => {
      const req = {
        headers: { [TRACE_ID_HEADER]: '' },
      } as unknown as FastifyRequest;
      const id = extractOrCreateTraceId(req);
      expect(id).toMatch(UUID_REGEX);
    });
  });

  describe('gRPC metadata propagation', () => {
    it('creates metadata with trace ID', () => {
      const traceId = 'trace-abc-123';
      const metadata = createGrpcMetadataWithTrace(traceId);
      const values = metadata.get(TRACE_ID_METADATA_KEY);
      expect(values).toHaveLength(1);
      expect(values[0]).toBe(traceId);
    });

    it('extracts trace ID from gRPC metadata', () => {
      const traceId = 'trace-xyz-456';
      const metadata = new grpc.Metadata();
      metadata.set(TRACE_ID_METADATA_KEY, traceId);

      expect(extractTraceIdFromGrpcMetadata(metadata)).toBe(traceId);
    });

    it('returns undefined when trace ID is not in metadata', () => {
      const metadata = new grpc.Metadata();
      expect(extractTraceIdFromGrpcMetadata(metadata)).toBeUndefined();
    });

    it('round-trips trace ID through create and extract', () => {
      const traceId = generateTraceId();
      const metadata = createGrpcMetadataWithTrace(traceId);
      expect(extractTraceIdFromGrpcMetadata(metadata)).toBe(traceId);
    });
  });

  describe('traceLogContext', () => {
    it('creates log context for websocket boundary', () => {
      const ctx = traceLogContext('trace-1', 'websocket');
      expect(ctx).toEqual({ traceId: 'trace-1', boundary: 'websocket' });
    });

    it('creates log context for rest boundary', () => {
      const ctx = traceLogContext('trace-2', 'rest');
      expect(ctx).toEqual({ traceId: 'trace-2', boundary: 'rest' });
    });

    it('creates log context for grpc boundary', () => {
      const ctx = traceLogContext('trace-3', 'grpc');
      expect(ctx).toEqual({ traceId: 'trace-3', boundary: 'grpc' });
    });
  });

  describe('constants', () => {
    it('uses x-trace-id as the HTTP header name', () => {
      expect(TRACE_ID_HEADER).toBe('x-trace-id');
    });

    it('uses x-trace-id as the gRPC metadata key', () => {
      expect(TRACE_ID_METADATA_KEY).toBe('x-trace-id');
    });
  });
});
