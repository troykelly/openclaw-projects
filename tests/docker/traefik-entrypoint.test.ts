import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { execFileSync } from 'child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'fs';
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

describe('Traefik dynamic config: api-redirect-router', () => {
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

  function getParsedConfig(env = defaultEnv) {
    const output = runSedSubstitution(env);
    return parseYaml(output) as {
      http: {
        routers: Record<string, { rule: string; service: string; priority?: number; middlewares?: string[] }>;
        middlewares: Record<string, { redirectRegex?: { regex: string; replacement: string; permanent: boolean } }>;
      };
    };
  }

  it('does NOT have the old api-path-router', () => {
    const config = getParsedConfig();
    expect(config.http.routers).not.toHaveProperty('api-path-router');
  });

  it('has api-redirect-router with priority 100', () => {
    const config = getParsedConfig();
    const router = config.http.routers['api-redirect-router'];
    expect(router).toBeDefined();
    expect(router.priority).toBe(100);
  });

  it('api-redirect-router matches DOMAIN and www.DOMAIN with /api prefix', () => {
    const config = getParsedConfig();
    const router = config.http.routers['api-redirect-router'];
    expect(router.rule).toContain('Host(`test.example.com`)');
    expect(router.rule).toContain('Host(`www.test.example.com`)');
    expect(router.rule).toContain('PathPrefix(`/api`)');
  });

  it('api-redirect-router uses api-redirect middleware', () => {
    const config = getParsedConfig();
    const router = config.http.routers['api-redirect-router'];
    expect(router.middlewares).toContain('api-redirect');
  });

  it('has api-redirect middleware with redirectRegex', () => {
    const config = getParsedConfig();
    const mw = config.http.middlewares['api-redirect'];
    expect(mw).toBeDefined();
    expect(mw.redirectRegex).toBeDefined();
  });

  it('api-redirect middleware uses non-permanent redirect (302/307)', () => {
    const config = getParsedConfig();
    const mw = config.http.middlewares['api-redirect'];
    // Traefik uses 302 for GET, 307 for non-GET when permanent=false
    expect(mw.redirectRegex!.permanent).toBe(false);
  });

  it('api-redirect regex captures domain and path correctly', () => {
    const config = getParsedConfig();
    const { regex, replacement } = config.http.middlewares['api-redirect'].redirectRegex!;

    // The regex should match URLs like https://test.example.com/api/foo
    const re = new RegExp(regex);
    const match = re.exec('https://test.example.com/api/work-items');
    expect(match).not.toBeNull();
    expect(match![1]).toBe('test.example.com');
    expect(match![2]).toBe('/work-items');

    // Traefik uses Go regex ${N} syntax for capture groups; convert to JS $N for testing
    const jsReplacement = replacement.replace(/\$\{(\d+)\}/g, '$$$1');
    const redirectUrl = 'https://test.example.com/api/work-items'.replace(re, jsReplacement);
    expect(redirectUrl).toBe('https://api.test.example.com/work-items');
  });

  it('api-redirect regex handles www prefix', () => {
    const config = getParsedConfig();
    const { regex, replacement } = config.http.middlewares['api-redirect'].redirectRegex!;

    const re = new RegExp(regex);
    const match = re.exec('https://www.test.example.com/api/auth/login');
    expect(match).not.toBeNull();
    // www. is consumed by the non-capturing group, so $1 is the base domain
    expect(match![1]).toBe('test.example.com');
    expect(match![2]).toBe('/auth/login');

    // Traefik uses Go regex ${N} syntax for capture groups; convert to JS $N for testing
    const jsReplacement = replacement.replace(/\$\{(\d+)\}/g, '$$$1');
    const redirectUrl = 'https://www.test.example.com/api/auth/login'.replace(re, jsReplacement);
    expect(redirectUrl).toBe('https://api.test.example.com/auth/login');
  });

  it('api-redirect regex handles bare /api path without trailing slash', () => {
    const config = getParsedConfig();
    const { regex, replacement } = config.http.middlewares['api-redirect'].redirectRegex!;

    const re = new RegExp(regex);
    const match = re.exec('https://test.example.com/api');
    expect(match).not.toBeNull();
    expect(match![1]).toBe('test.example.com');
    // /api is consumed by the literal in the regex; group 2 (/.*) is optional and empty
    expect(match![2]).toBeUndefined();

    const jsReplacement = replacement.replace(/\$\{(\d+)\}/g, '$$$1');
    const redirectUrl = 'https://test.example.com/api'.replace(re, jsReplacement);
    expect(redirectUrl).toBe('https://api.test.example.com');
  });

  it('preserves root-redirect-router and app-router', () => {
    const config = getParsedConfig();
    expect(config.http.routers).toHaveProperty('root-redirect-router');
    expect(config.http.routers).toHaveProperty('app-router');
    expect(config.http.routers).toHaveProperty('api-router');
  });
});

