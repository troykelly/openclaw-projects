/**
 * E2E test setup and utilities.
 * Part of Epic #310, Issue #326, #1336.
 *
 * Provides infrastructure for running E2E tests against a real backend.
 * Supports JWT Bearer authentication when JWT_SECRET is configured.
 */

import { beforeAll, afterAll, afterEach } from 'vitest';
import { SignJWT } from 'jose';
import { createHash, randomUUID } from 'node:crypto';

/** E2E test configuration */
export interface E2EConfig {
  /** Backend API URL */
  apiUrl: string;
  /** Gateway URL (for future OpenClaw Gateway integration) */
  gatewayUrl?: string;
  /** Connection timeout in milliseconds */
  timeout: number;
  /** Number of retries for service health checks */
  healthCheckRetries: number;
}

/** Default E2E configuration */
export const defaultConfig: E2EConfig = {
  apiUrl: process.env.E2E_API_URL || 'http://localhost:3001',
  gatewayUrl: process.env.E2E_GATEWAY_URL || 'http://localhost:18789',
  timeout: 30000,
  healthCheckRetries: 10,
};

/** Well-known JWT secret used in E2E test environments. */
const E2E_JWT_SECRET = process.env.JWT_SECRET || 'e2e-test-jwt-secret-at-least-32-bytes-long!!';

/** Default test user email for E2E tests. */
const E2E_TEST_EMAIL = process.env.OPENCLAW_E2E_SESSION_EMAIL || 'e2e-test@example.com';

/**
 * Signs a short-lived HS256 JWT for E2E test authentication.
 *
 * Uses the same algorithm and claims structure as the backend's
 * signAccessToken() in src/api/auth/jwt.ts.
 *
 * @param email - Subject email for the token. Defaults to E2E_TEST_EMAIL.
 * @returns Compact JWS string suitable for Authorization: Bearer header.
 */
export async function signTestJwt(email: string = E2E_TEST_EMAIL): Promise<string> {
  const secret = new TextEncoder().encode(E2E_JWT_SECRET);
  const kid = createHash('sha256')
    .update(E2E_JWT_SECRET.slice(0, 8))
    .digest('hex')
    .slice(0, 8);

  return new SignJWT({ type: 'user' })
    .setProtectedHeader({ alg: 'HS256', kid })
    .setSubject(email)
    .setIssuedAt()
    .setExpirationTime('15m')
    .setJti(randomUUID())
    .sign(secret);
}

/**
 * Wait for a service to become healthy.
 *
 * @param url - Health check URL
 * @param retries - Number of retries
 * @param delayMs - Delay between retries in milliseconds
 */
export async function waitForService(url: string, retries: number = 10, delayMs: number = 1000): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Service not ready yet
    }

    if (i < retries - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error(`Service at ${url} did not become healthy after ${retries} retries`);
}

/**
 * Build default request headers including JWT Bearer auth.
 *
 * @param includeContentType - Whether to include Content-Type: application/json.
 *   Set to false for bodyless methods (GET, DELETE) to avoid Fastify 400 errors.
 */
async function buildHeaders(includeContentType: boolean): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  if (includeContentType) {
    headers['Content-Type'] = 'application/json';
  }
  const token = await signTestJwt();
  headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

/**
 * Create an API client for E2E tests.
 * Automatically attaches a JWT Bearer token to every request.
 */
export function createTestApiClient(baseUrl: string) {
  return {
    async get<T>(path: string): Promise<T> {
      const headers = await buildHeaders(false);
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'GET',
        headers,
      });
      if (!response.ok) {
        throw new Error(`GET ${path} failed: ${response.status}`);
      }
      return response.json() as Promise<T>;
    },

    async post<T>(path: string, body: unknown): Promise<T> {
      const headers = await buildHeaders(true);
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(`POST ${path} failed: ${response.status}`);
      }
      return response.json() as Promise<T>;
    },

    async put<T>(path: string, body: unknown): Promise<T> {
      const headers = await buildHeaders(true);
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(`PUT ${path} failed: ${response.status}`);
      }
      return response.json() as Promise<T>;
    },

    async delete(path: string): Promise<void> {
      const headers = await buildHeaders(false);
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'DELETE',
        headers,
      });
      if (!response.ok) {
        throw new Error(`DELETE ${path} failed: ${response.status}`);
      }
    },
  };
}

