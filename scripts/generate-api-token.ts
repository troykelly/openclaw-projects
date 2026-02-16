#!/usr/bin/env node
/**
 * CLI script to generate a long-lived M2M JWT for API authentication.
 *
 * Usage:
 *   JWT_SECRET=<secret> pnpm run generate-api-token
 *   JWT_SECRET=<secret> pnpm run generate-api-token -- --service-id my-service --scopes api:read,api:write
 *
 * Environment:
 *   JWT_SECRET (required) — the same HS256 secret used by the API server.
 *
 * Options:
 *   --service-id <id>   Service identifier for the sub claim (default: openclaw-gateway)
 *   --scopes <list>     Comma-separated scopes (default: api:full)
 */

import { signM2MToken } from '../src/api/auth/jwt.ts';

function parseArgs(args: string[]): { serviceId: string; scopes: string[] } {
  let serviceId = 'openclaw-gateway';
  let scopes = ['api:full'];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--service-id' && args[i + 1]) {
      serviceId = args[i + 1];
      i++;
    } else if (args[i] === '--scopes' && args[i + 1]) {
      scopes = args[i + 1].split(',').map((s) => s.trim()).filter(Boolean);
      i++;
    }
  }

  return { serviceId, scopes };
}

async function main(): Promise<void> {
  if (!process.env.JWT_SECRET) {
    console.error('Error: JWT_SECRET environment variable is required.');
    console.error('Set it to the same secret used by your API server.');
    console.error('');
    console.error('Usage: JWT_SECRET=<secret> pnpm run generate-api-token');
    process.exit(1);
  }

  const { serviceId, scopes } = parseArgs(process.argv.slice(2));

  const token = await signM2MToken(serviceId, scopes);

  console.error(`Service ID: ${serviceId}`);
  console.error(`Scopes:     ${scopes.join(', ')}`);
  console.error(`Type:       m2m`);
  console.error(`Issuer:     openclaw-projects`);
  console.error('');
  console.error('Set this token as OPENCLAW_API_TOKEN in your environment:');
  console.error('');
  console.log(token);
}

main().catch((err: unknown) => {
  console.error('Failed to generate token:', err instanceof Error ? err.message : err);
  process.exit(1);
});