describe('Traefik dynamic config: api-ws-router (Issue #2069)', () => {
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

  function getParsedConfig(env = defaultEnv) {
    const output = runSedSubstitution(env);
    return parseYaml(output) as {
      http: {
        routers: Record<string, { rule: string; service: string; priority?: number; middlewares?: string[] }>;
      };
    };
  }

  it('has api-ws-router that bypasses ModSecurity', () => {
    const config = getParsedConfig();
    const router = config.http.routers['api-ws-router'];
    expect(router).toBeDefined();
    expect(router.service).toBe('api-service');
  });

  it('api-ws-router has higher priority than api-router', () => {
    const config = getParsedConfig();
    const wsRouter = config.http.routers['api-ws-router'];
    expect(wsRouter.priority).toBe(110);
    // api-router has no explicit priority (defaults to rule length),
    // but 110 > any auto-calculated priority for a simple Host() rule
  });

  it('api-ws-router matches terminal attach WebSocket path on api subdomain', () => {
    const config = getParsedConfig();
    const router = config.http.routers['api-ws-router'];
    expect(router.rule).toContain('Host(`api.test.example.com`)');
    expect(router.rule).toContain('PathRegexp');
    expect(router.rule).toContain('/terminal/sessions/');
    expect(router.rule).toContain('/attach');
  });

  it('api-ws-router requires Upgrade: websocket header (HeaderRegexp)', () => {
    const config = getParsedConfig();
    const router = config.http.routers['api-ws-router'];
    expect(router.rule).toContain('HeaderRegexp(`Upgrade`');
    expect(router.rule).toMatch(/websocket/i);
  });

  it('api-ws-router PathRegexp enforces UUID format for session ID', () => {
    const config = getParsedConfig();
    const router = config.http.routers['api-ws-router'];
    // Extract the PathRegexp value from the rule
    const pathRegexpMatch = router.rule.match(/PathRegexp\(`([^`]+)`\)/);
    expect(pathRegexpMatch).not.toBeNull();
    const regex = new RegExp(pathRegexpMatch![1]);

    // Valid UUID path — should match
    expect(regex.test('/terminal/sessions/7996e974-6396-4f1e-bac8-c191dd23341e/attach')).toBe(true);

    // Non-UUID session ID — should NOT match
    expect(regex.test('/terminal/sessions/not-a-uuid/attach')).toBe(false);
    expect(regex.test('/terminal/sessions/../../etc/passwd/attach')).toBe(false);

    // Trailing suffix after attach — should NOT match
    expect(regex.test('/terminal/sessions/7996e974-6396-4f1e-bac8-c191dd23341e/attach/extra')).toBe(false);

    // Prefix before /terminal — should NOT match
    expect(regex.test('/api/terminal/sessions/7996e974-6396-4f1e-bac8-c191dd23341e/attach')).toBe(false);
  });

  it('api-ws-router has security-headers and rate-limit middlewares', () => {
    const config = getParsedConfig();
    const router = config.http.routers['api-ws-router'];
    expect(router.middlewares).toContain('security-headers');
    expect(router.middlewares).toContain('rate-limit');
  });

  it('api-ws-router does NOT use api-cors middleware (CORS not applicable to WebSocket)', () => {
    const config = getParsedConfig();
    const router = config.http.routers['api-ws-router'];
    expect(router.middlewares).not.toContain('api-cors');
  });

  it('api-router still routes through modsecurity-service for normal API traffic', () => {
    const config = getParsedConfig();
    const router = config.http.routers['api-router'];
    expect(router.service).toBe('modsecurity-service');
  });
});

describe('Traefik dynamic config: api-webhook-router (Issue #2167)', () => {
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

  function getParsedConfig(env = defaultEnv) {
    const output = runSedSubstitution(env);
    return parseYaml(output) as {
      http: {
        routers: Record<string, { rule: string; service: string; priority?: number; middlewares?: string[] }>;
        middlewares: Record<string, unknown>;
      };
    };
  }

  // Per-provider webhook routers (Issue #2170 — split from single api-webhook-router)
  const webhookRouters = [
    { name: 'api-webhook-cloudflare-router', path: '/cloudflare/email', ipMiddleware: 'webhook-cloudflare-ipallowlist' },
    { name: 'api-webhook-postmark-router', path: '/postmark/inbound', ipMiddleware: 'webhook-postmark-ipallowlist' },
    { name: 'api-webhook-twilio-router', path: '/twilio/sms', ipMiddleware: 'webhook-twilio-ipallowlist' },
  ];

  it.each(webhookRouters)('$name bypasses ModSecurity and routes to api-service', ({ name }) => {
    const config = getParsedConfig();
    const router = config.http.routers[name];
    expect(router).toBeDefined();
    expect(router.service).toBe('api-service');
  });

  it.each(webhookRouters)('$name has priority 105', ({ name }) => {
    const config = getParsedConfig();
    const router = config.http.routers[name];
    expect(router.priority).toBe(105);
  });

  it.each(webhookRouters)('$name matches its webhook path with exact Path() and POST only', ({ name, path }) => {
    const config = getParsedConfig();
    const router = config.http.routers[name];
    expect(router.rule).toContain('Host(`api.test.example.com`)');
    expect(router.rule).toContain(`Path(\`${path}\`)`);
    expect(router.rule).toContain('Method(`POST`)');
    expect(router.rule).not.toContain('PathPrefix');
  });

  it.each(webhookRouters)('$name has security-headers, rate-limit, and ipAllowList middlewares', ({ name, ipMiddleware }) => {
    const config = getParsedConfig();
    const router = config.http.routers[name];
    expect(router.middlewares).toContain('security-headers');
    expect(router.middlewares).toContain('rate-limit');
    expect(router.middlewares).toContain(ipMiddleware);
    expect(router.middlewares).not.toContain('api-cors');
  });

  it('api-router still handles non-webhook API traffic through ModSecurity', () => {
    const config = getParsedConfig();
    const apiRouter = config.http.routers['api-router'];
    expect(apiRouter.service).toBe('modsecurity-service');
  });

  it('webhook routers do NOT match status callback endpoints', () => {
    const config = getParsedConfig();
    for (const { name } of webhookRouters) {
      const router = config.http.routers[name];
      expect(router.rule).not.toContain('/twilio/sms/status');
      expect(router.rule).not.toContain('/postmark/email/status');
    }
  });

  it('ipAllowList middlewares are defined for all providers', () => {
    const config = getParsedConfig() as { http: { middlewares: Record<string, unknown>; routers: Record<string, unknown> } };
    expect(config.http.middlewares['webhook-cloudflare-ipallowlist']).toBeDefined();
    expect(config.http.middlewares['webhook-postmark-ipallowlist']).toBeDefined();
    expect(config.http.middlewares['webhook-twilio-ipallowlist']).toBeDefined();
  });
});