/**
 * Check if E2E services are available.
 */
export async function areE2EServicesAvailable(config: E2EConfig = defaultConfig): Promise<boolean> {
  try {
    await waitForService(`${config.apiUrl}/api/health`, 1, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Skip E2E tests if services are not available.
 */
export function skipIfServicesUnavailable(config: E2EConfig = defaultConfig) {
  beforeAll(async () => {
    const available = await areE2EServicesAvailable(config);
    if (!available) {
      console.log('E2E services not available, skipping tests');
      return;
    }
  });
}

/** Test data helpers */
export const testData = {
  /** Generate a unique test email */
  uniqueEmail(): string {
    return `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  },

  /** Generate a unique test phone */
  uniquePhone(): string {
    return `+1555${Math.floor(1000000 + Math.random() * 9000000)}`;
  },

  /** Sample memory content */
  sampleMemory: {
    content: 'Test memory content for E2E testing',
    category: 'fact' as const,
    importance: 5,
  },

  /** Sample project */
  sampleProject: {
    name: 'E2E Test Project',
    description: 'A project created during E2E testing',
  },

  /** Sample contact */
  sampleContact: {
    name: 'E2E Test Contact',
    email: 'test@example.com',
    phone: '+15551234567',
  },
};

/**
 * E2E test context for sharing state across tests.
 */
export interface E2ETestContext {
  apiClient: ReturnType<typeof createTestApiClient>;
  config: E2EConfig;
  createdIds: {
    memories: string[];
    projects: string[];
    contacts: string[];
    workItems: string[];
    skills: string[];
  };
}

/**
 * Create E2E test context.
 */
export function createE2EContext(config: E2EConfig = defaultConfig): E2ETestContext {
  return {
    apiClient: createTestApiClient(config.apiUrl),
    config,
    createdIds: {
      memories: [],
      projects: [],
      contacts: [],
      workItems: [],
      skills: [],
    },
  };
}

/**
 * Setup E2E test lifecycle hooks.
 */
export function setupE2ELifecycle(context: E2ETestContext) {
  beforeAll(async () => {
    // Wait for backend to be available
    await waitForService(`${context.config.apiUrl}/api/health`, context.config.healthCheckRetries);
  });

  afterEach(async () => {
    // Cleanup could be added here if needed
  });

  afterAll(async () => {
    // Cleanup all created resources
    await cleanupResources(context);
  });
}

/**
 * Cleanup all resources created during tests.
 */
export async function cleanupResources(context: E2ETestContext): Promise<void> {
  // Cleanup memories
  for (const id of context.createdIds.memories) {
    try {
      await context.apiClient.delete(`/api/memories/${id}`);
    } catch {
      // Ignore cleanup errors
    }
  }

  // Cleanup contacts
  for (const id of context.createdIds.contacts) {
    try {
      await context.apiClient.delete(`/api/contacts/${id}`);
    } catch {
      // Ignore cleanup errors
    }
  }

  // Cleanup work items
  for (const id of context.createdIds.workItems) {
    try {
      await context.apiClient.delete(`/api/work-items/${id}`);
    } catch {
      // Ignore cleanup errors
    }
  }

  // Cleanup projects (if not already cleaned via workItems)
  for (const id of context.createdIds.projects) {
    try {
      await context.apiClient.delete(`/api/work-items/${id}`);
    } catch {
      // Ignore cleanup errors
    }
  }

  // Cleanup skills
  for (const id of context.createdIds.skills) {
    try {
      await context.apiClient.delete(`/api/skill-store/items/${id}`);
    } catch {
      // Ignore cleanup errors
    }
  }
}
