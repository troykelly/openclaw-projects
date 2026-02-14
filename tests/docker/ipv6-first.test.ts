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

describe('Dockerfile HOST is :: (dual-stack)', () => {
  it('docker/api/Dockerfile sets HOST=::', () => {
    const content = readFileSync(resolve(ROOT_DIR, 'docker/api/Dockerfile'), 'utf-8');
    expect(content).toContain('ENV HOST=::');
    expect(content).not.toContain('ENV HOST=0.0.0.0');
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
