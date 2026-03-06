/**
 * Symphony Agent Runner — Unit Tests
 *
 * Tests:
 * - Prompt rendering with all Symphony variables
 * - Stdin delivery prevents injection (execFile, not shell)
 * - Redaction filters known secret patterns
 * - Stall detection triggers at threshold
 * - Loop detection from activity patterns
 * - Token exhaustion detection from output patterns
 * - Approval request detection
 * - Content sanitization
 * - Agent command building
 *
 * Issue #2199
 */

import { describe, it, expect } from 'vitest';
import {
  renderPrompt,
  sanitizeContent,
  slugify,
  redactOutput,
  isStalled,
  updateHeartbeat,
  containsProgressMarker,
  detectLoop,
  analyzeExit,
  buildAgentCommand,
} from '../../src/symphony/agent-runner.js';
import type {
  SymphonyVariables,
  HeartbeatState,
  ActivityWindow,
  RedactionConfig,
  AgentLaunchConfig,
} from '../../src/symphony/agent-runner.js';

// ─── Test Helpers ────────────────────────────────────────────

function createDefaultVariables(): SymphonyVariables {
  return {
    issueNumber: 42,
    issueTitle: 'Fix the login bug',
    issueBody: 'Users cannot log in when...',
    issueSlug: 'fix-login-bug',
    org: 'testorg',
    repo: 'testrepo',
    branch: 'issue/42-fix-login-bug',
    worktreePath: '/tmp/worktree-issue-42-fix-login-bug',
    runId: 'run-123',
    attempt: 1,
    agentType: 'claude-code',
  };
}

// ─── Prompt Rendering Tests ──────────────────────────────────

describe('renderPrompt', () => {
  it('renders all known variables', () => {
    const template = 'Issue #{{issueNumber}}: {{issueTitle}} in {{org}}/{{repo}}';
    const vars = createDefaultVariables();
    const result = renderPrompt(template, vars);
    expect(result).toBe('Issue #42: Fix the login bug in testorg/testrepo');
  });

  it('renders multi-line templates', () => {
    const template = [
      '## Issue #{{issueNumber}}: {{issueTitle}}',
      '',
      '{{issueBody}}',
      '',
      'Working in {{worktreePath}} on branch {{branch}}',
      'Run: {{runId}}, Attempt: {{attempt}}',
    ].join('\n');

    const vars = createDefaultVariables();
    const result = renderPrompt(template, vars);
    expect(result).toContain('Issue #42: Fix the login bug');
    expect(result).toContain('Users cannot log in when');
    expect(result).toContain('/tmp/worktree-issue-42-fix-login-bug');
    expect(result).toContain('run-123');
  });

  it('handles optional variables (previousError, previousFeedback)', () => {
    const template = 'Error: {{previousError}}, Feedback: {{previousFeedback}}';
    const vars = createDefaultVariables();
    // These are undefined, should render as empty string
    const result = renderPrompt(template, vars);
    expect(result).toBe('Error: , Feedback: ');
  });

  it('renders previousError when present', () => {
    const template = 'Previous error: {{previousError}}';
    const vars: SymphonyVariables = {
      ...createDefaultVariables(),
      previousError: 'Tests failed in auth module',
    };
    const result = renderPrompt(template, vars);
    expect(result).toBe('Previous error: Tests failed in auth module');
  });

  it('throws on unknown variables', () => {
    const template = 'Hello {{unknownVar}} and {{anotherUnknown}}';
    const vars = createDefaultVariables();
    expect(() => renderPrompt(template, vars)).toThrow(/Unknown template variables/);
    expect(() => renderPrompt(template, vars)).toThrow(/unknownVar/);
  });

  it('sanitizes ANSI escapes from issue content', () => {
    const vars: SymphonyVariables = {
      ...createDefaultVariables(),
      issueTitle: '\x1b[31mRed Title\x1b[0m',
      issueBody: 'Body with \x1b[1mbold\x1b[0m text',
    };
    const template = '{{issueTitle}} - {{issueBody}}';
    const result = renderPrompt(template, vars);
    expect(result).not.toContain('\x1b');
    expect(result).toContain('Red Title');
    expect(result).toContain('bold');
  });

  it('sanitizes null bytes from issue content', () => {
    const vars: SymphonyVariables = {
      ...createDefaultVariables(),
      issueBody: 'Body with \x00null bytes',
    };
    const template = '{{issueBody}}';
    const result = renderPrompt(template, vars);
    expect(result).not.toContain('\x00');
    expect(result).toContain('null bytes');
  });

  it('slugifies issue slug for safe worktree paths', () => {
    const vars: SymphonyVariables = {
      ...createDefaultVariables(),
      issueSlug: 'Fix The Bug!!! (urgent)',
    };
    const template = '{{issueSlug}}';
    const result = renderPrompt(template, vars);
    expect(result).toMatch(/^[a-z0-9._-]+$/);
  });
});

