/**
 * Symphony Orchestration Module
 *
 * Exports the state machine engine, claim/concurrency control,
 * provisioning pipeline, and agent runner.
 * Epic #2186, Issues #2196, #2197, #2198, #2199
 */

export {
  RunState,
  RunStage,
  FailureClass,
  RUN_STATE_DB_VALUES,
  RUN_STAGE_DB_VALUES,
  TERMINAL_STATES,
  ACTIVE_STATES,
  VALID_TRANSITIONS,
  STATE_TIMEOUTS,
  FAILURE_RETRY_LIMITS,
  FAILURE_RECOVERY,
  isValidTransition,
  isTerminalState,
  inferStage,
  classifyFailure,
} from './states.js';
export type { RecoveryStrategy } from './states.js';

export { SymphonyStateMachine } from './state-machine.js';
export type {
  TransitionResult,
  TransitionContext,
  RunSnapshot,
  WatchdogOptions,
} from './state-machine.js';

export { SymphonyClaimManager, CLAIM_TIMEOUT_SECONDS } from './claim.js';
export type {
  ConcurrencyLimits,
  ClaimResult,
  ClaimCandidate,
  PreDispatchGates,
  ClaimOptions,
  CandidateSelectionOptions,
} from './claim.js';

export {
  ProvisioningPipeline,
  parseEnvFile,
  validateEnvVars,
  validatePath,
  normalizePath,
  validateDevcontainerConfig,
  validateShellSafe,
  validateContextInputs,
  compareVersions,
  PIPELINE_STEPS,
  STEP_TIMEOUTS,
  MIN_DISK_BYTES,
  DEVCONTAINER_ABSOLUTE_TIMEOUT_MINUTES,
} from './provisioning.js';
export type {
  PipelineStepName,
  StepStatus,
  StepResult,
  ProvisioningContext,
  RollbackAction,
  PipelineResult,
  CommandExecutor,
  CancellationChecker,
  StepStatusRecorder,
  ContainerTracker,
  SecretTracker,
  DevcontainerConfig,
} from './provisioning.js';

export {
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
} from './agent-runner.js';
export type {
  SymphonyVariables,
  RedactionConfig,
  HeartbeatState,
  ActivityWindow,
  LoopDetectionConfig,
  ExitAnalysis,
  AgentLaunchConfig,
} from './agent-runner.js';

// Cleanup Queue & Orphan Detection (#2213)
export {
  CleanupSweeper,
  identifyOrphanedContainers,
  identifyStaleWorktrees,
  identifyExpiredSecrets,
  checkCleanupSlo,
  shouldDeferCleanup,
  CLEANUP_RETENTION_DAYS,
  DEFERRED_GC_HOURS,
  MAX_CLEANUP_BACKLOG_AGE_SECONDS,
  MAX_CLEANUP_BACKLOG_SIZE,
  CRITICAL_BACKLOG_AGE_SECONDS,
} from './cleanup.js';
export type {
  ContainerRecord,
  WorkspaceRecord,
  SecretDeploymentRecord,
  CleanupItem,
  OrphanCandidate,
  CleanupResult,
  SloViolation,
  SloStatus,
  CleanupContext,
} from './cleanup.js';

// Secret Lifecycle Management (#2214)
export {
  SecretDeploymentTracker,
  validateSecretPreProvisioning,
  detectSecretRotation,
  getRedactionPatterns,
  DEFAULT_ROTATION_POLL_INTERVAL_MS,
} from './secret-lifecycle.js';
export type {
  SecretDeployment,
  CreateDeploymentInput,
  SecretRotationResult,
  ValidationResult,
  RedactionPattern,
} from './secret-lifecycle.js';
