# IPv6-First Service Bindings Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Flip all Docker Compose and Traefik configuration from IPv4-first to IPv6-first with IPv4 fallback.

**Architecture:** Port bindings list `[::1]` before `127.0.0.1`. `SERVICE_HOST` defaults to `[::1]`. Server bind addresses use `::` (dual-stack). Tests verify structure, sed substitution, and runtime dual-stack connectivity.

**Tech Stack:** Docker Compose YAML, shell scripts (sed), Vitest, Node.js/Fastify, SeaweedFS container

**Issue:** [#1128](https://github.com/troykelly/openclaw-projects/issues/1128)
**Design:** `docs/plans/2026-02-14-ipv6-first-service-bindings-design.md`

---

## Setup

Create worktree and branch before starting:

```bash
cd /workspaces/openclaw-projects
git worktree add /tmp/worktree-issue-1128-ipv6-first -b issue/1128-ipv6-first
cd /tmp/worktree-issue-1128-ipv6-first
ln -s /workspaces/openclaw-projects/node_modules node_modules
ln -s /workspaces/openclaw-projects/.local .local 2>/dev/null || true
```

All file paths below are relative to the worktree root.

---

### Task 1: Write IPv6-first compose structure tests

**Files:**
- Create: `tests/docker/ipv6-first.test.ts`

**Step 1: Write the failing tests**

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parse } from 'yaml';

const ROOT_DIR = resolve(__dirname, '../..');

interface ComposeService {
  image?: string;
  environment?: Record<string, string> | string[];
  ports?: string[];
  entrypoint?: string | string[];
  command?: string | string[];
}

interface ComposeFile {
  services: Record<string, ComposeService>;
}

function loadCompose(filename: string): ComposeFile {
  const content = readFileSync(resolve(ROOT_DIR, filename), 'utf-8');
  return parse(content) as ComposeFile;
}

function getEnv(service: ComposeService, key: string): string | undefined {
  const env = service.environment;
  if (!env || Array.isArray(env)) return undefined;
  return env[key];
}

/**
 * For a service's port list, assert that every localhost-bound port pair
 * has [::1] listed before 127.0.0.1.
 */
function assertIPv6First(ports: string[], serviceName: string): void {
  // Group port mappings by container port
  const byContainerPort = new Map<string, string[]>();
  for (const p of ports) {
    // Extract container port (last segment after final colon)
    const parts = p.split(':');
    const containerPort = parts[parts.length - 1];
    if (!byContainerPort.has(containerPort)) {
      byContainerPort.set(containerPort, []);
    }
    byContainerPort.get(containerPort)!.push(p);
  }

  for (const [containerPort, bindings] of byContainerPort) {
    const ipv6Idx = bindings.findIndex((b) => b.includes('[::1]'));
    const ipv4Idx = bindings.findIndex((b) => b.includes('127.0.0.1'));

    if (ipv6Idx !== -1 && ipv4Idx !== -1) {
      expect(ipv6Idx, `${serviceName} port ${containerPort}: [::1] should come before 127.0.0.1`).toBeLessThan(ipv4Idx);
    }
  }
}

describe('IPv6-first port binding order', () => {
  const TRAEFIK_COMPOSE = 'docker-compose.traefik.yml';
  const FULL_COMPOSE = 'docker-compose.full.yml';
  const BASIC_COMPOSE = 'docker-compose.yml';
  const QUICKSTART_COMPOSE = 'docker-compose.quickstart.yml';
  const TEST_COMPOSE = 'docker-compose.test.yml';

  const dualBindComposeFiles = [TRAEFIK_COMPOSE, FULL_COMPOSE, BASIC_COMPOSE];

  for (const file of dualBindComposeFiles) {
    describe(file, () => {
      let compose: ComposeFile;
      beforeAll(() => {
        compose = loadCompose(file);
      });

      it('all services with localhost ports have [::1] before 127.0.0.1', () => {
        for (const [name, service] of Object.entries(compose.services)) {
          if (service.ports && service.ports.some((p) => p.includes('127.0.0.1'))) {
            assertIPv6First(service.ports, `${file}/${name}`);
          }
        }
      });
    });
  }

  describe(QUICKSTART_COMPOSE, () => {
    it('api service has dual-stack localhost bindings with [::1] first', () => {
      const compose = loadCompose(QUICKSTART_COMPOSE);
      const apiPorts = compose.services.api?.ports || [];
      const hasIPv6 = apiPorts.some((p) => p.includes('[::1]'));
      const hasIPv4 = apiPorts.some((p) => p.includes('127.0.0.1'));
      expect(hasIPv6, 'quickstart api should have [::1] binding').toBe(true);
      expect(hasIPv4, 'quickstart api should have 127.0.0.1 binding').toBe(true);
      assertIPv6First(apiPorts, 'quickstart/api');
    });
  });

  describe(TEST_COMPOSE, () => {
    it('backend-test and postgres-test have dual-stack localhost bindings', () => {
      const compose = loadCompose(TEST_COMPOSE);
      for (const name of ['backend-test', 'postgres-test']) {
        const ports = compose.services[name]?.ports || [];
        const hasIPv6 = ports.some((p) => p.includes('[::1]'));
        const hasIPv4 = ports.some((p) => p.includes('127.0.0.1'));
        expect(hasIPv6, `${name} should have [::1] binding`).toBe(true);
        expect(hasIPv4, `${name} should have 127.0.0.1 binding`).toBe(true);
        assertIPv6First(ports, `test/${name}`);
      }
    });
  });
});

