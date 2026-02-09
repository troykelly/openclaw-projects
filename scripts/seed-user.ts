/**
 * Seed a test user and generate a signin link.
 * Usage: node --experimental-transform-types scripts/seed-user.ts [email]
 */
import { createHash, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { existsSync } from 'node:fs';

const defaultHost = existsSync('/.dockerenv') ? 'postgres' : 'localhost';
const pool = new Pool({
  host: process.env.PGHOST || defaultHost,
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'openclaw',
  password: process.env.PGPASSWORD || 'openclaw',
  database: process.env.PGDATABASE || 'openclaw',
});

async function main() {
  const email = process.argv[2] || 'test@example.com';

  console.log(`Creating signin link for: ${email}`);

  // Generate token
  const token = randomBytes(32).toString('base64url');
  const tokenSha = createHash('sha256').update(token).digest('hex');

  // Insert magic link
  await pool.query(
    `INSERT INTO auth_magic_link (email, token_sha256, expires_at)
     VALUES ($1, $2, now() + interval '24 hours')`,
    [email, tokenSha],
  );

  const baseUrl = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
  const loginUrl = `${baseUrl}/api/auth/consume?token=${token}`;

  console.log('\n✅ Signin link created!\n');
  console.log('────────────────────────────────────────────────────────────');
  console.log(loginUrl);
  console.log('────────────────────────────────────────────────────────────');
  console.log(`\nEmail: ${email}`);
  console.log('Expires: 24 hours from now');
  console.log('\nClick the link above to authenticate.\n');

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
