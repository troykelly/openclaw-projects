import { buildServer } from './server.ts';
import { closeSentry } from '../instrument.ts';

const port = parseInt(process.env.PORT || '3000');
const host = process.env.HOST || '::';

const app = buildServer({ logger: true });

/** Guard against duplicate shutdown from repeated signals. */
let shuttingDown = false;

/** Graceful shutdown: close Fastify, flush Sentry events, then exit. */
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  app.log.info(`Received ${signal}, shutting down gracefully`);
  try {
    await app.close();
  } finally {
    // Flush pending Sentry events before exiting (#2000)
    await closeSentry();
    process.exit(0);
  }
}

process.on('SIGTERM', () => { shutdown('SIGTERM').catch(() => process.exit(1)); });
process.on('SIGINT', () => { shutdown('SIGINT').catch(() => process.exit(1)); });

await app.listen({ port, host });
