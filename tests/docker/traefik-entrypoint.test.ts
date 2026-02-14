import { describe, it, expect } from 'vitest';
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
