/**
 * Symphony Agent Runner
 *
 * Launches coding agents (Claude Code, Codex) inside provisioned devcontainers,
 * delivers prompts safely, monitors execution, and handles agent-specific failures.
 *
 * Key design decisions:
 * - Prompts delivered via stdin pipe (never shell args) — prevents injection
 * - Agents launched via execFile (no shell) — prevents shell injection
 * - Terminal I/O redacted before storage/embedding
 * - Stall detection via heartbeat tracking
 * - Loop detection from activity patterns
 * - Agent-specific failure patterns (token exhaustion, approval requests)
 *
 * Issue #2199
 */

// ─────────────────────────────────────────────────────────────
// Prompt Construction
// ─────────────────────────────────────────────────────────────

/** Symphony variables available for template rendering. */
export interface SymphonyVariables {
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  issueSlug: string;
  org: string;
  repo: string;
  branch: string;
  worktreePath: string;
  runId: string;
  attempt: number;
  previousError?: string;
  previousFeedback?: string;
  agentType: 'claude-code' | 'codex';
}

/** Known template variables. */
const KNOWN_VARIABLES = new Set([
  'issueNumber',
  'issueTitle',
  'issueBody',
  'issueSlug',
  'org',
  'repo',
  'branch',
  'worktreePath',
  'runId',
  'attempt',
  'previousError',
  'previousFeedback',
  'agentType',
]);

/**
 * Render a prompt template with Symphony variables.
 *
 * Template format: {{variableName}}
 *
 * Rules:
 * - Unknown variables cause an error (strict checking)
 * - Issue content is sanitized (ANSI escapes, null bytes stripped)
 * - Worktree paths are validated as safe slugs
 *
 * @throws Error on unknown variables
 */
export function renderPrompt(
  template: string,
  variables: SymphonyVariables,
): string {
  // Sanitize issue content
  const sanitized: SymphonyVariables = {
    ...variables,
    issueTitle: sanitizeContent(variables.issueTitle),
    issueBody: sanitizeContent(variables.issueBody),
    issueSlug: slugify(variables.issueSlug),
  };

  // Find all template variables
  const variablePattern = /\{\{(\w+)\}\}/g;
  const unknownVars: string[] = [];

  const rendered = template.replace(variablePattern, (match, name: string) => {
    if (!KNOWN_VARIABLES.has(name)) {
      unknownVars.push(name);
      return match;
    }

    const value = sanitized[name as keyof SymphonyVariables];
    if (value === undefined) {
      return '';
    }
    return String(value);
  });

  if (unknownVars.length > 0) {
    throw new Error(
      `Unknown template variables: ${unknownVars.join(', ')}. ` +
      `Known variables: ${Array.from(KNOWN_VARIABLES).join(', ')}`,
    );
  }

  return rendered;
}

/**
 * Sanitize content for safe prompt inclusion.
 * Strips ANSI escape sequences and null bytes.
 */
export function sanitizeContent(input: string): string {
  // Strip ANSI escape sequences
  // eslint-disable-next-line no-control-regex
  let result = input.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  // Strip null bytes
  // eslint-disable-next-line no-control-regex
  result = result.replace(/\x00/g, '');
  // Strip other control characters except \n, \r, \t
  // eslint-disable-next-line no-control-regex
  result = result.replace(/[\x01-\x08\x0b\x0c\x0e-\x1f]/g, '');
  return result;
}

