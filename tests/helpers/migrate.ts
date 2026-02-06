import { execFileSync } from 'child_process';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Pool } from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '../..');
const migrationsPath = resolve(projectRoot, 'migrations');

function defaultDbHost(): string {
  // In the devcontainer, Postgres is reachable via the docker-compose service name.
  return existsSync('/.dockerenv') ? 'postgres' : 'localhost';
}

export const DATABASE_URL =
  process.env.DATABASE_URL ||
  `postgres://openclaw:openclaw@${defaultDbHost()}:5432/openclaw?sslmode=disable`;

type Migration = {
  version: number;
  upPath: string;
  downPath: string;
};

function parseVersion(filename: string): number {
  const m = filename.match(/^(\d+)_/);
  if (!m) throw new Error(`Invalid migration filename (missing numeric prefix): ${filename}`);
  return parseInt(m[1], 10);
}

function listMigrations(): Migration[] {
  const files = readdirSync(migrationsPath).sort((a, b) => a.localeCompare(b));
  const byVersion: Record<number, Partial<Migration>> = {};

  for (const f of files) {
    if (!f.endsWith('.sql')) continue;
    const version = parseVersion(f);
    byVersion[version] ||= { version };

    const full = resolve(migrationsPath, f);
    if (f.endsWith('.up.sql')) (byVersion[version] as Partial<Migration>).upPath = full;
    if (f.endsWith('.down.sql')) (byVersion[version] as Partial<Migration>).downPath = full;
  }

  return Object.values(byVersion)
    .map((m) => {
      if (!m.upPath || !m.downPath) {
        throw new Error(`Migration ${m.version} missing up/down pair`);
      }
      return m as Migration;
    })
    .sort((a, b) => a.version - b.version);
}

async function ensureMigrationsTable(pool: Pool): Promise<void> {
  // Keep compatibility with common migration trackers (e.g. golang-migrate),
  // which include a NOT NULL `dirty` column.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version bigint PRIMARY KEY,
      dirty boolean NOT NULL DEFAULT false,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  // If the table exists but is missing expected columns (older dev DB), patch it in-place.
  await pool.query(`ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS dirty boolean NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS applied_at timestamptz NOT NULL DEFAULT now()`);
}

async function withAdvisoryLock<T>(pool: Pool, fn: () => Promise<T>): Promise<T> {
  // Arbitrary constant lock key for this repo.
  await pool.query('SELECT pg_advisory_lock($1)', [74210421]);
  try {
    return await fn();
  } finally {
    await pool.query('SELECT pg_advisory_unlock($1)', [74210421]);
  }
}

async function applySql(pool: Pool, file: string): Promise<void> {
  const sql = readFileSync(file, 'utf-8');
  await pool.query(sql);
}

/**
 * Apply or rollback migrations without depending on the external `migrate` binary.
 *
 * Uses `schema_migrations` as the source of truth.
 */
export async function runMigrate(direction: 'up' | 'down', steps?: number): Promise<string> {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 3 });

  try {
    return await withAdvisoryLock(pool, async () => {
      await ensureMigrationsTable(pool);
      const migrations = listMigrations();

      if (direction === 'up') {
        const applied = await pool.query<{ version: number }>('SELECT version::int as version FROM schema_migrations');
        const appliedSet = new Set(applied.rows.map((r) => r.version));

        let count = 0;
        for (const m of migrations) {
          if (appliedSet.has(m.version)) continue;

          await pool.query('BEGIN');
          try {
            await applySql(pool, m.upPath);
            await pool.query(
              'INSERT INTO schema_migrations(version, dirty) VALUES ($1, false) ON CONFLICT (version) DO NOTHING',
              [m.version]
            );
            await pool.query('COMMIT');
          } catch (e) {
            await pool.query('ROLLBACK');
            throw e;
          }

          count += 1;
        }
        return `applied ${count} up migrations`;
      }

      // down
      const rows = await pool.query<{ version: number }>(
        'SELECT version::int as version FROM schema_migrations ORDER BY version DESC'
      );
      const toRollback = steps ? rows.rows.slice(0, steps) : rows.rows;

      let count = 0;
      for (const r of toRollback) {
        const m = migrations.find((x) => x.version === r.version);
        if (!m) throw new Error(`No migration files found for version ${r.version}`);

        await pool.query('BEGIN');
        try {
          await applySql(pool, m.downPath);
          await pool.query('DELETE FROM schema_migrations WHERE version = $1', [r.version]);
          await pool.query('COMMIT');
        } catch (e) {
          await pool.query('ROLLBACK');
          throw e;
        }

        count += 1;
      }
      return `applied ${count} down migrations`;
    });
  } finally {
    await pool.end();
  }
}

export function migrationCount(): number {
  const out = execFileSync('bash', ['-lc', `ls -1 "${migrationsPath}"/*.up.sql 2>/dev/null | wc -l`], {
    encoding: 'utf-8',
  });
  return parseInt(out.trim() || '0');
}
