/**
 * TMux worker entry point.
 *
 * Starts the gRPC server, health check endpoint, and connects to the database.
 * Handles graceful shutdown on SIGTERM/SIGINT.
 */

import { loadConfig } from './config.ts';
import { getPool, closePool } from './db.ts';
import { startHealthServer, stopHealthServer, setHealthy } from './health.ts';
import { createGrpcServer, startGrpcServer, stopGrpcServer } from './grpc-server.ts';

async function main(): Promise<void> {
  console.log('TMux worker starting...');

  const config = loadConfig();
  console.log(`Worker ID: ${config.workerId}`);

  // Connect to database
  const pool = getPool(config);

  // Verify database connectivity
  try {
    await pool.query('SELECT 1');
    console.log('Database connection verified');
  } catch (err) {
    console.error('Failed to connect to database:', (err as Error).message);
    process.exit(1);
  }

  // Start health check server
  startHealthServer(config.healthPort);

  // Start gRPC server
  const grpcServer = createGrpcServer(config, pool);
  await startGrpcServer(grpcServer, config.grpcPort);

  setHealthy(true);
  console.log('TMux worker ready');

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down...`);
    setHealthy(false);

    await stopGrpcServer(grpcServer);
    await stopHealthServer();
    await closePool();

    console.log('TMux worker stopped');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('TMux worker failed to start:', err);
  process.exit(1);
});