describe('SERVICE_HOST defaults to [::1]', () => {
  for (const file of ['docker-compose.traefik.yml', 'docker-compose.full.yml']) {
    it(`${file} traefik SERVICE_HOST defaults to [::1]`, () => {
      const compose = loadCompose(file);
      const serviceHost = getEnv(compose.services.traefik, 'SERVICE_HOST');
      expect(serviceHost).toContain('[::1]');
      expect(serviceHost).not.toMatch(/\$\{SERVICE_HOST:-127\.0\.0\.1\}/);
    });
  }
});

describe('API HOST is :: (dual-stack)', () => {
  for (const file of [
    'docker-compose.traefik.yml',
    'docker-compose.full.yml',
    'docker-compose.yml',
    'docker-compose.quickstart.yml',
  ]) {
    it(`${file} api HOST is ::`, () => {
      const compose = loadCompose(file);
      const host = getEnv(compose.services.api, 'HOST');
      expect(host).toBe('::');
    });
  }
});

describe('Gateway OPENCLAW_BIND is :: (dual-stack)', () => {
  it('docker-compose.full.yml openclaw-gateway OPENCLAW_BIND is ::', () => {
    const compose = loadCompose('docker-compose.full.yml');
    const bind = getEnv(compose.services['openclaw-gateway'], 'OPENCLAW_BIND');
    expect(bind).toBe('::');
  });
});

describe('SeaweedFS entrypoint uses -ip.bind=::', () => {
  it('docker/seaweedfs/entrypoint.sh contains -ip.bind=::', () => {
    const content = readFileSync(resolve(ROOT_DIR, 'docker/seaweedfs/entrypoint.sh'), 'utf-8');
    expect(content).toContain('-ip.bind=::');
    expect(content).not.toContain('-ip.bind=0.0.0.0');
  });
});

describe('Traefik entrypoint defaults SERVICE_HOST to [::1]', () => {
  it('docker/traefik/entrypoint.sh SERVICE_HOST defaults to [::1]', () => {
    const content = readFileSync(resolve(ROOT_DIR, 'docker/traefik/entrypoint.sh'), 'utf-8');
    expect(content).toContain('SERVICE_HOST:-[::1]');
    expect(content).not.toContain('SERVICE_HOST:-127.0.0.1');
  });
});

describe('.env.example documents IPv6-first defaults', () => {
  it('SERVICE_HOST default is [::1]', () => {
    const content = readFileSync(resolve(ROOT_DIR, '.env.example'), 'utf-8');
    // The commented default should show [::1]
    expect(content).toMatch(/SERVICE_HOST.*\[::1\]/);
  });

  it('HOST default is ::', () => {
    const content = readFileSync(resolve(ROOT_DIR, '.env.example'), 'utf-8');
    expect(content).toMatch(/HOST.*::/);
  });
});

