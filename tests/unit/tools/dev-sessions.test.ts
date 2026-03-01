/**
 * Unit tests for dev session plugin tools (Issue #1896).
 * Tests all 5 tools with mocked ApiClient.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createDevSessionCreateTool,
  createDevSessionListTool,
  createDevSessionGetTool,
  createDevSessionUpdateTool,
  createDevSessionCompleteTool,
} from '../../../packages/openclaw-plugin/src/tools/dev-sessions.ts';
import type { DevSessionToolOptions, DevSession } from '../../../packages/openclaw-plugin/src/tools/dev-sessions.ts';

/** Create a mock ApiClient with get/post/patch/put/delete stubs */
function createMockClient() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  };
}

/** Create a mock logger */
function createMockLogger() {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

/** Create a minimal PluginConfig */
function createMockConfig() {
  return {
    apiUrl: 'https://api.example.com',
    apiKey: 'test-key',
    timeout: 5000,
    maxRetries: 0,
    autoRecall: false,
    autoCapture: false,
  };
}

const TEST_USER_ID = 'test-user@example.com';
const TEST_SESSION_ID = 'd290f1ee-6c54-4b01-90e6-d701748f0851';
const TEST_PROJECT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

function makeSession(overrides: Partial<DevSession> = {}): DevSession {
  return {
    id: TEST_SESSION_ID,
    user_email: TEST_USER_ID,
    session_name: 'fix-auth-bug',
    node: 'dev-workstation-01',
    status: 'active',
    created_at: '2026-02-21T14:00:00Z',
    updated_at: '2026-02-21T14:30:00Z',
    ...overrides,
  };
}

function makeOpts(client: ReturnType<typeof createMockClient>, logger: ReturnType<typeof createMockLogger>): DevSessionToolOptions {
  return {
    client: client as unknown as DevSessionToolOptions['client'],
    logger: logger as unknown as DevSessionToolOptions['logger'],
    config: createMockConfig() as unknown as DevSessionToolOptions['config'],
    user_id: TEST_USER_ID,
  };
}

// ==================== dev_session_create ====================

describe('dev_session_create', () => {
  let client: ReturnType<typeof createMockClient>;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    client = createMockClient();
    logger = createMockLogger();
  });

  it('has correct tool metadata', () => {
    const tool = createDevSessionCreateTool(makeOpts(client, logger));
    expect(tool.name).toBe('dev_session_create');
    expect(tool.description).toBeTruthy();
    expect(tool.parameters).toBeDefined();
  });

  it('creates a session successfully', async () => {
    const session = makeSession();
    client.post.mockResolvedValue({ success: true, data: session });

    const tool = createDevSessionCreateTool(makeOpts(client, logger));
    const result = await tool.execute({
      session_name: 'fix-auth-bug',
      node: 'dev-workstation-01',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.details.session_id).toBe(TEST_SESSION_ID);
      expect(result.data.details.session_name).toBe('fix-auth-bug');
      expect(result.data.details.status).toBe('active');
      expect(result.data.content).toContain('fix-auth-bug');
      expect(result.data.content).toContain(TEST_SESSION_ID);
    }

    expect(client.post).toHaveBeenCalledWith(
      '/api/dev-sessions',
      expect.objectContaining({
        user_email: TEST_USER_ID,
        session_name: 'fix-auth-bug',
        node: 'dev-workstation-01',
      }),
      { user_id: TEST_USER_ID },
    );
  });

  it('passes optional fields to API', async () => {
    const session = makeSession({ branch: 'issue/123-fix' });
    client.post.mockResolvedValue({ success: true, data: session });

    const tool = createDevSessionCreateTool(makeOpts(client, logger));
    await tool.execute({
      session_name: 'fix-auth-bug',
      node: 'dev-workstation-01',
      branch: 'issue/123-fix',
      repo_org: 'troykelly',
      repo_name: 'openclaw-projects',
      task_summary: 'Fix auth race condition',
      linked_issues: ['#123'],
    });

    expect(client.post).toHaveBeenCalledWith(
      '/api/dev-sessions',
      expect.objectContaining({
        branch: 'issue/123-fix',
        repo_org: 'troykelly',
        repo_name: 'openclaw-projects',
        task_summary: 'Fix auth race condition',
        linked_issues: ['#123'],
      }),
      { user_id: TEST_USER_ID },
    );
  });

  it('rejects invalid project_id', async () => {
    const tool = createDevSessionCreateTool(makeOpts(client, logger));
    const result = await tool.execute({
      session_name: 'fix-auth-bug',
      node: 'dev-workstation-01',
      project_id: 'not-a-uuid',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('UUID');
    }
    expect(client.post).not.toHaveBeenCalled();
  });

  it('returns validation errors', async () => {
    const tool = createDevSessionCreateTool(makeOpts(client, logger));
    // Missing required fields
    const result = await tool.execute({} as any);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeTruthy();
    }
  });

  it('handles API errors', async () => {
    client.post.mockResolvedValue({
      success: false,
      error: { status: 500, message: 'Internal server error', code: 'INTERNAL' },
    });

    const tool = createDevSessionCreateTool(makeOpts(client, logger));
    const result = await tool.execute({
      session_name: 'fix-auth-bug',
      node: 'dev-workstation-01',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Internal server error');
    }
  });

  it('handles thrown exceptions', async () => {
    client.post.mockRejectedValue(new Error('Network failure'));

    const tool = createDevSessionCreateTool(makeOpts(client, logger));
    const result = await tool.execute({
      session_name: 'fix-auth-bug',
      node: 'dev-workstation-01',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Network failure');
    }
  });

  it('strips HTML from task_summary', async () => {
    const session = makeSession();
    client.post.mockResolvedValue({ success: true, data: session });

    const tool = createDevSessionCreateTool(makeOpts(client, logger));
    await tool.execute({
      session_name: 'fix-auth-bug',
      node: 'dev-workstation-01',
      task_summary: '<b>Fix</b> <script>alert("xss")</script>auth bug',
    });

    expect(client.post).toHaveBeenCalledWith(
      '/api/dev-sessions',
      expect.objectContaining({
        task_summary: 'Fix auth bug',
      }),
      { user_id: TEST_USER_ID },
    );
  });
});

// ==================== dev_session_list ====================

describe('dev_session_list', () => {
  let client: ReturnType<typeof createMockClient>;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    client = createMockClient();
    logger = createMockLogger();
  });

  it('has correct tool metadata', () => {
    const tool = createDevSessionListTool(makeOpts(client, logger));
    expect(tool.name).toBe('dev_session_list');
    expect(tool.description).toBeTruthy();
  });

  it('lists sessions successfully', async () => {
    const sessions = [makeSession(), makeSession({ id: 'b290f1ee-6c54-4b01-90e6-d701748f0852', session_name: 'build-feature', node: 'laptop' })];
    client.get.mockResolvedValue({ success: true, data: { sessions, total: 2 } });

    const tool = createDevSessionListTool(makeOpts(client, logger));
    const result = await tool.execute({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.details.sessions).toHaveLength(2);
      expect(result.data.details.total).toBe(2);
      expect(result.data.content).toContain('fix-auth-bug');
      expect(result.data.content).toContain('build-feature');
    }
  });

  it('returns empty message when no sessions found', async () => {
    client.get.mockResolvedValue({ success: true, data: { sessions: [] } });

    const tool = createDevSessionListTool(makeOpts(client, logger));
    const result = await tool.execute({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.content).toBe('No dev sessions found.');
      expect(result.data.details.sessions).toHaveLength(0);
      expect(result.data.details.total).toBe(0);
    }
  });

  it('passes filter params', async () => {
    client.get.mockResolvedValue({ success: true, data: { sessions: [] } });

    const tool = createDevSessionListTool(makeOpts(client, logger));
    await tool.execute({ status: 'active', node: 'laptop', limit: 10 });

    const url = client.get.mock.calls[0][0] as string;
    expect(url).toContain('status=active');
    expect(url).toContain('node=laptop');
    expect(url).toContain('limit=10');
  });

  it('handles items response key', async () => {
    const sessions = [makeSession()];
    client.get.mockResolvedValue({ success: true, data: { items: sessions } });

    const tool = createDevSessionListTool(makeOpts(client, logger));
    const result = await tool.execute({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.details.sessions).toHaveLength(1);
    }
  });

  it('rejects invalid project_id', async () => {
    const tool = createDevSessionListTool(makeOpts(client, logger));
    const result = await tool.execute({ project_id: 'not-a-uuid' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('UUID');
    }
    expect(client.get).not.toHaveBeenCalled();
  });

  it('handles API errors', async () => {
    client.get.mockResolvedValue({
      success: false,
      error: { status: 401, message: 'Unauthorized', code: 'UNAUTHORIZED' },
    });

    const tool = createDevSessionListTool(makeOpts(client, logger));
    const result = await tool.execute({});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Unauthorized');
    }
  });

  it('includes branch in listing output', async () => {
    const sessions = [makeSession({ branch: 'issue/42-fix' })];
    client.get.mockResolvedValue({ success: true, data: { sessions } });

    const tool = createDevSessionListTool(makeOpts(client, logger));
    const result = await tool.execute({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.content).toContain('branch: issue/42-fix');
    }
  });
});

