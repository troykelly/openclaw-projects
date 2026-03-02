import { buildServer } from './server.ts';
import { closeSentry } from '../instrument.ts';

const port = parseInt(process.env.PORT || '3000');
const host = process.env.HOST || '::';

const app = buildServer({ logger: true });

/** Graceful shutdown: flush Sentry events, then close Fastify and exit. */
async function shutdown(signal: string): Promise<void> {
  app.log.info(`Received ${signal}, shutting down gracefully`);
  await app.close();
  // Flush pending Sentry events before exiting (#2000)
  await closeSentry();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

await app.listen({ port, host });