describe('ops reference configs use [::1]', () => {
  it('ops/traefik/dynamic.yml uses [::1] in service URLs', () => {
    const path = resolve(ROOT_DIR, 'ops/traefik/dynamic.yml');
    if (!existsSync(path)) return; // skip if ops dir not present
    const content = readFileSync(path, 'utf-8');
    expect(content).not.toMatch(/http:\/\/127\.0\.0\.1:/);
    expect(content).toMatch(/http:\/\/\[::1\]:/);
  });

  it('ops/systemd/openclaw-projects.service uses HOST=::', () => {
    const path = resolve(ROOT_DIR, 'ops/systemd/openclaw-projects.service');
    if (!existsSync(path)) return;
    const content = readFileSync(path, 'utf-8');
    expect(content).toContain('HOST=::');
    expect(content).not.toContain('HOST=127.0.0.1');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/docker/ipv6-first.test.ts`
Expected: Multiple FAILs (config files still have IPv4 defaults)

**Step 3: Commit failing tests**

```bash
git add tests/docker/ipv6-first.test.ts
git commit -m "[#1128] Add IPv6-first compose structure tests (red)"
```

---

### Task 2: Write Traefik entrypoint sed substitution test

**Files:**
- Create: `tests/docker/traefik-entrypoint.test.ts`

**Step 1: Write the test**

This test exercises the same sed pipeline used by the Traefik entrypoint to verify that `[::1]` substitution produces valid YAML and URLs.

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { execFileSync } from 'child_process';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';

const ROOT_DIR = resolve(__dirname, '../..');
const TEMPLATE_PATH = resolve(ROOT_DIR, 'docker/traefik/dynamic-config.yml.template');

/**
 * Runs the same sed pipeline used by entrypoint.sh with the given env vars.
 * Uses execFileSync with explicit args to avoid shell injection.
 */
function runSedSubstitution(env: Record<string, string>): string {
  // Write a self-contained script to a temp file, then execute it
  const tmpDir = mkdtempSync(join(tmpdir(), 'traefik-test-'));
  const scriptPath = join(tmpDir, 'run-sed.sh');

  const envExports = Object.entries(env)
    .map(([k, v]) => `export ${k}='${v.replace(/'/g, "'\\''")}'`)
    .join('\n');

  const script = `#!/bin/sh
set -eu
${envExports}
escape_sed() { printf '%s\\n' "$1" | sed 's/[&/\\\\|]/\\\\&/g'; }
sed \\
  -e "s|\\\${DOMAIN}|$(escape_sed "\${DOMAIN}")|g" \\
  -e "s|\\\${ACME_EMAIL}|$(escape_sed "\${ACME_EMAIL}")|g" \\
  -e "s|\\\${TRUSTED_IPS}|$(escape_sed "\${TRUSTED_IPS}")|g" \\
  -e "s|\\\${DISABLE_HTTP}|$(escape_sed "\${DISABLE_HTTP}")|g" \\
  -e "s|\\\${SERVICE_HOST}|$(escape_sed "\${SERVICE_HOST}")|g" \\
  -e "s|\\\${MODSEC_HOST_PORT}|$(escape_sed "\${MODSEC_HOST_PORT}")|g" \\
  -e "s|\\\${API_HOST_PORT}|$(escape_sed "\${API_HOST_PORT}")|g" \\
  -e "s|\\\${APP_HOST_PORT}|$(escape_sed "\${APP_HOST_PORT}")|g" \\
  -e "s|\\\${GATEWAY_HOST_PORT}|$(escape_sed "\${GATEWAY_HOST_PORT}")|g" \\
  -e "s|\\\${SEAWEEDFS_HOST_PORT}|$(escape_sed "\${SEAWEEDFS_HOST_PORT}")|g" \\
  < '${TEMPLATE_PATH}'
`;

  writeFileSync(scriptPath, script, { mode: 0o755 });
  try {
    return execFileSync('/bin/sh', [scriptPath], { encoding: 'utf-8', timeout: 10_000 });
  } finally {
    try { execFileSync('rm', ['-rf', tmpDir]); } catch { /* cleanup best-effort */ }
  }
}

describe('Traefik entrypoint sed substitution with IPv6', () => {
  const defaultEnv = {
    DOMAIN: 'test.example.com',
    ACME_EMAIL: 'test@example.com',
    TRUSTED_IPS: '',
    DISABLE_HTTP: 'false',
    SERVICE_HOST: '[::1]',
    MODSEC_HOST_PORT: '8080',
    API_HOST_PORT: '3001',
    APP_HOST_PORT: '8081',
    GATEWAY_HOST_PORT: '18789',
    SEAWEEDFS_HOST_PORT: '8333',
  };

  it('generates valid YAML when SERVICE_HOST is [::1]', () => {
    const output = runSedSubstitution(defaultEnv);
    expect(() => parseYaml(output)).not.toThrow();
  });

  it('produces http://[::1]:PORT URLs for all services', () => {
    const output = runSedSubstitution(defaultEnv);
    expect(output).toContain('http://[::1]:8080');
    expect(output).toContain('http://[::1]:3001');
    expect(output).toContain('http://[::1]:8081');
    expect(output).toContain('http://[::1]:18789');
    expect(output).toContain('http://[::1]:8333');
  });

  it('has no unsubstituted ${SERVICE_HOST} placeholders', () => {
    const output = runSedSubstitution(defaultEnv);
    expect(output).not.toContain('${SERVICE_HOST}');
  });

  it('has no unsubstituted ${DOMAIN} placeholders', () => {
    const output = runSedSubstitution(defaultEnv);
    expect(output).not.toContain('${DOMAIN}');
  });

  it('generates valid URLs parseable by new URL()', () => {
    const output = runSedSubstitution(defaultEnv);
    const urlMatches = output.match(/url: "([^"]+)"/g) || [];
    expect(urlMatches.length).toBeGreaterThan(0);
    for (const match of urlMatches) {
      const url = match.replace(/url: "([^"]+)"/, '$1');
      expect(() => new URL(url), `URL should be valid: ${url}`).not.toThrow();
    }
  });

  it('also works with IPv4 SERVICE_HOST=127.0.0.1 (fallback)', () => {
    const output = runSedSubstitution({ ...defaultEnv, SERVICE_HOST: '127.0.0.1' });
    expect(() => parseYaml(output)).not.toThrow();
    expect(output).toContain('http://127.0.0.1:8080');
  });
});
```

**Step 2: Run test to verify it passes** (template already supports `[::1]` substitution)

Run: `pnpm exec vitest run tests/docker/traefik-entrypoint.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/docker/traefik-entrypoint.test.ts
git commit -m "[#1128] Add Traefik entrypoint sed substitution tests"
```

---

### Task 3: Write Fastify dual-stack binding test

**Files:**
- Create: `tests/api/dual-stack-binding.test.ts`

**Step 1: Write the test**

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { createServer, type Server } from 'http';

describe('Dual-stack binding on ::', () => {
  let server: Server;
  let port: number;

  afterAll(() => {
    return new Promise<void>((resolve) => {
      if (server) server.close(() => resolve());
      else resolve();
    });
  });

  it('accepts connections on both IPv4 (127.0.0.1) and IPv6 ([::1])', async () => {
    // Start server on :: (dual-stack)
    server = createServer((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(0, '::', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          port = addr.port;
          resolve();
        } else {
          reject(new Error('Failed to get server address'));
        }
      });
    });

    // Test IPv4 access
    const ipv4Resp = await fetch(`http://127.0.0.1:${port}/`);
    expect(ipv4Resp.status).toBe(200);
    expect(await ipv4Resp.text()).toBe('ok');

    // Test IPv6 access
    const ipv6Resp = await fetch(`http://[::1]:${port}/`);
    expect(ipv6Resp.status).toBe(200);
    expect(await ipv6Resp.text()).toBe('ok');
  });
});
```

**Step 2: Run test**

Run: `pnpm exec vitest run tests/api/dual-stack-binding.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/api/dual-stack-binding.test.ts
git commit -m "[#1128] Add dual-stack binding integration test"
```

---

### Task 4: Write SeaweedFS IPv6 container test

**Files:**
- Create: `tests/docker/seaweedfs-ipv6.test.ts`

**Step 1: Write the test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';

const CONTAINER_NAME = 'seaweed-ipv6-test-vitest';
const IMAGE = 'chrislusf/seaweedfs:4.09';
const STARTUP_WAIT_MS = 35_000;

function dockerExec(cmd: string[]): string {
  return execFileSync('docker', ['exec', CONTAINER_NAME, ...cmd], {
    encoding: 'utf-8',
    timeout: 10_000,
  }).trim();
}

function isDockerAvailable(): boolean {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore', timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

describe('SeaweedFS dual-stack with -ip.bind=::', () => {
  const skip = !isDockerAvailable();

  beforeAll(async () => {
    if (skip) return;
    // Clean up any leftover container
    try {
      execFileSync('docker', ['rm', '-f', CONTAINER_NAME], { stdio: 'ignore' });
    } catch { /* ignore */ }

    execFileSync(
      'docker',
      ['run', '--rm', '-d', '--name', CONTAINER_NAME, IMAGE, 'server', '-s3', '-ip.bind=::', '-s3.port=8333', '-volume.max=1'],
      { timeout: 15_000 },
    );

    // Wait for SeaweedFS to fully start
    await new Promise((r) => setTimeout(r, STARTUP_WAIT_MS));
  }, STARTUP_WAIT_MS + 10_000);

  afterAll(() => {
    if (skip) return;
    try {
      execFileSync('docker', ['stop', CONTAINER_NAME], { stdio: 'ignore', timeout: 15_000 });
    } catch { /* ignore */ }
  });

  it.skipIf(skip)('master responds on IPv4 (127.0.0.1:9333)', () => {
    const result = dockerExec(['wget', '-q', '-O', '-', 'http://127.0.0.1:9333/cluster/status']);
    expect(result).toContain('IsLeader');
  });

  it.skipIf(skip)('master responds on IPv6 ([::1]:9333)', () => {
    const result = dockerExec(['wget', '-q', '-O', '-', 'http://[::1]:9333/cluster/status']);
    expect(result).toContain('IsLeader');
  });

  it.skipIf(skip)('S3 responds on IPv4 (127.0.0.1:8333)', () => {
    const result = dockerExec(['wget', '-q', '-O', '-', 'http://127.0.0.1:8333/']);
    expect(result).toContain('ListAllMyBucketsResult');
  });

  it.skipIf(skip)('S3 responds on IPv6 ([::1]:8333)', () => {
    const result = dockerExec(['wget', '-q', '-O', '-', 'http://[::1]:8333/']);
    expect(result).toContain('ListAllMyBucketsResult');
  });
});
```