// ─── Content Sanitization Tests ──────────────────────────────

describe('sanitizeContent', () => {
  it('strips ANSI escape sequences', () => {
    expect(sanitizeContent('\x1b[31mred\x1b[0m')).toBe('red');
  });

  it('strips null bytes', () => {
    expect(sanitizeContent('hello\x00world')).toBe('helloworld');
  });

  it('strips control characters except \\n, \\r, \\t', () => {
    expect(sanitizeContent('hello\x01\x02world')).toBe('helloworld');
    expect(sanitizeContent('hello\nworld')).toBe('hello\nworld');
    expect(sanitizeContent('hello\tworld')).toBe('hello\tworld');
  });

  it('preserves normal text', () => {
    expect(sanitizeContent('Hello, World!')).toBe('Hello, World!');
  });
});

describe('slugify', () => {
  it('converts to lowercase', () => {
    expect(slugify('FIX-BUG')).toBe('fix-bug');
  });

  it('replaces special characters with dashes', () => {
    // Trailing dashes are stripped by the function
    expect(slugify('Fix The Bug!!!')).toBe('fix-the-bug');
    expect(slugify('Fix The Bug')).toBe('fix-the-bug');
  });

  it('collapses multiple dashes', () => {
    expect(slugify('fix---bug')).toBe('fix-bug');
  });

  it('strips leading and trailing dashes', () => {
    expect(slugify('-fix-bug-')).toBe('fix-bug');
  });

  it('allows dots and underscores', () => {
    expect(slugify('file.name_v2')).toBe('file.name_v2');
  });

  it('handles only [A-Za-z0-9._-] characters', () => {
    const result = slugify('hello@world#test');
    expect(result).toMatch(/^[a-z0-9._-]+$/);
  });
});

// ─── Redaction Tests ─────────────────────────────────────────

describe('redactOutput', () => {
  it('redacts 1Password references', () => {
    const input = 'Using op://Development/item/field for config';
    const result = redactOutput(input);
    expect(result).toContain('[REDACTED:1Password reference]');
    expect(result).not.toContain('op://Development');
  });

  it('redacts GitHub PATs (ghp_)', () => {
    const input = 'Token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij';
    const result = redactOutput(input);
    expect(result).toContain('[REDACTED:GitHub PAT (ghp_)]');
    expect(result).not.toContain('ghp_ABCDEF');
  });

  it('redacts GitHub PATs (github_pat_)', () => {
    const input = 'Token: github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZab';
    const result = redactOutput(input);
    expect(result).toContain('[REDACTED:');
    // The actual token value (after the prefix) should be gone
    expect(result).not.toContain('ABCDEFGHIJKLMNOPQRSTUVWXYZab');
  });

  it('redacts Anthropic API keys (sk-ant-)', () => {
    const input = 'Key: sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop';
    const result = redactOutput(input);
    expect(result).toContain('[REDACTED:Anthropic API key (sk-ant-)]');
    expect(result).not.toContain('sk-ant-api03');
  });

  it('redacts OpenAI API keys (sk-)', () => {
    const input = 'Key: sk-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrs';
    const result = redactOutput(input);
    expect(result).toContain('[REDACTED:');
    expect(result).not.toContain('sk-ABCDEF');
  });

  it('redacts Bearer tokens', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test.signature';
    const result = redactOutput(input);
    expect(result).toContain('[REDACTED:Bearer token]');
    expect(result).not.toContain('eyJhbGci');
  });

  it('redacts credential assignments', () => {
    const input = 'ANTHROPIC_API_KEY=sk-ant-secret123 and DB_PASSWORD=s3cret';
    const result = redactOutput(input);
    expect(result).toContain('[REDACTED:credential assignment]');
    expect(result).not.toContain('sk-ant-secret123');
  });

  it('redacts .env values', () => {
    const envValues = new Map([
      ['DB_PASSWORD', 'supersecretpassword'],
      ['SHORT', 'hi'],  // Too short, should NOT be redacted
    ]);

    const input = 'Connected with supersecretpassword to DB. Also hi there.';
    const result = redactOutput(input, { envValues });
    expect(result).toContain('[REDACTED:env:DB_PASSWORD]');
    expect(result).not.toContain('supersecretpassword');
    // Short values should NOT be redacted (avoid false positives)
    expect(result).toContain('hi');
  });

  it('applies custom additional patterns', () => {
    const config: RedactionConfig = {
      additionalPatterns: [
        { pattern: /CUSTOM-[A-Z0-9]+/g, label: 'custom-token' },
      ],
    };
    const input = 'Token: CUSTOM-ABC123 is used';
    const result = redactOutput(input, config);
    expect(result).toContain('[REDACTED:custom-token]');
    expect(result).not.toContain('CUSTOM-ABC123');
  });

  it('preserves non-sensitive text', () => {
    const input = 'Normal log message: connected to database on port 5432';
    const result = redactOutput(input);
    expect(result).toBe(input);
  });
});

