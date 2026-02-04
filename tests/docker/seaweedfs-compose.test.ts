import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse } from 'yaml';

const ROOT_DIR = resolve(__dirname, '../..');

interface ComposeService {
  image?: string;
  command?: string | string[];
  environment?: Record<string, string> | string[];
  ports?: string[];
  volumes?: string[];
  healthcheck?: {
    test: string[];
    interval?: string;
    timeout?: string;
    retries?: number;
    start_period?: string;
  };
  depends_on?: Record<string, { condition: string }> | string[];
  security_opt?: string[];
  cap_drop?: string[];
  restart?: string;
}

interface ComposeVolumes {
  [key: string]: object | null;
}

interface ComposeFile {
  name?: string;
  services: Record<string, ComposeService>;
  volumes?: ComposeVolumes;
}

describe('SeaweedFS in docker-compose.yml (production compose)', () => {
  let compose: ComposeFile;

  beforeAll(() => {
    const content = readFileSync(resolve(ROOT_DIR, 'docker-compose.yml'), 'utf-8');
    compose = parse(content) as ComposeFile;
  });

  describe('seaweedfs service', () => {
    it('exists in compose file', () => {
      expect(compose.services.seaweedfs).toBeDefined();
    });

    it('uses chrislusf/seaweedfs image', () => {
      expect(compose.services.seaweedfs.image).toMatch(/^chrislusf\/seaweedfs/);
    });

    it('runs in single-server mode with S3 gateway', () => {
      const command = compose.services.seaweedfs.command;
      const cmdString = Array.isArray(command) ? command.join(' ') : command;
      expect(cmdString).toContain('server');
      expect(cmdString).toContain('-s3');
      expect(cmdString).toContain('-s3.port=8333');
      expect(cmdString).toContain('-ip.bind=0.0.0.0');
    });

    it('maps port 8333 to host', () => {
      const ports = compose.services.seaweedfs.ports || [];
      const hasS3Port = ports.some((p: string) => p.includes('8333'));
      expect(hasS3Port).toBe(true);
    });

    it('configures volume size limit from env var', () => {
      const command = compose.services.seaweedfs.command;
      const cmdString = Array.isArray(command) ? command.join(' ') : command;
      expect(cmdString).toContain('-master.volumeSizeLimitMB');
    });

    it('has volume mount for data persistence', () => {
      const volumes = compose.services.seaweedfs.volumes || [];
      const hasDataVolume = volumes.some((v: string) => v.includes('/data'));
      expect(hasDataVolume).toBe(true);
    });

    it('has healthcheck configured', () => {
      const hc = compose.services.seaweedfs.healthcheck;
      expect(hc).toBeDefined();
      expect(hc?.test).toBeDefined();
      expect(Array.isArray(hc?.test)).toBe(true);
    });

    it('has container hardening (security_opt)', () => {
      expect(compose.services.seaweedfs.security_opt).toBeDefined();
      expect(compose.services.seaweedfs.security_opt).toContain('no-new-privileges:true');
    });

    it('has container hardening (cap_drop ALL)', () => {
      expect(compose.services.seaweedfs.cap_drop).toBeDefined();
      expect(compose.services.seaweedfs.cap_drop).toContain('ALL');
    });

    it('has restart policy', () => {
      expect(compose.services.seaweedfs.restart).toBe('unless-stopped');
    });
  });

  describe('api service S3 configuration', () => {
    it('depends on seaweedfs being healthy', () => {
      const deps = compose.services.api.depends_on;
      expect(deps).toBeDefined();
      if (typeof deps === 'object' && !Array.isArray(deps)) {
        expect(deps.seaweedfs).toBeDefined();
        expect(deps.seaweedfs.condition).toBe('service_healthy');
      }
    });

    it('has S3_ENDPOINT env var pointing to seaweedfs', () => {
      const env = compose.services.api.environment;
      expect(env).toBeDefined();
      if (typeof env === 'object' && !Array.isArray(env)) {
        expect(env.S3_ENDPOINT).toContain('seaweedfs:8333');
      }
    });

    it('has S3_BUCKET env var configured', () => {
      const env = compose.services.api.environment;
      if (typeof env === 'object' && !Array.isArray(env)) {
        expect(env.S3_BUCKET).toBeDefined();
      }
    });

    it('has S3_FORCE_PATH_STYLE set to true', () => {
      const env = compose.services.api.environment;
      if (typeof env === 'object' && !Array.isArray(env)) {
        expect(env.S3_FORCE_PATH_STYLE).toBe('true');
      }
    });

    it('has S3 access credentials configured', () => {
      const env = compose.services.api.environment;
      if (typeof env === 'object' && !Array.isArray(env)) {
        expect(env.S3_ACCESS_KEY).toBeDefined();
        expect(env.S3_SECRET_KEY).toBeDefined();
      }
    });
  });

  describe('seaweedfs_data volume', () => {
    it('is defined in volumes section', () => {
      expect(compose.volumes).toBeDefined();
      expect(compose.volumes?.seaweedfs_data).toBeDefined();
    });
  });
});

describe('.env.example contains SeaweedFS variables', () => {
  let envContent: string;

  beforeAll(() => {
    envContent = readFileSync(resolve(ROOT_DIR, '.env.example'), 'utf-8');
  });

  it('documents SEAWEEDFS_VOLUME_SIZE_LIMIT_MB', () => {
    expect(envContent).toContain('SEAWEEDFS_VOLUME_SIZE_LIMIT_MB');
  });

  it('documents S3_ACCESS_KEY', () => {
    expect(envContent).toContain('S3_ACCESS_KEY');
  });

  it('documents S3_SECRET_KEY', () => {
    expect(envContent).toContain('S3_SECRET_KEY');
  });
});