**Step 2: Run test**

Run: `pnpm exec vitest run tests/docker/seaweedfs-ipv6.test.ts --test-timeout=60000`
Expected: PASS (4 passing, or 4 skipped if Docker unavailable)

**Step 3: Commit**

```bash
git add tests/docker/seaweedfs-ipv6.test.ts
git commit -m "[#1128] Add SeaweedFS IPv6 container dual-stack test"
```

---

### Task 5: Flip docker-compose.traefik.yml to IPv6-first

**Files:**
- Modify: `docker-compose.traefik.yml`

**Step 1: Apply all changes**

Lines to change (exact current values shown):

| Line | Current | New |
|------|---------|-----|
| 52 | `# Set SERVICE_HOST to [::1] for IPv6-only environments.` | `# Set SERVICE_HOST to 127.0.0.1 for IPv4-only environments.` |
| 53 | `SERVICE_HOST: ${SERVICE_HOST:-127.0.0.1}` | `SERVICE_HOST: ${SERVICE_HOST:-[::1]}` |
| 199-200 | `"127.0.0.1:...8080"` then `"[::1]:...8080"` | Swap order |
| 305-306 | `"127.0.0.1:...8333"` then `"[::1]:...8333"` | Swap order |
| 378 | `HOST: 0.0.0.0` | `HOST: "::"` |
| 449-450 | `"127.0.0.1:...3001"` then `"[::1]:...3001"` | Swap order |
| 497-498 | `"127.0.0.1:...8081"` then `"[::1]:...8081"` | Swap order |