// ==================== dev_session_get ====================

describe('dev_session_get', () => {
  let client: ReturnType<typeof createMockClient>;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    client = createMockClient();
    logger = createMockLogger();
  });

  it('has correct tool metadata', () => {
    const tool = createDevSessionGetTool(makeOpts(client, logger));
    expect(tool.name).toBe('dev_session_get');
    expect(tool.description).toBeTruthy();
  });

  it('gets a session successfully', async () => {
    const session = makeSession({
      branch: 'issue/123-fix',
      repo_org: 'troykelly',
      repo_name: 'openclaw-projects',
      task_summary: 'Fix auth race condition',
      context_pct: 65.5,
      linked_issues: ['#123'],
    });
    client.get.mockResolvedValue({ success: true, data: session });

    const tool = createDevSessionGetTool(makeOpts(client, logger));
    const result = await tool.execute({ session_id: TEST_SESSION_ID });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.details.session.id).toBe(TEST_SESSION_ID);
      expect(result.data.content).toContain('fix-auth-bug');
      expect(result.data.content).toContain('[active]');
      expect(result.data.content).toContain('Branch: issue/123-fix');
      expect(result.data.content).toContain('troykelly/openclaw-projects');
      expect(result.data.content).toContain('Fix auth race condition');
      expect(result.data.content).toContain('65.5%');
      expect(result.data.content).toContain('#123');
    }

    expect(client.get).toHaveBeenCalledWith(
      `/api/dev-sessions/${TEST_SESSION_ID}`,
      { user_id: TEST_USER_ID, user_email: TEST_USER_ID },
    );
  });

  it('rejects invalid session ID', async () => {
    const tool = createDevSessionGetTool(makeOpts(client, logger));
    const result = await tool.execute({ session_id: 'not-a-uuid' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('UUID');
    }
    expect(client.get).not.toHaveBeenCalled();
  });

  it('handles not found', async () => {
    client.get.mockResolvedValue({
      success: false,
      error: { status: 404, message: 'Not found', code: 'NOT_FOUND' },
    });

    const tool = createDevSessionGetTool(makeOpts(client, logger));
    const result = await tool.execute({ session_id: TEST_SESSION_ID });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Dev session not found.');
    }
  });

  it('handles missing required fields', async () => {
    const tool = createDevSessionGetTool(makeOpts(client, logger));
    const result = await tool.execute({} as any);

    expect(result.success).toBe(false);
  });
});

