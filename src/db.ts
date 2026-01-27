import { Pool, PoolConfig } from 'pg';
import { existsSync } from 'fs';

function defaultHost(): string {
  // When running inside the devcontainer/docker-compose network, Postgres is reachable
  // via the service name. Keep localhost for non-container local dev.
  return existsSync('/.dockerenv') ? 'postgres' : 'localhost';
}

export function createPool(config?: PoolConfig): Pool {
  return new Pool({
    host: process.env.PGHOST || defaultHost(),
    port: parseInt(process.env.PGPORT || '5432', 10),
    user: process.env.PGUSER || 'clawdbot',
    password: process.env.PGPASSWORD || 'clawdbot',
    database: process.env.PGDATABASE || 'clawdbot',
    ...config,
  });
}
