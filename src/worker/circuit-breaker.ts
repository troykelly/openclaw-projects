/**
 * Per-destination circuit breaker for webhook dispatch.
 * Prevents hammering failing endpoints.
 * Part of Issue #1178.
 */

export type CircuitState = 'closed' | 'open' | 'half_open';

interface DestinationState {
  state: CircuitState;
  failures: number;
  lastFailure: number | null;
  openUntil: number | null;
}

/** Callback fired when a circuit breaker destination changes state. */
export type CircuitStateChangeCallback = (
  destination: string,
  previousState: CircuitState,
  newState: CircuitState,
  failures: number,
) => void;

interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit. Default: 5. */
  threshold?: number;
  /** Time in ms to keep the circuit open before allowing a probe. Default: 60000. */
  cooldownMs?: number;
  /** Optional callback when a destination's state changes (#2001). */
  onStateChange?: CircuitStateChangeCallback;
}

/**
 * Extract the host from a destination URL for use as the circuit breaker key.
 * Falls back to the raw string if the URL is unparseable.
 */
function destinationKey(destination: string): string {
  try {
    return new URL(destination).host;
  } catch {
    return destination;
  }
}

export class CircuitBreaker {
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly destinations = new Map<string, DestinationState>();
  private readonly onStateChange?: CircuitStateChangeCallback;

  constructor(options: CircuitBreakerOptions = {}) {
    this.threshold = options.threshold ?? 5;
    this.cooldownMs = options.cooldownMs ?? 60_000;
    this.onStateChange = options.onStateChange;
  }

  private getOrCreate(destination: string): DestinationState {
    const key = destinationKey(destination);
    let state = this.destinations.get(key);
    if (!state) {
      state = { state: 'closed', failures: 0, lastFailure: null, openUntil: null };
      this.destinations.set(key, state);
    }
    return state;
  }

  /**
   * Check whether the circuit is open (requests should be blocked).
   * Transitions from OPEN to HALF_OPEN when the cooldown expires.
   */
  isOpen(destination: string): boolean {
    const s = this.getOrCreate(destination);

    if (s.state === 'closed') return false;

    if (s.state === 'open') {
      if (s.openUntil !== null && Date.now() >= s.openUntil) {
        // Cooldown expired -- allow one probe
        const prev = s.state;
        s.state = 'half_open';
        this.onStateChange?.(destination, prev, 'half_open', s.failures);
        return false;
      }
      return true;
    }

    // half_open: allow the probe request through
    return false;
  }

  /**
   * Record a successful dispatch. Resets the destination to CLOSED.
   */
  recordSuccess(destination: string): void {
    const key = destinationKey(destination);
    const prev = this.destinations.get(key);
    const previousState = prev?.state ?? 'closed';
    this.destinations.set(key, {
      state: 'closed',
      failures: 0,
      lastFailure: null,
      openUntil: null,
    });
    if (previousState !== 'closed') {
      this.onStateChange?.(destination, previousState, 'closed', 0);
    }
  }

  /**
   * Record a failed dispatch.  Opens the circuit after `threshold` consecutive failures.
   */
  recordFailure(destination: string): void {
    const s = this.getOrCreate(destination);
    const previousState = s.state;
    s.failures++;
    s.lastFailure = Date.now();

    if (s.failures >= this.threshold && previousState !== 'open') {
      s.state = 'open';
      s.openUntil = Date.now() + this.cooldownMs;
      this.onStateChange?.(destination, previousState, 'open', s.failures);
    }
  }

  /**
   * Return the current state for a destination.
   * Automatically transitions OPEN -> HALF_OPEN when cooldown expires.
   */
  getState(destination: string): CircuitState {
    // isOpen has the side-effect of transitioning open -> half_open
    this.isOpen(destination);
    return this.getOrCreate(destination).state;
  }

  /**
   * Return stats for every tracked destination.
   */
  getStats(): Map<string, { state: CircuitState; failures: number; lastFailure: number | null; openUntil: number | null }> {
    // Refresh transitions before returning
    for (const key of this.destinations.keys()) {
      this.isOpen(key);
    }
    return new Map(this.destinations);
  }
}
