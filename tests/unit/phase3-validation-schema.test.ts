/**
 * @vitest-environment node
 *
 * Unit tests for Phase 3 validation and schema fixes (Epic #2130).
 *
 * Issue #2114: Connection PATCH lacks port/timeout validation
 * Issue #2118: WebSocket resize messages lack integer/bounds validation
 * Issue #2119: Database schema lacks CHECK constraints for port/timeout fields
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC_ROOT = path.resolve(__dirname, '../../src');
const MIGRATIONS_ROOT = path.resolve(__dirname, '../../migrations');

// ---------------------------------------------------------------------------
// #2114 — Connection PATCH must validate port and timeout ranges
// ---------------------------------------------------------------------------
describe('#2114: Connection PATCH port/timeout validation', () => {
  const routesPath = path.join(SRC_ROOT, 'api/terminal/routes.ts');
  let routesContent: string;

  // Read the file once for all tests in this block
  const getRoutes = () => {
    if (!routesContent) {
      routesContent = fs.readFileSync(routesPath, 'utf8');
    }
    return routesContent;
  };

  it('PATCH handler validates port is between 1 and 65535', () => {
    const content = getRoutes();
    // Find the PATCH /terminal/connections/:id handler
    const patchStart = content.indexOf("app.patch('/terminal/connections/:id'");
    expect(patchStart).toBeGreaterThan(-1);

    // Find the next handler (DELETE) to scope the search
    const patchEnd = content.indexOf("app.delete('/terminal/connections/:id'", patchStart);
    expect(patchEnd).toBeGreaterThan(patchStart);

    const patchHandler = content.slice(patchStart, patchEnd);

    // Must validate port (either inline or via helper function)
    expect(patchHandler).toMatch(/validatePort|port.*[<>]=?\s*(1|65535)/);
    // Must return 400 for invalid port
    expect(patchHandler).toMatch(/400/);
  });

  it('PATCH handler validates timeout fields are positive', () => {
    const content = getRoutes();
    const patchStart = content.indexOf("app.patch('/terminal/connections/:id'");
    const patchEnd = content.indexOf("app.delete('/terminal/connections/:id'", patchStart);
    const patchHandler = content.slice(patchStart, patchEnd);

    // Must validate connect_timeout_s
    expect(patchHandler).toContain('connect_timeout_s');
    // Must validate keepalive_interval
    expect(patchHandler).toContain('keepalive_interval');
    // Must validate idle_timeout_s
    expect(patchHandler).toContain('idle_timeout_s');
    // Must validate via helper or inline (return 400)
    expect(patchHandler).toMatch(/validateTimeout|timeout.*[<>]=?\s*(0|1)/);
    expect(patchHandler).toMatch(/400/);
  });

  it('POST handler also validates port and timeout ranges', () => {
    const content = getRoutes();
    const postStart = content.indexOf("app.post('/terminal/connections'");
    expect(postStart).toBeGreaterThan(-1);

    const postEnd = content.indexOf("app.get('/terminal/connections/:id'", postStart);
    expect(postEnd).toBeGreaterThan(postStart);

    const postHandler = content.slice(postStart, postEnd);

    // POST should validate port (inline or via helper)
    expect(postHandler).toMatch(/validatePort|port.*[<>]=?\s*(1|65535)/);
    // POST should return 400 for invalid port
    expect(postHandler).toMatch(/400/);
  });
});

// ---------------------------------------------------------------------------
// #2118 — WebSocket resize must validate cols/rows as integers within bounds
// ---------------------------------------------------------------------------
describe('#2118: WebSocket resize integer/bounds validation', () => {
  const routesPath = path.join(SRC_ROOT, 'api/terminal/routes.ts');
  let routesContent: string;

  const getRoutes = () => {
    if (!routesContent) {
      routesContent = fs.readFileSync(routesPath, 'utf8');
    }
    return routesContent;
  };

  it('resize handler checks cols is a positive integer', () => {
    const content = getRoutes();
    // Find the resize handling code
    const resizeStart = content.indexOf("parsed.type === 'resize'");
    expect(resizeStart).toBeGreaterThan(-1);

    // Grab a range around the resize handler
    const resizeContext = content.slice(
      Math.max(0, resizeStart - 200),
      resizeStart + 500,
    );

    // Must use Number.isInteger or equivalent integer check
    expect(resizeContext).toMatch(/Number\.isInteger|parseInt|Math\.floor|typeof.*number/);
  });

  it('resize handler enforces MAX_COLS and MAX_ROWS bounds', () => {
    const content = getRoutes();

    // The routes file should reference bounds constants or numeric limits for resize
    // Look for MAX_COLS/MAX_ROWS or numeric bounds near resize
    expect(content).toMatch(/MAX_COLS|MAX_ROWS|max.*cols|max.*rows|1000|500/i);

    const resizeStart = content.indexOf("parsed.type === 'resize'");
    const resizeContext = content.slice(resizeStart, resizeStart + 800);

    // Must have bounds checking that prevents extreme values (> MAX_COLS or <= MAX_COLS)
    expect(resizeContext).toMatch(/[<>]=?\s*(MAX_COLS|MAX_ROWS|\d{2,})/);
  });

  it('resize handler rejects non-integer or negative values', () => {
    const content = getRoutes();
    const resizeStart = content.indexOf("parsed.type === 'resize'");
    const resizeContext = content.slice(resizeStart, resizeStart + 800);

    // Must have explicit validation that prevents cols/rows <= 0
    expect(resizeContext).toMatch(/>\s*0|>=\s*1|<\s*1/);
  });
});

// ---------------------------------------------------------------------------
// #2119 — Database schema CHECK constraints for port/timeout
// ---------------------------------------------------------------------------
describe('#2119: Database CHECK constraints for port/timeout', () => {
  it('a migration exists adding CHECK constraints for port fields', () => {
    const files = fs.readdirSync(MIGRATIONS_ROOT);
    const checkMigration = files.find(
      (f) => f.includes('terminal') && f.includes('check') && f.endsWith('.up.sql'),
    );

    expect(checkMigration).toBeDefined();

    const content = fs.readFileSync(
      path.join(MIGRATIONS_ROOT, checkMigration!),
      'utf8',
    );

    // Must add CHECK constraint for port BETWEEN 1 AND 65535
    expect(content).toMatch(/CHECK\s*\(.*port.*BETWEEN\s+1\s+AND\s+65535/i);
  });

  it('migration adds CHECK constraints for timeout fields', () => {
    const files = fs.readdirSync(MIGRATIONS_ROOT);
    const checkMigration = files.find(
      (f) => f.includes('terminal') && f.includes('check') && f.endsWith('.up.sql'),
    );

    expect(checkMigration).toBeDefined();

    const content = fs.readFileSync(
      path.join(MIGRATIONS_ROOT, checkMigration!),
      'utf8',
    );

    // Must add CHECK for timeouts > 0
    expect(content).toMatch(/CHECK\s*\(.*timeout.*>\s*0|CHECK\s*\(.*timeout.*BETWEEN/i);
  });

  it('migration adds CHECK constraints for terminal_tunnel port fields', () => {
    const files = fs.readdirSync(MIGRATIONS_ROOT);
    const checkMigration = files.find(
      (f) => f.includes('terminal') && f.includes('check') && f.endsWith('.up.sql'),
    );

    expect(checkMigration).toBeDefined();

    const content = fs.readFileSync(
      path.join(MIGRATIONS_ROOT, checkMigration!),
      'utf8',
    );

    // Must mention terminal_tunnel for port constraints
    expect(content).toContain('terminal_tunnel');
    // Must constrain bind_port
    expect(content).toMatch(/bind_port/i);
    // Must constrain target_port
    expect(content).toMatch(/target_port/i);
  });

  it('migration has a corresponding down migration', () => {
    const files = fs.readdirSync(MIGRATIONS_ROOT);
    const upMigration = files.find(
      (f) => f.includes('terminal') && f.includes('check') && f.endsWith('.up.sql'),
    );

    expect(upMigration).toBeDefined();

    const downMigration = upMigration!.replace('.up.sql', '.down.sql');
    const downExists = files.includes(downMigration);

    expect(downExists).toBe(true);
  });

  it('terminal_known_host port also has CHECK constraint', () => {
    const files = fs.readdirSync(MIGRATIONS_ROOT);
    const checkMigration = files.find(
      (f) => f.includes('terminal') && f.includes('check') && f.endsWith('.up.sql'),
    );

    expect(checkMigration).toBeDefined();

    const content = fs.readFileSync(
      path.join(MIGRATIONS_ROOT, checkMigration!),
      'utf8',
    );

    // Must mention terminal_known_host
    expect(content).toContain('terminal_known_host');
  });
});
