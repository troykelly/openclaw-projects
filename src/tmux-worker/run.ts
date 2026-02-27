/**
 * TMux worker entry point.
 *
 * Starts the gRPC server, health check endpoint, and connects to the database.
 * Wires EntryRecorder for session I/O recording, session recovery on startup,
 * and graceful shutdown on SIGTERM/SIGINT.
 *
 * Issues #1848, #1849, #1850 — Terminal I/O, command execution, worker wiring.
 */

import fs from 'node:fs';
import { loadConfig, validateEncryptionKey } from './config.ts';
import { getPool, closePool } from './db.ts';
import { startHealthServer, stopHealthServer, setHealthy } from './health.ts';
import { createGrpcServer, startGrpcServer, stopGrpcServer } from './grpc-server.ts';
import {
  createEnrollmentSSHServer,
  startEnrollmentSSHServer,
  stopEnrollmentSSHServer,
} from './enrollment-ssh-server.ts';
import { EntryRecorder } from './entry-recorder.ts';
import { recoverSessions, gracefulShutdown } from './session-recovery.ts';

async function main(): Promise<void> {
  console.log('TMux worker starting...');

  const config = loadConfig();
  console.log(`Worker ID: ${config.workerId}`);

  // Validate encryption key (Issue #1859 — fail fast, not fail later)
  const keyValidation = validateEncryptionKey(config.encryptionKeyHex);
  if (!keyValidation.valid) {
    console.error(`Encryption key validation failed: ${keyValidation.error}`);
    process.exit(1);
  }

  // Validate TLS cert files if configured (Issue #1856)
  if (config.grpcTlsCert && config.grpcTlsKey && config.grpcTlsCa) {
    for (const [label, filePath] of [
      ['GRPC_TLS_CERT', config.grpcTlsCert],
      ['GRPC_TLS_KEY', config.grpcTlsKey],
      ['GRPC_TLS_CA', config.grpcTlsCa],
    ] as const) {
      try {
        fs.accessSync(filePath, fs.constants.R_OK);
      } catch {
        console.error(`TLS file not readable: ${label}=${filePath}`);
        process.exit(1);
      }
    }
    console.log('TLS certificate files verified');
  }

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

  // Initialize EntryRecorder for session I/O recording (#1850)
  const entryRecorder = new EntryRecorder(pool);
  entryRecorder.start();
  console.log('EntryRecorder started');

  // Recover sessions from previous worker instance (#1850)
  try {
    const recoveryResults = await recoverSessions(pool, {
      workerId: config.workerId,
    });
    if (recoveryResults.length > 0) {
      console.log(
        `Session recovery: ${recoveryResults.length} sessions processed`,
      );
      for (const r of recoveryResults) {
        console.log(
          `  Session ${r.sessionId}: ${r.previousStatus} → ${r.newStatus}${r.error ? ` (${r.error})` : ''}`,
        );
      }
    } else {
      console.log('Session recovery: no sessions to recover');
    }
  } catch (err) {
    console.error(
      'Session recovery failed:',
      (err as Error).message,
    );
    // Non-fatal: continue startup even if recovery fails
  }

  // Start health check server
  startHealthServer(config.healthPort);

  // Start gRPC server with EntryRecorder (mTLS if certs configured)
  const grpcServer = createGrpcServer(config, pool, entryRecorder);
  await startGrpcServer(grpcServer, config.grpcPort, config);

  // Start SSH enrollment server
  const sshServer = createEnrollmentSSHServer(config, pool);
  await startEnrollmentSSHServer(sshServer, config.enrollmentSshPort);

  setHealthy(true);
  console.log('TMux worker ready');

  // Graceful shutdown (#1850)
  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down...`);
    setHealthy(false);

    // Flush entries and mark sessions as disconnected BEFORE closing DB
    try {
      await gracefulShutdown(pool, config.workerId, entryRecorder);
      console.log('Graceful shutdown: entries flushed, sessions marked disconnected');
    } catch (err) {
      console.error(
        'Graceful shutdown error:',
        (err as Error).message,
      );
    }

    await stopEnrollmentSSHServer(sshServer);
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
