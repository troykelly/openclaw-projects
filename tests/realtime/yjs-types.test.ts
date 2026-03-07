/**
 * Tests for Yjs type definitions and constants.
 * Part of Issue #2256
 */

import { describe, it, expect } from 'vitest';
import {
  YJS_MSG_SYNC,
  YJS_MSG_AWARENESS,
  YJS_PERSIST_DEBOUNCE_MS,
  YJS_MAX_FLUSH_INTERVAL_MS,
  YJS_MAX_BINARY_SIZE,
  YJS_MAX_AWARENESS_SIZE,
  YJS_RATE_LIMIT_PER_SECOND,
  YJS_RATE_LIMIT_GLOBAL_PER_SECOND,
  YJS_DOC_EVICTION_TIMEOUT_MS,
  YJS_MAX_DOCS,
  YJS_REAUTH_INTERVAL_MS,
} from '../../src/api/realtime/yjs-types.ts';

describe('Yjs types constants', () => {
  it('sync and awareness message types are distinct single bytes', () => {
    expect(YJS_MSG_SYNC).toBe(0x01);
    expect(YJS_MSG_AWARENESS).toBe(0x02);
    expect(YJS_MSG_SYNC).not.toBe(YJS_MSG_AWARENESS);
  });

  it('persistence debounce is 10 seconds', () => {
    expect(YJS_PERSIST_DEBOUNCE_MS).toBe(10_000);
  });

  it('max flush interval is 60 seconds', () => {
    expect(YJS_MAX_FLUSH_INTERVAL_MS).toBe(60_000);
  });

  it('max binary size is 1MB', () => {
    expect(YJS_MAX_BINARY_SIZE).toBe(1024 * 1024);
  });

  it('max awareness size is 4KB', () => {
    expect(YJS_MAX_AWARENESS_SIZE).toBe(4096);
  });

  it('rate limit is 60 msg/s per client per room', () => {
    expect(YJS_RATE_LIMIT_PER_SECOND).toBe(60);
  });

  it('global rate limit is 120 msg/s per connection', () => {
    expect(YJS_RATE_LIMIT_GLOBAL_PER_SECOND).toBe(120);
  });

  it('doc eviction timeout is 5 minutes', () => {
    expect(YJS_DOC_EVICTION_TIMEOUT_MS).toBe(5 * 60 * 1000);
  });

  it('max docs is 500', () => {
    expect(YJS_MAX_DOCS).toBe(500);
  });

  it('re-auth interval is 30 seconds', () => {
    expect(YJS_REAUTH_INTERVAL_MS).toBe(30_000);
  });
});