Comments on port lines: add `# IPv6 (preferred)` and `# IPv4 fallback`.

**Step 2: Run structure test**

Run: `pnpm exec vitest run tests/docker/ipv6-first.test.ts -t "docker-compose.traefik.yml"`
Expected: Relevant tests PASS

**Step 3: Commit**

```bash
git add docker-compose.traefik.yml
git commit -m "[#1128] Flip docker-compose.traefik.yml to IPv6-first"
```

---

### Task 6: Flip docker-compose.full.yml to IPv6-first

**Files:**
- Modify: `docker-compose.full.yml`

**Step 1: Apply all changes**

Same pattern as traefik.yml, plus:

| Line | Current | New |
|------|---------|-----|
| 14-19 | Architecture diagram uses `127.0.0.1` | Change to `[::1]` |
| 63-64 | SERVICE_HOST comment + default | Same as traefik.yml |
| 181-182 | modsecurity ports | Swap order |
| 277-279 | seaweedfs ports | Swap order |
| 347 | API `HOST: 0.0.0.0` | `HOST: "::"` |
| 404-405 | api ports | Swap order |
| 446-447 | app ports | Swap order |
| 501 | `OPENCLAW_BIND: "0.0.0.0"` | `OPENCLAW_BIND: "::"` |
| 532-533 | gateway ports | Swap order |

**Step 2: Run structure test**

Run: `pnpm exec vitest run tests/docker/ipv6-first.test.ts -t "docker-compose.full.yml"`
Expected: PASS

**Step 3: Commit**

```bash
git add docker-compose.full.yml
git commit -m "[#1128] Flip docker-compose.full.yml to IPv6-first"
```

---

### Task 7: Add dual-bind to docker-compose.yml (basic)

**Files:**
- Modify: `docker-compose.yml`

**Step 1: Apply changes**

| Line | Current | New |
|------|---------|-----|
| 78 | `"127.0.0.1:${SEAWEEDFS_PORT:-8333}:8333"` | Split into `"[::1]:${SEAWEEDFS_PORT:-8333}:8333"` + `"127.0.0.1:${SEAWEEDFS_PORT:-8333}:8333"` |
| 150 | `HOST: 0.0.0.0` | `HOST: "::"` |
| 213 | `"${API_PORT:-3000}:3000"` | Split into `"[::1]:${API_PORT:-3000}:3000"` + `"127.0.0.1:${API_PORT:-3000}:3000"` |
| 253 | `"${FRONTEND_PORT:-8080}:8080"` | Split into `"[::1]:${FRONTEND_PORT:-8080}:8080"` + `"127.0.0.1:${FRONTEND_PORT:-8080}:8080"` |

**Step 2: Run structure test**

Run: `pnpm exec vitest run tests/docker/ipv6-first.test.ts -t "docker-compose.yml"`
Expected: PASS

**Step 3: Also run existing basic-compose tests to check nothing broke**

Run: `pnpm exec vitest run tests/docker/basic-compose.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "[#1128] Add IPv6-first dual-bind to docker-compose.yml"
```

---

### Task 8: Add dual-bind to docker-compose.quickstart.yml

**Files:**
- Modify: `docker-compose.quickstart.yml`

**Step 1: Apply changes**

| Line | Current | New |
|------|---------|-----|
| 123 | `HOST: 0.0.0.0` | `HOST: "::"` |
| 161 | `"${API_PORT:-3000}:3000"` | Split into `"[::1]:${API_PORT:-3000}:3000"` + `"127.0.0.1:${API_PORT:-3000}:3000"` |

