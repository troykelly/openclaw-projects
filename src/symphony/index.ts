/**
 * Symphony Orchestration Module
 *
 * Exports the state machine engine and claim/concurrency control.
 * Epic #2186, Issues #2196, #2197
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