describe('Traefik entrypoint: copy_custom_configs (Issue #2338)', () => {
  const ENTRYPOINT = resolve(ROOT_DIR, 'docker/traefik/entrypoint.sh');
  const TEMPLATE = resolve(ROOT_DIR, 'docker/traefik/dynamic-config.yml.template');

  function runEntrypointWithCustomSource(opts: {
    sourceFiles?: Record<string, string>;
    sourceExists?: boolean;
  }): { exitCode: number; customDir: string; stdout: string } {
    const testTmpDir = mkdtempSync(join(tmpdir(), 'traefik-custom-test-'));
    const testDir = join(testTmpDir, 'etc/traefik');

    // Create required directories
    const systemDir = join(testDir, 'dynamic/system');
    const customDir = join(testDir, 'dynamic/custom');
    const acmeDir = join(testDir, 'acme');
    const templateDir = join(testDir, 'templates');

    execFileSync('mkdir', ['-p', systemDir, customDir, acmeDir, templateDir]);

    // Copy template
    execFileSync('cp', [TEMPLATE, join(templateDir, 'dynamic-config.yml.template')]);

    // Create test entrypoint with patched paths
    const testEntrypoint = join(testTmpDir, 'entrypoint-test.sh');
    let script = readFileSync(ENTRYPOINT, 'utf-8');
    script = script.replace(/exec traefik/, 'echo "Would exec traefik"');
    script = script.replace(/\/etc\/traefik/g, testDir);
    writeFileSync(testEntrypoint, script, { mode: 0o755 });

    // Set up custom source
    let customSourceDir = join(testTmpDir, 'custom-source');
    if (opts.sourceExists !== false) {
      execFileSync('mkdir', ['-p', customSourceDir]);
      if (opts.sourceFiles) {
        for (const [name, content] of Object.entries(opts.sourceFiles)) {
          writeFileSync(join(customSourceDir, name), content);
        }
      }
    } else {
      customSourceDir = join(testTmpDir, 'nonexistent-source');
    }

    let stdout = '';
    let exitCode = 0;
    try {
      stdout = execFileSync('/bin/sh', [testEntrypoint], {
        encoding: 'utf-8',
        timeout: 10_000,
        env: {
          ...process.env,
          DOMAIN: 'example.com',
          ACME_EMAIL: 'test@example.com',
          CUSTOM_CONFIG_SOURCE_DIR: customSourceDir,
        },
      });
    } catch (err: unknown) {
      exitCode = (err as { status?: number }).status ?? 1;
    }

    return { exitCode, customDir, stdout };
  }

  it('copies .yml files from source dir to dynamic/custom', () => {
    const { exitCode, customDir } = runEntrypointWithCustomSource({
      sourceFiles: {
        'abs-proxy.yml': 'http: {}',
        'moltbot-gateway.yml': 'http: {}',
        'voice-call.yml': 'http: {}',
      },
    });

    expect(exitCode).toBe(0);
    expect(readFileSync(join(customDir, 'abs-proxy.yml'), 'utf-8')).toBe('http: {}');
    expect(readFileSync(join(customDir, 'moltbot-gateway.yml'), 'utf-8')).toBe('http: {}');
    expect(readFileSync(join(customDir, 'voice-call.yml'), 'utf-8')).toBe('http: {}');
  });

  it('does not fail when source dir is absent', () => {
    const { exitCode } = runEntrypointWithCustomSource({
      sourceExists: false,
    });

    expect(exitCode).toBe(0);
  });

  it('does not copy non-.yml files', () => {
    const { exitCode, customDir } = runEntrypointWithCustomSource({
      sourceFiles: {
        'valid-route.yml': 'http: {}',
        'readme.txt': 'not a config',
        'notes.md': 'some notes',
      },
    });

    expect(exitCode).toBe(0);
    expect(readFileSync(join(customDir, 'valid-route.yml'), 'utf-8')).toBe('http: {}');

    // Non-.yml files should not exist
    expect(() => readFileSync(join(customDir, 'readme.txt'))).toThrow();
    expect(() => readFileSync(join(customDir, 'notes.md'))).toThrow();
  });

  it('logs copied file names', () => {
    const { stdout } = runEntrypointWithCustomSource({
      sourceFiles: {
        'abs-proxy.yml': 'http: {}',
      },
    });

    expect(stdout).toContain('abs-proxy.yml');
  });

  it('logs message when no custom configs found', () => {
    const { stdout } = runEntrypointWithCustomSource({
      sourceFiles: {},
    });

    expect(stdout.toLowerCase()).toMatch(/no custom config/);
  });
});

