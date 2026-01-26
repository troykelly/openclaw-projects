import { execFileSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '../..');
const migrationsPath = resolve(projectRoot, 'migrations');

export const DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://clawdbot:clawdbot@localhost:5432/clawdbot?sslmode=disable';

export function runMigrate(direction: 'up' | 'down', steps?: number): string {
  const args = ['-path', migrationsPath, '-database', DATABASE_URL, direction];
  if (steps !== undefined) args.push(String(steps));

  try {
    return execFileSync('migrate', args, { encoding: 'utf-8', cwd: projectRoot });
  } catch (error: unknown) {
    const e = error as { stderr?: string; stdout?: string };
    const msg = `${e.stderr || e.stdout || ''}`.trim();
    if (msg.includes('no change')) return msg;
    throw new Error(`Migration failed: ${msg || String(error)}`);
  }
}

export function migrationCount(): number {
  const out = execFileSync('bash', ['-lc', `ls -1 "${migrationsPath}"/*.up.sql 2>/dev/null | wc -l`], {
    encoding: 'utf-8',
  });
  return parseInt(out.trim() || '0');
}
