# Health Endpoints Design

## Endpoints

| Endpoint | Purpose | Checks | HTTP Status |
|----------|---------|--------|-------------|
| `GET /api/health/live` | Liveness probe | Process running (no I/O) | 200 always |
| `GET /api/health/ready` | Readiness probe | All critical components | 200 or 503 |
| `GET /api/health` | Monitoring/debugging | Full component breakdown | 200 or 503 |

## Response Formats

### Liveness (`/api/health/live`)
```json
{"status": "ok"}
```

### Readiness (`/api/health/ready`)
```json
{"status": "ok"}
```
Or 503 with `{"status": "unavailable"}` if critical components fail.

### Detailed (`/api/health`)
```json
{
  "status": "healthy",
  "timestamp": "2026-02-02T12:00:00.000Z",
  "components": {
    "database": {
      "status": "healthy",
      "latency_ms": 2,
      "details": {
        "pool_total": 10,
        "pool_idle": 8,
        "pool_waiting": 0
      }
    }
  }
}
```

## Status Values

- `healthy` - all components ok
- `degraded` - non-critical components failing
- `unhealthy` - critical components failing (returns 503)

## Extensible Architecture

```typescript
type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

interface HealthCheckResult {
  status: HealthStatus;
  latency_ms: number;
  details?: Record<string, unknown>;
}

interface HealthChecker {
  name: string;
  critical: boolean;
  check(): Promise<HealthCheckResult>;
}
```

- Register checkers at startup
- `critical: true` → unhealthy affects overall status
- `critical: false` → unhealthy → degraded status

## Initial Components

- **DatabaseHealthChecker**: Pings DB with `SELECT 1`, reports pool stats

## Best Practice Alignment

- Liveness: no dependency checks (avoids restart loops)
- Readiness: dependency checks (controls traffic routing)
- Detailed: for monitoring/alerting only, not orchestration