// ─── Stall Detection Tests ───────────────────────────────────

describe('isStalled', () => {
  it('returns false when activity is recent', () => {
    const state: HeartbeatState = {
      lastActivityAt: new Date(),
      totalIdleSeconds: 0,
    };
    expect(isStalled(state, 600)).toBe(false);
  });

  it('returns true when idle exceeds threshold', () => {
    const state: HeartbeatState = {
      lastActivityAt: new Date(Date.now() - 700 * 1000),  // 700 seconds ago
      totalIdleSeconds: 0,
    };
    expect(isStalled(state, 600)).toBe(true);
  });

  it('suppresses stall when progress marker is recent', () => {
    const state: HeartbeatState = {
      lastActivityAt: new Date(Date.now() - 700 * 1000),  // 700 seconds ago
      lastProgressMarkerAt: new Date(Date.now() - 100 * 1000),  // 100 seconds ago
      totalIdleSeconds: 0,
    };
    // With recent progress marker, only max threshold applies (1800s)
    expect(isStalled(state, 600, 1800)).toBe(false);
  });

  it('still triggers stall when progress marker is old and exceeds max', () => {
    const state: HeartbeatState = {
      lastActivityAt: new Date(Date.now() - 2000 * 1000),  // 2000 seconds ago
      lastProgressMarkerAt: new Date(Date.now() - 700 * 1000),  // 700 seconds ago (past threshold)
      totalIdleSeconds: 0,
    };
    expect(isStalled(state, 600, 1800)).toBe(true);
  });

  it('uses default thresholds (600s, 1800s)', () => {
    const recentState: HeartbeatState = {
      lastActivityAt: new Date(Date.now() - 500 * 1000),
      totalIdleSeconds: 0,
    };
    expect(isStalled(recentState)).toBe(false);

    const staleState: HeartbeatState = {
      lastActivityAt: new Date(Date.now() - 700 * 1000),
      totalIdleSeconds: 0,
    };
    expect(isStalled(staleState)).toBe(true);
  });
});

describe('updateHeartbeat', () => {
  it('updates lastActivityAt', () => {
    const before = new Date(Date.now() - 10000);
    const state: HeartbeatState = {
      lastActivityAt: before,
      totalIdleSeconds: 0,
    };
    const updated = updateHeartbeat(state);
    expect(updated.lastActivityAt.getTime()).toBeGreaterThan(before.getTime());
  });

  it('updates lastProgressMarkerAt when isProgressMarker is true', () => {
    const state: HeartbeatState = {
      lastActivityAt: new Date(Date.now() - 10000),
      totalIdleSeconds: 0,
    };
    const updated = updateHeartbeat(state, true);
    expect(updated.lastProgressMarkerAt).toBeDefined();
  });

  it('does not update lastProgressMarkerAt when isProgressMarker is false', () => {
    const state: HeartbeatState = {
      lastActivityAt: new Date(Date.now() - 10000),
      totalIdleSeconds: 0,
    };
    const updated = updateHeartbeat(state, false);
    expect(updated.lastProgressMarkerAt).toBeUndefined();
  });
});

describe('containsProgressMarker', () => {
  it('detects SYMPHONY_HEARTBEAT', () => {
    expect(containsProgressMarker('some output SYMPHONY_HEARTBEAT here')).toBe(true);
  });

  it('detects .symphony-heartbeat file', () => {
    expect(containsProgressMarker('wrote to .symphony-heartbeat')).toBe(true);
  });

  it('returns false for normal output', () => {
    expect(containsProgressMarker('normal log output')).toBe(false);
  });
});

// ─── Loop Detection Tests ────────────────────────────────────

