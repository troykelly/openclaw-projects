import { buildServer } from './server.ts';

const port = parseInt(process.env.PORT || '3000');
const host = process.env.HOST || '::';

const app = buildServer({ logger: true });

await app.listen({ port, host });