describe('Traefik dynamic config: api-cors namespace headers (Issue #2369)', () => {
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

  function getParsedConfig(env = defaultEnv) {
    const output = runSedSubstitution(env);
    return parseYaml(output) as {
      http: {
        middlewares: Record<string, { headers?: { accessControlAllowHeaders?: string[] } }>;
        routers: Record<string, unknown>;
      };
    };
  }

  it('api-cors middleware includes X-Namespace and X-Namespaces in accessControlAllowHeaders', () => {
    const config = getParsedConfig();
    const apiCors = config.http.middlewares['api-cors'];
    expect(apiCors).toBeDefined();
    const allowedHeaders = apiCors.headers?.accessControlAllowHeaders;
    expect(allowedHeaders).toBeDefined();
    expect(allowedHeaders).toContain('X-Namespace');
    expect(allowedHeaders).toContain('X-Namespaces');
  });
});

describe('ModSecurity ALLOWED_METHODS in compose files (Issue #1917)', () => {
  const COMPOSE_FILES = ['docker-compose.traefik.yml', 'docker-compose.full.yml'];

  interface ComposeService {
    environment?: Record<string, string>;
    [key: string]: unknown;
  }

  interface ComposeFile {
    services: Record<string, ComposeService>;
  }

  function loadCompose(filename: string): ComposeFile {
    const content = readFileSync(resolve(ROOT_DIR, filename), 'utf-8');
    return parseYaml(content) as ComposeFile;
  }

  it.each(COMPOSE_FILES)('%s modsecurity service has ALLOWED_METHODS env var', (filename) => {
    const compose = loadCompose(filename);
    const modsec = compose.services.modsecurity;
    expect(modsec).toBeDefined();
    const env = modsec.environment;
    expect(env).toBeDefined();
    expect(env!.ALLOWED_METHODS).toBeDefined();
  });

  it.each(COMPOSE_FILES)('%s ALLOWED_METHODS includes PUT, PATCH, and DELETE', (filename) => {
    const compose = loadCompose(filename);
    const methods = compose.services.modsecurity.environment!.ALLOWED_METHODS;
    for (const method of ['GET', 'HEAD', 'POST', 'OPTIONS', 'PUT', 'PATCH', 'DELETE']) {
      expect(methods).toContain(method);
    }
  });
});
