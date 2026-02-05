import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parse } from 'yaml';

const ROOT_DIR = resolve(__dirname, '../..');
const COMPOSE_PATH = resolve(ROOT_DIR, 'docker-compose.yml');
const ENV_EXAMPLE_PATH = resolve(ROOT_DIR, '.env.example');

interface HealthCheck {
  test: string[];
  interval?: string;
  timeout?: string;
  retries?: number;
  start_period?: string;
}

interface ResourceLimits {
  cpus?: string;
  memory?: string;
}

interface Resources {
  limits?: ResourceLimits;
  reservations?: ResourceLimits;
}

interface Deploy {
  resources?: Resources;
}

interface ComposeService {
  image?: string;
  build?: {
    context?: string;
    dockerfile?: string;
  };
  command?: string | string[];
  environment?: Record<string, string> | string[];
  ports?: string[];
  volumes?: string[];
  tmpfs?: string | string[];
  healthcheck?: HealthCheck;
  depends_on?: Record<string, { condition: string }> | string[];
  security_opt?: string[];
  cap_drop?: string[];
  cap_add?: string[];
  read_only?: boolean;
  restart?: string;
  deploy?: Deploy;
}

interface ComposeVolumes {
  [key: string]: object | null;
}

interface ComposeFile {
  name?: string;
  services: Record<string, ComposeService>;
  volumes?: ComposeVolumes;
}

describe('Basic docker-compose.yml structure', () => {
  let compose: ComposeFile;

  beforeAll(() => {
    const content = readFileSync(COMPOSE_PATH, 'utf-8');
    compose = parse(content) as ComposeFile;
  });

  describe('required services', () => {
    it('has db service', () => {
      expect(compose.services.db).toBeDefined();
    });

    it('has api service', () => {
      expect(compose.services.api).toBeDefined();
    });

    it('has app service', () => {
      expect(compose.services.app).toBeDefined();
    });

    it('has seaweedfs service', () => {
      expect(compose.services.seaweedfs).toBeDefined();
    });

    it('has migrate service', () => {
      expect(compose.services.migrate).toBeDefined();
    });
  });

  describe('published images', () => {
    it('db uses ghcr.io/troykelly/openclaw-projects-db', () => {
      expect(compose.services.db.image).toMatch(/^ghcr\.io\/troykelly\/openclaw-projects-db/);
    });

    it('api uses ghcr.io/troykelly/openclaw-projects-api', () => {
      expect(compose.services.api.image).toMatch(/^ghcr\.io\/troykelly\/openclaw-projects-api/);
    });

    it('app uses ghcr.io/troykelly/openclaw-projects-app', () => {
      expect(compose.services.app.image).toMatch(/^ghcr\.io\/troykelly\/openclaw-projects-app/);
    });

    it('migrate uses ghcr.io/troykelly/openclaw-projects-migrate', () => {
      expect(compose.services.migrate.image).toMatch(/^ghcr\.io\/troykelly\/openclaw-projects-migrate/);
    });

    it('seaweedfs uses chrislusf/seaweedfs', () => {
      expect(compose.services.seaweedfs.image).toMatch(/^chrislusf\/seaweedfs/);
    });
  });

  describe('volumes', () => {
    it('defines db_data volume', () => {
      expect(compose.volumes).toBeDefined();
      expect(compose.volumes?.db_data).toBeDefined();
    });

    it('defines seaweedfs_data volume', () => {
      expect(compose.volumes?.seaweedfs_data).toBeDefined();
    });

    it('db mounts db_data', () => {
      const volumes = compose.services.db.volumes || [];
      const hasDbData = volumes.some((v: string) => v.includes('db_data'));
      expect(hasDbData).toBe(true);
    });

    it('seaweedfs mounts seaweedfs_data', () => {
      const volumes = compose.services.seaweedfs.volumes || [];
      const hasSeaweedfsData = volumes.some((v: string) => v.includes('seaweedfs_data'));
      expect(hasSeaweedfsData).toBe(true);
    });
  });
});