/**
 * Slugify a string for safe use in worktree paths.
 * Only allows [A-Za-z0-9._-].
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ─────────────────────────────────────────────────────────────
// I/O Redaction (P2-10 finding)
// ─────────────────────────────────────────────────────────────

/** Built-in redaction patterns. */
const BUILTIN_REDACTION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /op:\/\/[^\s'"]+/g, label: '1Password reference' },
  { pattern: /ghp_[A-Za-z0-9_]{36,}/g, label: 'GitHub PAT (ghp_)' },
  { pattern: /github_pat_[A-Za-z0-9_]{22,}/g, label: 'GitHub PAT (github_pat_)' },
  { pattern: /sk-ant-[A-Za-z0-9_-]{40,}/g, label: 'Anthropic API key (sk-ant-)' },
  { pattern: /sk-[A-Za-z0-9]{40,}/g, label: 'OpenAI API key (sk-)' },
  { pattern: /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/gi, label: 'Bearer token' },
  { pattern: /[A-Z_]*(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)=[^\s'"]+/g, label: 'credential assignment' },
];

/** Redaction configuration. */
export interface RedactionConfig {
  /** Additional regex patterns to redact. */
  additionalPatterns?: Array<{ pattern: RegExp; label: string }>;
  /** Keys from the deployed .env file — their values will be redacted. */
  envValues?: Map<string, string>;
}

/**
 * Redact sensitive content from terminal I/O.
 *
 * Covers (P2-10 acceptance criterion):
 * 1. op:// 1Password references
 * 2. ghp_ / github_pat_ GitHub tokens
 * 3. sk-ant- / sk- API keys
 * 4. Bearer <token> authorization headers
 * 5. *_KEY=, *_SECRET=, *_TOKEN= patterns
 * 6. All keys from the deployed .env file
 * 7. Configurable additional patterns
 */
export function redactOutput(
  input: string,
  config?: RedactionConfig,
): string {
  let result = input;

  // Apply built-in patterns
  for (const { pattern, label } of BUILTIN_REDACTION_PATTERNS) {
    // Reset regex state for global patterns
    pattern.lastIndex = 0;
    result = result.replace(pattern, `[REDACTED:${label}]`);
  }

  // Apply additional custom patterns
  if (config?.additionalPatterns) {
    for (const { pattern, label } of config.additionalPatterns) {
      pattern.lastIndex = 0;
      result = result.replace(pattern, `[REDACTED:${label}]`);
    }
  }

  // Redact .env values
  if (config?.envValues) {
    for (const [key, value] of config.envValues) {
      if (value.length >= 8) {
        // Only redact non-trivial values
        result = result.replaceAll(value, `[REDACTED:env:${key}]`);
      }
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────
// Stall Detection
// ─────────────────────────────────────────────────────────────

/** Heartbeat tracker state. */
export interface HeartbeatState {
  lastActivityAt: Date;
  lastProgressMarkerAt?: Date;
  totalIdleSeconds: number;
}

/**
 * Check if an agent run is stalled.
 *
 * @param state Current heartbeat state
 * @param noProgressThresholdSeconds Time without any output before considered stalled (default 600 = 10min)
 * @param maxThresholdSeconds Absolute maximum idle before stall (default 1800 = 30min)
 * @returns true if the agent is considered stalled
 */
export function isStalled(
  state: HeartbeatState,
  noProgressThresholdSeconds: number = 600,
  maxThresholdSeconds: number = 1800,
): boolean {
  const now = Date.now();
  const idleSeconds = (now - state.lastActivityAt.getTime()) / 1000;

  // If there's a recent progress marker, use the max threshold
  if (state.lastProgressMarkerAt) {
    const markerAge =
      (now - state.lastProgressMarkerAt.getTime()) / 1000;
    if (markerAge < noProgressThresholdSeconds) {
      // Progress markers suppress stall detection, but not past max
      return idleSeconds > maxThresholdSeconds;
    }
  }

  return idleSeconds > noProgressThresholdSeconds;
}

/**
 * Update heartbeat state with new activity.
 */
export function updateHeartbeat(
  state: HeartbeatState,
  isProgressMarker: boolean = false,
): HeartbeatState {
  const now = new Date();
  return {
    ...state,
    lastActivityAt: now,
    lastProgressMarkerAt: isProgressMarker ? now : state.lastProgressMarkerAt,
    totalIdleSeconds: state.totalIdleSeconds,
  };
}

/**
 * Check if output contains a progress marker (~/.symphony-heartbeat file content).
 */
export function containsProgressMarker(output: string): boolean {
  return output.includes('SYMPHONY_HEARTBEAT') || output.includes('.symphony-heartbeat');
}

// ─────────────────────────────────────────────────────────────
// Loop Detection
// ─────────────────────────────────────────────────────────────

/** Activity window for loop detection. */
export interface ActivityWindow {
  /** Files changed in this window. */
  filesChanged: Set<string>;
  /** Commands executed in this window. */
  commands: string[];
  /** Test results (pass/fail counts). */
  testResults: Array<{ passed: number; failed: number }>;
  /** Window start time. */
  startedAt: Date;
  /** Whether progress markers were seen. */
  hasProgressMarkers: boolean;
}

/** Loop detection configuration. */
export interface LoopDetectionConfig {
  /** Minimum file change diversity ratio (default 0.3). */
  minFileDiversity?: number;
  /** Minimum command diversity ratio (default 0.3). */
  minCommandDiversity?: number;
  /** Minimum test result diversity (default 2 distinct results). */
  minTestDiversity?: number;
}

/**
 * Detect if an agent is stuck in a loop.
 *
 * Checks:
 * 1. File change diversity per time window
 * 2. Command diversity (not repeating same commands)
 * 3. Test result diversity
 * 4. Progress markers suppress loop detection
 *
 * @returns Object with isLoop flag and reason
 */
export function detectLoop(
  window: ActivityWindow,
  config?: LoopDetectionConfig,
): { isLoop: boolean; reason?: string } {
  // Progress markers suppress loop detection
  if (window.hasProgressMarkers) {
    return { isLoop: false };
  }

  const minFileDiversity = config?.minFileDiversity ?? 0.3;
  const minCommandDiversity = config?.minCommandDiversity ?? 0.3;
  const minTestDiversity = config?.minTestDiversity ?? 2;

  // Need minimum data points for detection
  if (window.commands.length < 5) {
    return { isLoop: false };
  }

  // Check command diversity
  const uniqueCommands = new Set(window.commands);
  const commandDiversity = uniqueCommands.size / window.commands.length;
  if (commandDiversity < minCommandDiversity) {
    return {
      isLoop: true,
      reason: `Low command diversity: ${(commandDiversity * 100).toFixed(0)}% ` +
        `(${uniqueCommands.size} unique of ${window.commands.length} total)`,
    };
  }

  // Check file change diversity (if files were changed)
  if (window.filesChanged.size > 0 && window.commands.length > 10) {
    const fileDiversity = window.filesChanged.size / window.commands.length;
    if (fileDiversity < minFileDiversity) {
      return {
        isLoop: true,
        reason: `Low file diversity: ${(fileDiversity * 100).toFixed(0)}% ` +
          `(${window.filesChanged.size} files across ${window.commands.length} commands)`,
      };
    }
  }

  // Check test result diversity
  if (window.testResults.length >= 3) {
    const uniqueResults = new Set(
      window.testResults.map((r) => `${r.passed}:${r.failed}`),
    );
    if (uniqueResults.size < minTestDiversity) {
      return {
        isLoop: true,
        reason: `Low test result diversity: ${uniqueResults.size} distinct results ` +
          `across ${window.testResults.length} test runs`,
      };
    }
  }

  return { isLoop: false };
}

// ─────────────────────────────────────────────────────────────
// Agent-Specific Failure Detection
// ─────────────────────────────────────────────────────────────

/** Agent exit analysis result. */
export interface ExitAnalysis {
  /** Whether the agent exited successfully. */
  success: boolean;
  /** Failure type if not successful. */
  failureType?:
    | 'token_exhaustion'
    | 'context_overflow'
    | 'approval_required'
    | 'agent_error'
    | 'unknown';
  /** Detail message. */
  detail?: string;
  /** Recommended action. */
  recommendation?: 'retry' | 'retry_with_reduced_context' | 'pause' | 'fail';
}

/** Patterns indicating token/context exhaustion. */
const TOKEN_EXHAUSTION_PATTERNS = [
  /max.?tokens?\s+(?:reached|exceeded|limit)/i,
  /token\s+(?:limit|budget)\s+(?:reached|exceeded)/i,
  /ran\s+out\s+of\s+tokens/i,
  /context\s+(?:window|length)\s+exceeded/i,
  /maximum\s+context\s+length/i,
  /conversation\s+too\s+long/i,
  /rate_limit_error.*tokens/i,
];

/** Patterns indicating the agent is requesting approval (Codex). */
const APPROVAL_REQUEST_PATTERNS = [
  /waiting\s+for\s+(?:user\s+)?approval/i,
  /requires?\s+(?:manual\s+)?approval/i,
  /awaiting\s+(?:human\s+)?review/i,
  /please\s+approve/i,
  /approval\s+required/i,
  /user\s+action\s+needed/i,
];

/** Patterns indicating context overflow (recoverable with reduced context). */
const CONTEXT_OVERFLOW_PATTERNS = [
  /context\s+(?:window|length)\s+(?:exceeded|overflow)/i,
  /too\s+many\s+tokens/i,
  /input\s+too\s+long/i,
  /maximum\s+context/i,
  /context\s+limit\s+reached/i,
];

/**
 * Analyze agent exit to determine failure type and recommended action.
 *
 * @param output Combined stdout+stderr from the agent
 * @param exitCode Process exit code
 * @param agentType The type of agent (claude-code or codex)
 */
export function analyzeExit(
  output: string,
  exitCode: number,
  agentType: 'claude-code' | 'codex',
): ExitAnalysis {
  // Exit code 0 = success
  if (exitCode === 0) {
    return { success: true };
  }

  // Check for approval requests (Codex-specific)
  if (agentType === 'codex') {
    for (const pattern of APPROVAL_REQUEST_PATTERNS) {
      if (pattern.test(output)) {
        return {
          success: false,
          failureType: 'approval_required',
          detail: 'Agent is requesting approval for an action',
          recommendation: 'pause',
        };
      }
    }
  }

  // Check for context overflow (recoverable)
  for (const pattern of CONTEXT_OVERFLOW_PATTERNS) {
    if (pattern.test(output)) {
      return {
        success: false,
        failureType: 'context_overflow',
        detail: 'Agent context window exceeded',
        recommendation: 'retry_with_reduced_context',
      };
    }
  }

  // Check for token exhaustion (not recoverable)
  for (const pattern of TOKEN_EXHAUSTION_PATTERNS) {
    if (pattern.test(output)) {
      return {
        success: false,
        failureType: 'token_exhaustion',
        detail: 'Agent ran out of tokens',
        recommendation: 'fail',
      };
    }
  }

  // Unknown failure based on exit code
  return {
    success: false,
    failureType: exitCode === 1 ? 'agent_error' : 'unknown',
    detail: `Agent exited with code ${exitCode}`,
    recommendation: exitCode === 1 ? 'retry' : 'fail',
  };
}

// ─────────────────────────────────────────────────────────────
// Agent Launch Configuration
// ─────────────────────────────────────────────────────────────

/** Configuration for launching an agent. */
export interface AgentLaunchConfig {
  /** Agent type. */
  agentType: 'claude-code' | 'codex';
  /** The rendered prompt to deliver via stdin. */
  prompt: string;
  /** Working directory inside the container. */
  workingDirectory: string;
  /** Container ID to execute in. */
  containerId: string;
  /** Container user. */
  containerUser: string;
  /** Whether to enable auto-approve (for non-interactive runs). */
  autoApprove?: boolean;
  /** Maximum tokens/cost limit. */
  maxTokens?: number;
  /** Redaction configuration for I/O. */
  redactionConfig?: RedactionConfig;
}

/**
 * Build the command arguments for launching an agent.
 * Returns an array suitable for execFile (no shell).
 *
 * The agent binary and its arguments are separate array elements,
 * preventing shell injection even if values contain special characters.
 */
export function buildAgentCommand(config: AgentLaunchConfig): {
  command: string;
  args: string[];
} {
  const { agentType, workingDirectory, containerId, containerUser } = config;

  // Base: docker exec
  const args = [
    'exec',
    '-i',           // Keep stdin open for prompt pipe
    '-u', containerUser,
    '-w', workingDirectory,
    containerId,
  ];

  // Agent-specific binary and flags
  if (agentType === 'claude-code') {
    args.push('claude');
    args.push('--print');  // Non-interactive mode
    if (config.autoApprove) {
      args.push('--dangerously-skip-permissions');
    }
    if (config.maxTokens) {
      args.push('--max-turns', String(config.maxTokens));
    }
  } else {
    // codex
    args.push('codex');
    if (config.autoApprove) {
      args.push('--approval-policy', 'on-failure');
    }
  }

  return { command: 'docker', args };
}
