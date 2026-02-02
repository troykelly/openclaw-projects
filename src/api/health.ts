import type { Pool } from 'pg';

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface HealthCheckResult {
  status: HealthStatus;
  latencyMs: number;
  details?: Record<string, unknown>;
}

export interface HealthChecker {
  name: string;
  critical: boolean;
  check(): Promise<HealthCheckResult>;
}

export interface ComponentHealth {
  status: HealthStatus;
  latencyMs: number;
  details?: Record<string, unknown>;
}

export interface HealthResponse {
  status: HealthStatus;
  timestamp: string;
  components: Record<string, ComponentHealth>;
}

export class DatabaseHealthChecker implements HealthChecker {
  readonly name = 'database';
  readonly critical = true;

  constructor(private pool: Pool) {}

  async check(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      await this.pool.query('SELECT 1');
      const latencyMs = Date.now() - start;

      return {
        status: 'healthy',
        latencyMs,
        details: {
          poolTotal: this.pool.totalCount,
          poolIdle: this.pool.idleCount,
          poolWaiting: this.pool.waitingCount,
        },
      };
    } catch {
      return {
        status: 'unhealthy',
        latencyMs: Date.now() - start,
        details: { error: 'Database connection failed' },
      };
    }
  }
}

export class HealthCheckRegistry {
  private checkers: HealthChecker[] = [];

  register(checker: HealthChecker): void {
    this.checkers.push(checker);
  }

  async checkAll(): Promise<HealthResponse> {
    const components: Record<string, ComponentHealth> = {};
    let overallStatus: HealthStatus = 'healthy';

    for (const checker of this.checkers) {
      const result = await checker.check();
      components[checker.name] = {
        status: result.status,
        latencyMs: result.latencyMs,
        details: result.details,
      };

      if (result.status === 'unhealthy' && checker.critical) {
        overallStatus = 'unhealthy';
      } else if (result.status === 'unhealthy' && overallStatus === 'healthy') {
        overallStatus = 'degraded';
      } else if (result.status === 'degraded' && overallStatus === 'healthy') {
        overallStatus = 'degraded';
      }
    }

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      components,
    };
  }

  async isReady(): Promise<boolean> {
    for (const checker of this.checkers) {
      if (!checker.critical) continue;
      const result = await checker.check();
      if (result.status === 'unhealthy') return false;
    }
    return true;
  }
}