**Step 2: Run structure test**

Run: `pnpm exec vitest run tests/docker/ipv6-first.test.ts -t "quickstart"`
Expected: PASS

**Step 3: Commit**

```bash
git add docker-compose.quickstart.yml
git commit -m "[#1128] Add IPv6-first dual-bind to docker-compose.quickstart.yml"
```

---

### Task 9: Add dual-bind to docker-compose.test.yml

**Files:**
- Modify: `docker-compose.test.yml`

**Step 1: Apply changes**

| Line | Current | New |
|------|---------|-----|
| 31 | `"5433:5432"` | `"[::1]:5433:5432"` + `"127.0.0.1:5433:5432"` |
| 74 | `"3001:3001"` | `"[::1]:3001:3001"` + `"127.0.0.1:3001:3001"` |

**Step 2: Run structure test**

Run: `pnpm exec vitest run tests/docker/ipv6-first.test.ts -t "test.yml"`
Expected: PASS

**Step 3: Commit**

```bash
git add docker-compose.test.yml
git commit -m "[#1128] Add IPv6-first dual-bind to docker-compose.test.yml"
```

---

### Task 10: Add dual-bind to devcontainer compose

**Files:**
- Modify: `.devcontainer/docker-compose.devcontainer.yml`

**Step 1: Apply changes**

| Line | Current | New |
|------|---------|-----|
| 90 | `"8333:8333"` | `"[::1]:8333:8333"` + `"127.0.0.1:8333:8333"` |
| 91 | `"9333:9333"` | `"[::1]:9333:9333"` + `"127.0.0.1:9333:9333"` |

**Step 2: Run devcontainer compose test**

Run: `pnpm exec vitest run tests/devcontainer/docker-compose.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add .devcontainer/docker-compose.devcontainer.yml
git commit -m "[#1128] Add IPv6-first dual-bind to devcontainer compose"
```

---

### Task 11: Update Traefik entrypoint and dynamic config template

**Files:**
- Modify: `docker/traefik/entrypoint.sh`
- Modify: `docker/traefik/dynamic-config.yml.template`

**Step 1: Update entrypoint.sh**

| Line | Current | New |
|------|---------|-----|
| 183-184 | Comment says "Set to [::1] for IPv6-only" | "Set to 127.0.0.1 for IPv4-only environments" |
| 185 | `export SERVICE_HOST="${SERVICE_HOST:-127.0.0.1}"` | `export SERVICE_HOST="${SERVICE_HOST:-[::1]}"` |

**Step 2: Update dynamic-config.yml.template**

| Line | Current | New |
|------|---------|-----|
| 9-12 | Architecture comments use `127.0.0.1` | Change to `[::1]` |
| 143 | `SERVICE_HOST controls the address (default: 127.0.0.1, set to [::1] for IPv6).` | `SERVICE_HOST controls the address (default: [::1], set to 127.0.0.1 for IPv4-only).` |

**Step 3: Run structure tests and sed test**

Run: `pnpm exec vitest run tests/docker/ipv6-first.test.ts tests/docker/traefik-entrypoint.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add docker/traefik/entrypoint.sh docker/traefik/dynamic-config.yml.template
git commit -m "[#1128] Update Traefik entrypoint and template to IPv6-first defaults"
```

---

### Task 12: Update SeaweedFS entrypoint

**Files:**
- Modify: `docker/seaweedfs/entrypoint.sh`

**Step 1: Apply change**

| Line | Current | New |
|------|---------|-----|
| 71 | `-ip.bind=0.0.0.0` | `-ip.bind=::` |

**Step 2: Run structure test**

Run: `pnpm exec vitest run tests/docker/ipv6-first.test.ts -t "SeaweedFS entrypoint"`
Expected: PASS

**Step 3: Commit**

```bash
git add docker/seaweedfs/entrypoint.sh
git commit -m "[#1128] Change SeaweedFS bind to :: for dual-stack"
```

---

### Task 13: Update override example and Traefik shell tests

**Files:**
- Modify: `docker/traefik/examples/docker-compose.override.example.yml`
- Modify: `docker/traefik/tests/test-entrypoint.sh`

**Step 1: Update override example**

| Line | Current | New |
|------|---------|-----|
| 50 | `"127.0.0.1:8888:80"` | `"[::1]:8888:80"` |
| 51 | `"[::1]:8888:80"` | `"127.0.0.1:8888:80"` |
| 66 | `http://${SERVICE_HOST:-127.0.0.1}:8888` | `http://${SERVICE_HOST:-[::1]}:8888` |
| 82 | `"127.0.0.1:3002:3000"` | `"[::1]:3002:3000"` |
| 83 | `"[::1]:3002:3000"` | `"127.0.0.1:3002:3000"` |
| 90 | `http://${SERVICE_HOST:-127.0.0.1}:3002` | `http://${SERVICE_HOST:-[::1]}:3002` |

