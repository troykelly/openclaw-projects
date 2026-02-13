/**
 * Tests for docker/app/Dockerfile
 *
 * These tests verify the Dockerfile configuration and nginx setup
 * for the frontend app container. Tests validate file presence,
 * configuration structure, and build requirements.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const DOCKER_APP_DIR = resolve(import.meta.dirname, '../../docker/app');

describe('Frontend App Dockerfile', () => {
  let dockerfileContent: string;

  beforeAll(() => {
    const dockerfilePath = resolve(DOCKER_APP_DIR, 'Dockerfile');
    if (!existsSync(dockerfilePath)) {
      throw new Error('docker/app/Dockerfile not found');
    }
    dockerfileContent = readFileSync(dockerfilePath, 'utf-8');
  });

  describe('Multi-stage build', () => {
    it('should have builder stage using node:25-bookworm-slim', () => {
      expect(dockerfileContent).toMatch(/FROM\s+node:25-bookworm-slim\s+AS\s+builder/i);
    });

    it('should have runtime stage using nginx:1-alpine', () => {
      expect(dockerfileContent).toMatch(/FROM\s+nginx:1-alpine\s+AS\s+runtime/i);
    });

    it('should run app:build in builder stage', () => {
      expect(dockerfileContent).toContain('pnpm run app:build');
    });
  });

  describe('Package manager', () => {
    it('should install pnpm', () => {
      expect(dockerfileContent).toContain('pnpm');
    });

    it('should use pnpm install with frozen-lockfile', () => {
      expect(dockerfileContent).toContain('pnpm install --frozen-lockfile');
    });
  });

  describe('Compression', () => {
    it('should install brotli for pre-compression', () => {
      expect(dockerfileContent).toContain('brotli');
    });

    it('should pre-compress with gzip (keep original)', () => {
      expect(dockerfileContent).toMatch(/gzip.*-k/);
    });

    it('should pre-compress with brotli (keep original)', () => {
      expect(dockerfileContent).toMatch(/brotli.*-k/);
    });
  });

  describe('Security', () => {
    it('should run as non-root nginx user', () => {
      expect(dockerfileContent).toContain('USER nginx');
    });

    it('should expose only port 8080', () => {
      const exposeMatches = dockerfileContent.match(/EXPOSE\s+\d+/g);
      expect(exposeMatches).toHaveLength(1);
      expect(exposeMatches![0]).toBe('EXPOSE 8080');
    });
  });

  describe('OCI Labels', () => {
    it('should define BUILD_DATE build arg', () => {
      expect(dockerfileContent).toContain('ARG BUILD_DATE');
    });

    it('should define VCS_REF build arg', () => {
      expect(dockerfileContent).toContain('ARG VCS_REF');
    });

    it('should define VERSION build arg', () => {
      expect(dockerfileContent).toContain('ARG VERSION');
    });

    it('should have org.opencontainers.image.title label', () => {
      expect(dockerfileContent).toContain('org.opencontainers.image.title');
    });

    it('should have org.opencontainers.image.created label', () => {
      expect(dockerfileContent).toContain('org.opencontainers.image.created');
    });

    it('should have org.opencontainers.image.revision label', () => {
      expect(dockerfileContent).toContain('org.opencontainers.image.revision');
    });

    it('should have org.opencontainers.image.version label', () => {
      expect(dockerfileContent).toContain('org.opencontainers.image.version');
    });

    it('should have org.opencontainers.image.source label', () => {
      expect(dockerfileContent).toContain('org.opencontainers.image.source');
    });
  });

  describe('Environment configuration', () => {
    it('should define API_HOST environment variable', () => {
      expect(dockerfileContent).toMatch(/ENV\s+API_HOST/);
    });

    it('should define API_PORT environment variable', () => {
      expect(dockerfileContent).toMatch(/ENV\s+API_PORT/);
    });
  });

  describe('Static assets', () => {
    it('should copy built assets from builder stage', () => {
      expect(dockerfileContent).toMatch(/COPY\s+--from=builder/);
      expect(dockerfileContent).toContain('/app/src/api/static/app');
      expect(dockerfileContent).toContain('/usr/share/nginx/html');
    });
  });
});

describe('Nginx Configuration Template', () => {
  let nginxConfigContent: string;

  beforeAll(() => {
    const configPath = resolve(DOCKER_APP_DIR, 'nginx.conf.template');
    if (!existsSync(configPath)) {
      throw new Error('docker/app/nginx.conf.template not found');
    }
    nginxConfigContent = readFileSync(configPath, 'utf-8');
  });

  describe('Server configuration', () => {
    it('should listen on port 8080', () => {
      expect(nginxConfigContent).toContain('listen 8080');
    });

    it('should set root to /usr/share/nginx/html', () => {
      expect(nginxConfigContent).toContain('root /usr/share/nginx/html');
    });

    it('should set index to index.html', () => {
      expect(nginxConfigContent).toContain('index index.html');
    });
  });

  describe('Gzip compression', () => {
    it('should enable gzip_static for pre-compressed files', () => {
      expect(nginxConfigContent).toContain('gzip_static on');
    });

    it('should enable gzip compression', () => {
      expect(nginxConfigContent).toContain('gzip on');
    });

    it('should include gzip_vary', () => {
      expect(nginxConfigContent).toContain('gzip_vary on');
    });

    it('should compress common text types', () => {
      expect(nginxConfigContent).toContain('text/css');
      expect(nginxConfigContent).toContain('application/javascript');
      expect(nginxConfigContent).toContain('application/json');
    });
  });

  describe('Cache headers', () => {
    it('should have immutable cache for hashed assets', () => {
      expect(nginxConfigContent).toContain('immutable');
      expect(nginxConfigContent).toContain('max-age=31536000');
    });

    it('should have no-cache for index.html', () => {
      expect(nginxConfigContent).toContain('no-cache');
      expect(nginxConfigContent).toContain('must-revalidate');
    });

    it('should have location block for /assets/', () => {
      expect(nginxConfigContent).toContain('location /assets/');
    });

    it('should have location block for index.html', () => {
      expect(nginxConfigContent).toContain('location = /index.html');
    });
  });

  describe('Vite base path handling', () => {
    it('should rewrite /static/app/assets/ to strip Vite base prefix', () => {
      expect(nginxConfigContent).toContain('location /static/app/assets/');
      expect(nginxConfigContent).toMatch(/rewrite.*\/static\/app\/.*last/);
    });

    it('should have SPA fallback for /static/app/ deep links', () => {
      expect(nginxConfigContent).toContain('location /static/app/');
    });

    it('should NOT have an overly broad rewrite that could tunnel into /api/', () => {
      // The rewrite must live inside a location scoped to /static/app/assets/,
      // not a bare /static/app/ location, to prevent /static/app/api/... from
      // being rewritten into /api/... and hitting the API proxy.
      expect(nginxConfigContent).toContain('location /static/app/assets/');
      // The /static/app/ location should use try_files, not rewrite
      const lines = nginxConfigContent.split('\n');
      let inStaticAppBlock = false;
      for (const line of lines) {
        if (line.includes('location /static/app/') && !line.includes('/assets/')) {
          inStaticAppBlock = true;
        }
        if (inStaticAppBlock && line.includes('rewrite')) {
          throw new Error(
            'Found rewrite inside broad /static/app/ location — ' +
            'this could tunnel /static/app/api/ into /api/. ' +
            'Rewrites must be scoped to /static/app/assets/ only.',
          );
        }
        if (inStaticAppBlock && line.trim() === '}') {
          inStaticAppBlock = false;
        }
      }
    });
  });

  describe('Vite base path consistency', () => {
    it('nginx rewrite should match the Vite base path in vite.config.ts', () => {
      const viteConfigPath = resolve(import.meta.dirname, '../../vite.config.ts');
      const viteConfig = readFileSync(viteConfigPath, 'utf-8');
      // Vite base: '/static/app/' must match the nginx locations
      expect(viteConfig).toContain("base: '/static/app/'");
      expect(nginxConfigContent).toContain('location /static/app/');
    });
  });

  describe('SPA fallback', () => {
    it('should have try_files directive for SPA routing', () => {
      expect(nginxConfigContent).toContain('try_files $uri $uri/ /index.html');
    });
  });

  describe('Security headers', () => {
    it('should include X-Frame-Options', () => {
      expect(nginxConfigContent).toContain('X-Frame-Options');
    });

    it('should include X-Content-Type-Options', () => {
      expect(nginxConfigContent).toContain('X-Content-Type-Options');
    });
  });

  describe('Health check', () => {
    it('should have health check endpoint', () => {
      expect(nginxConfigContent).toContain('location = /health');
    });
  });

  describe('API proxy', () => {
    it('should have API proxy location block', () => {
      expect(nginxConfigContent).toContain('location /api/');
    });

    it('should proxy to API_HOST and API_PORT', () => {
      expect(nginxConfigContent).toMatch(/proxy_pass.*\$\{API_HOST\}.*\$\{API_PORT\}/);
    });

    it('should set proxy headers', () => {
      expect(nginxConfigContent).toContain('proxy_set_header Host');
      expect(nginxConfigContent).toContain('proxy_set_header X-Real-IP');
      expect(nginxConfigContent).toContain('proxy_set_header X-Forwarded-For');
      expect(nginxConfigContent).toContain('proxy_set_header X-Forwarded-Proto');
    });

    it('should support WebSocket connections', () => {
      expect(nginxConfigContent).toContain('proxy_set_header Upgrade');
      expect(nginxConfigContent).toContain('proxy_set_header Connection');
    });
  });
});

describe('App .dockerignore', () => {
  let dockerignoreContent: string;
  const dockerignorePath = resolve(DOCKER_APP_DIR, '.dockerignore');

  beforeAll(() => {
    if (existsSync(dockerignorePath)) {
      dockerignoreContent = readFileSync(dockerignorePath, 'utf-8');
    } else {
      dockerignoreContent = '';
    }
  });

  it('should exist', () => {
    expect(existsSync(dockerignorePath)).toBe(true);
  });

  it('should ignore node_modules', () => {
    expect(dockerignoreContent).toContain('node_modules');
  });

  it('should ignore .git directory', () => {
    expect(dockerignoreContent).toContain('.git');
  });

  it('should ignore test files', () => {
    expect(dockerignoreContent).toContain('tests');
  });

  it('should ignore .env files but allow .env.example', () => {
    expect(dockerignoreContent).toContain('.env');
    expect(dockerignoreContent).toContain('!.env.example');
  });
});