describe('detectLoop', () => {
  it('returns false when not enough data points', () => {
    const window: ActivityWindow = {
      filesChanged: new Set(['a.ts']),
      commands: ['cmd1', 'cmd2'],
      testResults: [],
      startedAt: new Date(),
      hasProgressMarkers: false,
    };
    expect(detectLoop(window).isLoop).toBe(false);
  });

  it('returns false when progress markers are present', () => {
    const window: ActivityWindow = {
      filesChanged: new Set(['a.ts']),
      commands: Array(10).fill('same-command'),
      testResults: [],
      startedAt: new Date(),
      hasProgressMarkers: true,
    };
    expect(detectLoop(window).isLoop).toBe(false);
  });

  it('detects low command diversity (same command repeated)', () => {
    const window: ActivityWindow = {
      filesChanged: new Set(['a.ts', 'b.ts']),
      commands: Array(10).fill('pnpm test'),
      testResults: [],
      startedAt: new Date(),
      hasProgressMarkers: false,
    };
    const result = detectLoop(window);
    expect(result.isLoop).toBe(true);
    expect(result.reason).toContain('command diversity');
  });

  it('accepts sufficient command diversity', () => {
    const window: ActivityWindow = {
      filesChanged: new Set(['a.ts', 'b.ts', 'c.ts']),
      commands: ['cmd1', 'cmd2', 'cmd3', 'cmd4', 'cmd5'],
      testResults: [],
      startedAt: new Date(),
      hasProgressMarkers: false,
    };
    expect(detectLoop(window).isLoop).toBe(false);
  });

  it('detects low test result diversity', () => {
    const window: ActivityWindow = {
      filesChanged: new Set(['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts']),
      commands: ['cmd1', 'cmd2', 'cmd3', 'cmd4', 'cmd5', 'cmd6'],
      testResults: [
        { passed: 5, failed: 3 },
        { passed: 5, failed: 3 },
        { passed: 5, failed: 3 },
      ],
      startedAt: new Date(),
      hasProgressMarkers: false,
    };
    const result = detectLoop(window);
    expect(result.isLoop).toBe(true);
    expect(result.reason).toContain('test result diversity');
  });

  it('accepts diverse test results', () => {
    const window: ActivityWindow = {
      filesChanged: new Set(['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts']),
      commands: ['cmd1', 'cmd2', 'cmd3', 'cmd4', 'cmd5', 'cmd6'],
      testResults: [
        { passed: 5, failed: 3 },
        { passed: 6, failed: 2 },
        { passed: 8, failed: 0 },
      ],
      startedAt: new Date(),
      hasProgressMarkers: false,
    };
    expect(detectLoop(window).isLoop).toBe(false);
  });

  it('respects custom thresholds', () => {
    const window: ActivityWindow = {
      filesChanged: new Set(['a.ts']),
      commands: ['cmd1', 'cmd2', 'cmd1', 'cmd2', 'cmd1'],
      testResults: [],
      startedAt: new Date(),
      hasProgressMarkers: false,
    };
    // With very low diversity threshold, this should pass
    const result = detectLoop(window, { minCommandDiversity: 0.1 });
    expect(result.isLoop).toBe(false);
  });
});

// ─── Exit Analysis Tests ─────────────────────────────────────

describe('analyzeExit', () => {
  it('returns success for exit code 0', () => {
    const result = analyzeExit('All done!', 0, 'claude-code');
    expect(result.success).toBe(true);
  });

  it('detects token exhaustion', () => {
    const output = 'Error: max tokens reached, cannot continue';
    const result = analyzeExit(output, 1, 'claude-code');
    expect(result.success).toBe(false);
    expect(result.failureType).toBe('token_exhaustion');
    expect(result.recommendation).toBe('fail');
  });

  it('detects context overflow', () => {
    const output = 'Error: context window exceeded, conversation too large';
    const result = analyzeExit(output, 1, 'claude-code');
    expect(result.success).toBe(false);
    expect(result.failureType).toBe('context_overflow');
    expect(result.recommendation).toBe('retry_with_reduced_context');
  });

  it('detects approval requests (Codex)', () => {
    const output = 'Action requires approval. Waiting for user approval...';
    const result = analyzeExit(output, 1, 'codex');
    expect(result.success).toBe(false);
    expect(result.failureType).toBe('approval_required');
    expect(result.recommendation).toBe('pause');
  });

  it('does not detect approval requests for claude-code', () => {
    const output = 'Waiting for user approval...';
    const result = analyzeExit(output, 1, 'claude-code');
    // claude-code doesn't have approval concept, should be generic error
    expect(result.failureType).not.toBe('approval_required');
  });

  it('classifies exit code 1 as agent_error', () => {
    const result = analyzeExit('Something went wrong', 1, 'claude-code');
    expect(result.failureType).toBe('agent_error');
    expect(result.recommendation).toBe('retry');
  });

  it('classifies unknown exit codes as unknown', () => {
    const result = analyzeExit('Segfault', 139, 'claude-code');
    expect(result.failureType).toBe('unknown');
    expect(result.recommendation).toBe('fail');
  });

  it('prioritizes context_overflow over token_exhaustion', () => {
    // Context overflow is checked first and is recoverable
    const output = 'context window exceeded and max tokens reached';
    const result = analyzeExit(output, 1, 'claude-code');
    expect(result.failureType).toBe('context_overflow');
    expect(result.recommendation).toBe('retry_with_reduced_context');
  });

  it('detects various token exhaustion patterns', () => {
    const patterns = [
      'token limit exceeded',
      'ran out of tokens',
      'maximum context length exceeded',
      'conversation too long',
    ];

    for (const pattern of patterns) {
      const result = analyzeExit(pattern, 1, 'claude-code');
      expect(result.success).toBe(false);
      // Some match context_overflow, some match token_exhaustion
      expect(['token_exhaustion', 'context_overflow']).toContain(result.failureType);
    }
  });

  it('detects various approval patterns', () => {
    const patterns = [
      'waiting for approval',
      'requires manual approval',
      'awaiting human review',
      'please approve',
      'approval required',
      'user action needed',
    ];

    for (const pattern of patterns) {
      const result = analyzeExit(pattern, 1, 'codex');
      expect(result.failureType).toBe('approval_required');
    }
  });
});