**Step 2: Update test-entrypoint.sh**

| Line | Current | New |
|------|---------|-----|
| 233 | `grep -q "http://127.0.0.1:" "${config_file}"` | `grep -q 'http://\[::1\]:' "${config_file}"` |
| 234 | `pass "ModSecurity service is present with localhost URL"` | `pass "ModSecurity service is present with IPv6 localhost URL"` |
| 236 | `fail "ModSecurity service should be present with localhost URL"` | `fail "ModSecurity service should be present with IPv6 localhost URL"` |
| 627 | Comment referencing `defaults to 127.0.0.1` | `defaults to [::1]` |

**Step 3: Commit**

```bash
git add docker/traefik/examples/docker-compose.override.example.yml docker/traefik/tests/test-entrypoint.sh
git commit -m "[#1128] Update Traefik examples and shell tests for IPv6-first"
```

---

### Task 14: Update ops reference configs

**Files:**
- Modify: `ops/traefik/dynamic.yml`
- Modify: `ops/systemd/openclaw-projects.service`

**Step 1: Update ops/traefik/dynamic.yml**

| Line | Current | New |
|------|---------|-----|
| 26 | `url: "http://127.0.0.1:18789"` | `url: "http://[::1]:18789"` |
| 31 | `url: "http://127.0.0.1:3000"` | `url: "http://[::1]:3000"` |

**Step 2: Update ops/systemd/openclaw-projects.service**

| Line | Current | New |
|------|---------|-----|
| 15 | `Environment=HOST=127.0.0.1` | `Environment=HOST=::` |

**Step 3: Run structure test**

Run: `pnpm exec vitest run tests/docker/ipv6-first.test.ts -t "ops"`
Expected: PASS

**Step 4: Commit**

```bash
git add ops/traefik/dynamic.yml ops/systemd/openclaw-projects.service
git commit -m "[#1128] Update ops reference configs to IPv6-first"
```

---

### Task 15: Update .env.example documentation

**Files:**
- Modify: `.env.example`

**Step 1: Apply changes**

| Line | Current | New |
|------|---------|-----|
| 301 | `Each port is published on both 127.0.0.1 (IPv4) and [::1] (IPv6).` | `Each port is published on both [::1] (IPv6, preferred) and 127.0.0.1 (IPv4 fallback).` |
| 303-304 | `Address Traefik uses to reach backend services (default: 127.0.0.1)` + `Set to [::1] for IPv6-only hosts` | `Address Traefik uses to reach backend services (default: [::1])` + `Set to 127.0.0.1 for IPv4-only hosts` |
| 305 | `# SERVICE_HOST=127.0.0.1` | `# SERVICE_HOST=[::1]` |
| 447-448 | `Host binding for API server (default: 0.0.0.0)` + `# HOST=0.0.0.0` | `Host binding for API server (default: ::, dual-stack)` + `# HOST=::` |

**Step 2: Run structure test**

Run: `pnpm exec vitest run tests/docker/ipv6-first.test.ts -t "env.example"`
Expected: PASS

**Step 3: Commit**

```bash
git add .env.example
git commit -m "[#1128] Update .env.example for IPv6-first defaults"
```

---

### Task 16: Update docs/deployment.md

**Files:**
- Modify: `docs/deployment.md`

**Step 1: Apply changes**

| Line | Current | New |
|------|---------|-----|
| 46 | `localhost (127.0.0.1 / [::1])` | `localhost ([::1] / 127.0.0.1)` |
| 131 | `dual-stack localhost (\`127.0.0.1\` + \`[::1]\`)` | `dual-stack localhost (\`[::1]\` + \`127.0.0.1\`)` |
| 140 | `default: \`127.0.0.1\`). Set to \`[::1]\` for IPv6-only hosts.` | `default: \`[::1]\`). Set to \`127.0.0.1\` for IPv4-only hosts.` |
| 489 | `\`127.0.0.1\` \| Address Traefik uses...` | `\`[::1]\` \| Address Traefik uses to reach backends (set to \`127.0.0.1\` for IPv4-only)` |
| 718-719 | `"127.0.0.1:8888:80"` then `"[::1]:8888:80"` | Swap order |
| 727 | `http://${SERVICE_HOST:-127.0.0.1}:8888` | `http://${SERVICE_HOST:-[::1]}:8888` |
| 766 | `url: "http://127.0.0.1:9090"` | `url: "http://[::1]:9090"` |
| 1257-1260 | `curl -s http://127.0.0.1:PORT` (4 lines) | `curl -s 'http://[::1]:PORT'` |
| 1265-1266 | `# If using IPv6 SERVICE_HOST=[::1]...` + `curl -s http://[::1]:3001/health` | `# If using IPv4 SERVICE_HOST=127.0.0.1...` + `curl -s 'http://127.0.0.1:3001/health'` |

