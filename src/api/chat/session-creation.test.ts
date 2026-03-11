/**
 * Unit tests for chat session creation — duplicate endpoint handling.
 * Issue #2386: POST /chat/sessions returned 500 on second session creation
 * for the same user+agent pair due to duplicate contact_endpoint insert.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * These tests verify the SQL logic that the route handler uses:
 * - First session: INSERT contact + contact_endpoint (no prior rows)
 * - Second session: SELECT existing endpoint, skip INSERT
 *
 * We mock the pg client to simulate the DB responses.
 */

/** Minimal mock PoolClient that records queries. */
function createMockClient() {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  let endpointExists = false;

  const client = {
    query: vi.fn(async (text: string, values?: unknown[]) => {
      queries.push({ text, values: values ?? [] });

      // SELECT for existing endpoint
      if (text.includes('SELECT id FROM contact_endpoint')) {
        return {
          rows: endpointExists ? [{ id: 'existing-ep-id' }] : [],
        };
      }

      // INSERT INTO contact_endpoint (must check before INSERT INTO contact)
      if (text.includes('INSERT INTO contact_endpoint')) {
        if (endpointExists) {
          // Simulate the unique constraint violation that occurred before the fix
          const err = new Error(
            'duplicate key value violates unique constraint "contact_endpoint_normalized_unique"',
          );
          (err as NodeJS.ErrnoException).code = '23505';
          throw err;
        }
        return { rows: [{ id: 'new-ep-id' }] };
      }

      // INSERT INTO contact (display_name)
      if (text.includes('INSERT INTO contact')) {
        return { rows: [{ id: 'new-contact-id' }] };
      }

      // INSERT INTO external_thread
      if (text.includes('INSERT INTO external_thread')) {
        return { rows: [{ id: 'thread-id' }] };
      }

      // INSERT INTO chat_session
      if (text.includes('INSERT INTO chat_session')) {
        return {
          rows: [{ id: 'session-id', user_email: 'test@example.com', agent_id: 'agent-1' }],
        };
      }

      // BEGIN / COMMIT
      return { rows: [] };
    }),
    release: vi.fn(),
  };

  return {
    client,
    queries,
    setEndpointExists(exists: boolean) {
      endpointExists = exists;
    },
  };
}

/**
 * Simulates the session-creation logic from routes.ts (the fixed version)
 * to verify it correctly reuses existing endpoints.
 */
async function createSessionEndpoint(
  client: ReturnType<typeof createMockClient>['client'],
  agentId: string,
  userEmail: string,
  namespace: string,
): Promise<string> {
  await client.query('BEGIN');

  const endpointKey = `agent:${agentId}:${userEmail}`;
  const existingEndpoint = await client.query(
    `SELECT id FROM contact_endpoint
     WHERE endpoint_type = 'agent_chat' AND endpoint_value = $1`,
    [endpointKey],
  );

  let endpointId: string;
  if ((existingEndpoint.rows as Array<{ id: string }>).length > 0) {
    endpointId = (existingEndpoint.rows as Array<{ id: string }>)[0].id;
  } else {
    const contactResult = await client.query(
      `INSERT INTO contact (display_name, namespace)
       VALUES ($1, $2)
       RETURNING id`,
      [`Agent: ${agentId}`, namespace],
    );
    const contactId = (contactResult.rows as Array<{ id: string }>)[0].id;

    const endpointResult = await client.query(
      `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value)
       VALUES ($1, 'agent_chat', $2)
       RETURNING id`,
      [contactId, endpointKey],
    );
    endpointId = (endpointResult.rows as Array<{ id: string }>)[0].id;
  }

  await client.query('COMMIT');
  return endpointId;
}

describe('Chat session creation — endpoint reuse (Issue #2386)', () => {
  it('creates a new contact + endpoint on first session', async () => {
    const { client, setEndpointExists } = createMockClient();
    setEndpointExists(false);

    const endpointId = await createSessionEndpoint(client, 'agent-1', 'user@test.com', 'ns');

    expect(endpointId).toBe('new-ep-id');

    // Should have called: BEGIN, SELECT endpoint, INSERT contact, INSERT endpoint, COMMIT
    const queryTexts = client.query.mock.calls.map((c) => (c[0] as string).trim());
    expect(queryTexts).toContain('BEGIN');
    expect(queryTexts.some((q) => q.includes('SELECT id FROM contact_endpoint'))).toBe(true);
    expect(queryTexts.some((q) => q.includes('INSERT INTO contact'))).toBe(true);
    expect(queryTexts.some((q) => q.includes('INSERT INTO contact_endpoint'))).toBe(true);
    expect(queryTexts).toContain('COMMIT');
  });

  it('reuses existing endpoint on second session (no duplicate key error)', async () => {
    const { client, setEndpointExists } = createMockClient();
    setEndpointExists(true);

    const endpointId = await createSessionEndpoint(client, 'agent-1', 'user@test.com', 'ns');

    expect(endpointId).toBe('existing-ep-id');

    // Should have called: BEGIN, SELECT endpoint, COMMIT (no INSERT calls)
    const queryTexts = client.query.mock.calls.map((c) => (c[0] as string).trim());
    expect(queryTexts.some((q) => q.includes('SELECT id FROM contact_endpoint'))).toBe(true);
    expect(queryTexts.some((q) => q.includes('INSERT INTO contact'))).toBe(false);
    expect(queryTexts.some((q) => q.includes('INSERT INTO contact_endpoint'))).toBe(false);
  });

  it('uses correct endpoint_value format', async () => {
    const { client, setEndpointExists } = createMockClient();
    setEndpointExists(false);

    await createSessionEndpoint(client, 'my-agent', 'alice@example.com', 'default');

    // Find the SELECT query to verify the endpoint_value format
    const selectCall = client.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('SELECT id FROM contact_endpoint'),
    );
    expect(selectCall).toBeDefined();
    expect(selectCall![1]).toEqual(['agent:my-agent:alice@example.com']);
  });
});