describe('db service', () => {
  let compose: ComposeFile;

  beforeAll(() => {
    const content = readFileSync(COMPOSE_PATH, 'utf-8');
    compose = parse(content) as ComposeFile;
  });

  it('has healthcheck', () => {
    expect(compose.services.db.healthcheck).toBeDefined();
    expect(compose.services.db.healthcheck?.test).toBeDefined();
  });

  it('has security_opt no-new-privileges', () => {
    expect(compose.services.db.security_opt).toContain('no-new-privileges:true');
  });

  it('does not have cap_drop (PostgreSQL needs capabilities for initialization)', () => {
    // PostgreSQL requires more capabilities than other services for initialization
    // (directory permissions, initdb, user switching with gosu)
    expect(compose.services.db.cap_drop).toBeUndefined();
  });

  it('has resource limits', () => {
    expect(compose.services.db.deploy?.resources?.limits).toBeDefined();
  });

  it('has restart policy', () => {
    expect(compose.services.db.restart).toBe('unless-stopped');
  });

  it('has environment variables with defaults', () => {
    const env = compose.services.db.environment;
    expect(env).toBeDefined();
  });
});

describe('api service', () => {
  let compose: ComposeFile;

  beforeAll(() => {
    const content = readFileSync(COMPOSE_PATH, 'utf-8');
    compose = parse(content) as ComposeFile;
  });

  it('has read_only: true', () => {
    expect(compose.services.api.read_only).toBe(true);
  });

  it('has tmpfs for /tmp', () => {
    const tmpfs = compose.services.api.tmpfs;
    const tmpfsArr = Array.isArray(tmpfs) ? tmpfs : [tmpfs];
    const hasTmp = tmpfsArr.some((t) => t?.includes('/tmp'));
    expect(hasTmp).toBe(true);
  });

  it('has security_opt no-new-privileges', () => {
    expect(compose.services.api.security_opt).toContain('no-new-privileges:true');
  });

  it('has cap_drop ALL', () => {
    expect(compose.services.api.cap_drop).toContain('ALL');
  });

  it('has healthcheck', () => {
    expect(compose.services.api.healthcheck).toBeDefined();
    expect(compose.services.api.healthcheck?.test).toBeDefined();
  });

  it('has resource limits', () => {
    expect(compose.services.api.deploy?.resources?.limits).toBeDefined();
  });

  it('depends_on db with service_healthy condition', () => {
    const deps = compose.services.api.depends_on;
    expect(deps).toBeDefined();
    if (typeof deps === 'object' && !Array.isArray(deps)) {
      expect(deps.db).toBeDefined();
      expect(deps.db.condition).toBe('service_healthy');
    }
  });

  it('depends_on seaweedfs with service_healthy condition', () => {
    const deps = compose.services.api.depends_on;
    if (typeof deps === 'object' && !Array.isArray(deps)) {
      expect(deps.seaweedfs).toBeDefined();
      expect(deps.seaweedfs.condition).toBe('service_healthy');
    }
  });

  it('has S3 environment variables configured for seaweedfs', () => {
    const env = compose.services.api.environment;
    if (typeof env === 'object' && !Array.isArray(env)) {
      expect(env.S3_ENDPOINT).toContain('seaweedfs');
      expect(env.S3_FORCE_PATH_STYLE).toBe('true');
    }
  });

  it('has restart policy', () => {
    expect(compose.services.api.restart).toBe('unless-stopped');
  });
});

describe('app service', () => {
  let compose: ComposeFile;

  beforeAll(() => {
    const content = readFileSync(COMPOSE_PATH, 'utf-8');
    compose = parse(content) as ComposeFile;
  });

  it('has read_only: true', () => {
    expect(compose.services.app.read_only).toBe(true);
  });

  it('has tmpfs for /tmp', () => {
    const tmpfs = compose.services.app.tmpfs;
    const tmpfsArr = Array.isArray(tmpfs) ? tmpfs : [tmpfs];
    const hasTmp = tmpfsArr.some((t) => t?.includes('/tmp'));
    expect(hasTmp).toBe(true);
  });

  it('has security_opt no-new-privileges', () => {
    expect(compose.services.app.security_opt).toContain('no-new-privileges:true');
  });

  it('has cap_drop ALL', () => {
    expect(compose.services.app.cap_drop).toContain('ALL');
  });

  it('has healthcheck', () => {
    expect(compose.services.app.healthcheck).toBeDefined();
    expect(compose.services.app.healthcheck?.test).toBeDefined();
  });

  it('has resource limits', () => {
    expect(compose.services.app.deploy?.resources?.limits).toBeDefined();
  });

  it('depends_on api with service_healthy condition', () => {
    const deps = compose.services.app.depends_on;
    expect(deps).toBeDefined();
    if (typeof deps === 'object' && !Array.isArray(deps)) {
      expect(deps.api).toBeDefined();
      expect(deps.api.condition).toBe('service_healthy');
    }
  });

  it('has restart policy', () => {
    expect(compose.services.app.restart).toBe('unless-stopped');
  });
});