**Step 2: Commit**

```bash
git add docs/deployment.md
git commit -m "[#1128] Update deployment docs for IPv6-first defaults"
```

---

### Task 17: Update existing seaweedfs-compose test

**Files:**
- Modify: `tests/docker/seaweedfs-compose.test.ts`

**Step 1: Update assertion at line 78-84**

Replace:

```ts
    it('maps port 8333 to localhost only for security', () => {
      const ports = compose.services.seaweedfs.ports || [];
      const s3Port = ports.find((p: string) => p.includes('8333'));
      expect(s3Port).toBeDefined();
      // Basic compose should bind to localhost only
      expect(s3Port).toContain('127.0.0.1');
    });
```

With:

```ts
    it('maps port 8333 with IPv6-first dual-stack localhost bindings', () => {
      const ports = compose.services.seaweedfs.ports || [];
      const s3Ports = ports.filter((p: string) => p.includes('8333'));
      expect(s3Ports.length).toBeGreaterThanOrEqual(1);
      // First binding should be IPv6
      expect(s3Ports[0]).toContain('[::1]');
      // Should also have IPv4 fallback
      const hasIPv4 = s3Ports.some((p: string) => p.includes('127.0.0.1'));
      expect(hasIPv4).toBe(true);
    });
```

**Step 2: Run test**

Run: `pnpm exec vitest run tests/docker/seaweedfs-compose.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/docker/seaweedfs-compose.test.ts
git commit -m "[#1128] Update seaweedfs compose test for IPv6-first port order"
```

---

### Task 18: Run full test suite and verify

**Step 1: Run all IPv6-related tests**

Run: `pnpm exec vitest run tests/docker/ipv6-first.test.ts tests/docker/traefik-entrypoint.test.ts tests/api/dual-stack-binding.test.ts tests/docker/seaweedfs-compose.test.ts`
Expected: All PASS

**Step 2: Run the existing compose/docker tests to check for regressions**

Run: `pnpm exec vitest run tests/docker/ tests/devcontainer/`
Expected: All PASS

**Step 3: Run the Traefik shell test suite**

Run: `bash docker/traefik/tests/test-entrypoint.sh`
Expected: All tests PASS

**Step 4: Run the full unit test suite**

Run: `pnpm test`
Expected: All PASS

**Step 5: Run SeaweedFS container test (slower, Docker required)**

Run: `pnpm exec vitest run tests/docker/seaweedfs-ipv6.test.ts --test-timeout=60000`
Expected: All PASS

**Step 6: Run lint**

Run: `pnpm run lint`
Expected: PASS

---

### Task 19: Push and open PR

**Step 1: Push branch**

```bash
git push -u origin issue/1128-ipv6-first
```

**Step 2: Open PR**

```bash
gh pr create --title "[#1128] Default to IPv6-first for all service bindings" --body "$(cat <<'PREOF'
## Summary

- Flip all port binding order: `[::1]` first, `127.0.0.1` fallback
- `SERVICE_HOST` defaults to `[::1]` (was `127.0.0.1`)
- API/Gateway bind on `::` (dual-stack, was `0.0.0.0`)
- SeaweedFS binds on `::` (was `0.0.0.0`)
- Add dual-bind to basic, quickstart, test, and devcontainer compose files
- Update all docs, examples, ops configs, and shell tests

Closes #1128

## Related Issues

- #1129 — SSRF filter gap with `[::]` (separate fix)
- #1130 — Twilio localhost check missing `[::1]` (separate fix)

## Test plan

- [ ] New `tests/docker/ipv6-first.test.ts` — compose structure assertions (15 tests)
- [ ] New `tests/docker/traefik-entrypoint.test.ts` — sed substitution with `[::1]` (6 tests)
- [ ] New `tests/api/dual-stack-binding.test.ts` — Fastify `::` accepts IPv4+IPv6
- [ ] New `tests/docker/seaweedfs-ipv6.test.ts` — container dual-stack via docker exec
- [ ] Updated `tests/docker/seaweedfs-compose.test.ts` — IPv6-first port order
- [ ] Updated `docker/traefik/tests/test-entrypoint.sh` — default output assertions
- [ ] `pnpm test` passes
- [ ] `pnpm run lint` passes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
PREOF
)"
```

---

## Dependency Order

Tasks 1-4 (tests) can be done in parallel. Tasks 5-17 (config changes) should be done sequentially to keep commits atomic. Task 18 (verification) depends on all prior tasks. Task 19 (PR) depends on 18.

```
[1] Tests: ipv6-first.test.ts ─────┐
[2] Tests: traefik-entrypoint.test.ts ─┤
[3] Tests: dual-stack-binding.test.ts ─┤
[4] Tests: seaweedfs-ipv6.test.ts ─────┤
                                       ├─▶ [5-17] Config changes (sequential) ─▶ [18] Verify ─▶ [19] PR
```