// ─── Agent Command Building Tests ────────────────────────────

describe('buildAgentCommand', () => {
  it('builds docker exec command for claude-code', () => {
    const config: AgentLaunchConfig = {
      agentType: 'claude-code',
      prompt: 'Fix the bug',
      workingDirectory: '/workspaces/repo',
      containerId: 'abc123',
      containerUser: 'vscode',
    };

    const { command, args } = buildAgentCommand(config);
    expect(command).toBe('docker');
    expect(args).toContain('exec');
    expect(args).toContain('-i');
    expect(args).toContain('-u');
    expect(args).toContain('vscode');
    expect(args).toContain('-w');
    expect(args).toContain('/workspaces/repo');
    expect(args).toContain('abc123');
    expect(args).toContain('claude');
    expect(args).toContain('--print');
  });

  it('adds auto-approve flag for claude-code', () => {
    const config: AgentLaunchConfig = {
      agentType: 'claude-code',
      prompt: 'Fix the bug',
      workingDirectory: '/workspaces/repo',
      containerId: 'abc123',
      containerUser: 'vscode',
      autoApprove: true,
    };

    const { args } = buildAgentCommand(config);
    expect(args).toContain('--dangerously-skip-permissions');
  });

  it('adds max-turns flag for claude-code', () => {
    const config: AgentLaunchConfig = {
      agentType: 'claude-code',
      prompt: 'Fix the bug',
      workingDirectory: '/workspaces/repo',
      containerId: 'abc123',
      containerUser: 'vscode',
      maxTokens: 100,
    };

    const { args } = buildAgentCommand(config);
    expect(args).toContain('--max-turns');
    expect(args).toContain('100');
  });

  it('builds docker exec command for codex', () => {
    const config: AgentLaunchConfig = {
      agentType: 'codex',
      prompt: 'Review the code',
      workingDirectory: '/workspaces/repo',
      containerId: 'def456',
      containerUser: 'root',
    };

    const { command, args } = buildAgentCommand(config);
    expect(command).toBe('docker');
    expect(args).toContain('codex');
    expect(args).not.toContain('claude');
  });

  it('adds approval-policy for codex with autoApprove', () => {
    const config: AgentLaunchConfig = {
      agentType: 'codex',
      prompt: 'Review the code',
      workingDirectory: '/workspaces/repo',
      containerId: 'def456',
      containerUser: 'root',
      autoApprove: true,
    };

    const { args } = buildAgentCommand(config);
    expect(args).toContain('--approval-policy');
    expect(args).toContain('on-failure');
  });

  it('uses execFile pattern: command and args are separate', () => {
    const config: AgentLaunchConfig = {
      agentType: 'claude-code',
      prompt: 'prompt with "quotes" and $variables',
      workingDirectory: '/workspaces/repo',
      containerId: 'abc123',
      containerUser: 'vscode',
    };

    const { command, args } = buildAgentCommand(config);
    // The prompt is NOT in the args — it goes via stdin
    expect(command).toBe('docker');
    expect(args.join(' ')).not.toContain('prompt with');
    // All args are individual strings (execFile safe)
    for (const arg of args) {
      expect(typeof arg).toBe('string');
    }
  });
});