// ==================== dev_session_update ====================

describe('dev_session_update', () => {
  let client: ReturnType<typeof createMockClient>;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    client = createMockClient();
    logger = createMockLogger();
  });

  it('has correct tool metadata', () => {
    const tool = createDevSessionUpdateTool(makeOpts(client, logger));
    expect(tool.name).toBe('dev_session_update');
    expect(tool.description).toBeTruthy();
  });

  it('updates a session successfully', async () => {
    const session = makeSession({ task_summary: 'Updated summary', context_pct: 72.3 });
    client.patch.mockResolvedValue({ success: true, data: session });

    const tool = createDevSessionUpdateTool(makeOpts(client, logger));
    const result = await tool.execute({
      session_id: TEST_SESSION_ID,
      task_summary: 'Updated summary',
      context_pct: 72.3,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.details.session.id).toBe(TEST_SESSION_ID);
      expect(result.data.content).toContain('Updated');
      expect(result.data.content).toContain(TEST_SESSION_ID);
    }

    expect(client.patch).toHaveBeenCalledWith(
      `/api/dev-sessions/${TEST_SESSION_ID}`,
      expect.objectContaining({
        user_email: TEST_USER_ID,
        task_summary: 'Updated summary',
        context_pct: 72.3,
      }),
      { user_id: TEST_USER_ID },
    );
  });

  it('rejects invalid session ID', async () => {
    const tool = createDevSessionUpdateTool(makeOpts(client, logger));
    const result = await tool.execute({ session_id: 'bad-id', status: 'active' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('UUID');
    }
    expect(client.patch).not.toHaveBeenCalled();
  });

  it('handles not found', async () => {
    client.patch.mockResolvedValue({
      success: false,
      error: { status: 404, message: 'Not found', code: 'NOT_FOUND' },
    });

    const tool = createDevSessionUpdateTool(makeOpts(client, logger));
    const result = await tool.execute({ session_id: TEST_SESSION_ID, status: 'active' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Dev session not found.');
    }
  });

  it('strips HTML from completion_summary', async () => {
    const session = makeSession();
    client.patch.mockResolvedValue({ success: true, data: session });

    const tool = createDevSessionUpdateTool(makeOpts(client, logger));
    await tool.execute({
      session_id: TEST_SESSION_ID,
      completion_summary: '<em>Done</em> with <script>alert(1)</script>work',
    });

    expect(client.patch).toHaveBeenCalledWith(
      `/api/dev-sessions/${TEST_SESSION_ID}`,
      expect.objectContaining({
        completion_summary: 'Done with work',
      }),
      { user_id: TEST_USER_ID },
    );
  });

  it('sends linked_issues and linked_prs', async () => {
    const session = makeSession();
    client.patch.mockResolvedValue({ success: true, data: session });

    const tool = createDevSessionUpdateTool(makeOpts(client, logger));
    await tool.execute({
      session_id: TEST_SESSION_ID,
      linked_issues: ['#100', '#101'],
      linked_prs: ['#200'],
    });

    expect(client.patch).toHaveBeenCalledWith(
      `/api/dev-sessions/${TEST_SESSION_ID}`,
      expect.objectContaining({
        linked_issues: ['#100', '#101'],
        linked_prs: ['#200'],
      }),
      { user_id: TEST_USER_ID },
    );
  });

  it('handles thrown exceptions', async () => {
    client.patch.mockRejectedValue(new Error('Connection lost'));

    const tool = createDevSessionUpdateTool(makeOpts(client, logger));
    const result = await tool.execute({ session_id: TEST_SESSION_ID, status: 'active' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Connection lost');
    }
  });
});

// ==================== dev_session_complete ====================

describe('dev_session_complete', () => {
  let client: ReturnType<typeof createMockClient>;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    client = createMockClient();
    logger = createMockLogger();
  });

  it('has correct tool metadata', () => {
    const tool = createDevSessionCompleteTool(makeOpts(client, logger));
    expect(tool.name).toBe('dev_session_complete');
    expect(tool.description).toBeTruthy();
  });

  it('completes a session successfully', async () => {
    const session = makeSession({ status: 'completed', completed_at: '2026-02-21T18:00:00Z' });
    client.post.mockResolvedValue({ success: true, data: session });

    const tool = createDevSessionCompleteTool(makeOpts(client, logger));
    const result = await tool.execute({
      session_id: TEST_SESSION_ID,
      completion_summary: 'Fixed auth race condition. All tests passing.',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.details.session.status).toBe('completed');
      expect(result.data.content).toContain('completed');
      expect(result.data.content).toContain(TEST_SESSION_ID);
    }

    expect(client.post).toHaveBeenCalledWith(
      `/api/dev-sessions/${TEST_SESSION_ID}/complete`,
      expect.objectContaining({
        user_email: TEST_USER_ID,
        completion_summary: 'Fixed auth race condition. All tests passing.',
      }),
      { user_id: TEST_USER_ID },
    );
  });

  it('completes without summary', async () => {
    const session = makeSession({ status: 'completed' });
    client.post.mockResolvedValue({ success: true, data: session });

    const tool = createDevSessionCompleteTool(makeOpts(client, logger));
    const result = await tool.execute({ session_id: TEST_SESSION_ID });

    expect(result.success).toBe(true);
    expect(client.post).toHaveBeenCalledWith(
      `/api/dev-sessions/${TEST_SESSION_ID}/complete`,
      { user_email: TEST_USER_ID },
      { user_id: TEST_USER_ID },
    );
  });

  it('rejects invalid session ID', async () => {
    const tool = createDevSessionCompleteTool(makeOpts(client, logger));
    const result = await tool.execute({ session_id: 'nope' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('UUID');
    }
    expect(client.post).not.toHaveBeenCalled();
  });

  it('handles not found', async () => {
    client.post.mockResolvedValue({
      success: false,
      error: { status: 404, message: 'Not found', code: 'NOT_FOUND' },
    });

    const tool = createDevSessionCompleteTool(makeOpts(client, logger));
    const result = await tool.execute({ session_id: TEST_SESSION_ID });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Dev session not found.');
    }
  });

  it('handles API errors', async () => {
    client.post.mockResolvedValue({
      success: false,
      error: { status: 409, message: 'Session already completed', code: 'CONFLICT' },
    });

    const tool = createDevSessionCompleteTool(makeOpts(client, logger));
    const result = await tool.execute({ session_id: TEST_SESSION_ID });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Session already completed');
    }
  });

  it('strips HTML from completion_summary', async () => {
    const session = makeSession({ status: 'completed' });
    client.post.mockResolvedValue({ success: true, data: session });

    const tool = createDevSessionCompleteTool(makeOpts(client, logger));
    await tool.execute({
      session_id: TEST_SESSION_ID,
      completion_summary: '<b>All done</b>',
    });

    expect(client.post).toHaveBeenCalledWith(
      `/api/dev-sessions/${TEST_SESSION_ID}/complete`,
      expect.objectContaining({
        completion_summary: 'All done',
      }),
      { user_id: TEST_USER_ID },
    );
  });

  it('handles thrown exceptions', async () => {
    client.post.mockRejectedValue(new Error('Timeout'));

    const tool = createDevSessionCompleteTool(makeOpts(client, logger));
    const result = await tool.execute({ session_id: TEST_SESSION_ID });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Timeout');
    }
  });
});