describe('seaweedfs service', () => {
  let compose: ComposeFile;

  beforeAll(() => {
    const content = readFileSync(COMPOSE_PATH, 'utf-8');
    compose = parse(content) as ComposeFile;
  });

  it('uses custom entrypoint for S3 gateway with authentication', () => {
    const entrypoint = compose.services.seaweedfs.entrypoint;
    const entrypointStr = Array.isArray(entrypoint) ? entrypoint.join(' ') : entrypoint;
    expect(entrypointStr).toContain('/docker-entrypoint-s3.sh');
  });

  it('has security_opt no-new-privileges', () => {
    expect(compose.services.seaweedfs.security_opt).toContain('no-new-privileges:true');
  });

  it('has cap_drop ALL', () => {
    expect(compose.services.seaweedfs.cap_drop).toContain('ALL');
  });

  it('has healthcheck', () => {
    expect(compose.services.seaweedfs.healthcheck).toBeDefined();
    expect(compose.services.seaweedfs.healthcheck?.test).toBeDefined();
  });

  it('has resource limits', () => {
    expect(compose.services.seaweedfs.deploy?.resources?.limits).toBeDefined();
  });

  it('has restart policy', () => {
    expect(compose.services.seaweedfs.restart).toBe('unless-stopped');
  });
});

describe('migrate service', () => {
  let compose: ComposeFile;

  beforeAll(() => {
    const content = readFileSync(COMPOSE_PATH, 'utf-8');
    compose = parse(content) as ComposeFile;
  });

  it('has read_only: true', () => {
    expect(compose.services.migrate.read_only).toBe(true);
  });

  it('has security_opt no-new-privileges', () => {
    expect(compose.services.migrate.security_opt).toContain('no-new-privileges:true');
  });

  it('has cap_drop ALL', () => {
    expect(compose.services.migrate.cap_drop).toContain('ALL');
  });

  it('has restart: no (run once)', () => {
    expect(compose.services.migrate.restart).toBe('no');
  });

  it('depends_on db with service_healthy condition', () => {
    const deps = compose.services.migrate.depends_on;
    expect(deps).toBeDefined();
    if (typeof deps === 'object' && !Array.isArray(deps)) {
      expect(deps.db).toBeDefined();
      expect(deps.db.condition).toBe('service_healthy');
    }
  });
});

describe('.env.example documentation', () => {
  let envContent: string;

  beforeAll(() => {
    envContent = readFileSync(ENV_EXAMPLE_PATH, 'utf-8');
  });

  it('documents POSTGRES_USER', () => {
    expect(envContent).toContain('POSTGRES_USER');
  });

  it('documents POSTGRES_PASSWORD', () => {
    expect(envContent).toContain('POSTGRES_PASSWORD');
  });

  it('documents POSTGRES_DB', () => {
    expect(envContent).toContain('POSTGRES_DB');
  });

  it('documents PUBLIC_BASE_URL', () => {
    expect(envContent).toContain('PUBLIC_BASE_URL');
  });

  it('documents COOKIE_SECRET', () => {
    expect(envContent).toContain('COOKIE_SECRET');
  });

  it('documents API_PORT with default 3000', () => {
    expect(envContent).toMatch(/API_PORT.*3000/);
  });

  it('documents FRONTEND_PORT with default 8080', () => {
    expect(envContent).toMatch(/FRONTEND_PORT.*8080/);
  });

  it('documents S3 variables', () => {
    expect(envContent).toContain('S3_ACCESS_KEY');
    expect(envContent).toContain('S3_SECRET_KEY');
    expect(envContent).toContain('S3_BUCKET');
  });
});
