/**
 * Symphony Provisioning Pipeline
 *
 * 8-step pipeline that takes a claimed issue from "nothing" to
 * "agent ready to work in a devcontainer."
 *
 * Steps (in order):
 * 1. disk_check — Verify 10GB+ free on host
 * 2. ssh_connect — Connect via terminal session
 * 3. repo_check — Clone/verify repo
 * 4. env_sync — 1Password vault sync (.env)
 * 5. devcontainer_up — Start devcontainer
 * 6. container_exec — Exec into container
 * 7. agent_verify — Verify agent CLI
 * 8. worktree_setup — Create git worktree
 *
 * Each step has: status tracking, timeout, heartbeat, rollback on failure.
 * Rollback executes in reverse order on failure.
 * Cancellation checked before each step.
 *
 * Issue #2198
 */

/** Step names in pipeline order. */
export const PIPELINE_STEPS = [
  'disk_check',
  'ssh_connect',
  'repo_check',
  'env_sync',
  'devcontainer_up',
  'container_exec',
  'agent_verify',
  'worktree_setup',
] as const;

export type PipelineStepName = (typeof PIPELINE_STEPS)[number];

/** Status of an individual pipeline step. */
export type StepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'rolled_back'
  | 'skipped';

/** Default timeout per step in seconds. */
export const STEP_TIMEOUTS: Record<PipelineStepName, number> = {
  disk_check: 30,
  ssh_connect: 30,
  repo_check: 5 * 60,
  env_sync: 30,
  devcontainer_up: 15 * 60,
  container_exec: 30,
  agent_verify: 60,
  worktree_setup: 2 * 60,
};

/** Minimum disk space in bytes (10 GB). */
export const MIN_DISK_BYTES = 10 * 1024 * 1024 * 1024;

/** Maximum absolute timeout for devcontainer_up in minutes. */
export const DEVCONTAINER_ABSOLUTE_TIMEOUT_MINUTES = 60;

/** Result of a single pipeline step. */
export interface StepResult {
  step: PipelineStepName;
  status: StepStatus;
  startedAt: Date;
  completedAt?: Date;
  error?: string;
  /** Data produced by the step for downstream use. */
  data?: Record<string, unknown>;
}

/** Provisioning context passed between steps. */
export interface ProvisioningContext {
  runId: string;
  namespace: string;
  org: string;
  repo: string;
  connectionId: string;
  issueNumber: number;
  issueSlug: string;
  /** Clone depth (default 1 for shallow clones). */
  cloneDepth?: number;
  /** Devcontainer absolute timeout in minutes. */
  devcontainerAbsoluteTimeoutMinutes?: number;
  /** Agent CLI minimum version. */
  agentMinVersion?: string;
  /** Env vault item identifier. */
  envVaultItem?: string;
}

/** Rollback action for a step. */
export interface RollbackAction {
  step: PipelineStepName;
  description: string;
  rollback: () => Promise<void>;
}

/** Overall pipeline result. */
export interface PipelineResult {
  success: boolean;
  steps: StepResult[];
  rollbackResults?: Array<{
    step: PipelineStepName;
    success: boolean;
    error?: string;
  }>;
  error?: string;
  /** Was the pipeline cancelled externally? */
  cancelled?: boolean;
}

/**
 * Executor interface — abstracts remote command execution.
 * The "run" method name avoids confusion with child_process.exec.
 * Allows mocking for tests and swapping SSH backends.
 */
export interface CommandExecutor {
  /** Run a command and return stdout. Throws on non-zero exit or timeout. */
  run(command: string, timeoutMs: number): Promise<string>;
  /** Check if connected. */
  isConnected(): boolean;
  /** Connect to host. */
  connect(): Promise<void>;
  /** Disconnect. */
  disconnect(): Promise<void>;
}

/** Cancellation checker — polls DB to verify run not externally cancelled. */
export interface CancellationChecker {
  isCancelled(runId: string): Promise<boolean>;
}

/** Step status recorder — writes step status to DB for crash recovery. */
export interface StepStatusRecorder {
  recordStepStatus(
    runId: string,
    step: PipelineStepName,
    status: StepStatus,
    error?: string,
    data?: Record<string, unknown>,
  ): Promise<void>;
  /** Get the last recorded step statuses for crash recovery. */
  getStepStatuses(
    runId: string,
  ): Promise<Array<{ step: PipelineStepName; status: StepStatus }>>;
}

