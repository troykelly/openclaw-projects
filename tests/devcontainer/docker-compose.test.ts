/**
 * Tests for devcontainer docker-compose configuration.
 * Part of Issue #533 - MinIO to SeaweedFS migration.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import { join } from 'path';

describe('Devcontainer Docker Compose Configuration', () => {
  const composePath = join(__dirname, '../../.devcontainer/docker-compose.devcontainer.yml');
  const composeContent = readFileSync(composePath, 'utf-8');
  const compose = parseYaml(composeContent);

  describe('SeaweedFS Service', () => {
    it('should have seaweedfs service defined', () => {
      expect(compose.services).toHaveProperty('seaweedfs');
    });

    it('should use chrislusf/seaweedfs image', () => {
      expect(compose.services.seaweedfs.image).toMatch(/^chrislusf\/seaweedfs/);
    });

    it('should expose S3 port 8333', () => {
      const ports = compose.services.seaweedfs.ports;
      expect(ports).toBeDefined();
      expect(ports.some((p: string) => p.includes('8333'))).toBe(true);
    });

    it('should have health check configured', () => {
      expect(compose.services.seaweedfs.healthcheck).toBeDefined();
      expect(compose.services.seaweedfs.healthcheck.test).toBeDefined();
    });

    it('should have persistent volume for data', () => {
      const volumes = compose.services.seaweedfs.volumes;
      expect(volumes).toBeDefined();
      expect(volumes.some((v: string) => v.includes('seaweedfs_data'))).toBe(true);
    });
  });

  describe('MinIO Service', () => {
    it('should NOT have minio service defined', () => {
      expect(compose.services).not.toHaveProperty('minio');
    });
  });

  describe('Volumes', () => {
    it('should NOT have minio data volume', () => {
      expect(compose.volumes).not.toHaveProperty('openclaw_projects_minio_data');
    });

    it('should have seaweedfs data volume', () => {
      expect(compose.volumes).toHaveProperty('openclaw_projects_seaweedfs_data');
    });
  });

  describe('Workspace Service', () => {
    it('should have S3 environment variables for SeaweedFS', () => {
      const env = compose.services.workspace.environment;
      expect(env).toBeDefined();
      expect(env.S3_ENDPOINT).toBe('http://seaweedfs:8333');
      expect(env.S3_BUCKET).toBe('openclaw');
      expect(env.S3_ACCESS_KEY).toBeDefined();
      expect(env.S3_SECRET_KEY).toBeDefined();
    });

    it('should depend on seaweedfs service', () => {
      const depends = compose.services.workspace.depends_on;
      expect(depends).toHaveProperty('seaweedfs');
    });
  });
});
