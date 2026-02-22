/**
 * Embedding API mock for integration tests.
 *
 * Intercepts fetch calls to known embedding API endpoints and returns
 * deterministic fake embeddings, so integration tests:
 *   - Never make real API calls (each costs 500-750ms + credits)
 *   - Run consistently without network access or API keys
 *   - Work for all developers regardless of whether they have keys
 *
 * The fake VOYAGERAI_API_KEY causes the embedding service to configure
 * itself, so tests guarded by `it.skipIf(!hasApiKey)` will execute.
 *
 * The stub is installed once before any tests run and cleared after each
 * file. It only intercepts known embedding endpoints — all other fetch
 * calls (including any direct HTTP calls to the test server) are forwarded
 * to the real fetch unchanged.
 *
 * IMPORTANT: This setup file is compatible with test files that manage
 * their own fetch mocks (e.g. via vi.stubGlobal('fetch', vi.fn())).
 * If fetch is already a Vitest mock when beforeEach runs, we skip
 * our stub to avoid interfering.
 */

import { vi, beforeEach, afterEach } from 'vitest';
import { PROVIDER_DETAILS } from '../src/api/embeddings/types.ts';
import { embeddingService } from '../src/api/embeddings/service.ts';

// Deterministic 1024-dimensional embedding (unique per input position).
// Values are small floats normalised to [-1, 1] so pgvector similarity works.
const DIMENSIONS = 1024;

function makeFakeEmbedding(seed = 0): number[] {
  return Array.from({ length: DIMENSIONS }, (_, i) => {
    const angle = ((i + seed * 7) * Math.PI) / DIMENSIONS;
    return Math.sin(angle) * 0.1;
  });
}

const EMBEDDING_HOSTS = [
  'api.voyageai.com',
  'api.openai.com',
  'generativelanguage.googleapis.com',
];

function isEmbeddingUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return EMBEDDING_HOSTS.some((h) => host.endsWith(h));
  } catch {
    return false;
  }
}

/**
 * Build a fake VoyageAI-compatible response for the given input texts.
 * (OpenAI uses the same shape; Gemini differs but we only ever use VoyageAI
 * or OpenAI in practice, so this is sufficient.)
 */
function buildFakeResponse(body: string): Response {
  let texts: string[] = [''];

  try {
    const parsed = JSON.parse(body) as { input?: string[]; texts?: string[] };
    texts = parsed.input ?? parsed.texts ?? texts;
  } catch {
    // Ignore parse errors — return one fake embedding.
  }

  const data = texts.map((_, i) => ({
    object: 'embedding',
    index: i,
    embedding: makeFakeEmbedding(i),
  }));

  const responseBody = JSON.stringify({
    object: 'list',
    data,
    model: PROVIDER_DETAILS.voyageai.model,
    usage: { total_tokens: texts.reduce((sum, t) => sum + t.split(' ').length, 0) },
  });

  return new Response(responseBody, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Environment setup ────────────────────────────────────────────────────────────────

// Provide a fake API key so the embedding service self-configures.
// Without a key the service returns null for every embed call, and tests
// guarded by `it.skipIf(!hasApiKey)` would be skipped entirely.
if (!process.env.VOYAGERAI_API_KEY) {
  process.env.VOYAGERAI_API_KEY = 'test-fake-key-for-integration-mocks';
}

// ── Fetch interception ───────────────────────────────────────────────────────────────

const realFetch = globalThis.fetch;

// Track whether WE installed the fetch stub so we only clean up our own.
let weInstalledStub = false;

beforeEach(() => {
  // If fetch has already been replaced by a Vitest mock (vi.fn()), the test
  // file manages its own mock. Skip our interception to avoid clobbering it.
  // vi.fn() objects have a .mock property with calls/results tracking.
  const currentFetch = globalThis.fetch as unknown as { mock?: unknown };
  if (currentFetch && typeof currentFetch === 'function' && 'mock' in currentFetch) {
    weInstalledStub = false;
    embeddingService.clearCache();
    return;
  }

  weInstalledStub = true;

  // Replace globalThis.fetch with an interceptor.
  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;

      if (isEmbeddingUrl(url)) {
        const body = typeof init?.body === 'string' ? init.body : '{}';
        return buildFakeResponse(body);
      }

      return realFetch(input, init);
    },
  );

  // Clear the provider cache so the service picks up the fake key freshly.
  embeddingService.clearCache();
});

afterEach(() => {
  // Only unstub if we were the ones who installed the stub.
  if (weInstalledStub) {
    vi.unstubAllGlobals();
    weInstalledStub = false;
  }
  embeddingService.clearCache();
});