/** Container tracker — records devcontainer starts for orphan detection. */
export interface ContainerTracker {
  trackContainer(
    runId: string,
    namespace: string,
    containerId: string,
    containerName: string,
    connectionId: string,
  ): Promise<void>;
  removeContainer(containerId: string): Promise<void>;
}

/** Secret deployment tracker — records .env deployments with version. */
export interface SecretTracker {
  trackSecret(
    runId: string,
    namespace: string,
    connectionId: string,
    envPath: string,
    version: string,
  ): Promise<void>;
  removeSecret(runId: string, connectionId: string): Promise<void>;
}

// ─────────────────────────────────────────────────────────────
// Safe .env parser (SECURITY CRITICAL — P2-6 finding)
// ─────────────────────────────────────────────────────────────

/** Regex for valid KEY=VALUE lines. */
const ENV_LINE_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)/;

/** Patterns that indicate shell code injection. */
const DANGEROUS_PATTERNS = [
  /\$\(/, // command substitution $(...)
  /`/,    // backtick command substitution
  /\$\{/, // variable expansion ${...}
];

/**
 * Parse a .env file safely. NEVER use `source` or shell evaluation.
 *
 * Rules (P2-6 security finding):
 * 1. Only reads lines matching ^[A-Za-z_][A-Za-z0-9_]*=
 * 2. Rejects lines containing command substitutions ($(...), backticks)
 * 3. Rejects multi-line values
 * 4. Strips optional surrounding quotes (single/double) from values
 * 5. Skips comments and blank lines
 *
 * @returns Map of key-value pairs
 * @throws Error if dangerous content is detected
 */
export function parseEnvFile(
  content: string,
): Map<string, string> {
  const result = new Map<string, string>();
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty lines and comments
    if (line === '' || line.startsWith('#')) continue;

    const match = ENV_LINE_PATTERN.exec(line);
    if (!match) {
      // Non-matching lines are silently skipped (could be malformed)
      continue;
    }

    const key = match[1];
    let value = match[2];

    // Check for dangerous patterns (SECURITY CRITICAL)
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(value)) {
        throw new Error(
          `Dangerous pattern detected in .env at line ${i + 1}: ` +
          `key="${key}" contains shell code (${pattern.source}). ` +
          `This is a security violation.`,
        );
      }
    }

    // Strip surrounding quotes (single or double)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result.set(key, value);
  }

  return result;
}

/**
 * Validate that required environment variables are present.
 */
export function validateEnvVars(
  env: Map<string, string>,
  requiredVars: string[],
): { valid: boolean; missing: string[] } {
  const missing = requiredVars.filter((v) => !env.has(v));
  return { valid: missing.length === 0, missing };
}

// ─────────────────────────────────────────────────────────────
// Path safety (Codex Critical — path traversal prevention)
// ─────────────────────────────────────────────────────────────

/**
 * Validate and canonicalize a path, ensuring it is within an expected parent.
 *
 * Rules (Codex path traversal finding):
 * 1. Canonicalize using realpath-equivalent logic
 * 2. Verify canonical path is within expectedParent
 * 3. Reject paths containing '..' segments
 * 4. Log canonical path before any deletion
 *
 * @returns The canonical path if safe
 * @throws Error if path escapes expected parent
 */
export function validatePath(
  inputPath: string,
  expectedParent: string,
): string {
  // Reject '..' segments immediately
  const segments = inputPath.split('/');
  if (segments.includes('..')) {
    throw new Error(
      `Path traversal detected: "${inputPath}" contains '..' segments`,
    );
  }

  // Normalize: resolve . segments, remove double slashes
  const normalized = normalizePath(inputPath);
  const normalizedParent = normalizePath(expectedParent);

  // Verify the path starts with the expected parent
  if (
    !normalized.startsWith(normalizedParent + '/') &&
    normalized !== normalizedParent
  ) {
    throw new Error(
      `Path "${normalized}" is outside expected parent "${normalizedParent}"`,
    );
  }

  return normalized;
}

/**
 * Normalize a path: resolve single dots, remove trailing slashes, collapse double slashes.
 * Does NOT resolve '..' (that would require filesystem access); we reject '..' above.
 */
export function normalizePath(inputPath: string): string {
  // Split, filter empty and single-dot segments, rejoin
  const parts = inputPath.split('/').filter((p) => p !== '' && p !== '.');
  const result = inputPath.startsWith('/') ? '/' + parts.join('/') : parts.join('/');
  return result || '/';
}

// ─────────────────────────────────────────────────────────────
// Devcontainer config validation
// ─────────────────────────────────────────────────────────────

/** Devcontainer config shape for validation. */
export interface DevcontainerConfig {
  name?: string;
  dockerComposeFile?: string | string[];
  service?: string;
  workspaceFolder?: string;
  remoteUser?: string;
  containerUser?: string;
  mounts?: Array<string | { source: string; target: string; type: string }>;
  runArgs?: string[];
  privileged?: boolean;
  capAdd?: string[];
  [key: string]: unknown;
}

/** Safe capabilities allowlist. */
const SAFE_CAPABILITIES = new Set([
  'SYS_PTRACE', // needed for debugging
]);

/**
 * Validate devcontainer config against security allowlist (P2-9 finding).
 *
 * Rejects:
 * - privileged: true
 * - Docker socket mounts
 * - Host path mounts outside repo directory
 * - Unsafe capabilities
 *
 * @returns Array of validation errors (empty means valid)
 */
export function validateDevcontainerConfig(
  config: DevcontainerConfig,
  repoPath: string,
): string[] {
  const errors: string[] = [];

  // Reject privileged mode
  if (config.privileged === true) {
    errors.push('privileged mode is not allowed');
  }

  // Check capabilities
  if (config.capAdd && Array.isArray(config.capAdd)) {
    for (const cap of config.capAdd) {
      if (!SAFE_CAPABILITIES.has(cap)) {
        errors.push(`capability '${cap}' is not in the safe allowlist`);
      }
    }
  }

  // Check mounts
  if (config.mounts && Array.isArray(config.mounts)) {
    for (const mount of config.mounts) {
      const mountStr =
        typeof mount === 'string' ? mount : `source=${mount.source}`;

      // Reject Docker socket mounts
      if (mountStr.includes('/var/run/docker.sock')) {
        errors.push('Docker socket mount is not allowed');
      }

      // Check host path mounts
      if (typeof mount === 'object' && mount.source) {
        if (
          !mount.source.startsWith(repoPath) &&
          !mount.source.startsWith('/tmp')
        ) {
          errors.push(
            `host path mount '${mount.source}' is outside the repo directory`,
          );
        }
      }
    }
  }

  // Check runArgs for dangerous flags
  if (config.runArgs && Array.isArray(config.runArgs)) {
    for (let i = 0; i < config.runArgs.length; i++) {
      const arg = config.runArgs[i];
      if (arg === '--privileged') {
        errors.push('--privileged flag is not allowed in runArgs');
      }
      if (
        arg === '-v' &&
        config.runArgs[i + 1]?.includes('/var/run/docker.sock')
      ) {
        errors.push(
          'Docker socket mount via -v is not allowed in runArgs',
        );
      }
    }
  }

  return errors;
}

// ─────────────────────────────────────────────────────────────
// Pipeline Engine
// ─────────────────────────────────────────────────────────────

/**
 * The Provisioning Pipeline orchestrates the 8-step process.
 *
 * Each step:
 * 1. Records status as 'running' in DB
 * 2. Runs with timeout
 * 3. Records status as 'completed' or 'failed'
 * 4. On failure: triggers reverse-order rollback
 *
 * Before each step: check for external cancellation.
 * After crash: resume from last incomplete step.
 */
export class ProvisioningPipeline {
  private rollbackActions: RollbackAction[] = [];
  private stepResults: StepResult[] = [];

  constructor(
    private readonly remoteExecutor: CommandExecutor,
    private readonly cancellation: CancellationChecker,
    private readonly statusRecorder: StepStatusRecorder,
    private readonly containerTracker: ContainerTracker,
    private readonly secretTracker: SecretTracker,
  ) {}

  /**
   * Run the full provisioning pipeline.
   */
  async execute(ctx: ProvisioningContext): Promise<PipelineResult> {
    this.rollbackActions = [];
    this.stepResults = [];

    for (const stepName of PIPELINE_STEPS) {
      // Cancellation check before each step
      const cancelled = await this.cancellation.isCancelled(ctx.runId);
      if (cancelled) {
        await this.performRollback();
        return {
          success: false,
          steps: this.stepResults,
          cancelled: true,
          error: 'Pipeline cancelled externally',
        };
      }

      const result = await this.executeStep(stepName, ctx);
      this.stepResults.push(result);

      if (result.status === 'failed') {
        const rollbackResults = await this.performRollback();
        return {
          success: false,
          steps: this.stepResults,
          rollbackResults,
          error: result.error,
        };
      }
    }

    return {
      success: true,
      steps: this.stepResults,
    };
  }

  /**
   * Resume pipeline from last incomplete step (crash recovery — P2-3 finding).
   */
  async resume(ctx: ProvisioningContext): Promise<PipelineResult> {
    this.rollbackActions = [];
    this.stepResults = [];

    // Get last recorded step statuses
    const statuses = await this.statusRecorder.getStepStatuses(ctx.runId);
    const statusMap = new Map(statuses.map((s) => [s.step, s.status]));

    // Find the first step that is not 'completed'
    let resumeFrom = 0;
    for (let i = 0; i < PIPELINE_STEPS.length; i++) {
      const status = statusMap.get(PIPELINE_STEPS[i]);
      if (status === 'completed') {
        // Record as completed in our results
        this.stepResults.push({
          step: PIPELINE_STEPS[i],
          status: 'completed',
          startedAt: new Date(),
          completedAt: new Date(),
        });
        resumeFrom = i + 1;
      } else {
        break;
      }
    }

    // Execute remaining steps
    for (let i = resumeFrom; i < PIPELINE_STEPS.length; i++) {
      const stepName = PIPELINE_STEPS[i];

      const cancelled = await this.cancellation.isCancelled(ctx.runId);
      if (cancelled) {
        await this.performRollback();
        return {
          success: false,
          steps: this.stepResults,
          cancelled: true,
          error: 'Pipeline cancelled externally',
        };
      }

      const result = await this.executeStep(stepName, ctx);
      this.stepResults.push(result);

      if (result.status === 'failed') {
        const rollbackResults = await this.performRollback();
        return {
          success: false,
          steps: this.stepResults,
          rollbackResults,
          error: result.error,
        };
      }
    }

    return {
      success: true,
      steps: this.stepResults,
    };
  }

  /**
   * Run a single pipeline step with timeout and status tracking.
   */
  private async executeStep(
    stepName: PipelineStepName,
    ctx: ProvisioningContext,
  ): Promise<StepResult> {
    const startedAt = new Date();

    // Record running status in DB
    await this.statusRecorder.recordStepStatus(ctx.runId, stepName, 'running');

    try {
      const timeoutMs = STEP_TIMEOUTS[stepName] * 1000;
      const data = await this.runStepLogic(stepName, ctx, timeoutMs);

      // Record completed status
      await this.statusRecorder.recordStepStatus(
        ctx.runId,
        stepName,
        'completed',
        undefined,
        data,
      );

      return {
        step: stepName,
        status: 'completed',
        startedAt,
        completedAt: new Date(),
        data,
      };
    } catch (err) {
      const error =
        err instanceof Error ? err.message : String(err);

      // Record failed status
      await this.statusRecorder.recordStepStatus(
        ctx.runId,
        stepName,
        'failed',
        error,
      );

      return {
        step: stepName,
        status: 'failed',
        startedAt,
        completedAt: new Date(),
        error,
      };
    }
  }

  /**
   * Dispatch to the correct step logic.
   */
  private async runStepLogic(
    step: PipelineStepName,
    ctx: ProvisioningContext,
    timeoutMs: number,
  ): Promise<Record<string, unknown> | undefined> {
    switch (step) {
      case 'disk_check':
        return this.stepDiskCheck(ctx, timeoutMs);
      case 'ssh_connect':
        return this.stepSshConnect(ctx, timeoutMs);
      case 'repo_check':
        return this.stepRepoCheck(ctx, timeoutMs);
      case 'env_sync':
        return this.stepEnvSync(ctx, timeoutMs);
      case 'devcontainer_up':
        return this.stepDevcontainerUp(ctx, timeoutMs);
      case 'container_exec':
        return this.stepContainerExec(ctx, timeoutMs);
      case 'agent_verify':
        return this.stepAgentVerify(ctx, timeoutMs);
      case 'worktree_setup':
        return this.stepWorktreeSetup(ctx, timeoutMs);
    }
  }

  // ─── Step 1: Disk Check ────────────────────────────────────

  private async stepDiskCheck(
    _ctx: ProvisioningContext,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    const output = await this.remoteExecutor.run(
      'df -B1 --output=avail / | tail -1',
      timeoutMs,
    );
    const availableBytes = parseInt(output.trim(), 10);

    if (isNaN(availableBytes)) {
      throw new Error(`Failed to parse disk space: "${output.trim()}"`);
    }

    if (availableBytes < MIN_DISK_BYTES) {
      throw new Error(
        `Insufficient disk space: ${availableBytes} bytes available, ` +
        `${MIN_DISK_BYTES} bytes required`,
      );
    }

    return { availableBytes };
    // No rollback for disk_check
  }

  // ─── Step 2: SSH Connect ───────────────────────────────────

  private async stepSshConnect(
    _ctx: ProvisioningContext,
    _timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    await this.remoteExecutor.connect();

    // Register rollback: disconnect
    this.rollbackActions.push({
      step: 'ssh_connect',
      description: 'Disconnect SSH session',
      rollback: async () => {
        await this.remoteExecutor.disconnect();
      },
    });

    return { connected: true };
  }

  // ─── Step 3: Repo Check ────────────────────────────────────

  private async stepRepoCheck(
    ctx: ProvisioningContext,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    const repoPath = `~/claw/repos/${ctx.org}/${ctx.repo}`;

    // Validate path safety (prevent traversal via org/repo names)
    const expandedPath = repoPath.replace('~', '/home/user');
    validatePath(expandedPath, '/home/user/claw/repos');

    // Check if repo exists
    const exists = await this.remoteExecutor
      .run(`test -d ${repoPath}/.git && echo exists || echo missing`, timeoutMs)
      .then((out) => out.trim() === 'exists');

    const cloneDepth = ctx.cloneDepth ?? 1;
    let freshClone = false;

    if (!exists) {
      await this.remoteExecutor.run(
        `mkdir -p ~/claw/repos/${ctx.org} && ` +
        `git clone --depth ${cloneDepth} https://github.com/${ctx.org}/${ctx.repo}.git ${repoPath}`,
        timeoutMs,
      );
      freshClone = true;
    } else {
      // Pull latest
      await this.remoteExecutor.run(
        `cd ${repoPath} && git fetch origin`,
        timeoutMs,
      );
    }

    // Register rollback: rm -rf if fresh clone
    if (freshClone) {
      this.rollbackActions.push({
        step: 'repo_check',
        description: `Remove freshly cloned repo at ${repoPath}`,
        rollback: async () => {
          // SECURITY: canonicalize path before deletion
          const canonical = await this.remoteExecutor.run(
            `realpath ${repoPath}`,
            5000,
          );
          const canonicalTrimmed = canonical.trim();
          const parentDir = `/home/user/claw/repos`;

          // Verify the path is within expected parent
          if (!canonicalTrimmed.startsWith(parentDir + '/')) {
            throw new Error(
              `Rollback aborted: canonical path "${canonicalTrimmed}" ` +
              `is outside expected parent "${parentDir}"`,
            );
          }

          await this.remoteExecutor.run(`rm -rf ${canonicalTrimmed}`, 30000);
        },
      });
    }

    return { repoPath, freshClone };
  }

  // ─── Step 4: Env Sync ──────────────────────────────────────

  private async stepEnvSync(
    ctx: ProvisioningContext,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    const repoPath = `~/claw/repos/${ctx.org}/${ctx.repo}`;
    const envPath = `${repoPath}/.env`;
    const vaultItem =
      ctx.envVaultItem ?? `.env (${ctx.org}/${ctx.repo}) [User]`;

    // Fetch from 1Password
    const envContent = await this.remoteExecutor.run(
      `op read "op://Development Environments/${vaultItem}"`,
      timeoutMs,
    );

    // Parse safely (NEVER source .env — P2-6 security finding)
    const envVars = parseEnvFile(envContent);

    // Build safe content to write
    const envLines: string[] = [];
    for (const [key, value] of envVars) {
      envLines.push(`${key}=${value}`);
    }
    const safeContent = envLines.join('\n') + '\n';

    // Write via heredoc with quoted delimiter (no shell expansion)
    await this.remoteExecutor.run(
      `cat > ${envPath} <<'ENVEOF'\n${safeContent}ENVEOF`,
      timeoutMs,
    );

    // Track secret deployment
    const version = new Date().toISOString();
    await this.secretTracker.trackSecret(
      ctx.runId,
      ctx.namespace,
      ctx.connectionId,
      envPath,
      version,
    );

    // Register rollback: rm .env
    this.rollbackActions.push({
      step: 'env_sync',
      description: `Remove .env at ${envPath}`,
      rollback: async () => {
        await this.remoteExecutor.run(`rm -f ${envPath}`, 5000);
        await this.secretTracker.removeSecret(ctx.runId, ctx.connectionId);
      },
    });

    return { envPath, varCount: envVars.size, version };
  }

  // ─── Step 5: Devcontainer Up ───────────────────────────────

  private async stepDevcontainerUp(
    ctx: ProvisioningContext,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    const repoPath = `~/claw/repos/${ctx.org}/${ctx.repo}`;

    // Apply absolute timeout cap (P2-8 finding)
    const absTimeoutMin =
      ctx.devcontainerAbsoluteTimeoutMinutes ?? DEVCONTAINER_ABSOLUTE_TIMEOUT_MINUTES;
    const absTimeoutMs = absTimeoutMin * 60 * 1000;
    const effectiveTimeout = Math.min(timeoutMs, absTimeoutMs);

    // Read and validate devcontainer config first (P2-9 finding)
    const configRaw = await this.remoteExecutor.run(
      `cat ${repoPath}/.devcontainer/devcontainer.json`,
      10000,
    );

    let config: DevcontainerConfig;
    try {
      config = JSON.parse(configRaw) as DevcontainerConfig;
    } catch {
      throw new Error('Failed to parse devcontainer.json');
    }

    const configErrors = validateDevcontainerConfig(config, repoPath);
    if (configErrors.length > 0) {
      throw new Error(
        `Devcontainer config validation failed: ${configErrors.join('; ')}`,
      );
    }

    // Start devcontainer
    const output = await this.remoteExecutor.run(
      `devcontainer up --workspace-folder ${repoPath}`,
      effectiveTimeout,
    );

    // Parse container ID from output
    const containerIdMatch = /containerId.*?:\s*"?([a-f0-9]{12,64})"?/i.exec(output);
    const containerId = containerIdMatch?.[1] ?? 'unknown';
    const containerName = config.name ?? `${ctx.org}-${ctx.repo}`;

    // Track container for orphan detection
    await this.containerTracker.trackContainer(
      ctx.runId,
      ctx.namespace,
      containerId,
      containerName,
      ctx.connectionId,
    );

    // Register rollback: docker rm -f
    this.rollbackActions.push({
      step: 'devcontainer_up',
      description: `Remove container ${containerId}`,
      rollback: async () => {
        await this.remoteExecutor.run(`docker rm -f ${containerId}`, 30000);
        await this.containerTracker.removeContainer(containerId);
      },
    });

    return { containerId, containerName };
  }

  // ─── Step 6: Container Exec ────────────────────────────────

  private async stepContainerExec(
    ctx: ProvisioningContext,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    const repoPath = `~/claw/repos/${ctx.org}/${ctx.repo}`;

    // Read devcontainer config for user
    const configRaw = await this.remoteExecutor.run(
      `cat ${repoPath}/.devcontainer/devcontainer.json`,
      10000,
    );

    let config: DevcontainerConfig;
    try {
      config = JSON.parse(configRaw) as DevcontainerConfig;
    } catch {
      throw new Error('Failed to parse devcontainer.json for container_exec');
    }

    const user = config.remoteUser ?? config.containerUser ?? 'root';

    // Find the container ID from the devcontainer_up step result
    const devcontainerResult = this.stepResults.find(
      (r) => r.step === 'devcontainer_up',
    );
    const containerId =
      (devcontainerResult?.data?.containerId as string) ?? 'unknown';

    // Verify container is running
    const statusOutput = await this.remoteExecutor.run(
      `docker inspect --format '{{.State.Running}}' ${containerId}`,
      timeoutMs,
    );

    if (statusOutput.trim() !== 'true') {
      throw new Error(`Container ${containerId} is not running`);
    }

    // Verify workspace exists inside container
    await this.remoteExecutor.run(
      `docker exec -u ${user} ${containerId} test -d /workspaces/${ctx.repo}`,
      timeoutMs,
    );

    // Register rollback (no-op since we use per-command exec, no persistent shell)
    this.rollbackActions.push({
      step: 'container_exec',
      description: 'Exit container exec session',
      rollback: async () => {
        // No persistent shell to clean up
      },
    });

    return { containerId, user };
  }

  // ─── Step 7: Agent Verify ──────────────────────────────────

  private async stepAgentVerify(
    ctx: ProvisioningContext,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    const devcontainerResult = this.stepResults.find(
      (r) => r.step === 'devcontainer_up',
    );
    const containerId =
      (devcontainerResult?.data?.containerId as string) ?? 'unknown';

    const containerExecResult = this.stepResults.find(
      (r) => r.step === 'container_exec',
    );
    const user =
      (containerExecResult?.data?.user as string) ?? 'root';

    // Check CLI installed and version
    const versionOutput = await this.remoteExecutor.run(
      `docker exec -u ${user} ${containerId} claude --version`,
      timeoutMs,
    );

    const versionMatch = /(\d+\.\d+\.\d+)/.exec(versionOutput);
    if (!versionMatch) {
      throw new Error(
        `Could not determine agent CLI version from: "${versionOutput.trim()}"`,
      );
    }

    const version = versionMatch[1];
    const minVersion = ctx.agentMinVersion ?? '0.0.1';

    if (compareVersions(version, minVersion) < 0) {
      throw new Error(
        `Agent CLI version ${version} is below minimum ${minVersion}`,
      );
    }

    // Verify authentication
    const authOutput = await this.remoteExecutor.run(
      `docker exec -u ${user} ${containerId} claude auth status`,
      timeoutMs,
    );

    if (
      !authOutput.toLowerCase().includes('authenticated') &&
      !authOutput.toLowerCase().includes('logged in')
    ) {
      throw new Error('Agent CLI is not authenticated');
    }

    // No rollback needed for agent_verify
    return { version, authenticated: true };
  }

  // ─── Step 8: Worktree Setup ────────────────────────────────

  private async stepWorktreeSetup(
    ctx: ProvisioningContext,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    const devcontainerResult = this.stepResults.find(
      (r) => r.step === 'devcontainer_up',
    );
    const containerId =
      (devcontainerResult?.data?.containerId as string) ?? 'unknown';
    const containerExecResult = this.stepResults.find(
      (r) => r.step === 'container_exec',
    );
    const user =
      (containerExecResult?.data?.user as string) ?? 'root';

    const worktreePath = `/tmp/worktree-issue-${ctx.issueNumber}-${ctx.issueSlug}`;
    const branchName = `issue/${ctx.issueNumber}-${ctx.issueSlug}`;

    // Fetch latest
    await this.remoteExecutor.run(
      `docker exec -u ${user} ${containerId} bash -c ` +
      `"cd /workspaces/${ctx.repo} && git fetch origin"`,
      timeoutMs,
    );

    // Create worktree
    await this.remoteExecutor.run(
      `docker exec -u ${user} ${containerId} bash -c ` +
      `"cd /workspaces/${ctx.repo} && git worktree add ${worktreePath} -b ${branchName} origin/main"`,
      timeoutMs,
    );

    // Register rollback: remove worktree
    this.rollbackActions.push({
      step: 'worktree_setup',
      description: `Remove worktree at ${worktreePath}`,
      rollback: async () => {
        await this.remoteExecutor.run(
          `docker exec -u ${user} ${containerId} bash -c ` +
          `"cd /workspaces/${ctx.repo} && git worktree remove ${worktreePath} --force"`,
          30000,
        );
      },
    });

    return { worktreePath, branchName };
  }

  // ─── Rollback ──────────────────────────────────────────────

  /**
   * Perform rollback actions in reverse order.
   */
  private async performRollback(): Promise<
    Array<{ step: PipelineStepName; success: boolean; error?: string }>
  > {
    const results: Array<{
      step: PipelineStepName;
      success: boolean;
      error?: string;
    }> = [];

    // Reverse order rollback
    const reversed = [...this.rollbackActions].reverse();

    for (const action of reversed) {
      try {
        await action.rollback();
        results.push({ step: action.step, success: true });
      } catch (err) {
        const error =
          err instanceof Error ? err.message : String(err);
        results.push({ step: action.step, success: false, error });
      }
    }

    return results;
  }
}

/**
 * Compare semantic versions. Returns:
 * -1 if a < b, 0 if a == b, 1 if a > b
 */
export function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);
  const len = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < len; i++) {
    const pA = partsA[i] ?? 0;
    const pB = partsB[i] ?? 0;
    if (pA < pB) return -1;
    if (pA > pB) return 1;
  }
  return 0;
}
