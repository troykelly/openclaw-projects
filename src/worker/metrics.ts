/**
 * Prometheus text exposition format metrics.
 * Hand-rolled -- no external dependencies.
 * Part of Issue #1178.
 */

// ─── Metric primitives ───

type Labels = Record<string, string>;

function labelsKey(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return '';
  return '{' + keys.map((k) => `${k}="${labels[k]}"`).join(',') + '}';
}

/** Monotonically increasing counter. */
export class Counter {
  readonly name: string;
  readonly help: string;
  private data = new Map<string, number>();

  constructor(name: string, help: string) {
    this.name = name;
    this.help = help;
  }

  inc(labels: Labels = {}, value: number = 1): void {
    const key = labelsKey(labels);
    this.data.set(key, (this.data.get(key) ?? 0) + value);
  }

  serialize(): string {
    const lines: string[] = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const [key, value] of this.data) {
      lines.push(`${this.name}${key} ${value}`);
    }
    return lines.join('\n');
  }

  /** Visible for testing / health. */
  get(labels: Labels = {}): number {
    return this.data.get(labelsKey(labels)) ?? 0;
  }
}

/** Point-in-time gauge. */
export class Gauge {
  readonly name: string;
  readonly help: string;
  private data = new Map<string, number>();

  constructor(name: string, help: string) {
    this.name = name;
    this.help = help;
  }

  set(labels: Labels, value: number): void;
  set(value: number): void;
  set(labelsOrValue: Labels | number, maybeValue?: number): void {
    if (typeof labelsOrValue === 'number') {
      this.data.set('', labelsOrValue);
    } else {
      this.data.set(labelsKey(labelsOrValue), maybeValue!);
    }
  }

  inc(labels: Labels = {}, value: number = 1): void {
    const key = labelsKey(labels);
    this.data.set(key, (this.data.get(key) ?? 0) + value);
  }

  serialize(): string {
    const lines: string[] = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
    for (const [key, value] of this.data) {
      lines.push(`${this.name}${key} ${value}`);
    }
    return lines.join('\n');
  }

  get(labels: Labels = {}): number {
    return this.data.get(labelsKey(labels)) ?? 0;
  }
}

/** Histogram with fixed buckets. */
export class Histogram {
  readonly name: string;
  readonly help: string;
  readonly buckets: number[];
  private data = new Map<string, { sum: number; count: number; buckets: number[] }>();

  constructor(name: string, help: string, buckets?: number[]) {
    this.name = name;
    this.help = help;
    this.buckets = buckets ?? DEFAULT_BUCKETS;
  }

  private getOrCreate(labels: Labels): { sum: number; count: number; buckets: number[] } {
    const key = labelsKey(labels);
    let entry = this.data.get(key);
    if (!entry) {
      entry = { sum: 0, count: 0, buckets: new Array(this.buckets.length).fill(0) as number[] };
      this.data.set(key, entry);
    }
    return entry;
  }

  observe(labels: Labels, value: number): void {
    const entry = this.getOrCreate(labels);
    entry.sum += value;
    entry.count++;
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]) {
        entry.buckets[i]++;
      }
    }
  }

  serialize(): string {
    const lines: string[] = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const [key, entry] of this.data) {
      // Strip wrapping braces so we can merge label sets
      const rawLabels = key.startsWith('{') ? key.slice(1, -1) : key;
      const sep = rawLabels ? ',' : '';

      for (let i = 0; i < this.buckets.length; i++) {
        lines.push(`${this.name}_bucket{${rawLabels}${sep}le="${this.buckets[i]}"} ${entry.buckets[i]}`);
      }
      lines.push(`${this.name}_bucket{${rawLabels}${sep}le="+Inf"} ${entry.count}`);
      lines.push(`${this.name}_sum{${rawLabels}} ${entry.sum}`);
      lines.push(`${this.name}_count{${rawLabels}} ${entry.count}`);
    }
    return lines.join('\n');
  }
}

// ─── Default buckets ───

const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120];

// ─── Worker metrics instances ───

// Jobs
export const jobsProcessedTotal = new Counter('worker_jobs_processed_total', 'Total internal jobs processed');
export const jobsDuration = new Histogram('worker_jobs_duration_seconds', 'Job processing duration in seconds');
export const jobsPending = new Gauge('worker_jobs_pending', 'Number of pending internal jobs');
export const jobsDeadLetterTotal = new Counter('worker_jobs_dead_letter_total', 'Total jobs dead-lettered');

// Webhooks
export const webhooksDispatchedTotal = new Counter('worker_webhooks_dispatched_total', 'Total webhooks dispatched');
export const webhooksDuration = new Histogram('worker_webhooks_duration_seconds', 'Webhook dispatch duration in seconds');
export const webhooksPending = new Gauge('worker_webhooks_pending', 'Number of pending webhooks');
export const webhooksDeadLetterTotal = new Counter('worker_webhooks_dead_letter_total', 'Total webhooks dead-lettered');

// Circuit breaker
export const circuitBreakerState = new Gauge('worker_circuit_breaker_state', 'Circuit breaker state (0=closed, 1=open, 2=half_open)');
export const circuitBreakerTripsTotal = new Counter('worker_circuit_breaker_trips_total', 'Total circuit breaker trips');

// Tick
export const tickDuration = new Histogram('worker_tick_duration_seconds', 'Tick loop duration in seconds');

// Listener
export const listenReconnectsTotal = new Counter('worker_listen_reconnects_total', 'Total LISTEN client reconnections');

// Pool
export const poolActiveConnections = new Gauge('worker_pool_active_connections', 'Active pool connections');
export const poolIdleConnections = new Gauge('worker_pool_idle_connections', 'Idle pool connections');
export const poolWaitingRequests = new Gauge('worker_pool_waiting_requests', 'Waiting pool requests');

// ─── Serializer ───

const ALL_METRICS = [
  jobsProcessedTotal,
  jobsDuration,
  jobsPending,
  jobsDeadLetterTotal,
  webhooksDispatchedTotal,
  webhooksDuration,
  webhooksPending,
  webhooksDeadLetterTotal,
  circuitBreakerState,
  circuitBreakerTripsTotal,
  tickDuration,
  listenReconnectsTotal,
  poolActiveConnections,
  poolIdleConnections,
  poolWaitingRequests,
];

/** Serialize all worker metrics to Prometheus text exposition format. */
export function serialize(): string {
  return ALL_METRICS.map((m) => m.serialize()).join('\n\n') + '\n';
}
