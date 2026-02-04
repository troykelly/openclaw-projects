/**
 * Tests for comprehensive .env.example documentation.
 * Issue #536: Verify all sections, comments, required markers, and DNS provider examples.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT_DIR = resolve(__dirname, '../..');
const ENV_EXAMPLE_PATH = resolve(ROOT_DIR, '.env.example');

describe('.env.example comprehensive documentation (Issue #536)', () => {
  let envContent: string;
  let lines: string[];

  beforeAll(() => {
    envContent = readFileSync(ENV_EXAMPLE_PATH, 'utf-8');
    lines = envContent.split('\n');
  });

  describe('section headers', () => {
    const requiredSections = [
      'Core Application Settings',
      'Database',
      'Service Ports',
      'S3-Compatible Storage',
      'SeaweedFS Configuration',
      'Email Integration',
      'SMS Integration',
      'Embedding Providers',
      'Traefik/TLS Configuration',
      'DNS Provider Configuration',
      'ModSecurity/WAF Configuration',
    ];

    it.each(requiredSections)('has section header for "%s"', (section) => {
      // Section headers should be in a comment block
      const headerRegex = new RegExp(section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      expect(envContent).toMatch(headerRegex);
    });

    it('uses consistent section header format', () => {
      // Check for delimiter format (lines of = signs)
      const delimiterCount = (envContent.match(/^# =+$/gm) || []).length;
      // At least 11 sections, each with top and bottom delimiter = 22 minimum
      expect(delimiterCount).toBeGreaterThanOrEqual(20);
    });
  });

  describe('required variables marked', () => {
    const requiredVars = [
      'POSTGRES_PASSWORD',
      'COOKIE_SECRET',
      'S3_SECRET_KEY',
    ];

    it.each(requiredVars)('%s is marked as (REQUIRED)', (varName) => {
      // Find the line with the variable and check nearby comment
      const varIndex = lines.findIndex((line) => line.startsWith(`${varName}=`) || line.startsWith(`# ${varName}=`));
      expect(varIndex).toBeGreaterThan(-1);
      
      // Look for (REQUIRED) in the preceding comment lines (up to 5 lines before)
      const contextStart = Math.max(0, varIndex - 5);
      const contextLines = lines.slice(contextStart, varIndex + 1).join('\n');
      expect(contextLines).toContain('(REQUIRED)');
    });
  });

  describe('default values shown', () => {
    const defaultValues = [
      { var: 'POSTGRES_USER', default: 'openclaw' },
      { var: 'POSTGRES_DB', default: 'openclaw' },
      { var: 'API_PORT', default: '3000' },
      { var: 'FRONTEND_PORT', default: '8080' },
      { var: 'S3_BUCKET', default: 'openclaw' },
      { var: 'S3_REGION', default: 'us-east-1' },
    ];

    it.each(defaultValues)('$var shows default value $default', ({ var: varName, default: defaultVal }) => {
      const varRegex = new RegExp(`${varName}=(${defaultVal}|.*\\(default:?\\s*${defaultVal}\\))`, 'i');
      expect(envContent).toMatch(varRegex);
    });
  });

  describe('variable comments', () => {
    it('each variable has a comment explaining what it does', () => {
      // Extract variable declarations (lines starting with VAR= or # VAR=)
      const varLines = lines.filter((line) => 
        /^#?\s*[A-Z][A-Z0-9_]+=/.test(line) && !line.startsWith('# =')
      );
      
      // For each variable, check there's a descriptive comment within 5 lines before it
      let missingComments = 0;
      for (const varLine of varLines) {
        const varIndex = lines.indexOf(varLine);
        const contextStart = Math.max(0, varIndex - 5);
        const contextLines = lines.slice(contextStart, varIndex);
        
        // Check if any line in context is a descriptive comment (not a section header)
        const hasComment = contextLines.some((line) => 
          line.startsWith('#') && 
          !line.startsWith('# =') && 
          line.length > 2 &&
          !/^#\s*$/.test(line)
        );
        
        if (!hasComment) {
          missingComments++;
        }
      }
      
      // Allow up to 5% without comments (some may be in groups)
      const threshold = Math.ceil(varLines.length * 0.05);
      expect(missingComments).toBeLessThanOrEqual(threshold);
    });
  });

  describe('Twilio/SMS section', () => {
    it('documents TWILIO_ACCOUNT_SID', () => {
      expect(envContent).toContain('TWILIO_ACCOUNT_SID');
    });

    it('documents TWILIO_AUTH_TOKEN', () => {
      expect(envContent).toContain('TWILIO_AUTH_TOKEN');
    });

    it('documents TWILIO_FROM_NUMBER', () => {
      expect(envContent).toContain('TWILIO_FROM_NUMBER');
    });
  });

  describe('Embedding Providers section', () => {
    it('documents OPENAI_API_KEY', () => {
      expect(envContent).toContain('OPENAI_API_KEY');
    });

    it('documents VOYAGERAI_API_KEY', () => {
      expect(envContent).toContain('VOYAGERAI_API_KEY');
    });

    it('documents GEMINI_API_KEY', () => {
      expect(envContent).toContain('GEMINI_API_KEY');
    });

    it('documents EMBEDDING_PROVIDER', () => {
      expect(envContent).toContain('EMBEDDING_PROVIDER');
    });
  });

  describe('Traefik/TLS section', () => {
    it('documents DOMAIN', () => {
      expect(envContent).toContain('DOMAIN');
    });

    it('documents ACME_EMAIL', () => {
      expect(envContent).toContain('ACME_EMAIL');
    });

    it('documents ACME_DNS_PROVIDER', () => {
      expect(envContent).toContain('ACME_DNS_PROVIDER');
    });

    it('documents HTTPS_PORT', () => {
      expect(envContent).toContain('HTTPS_PORT');
    });

    it('documents HTTP_PORT', () => {
      expect(envContent).toContain('HTTP_PORT');
    });

    it('documents DISABLE_HTTP', () => {
      expect(envContent).toContain('DISABLE_HTTP');
    });

    it('documents TRUSTED_IPS', () => {
      expect(envContent).toContain('TRUSTED_IPS');
    });
  });

  describe('DNS Provider section', () => {
    it('includes link to Lego DNS providers documentation', () => {
      // Check for Lego documentation URL
      expect(envContent).toMatch(/https:\/\/go-acme\.github\.io\/lego\/dns/);
    });

    it('includes Cloudflare example (CF_DNS_API_TOKEN)', () => {
      expect(envContent).toContain('CF_DNS_API_TOKEN');
    });

    it('includes Route53/AWS example (AWS_ACCESS_KEY_ID)', () => {
      expect(envContent).toContain('AWS_ACCESS_KEY_ID');
    });

    it('includes Route53/AWS example (AWS_SECRET_ACCESS_KEY)', () => {
      expect(envContent).toContain('AWS_SECRET_ACCESS_KEY');
    });

    it('includes Route53/AWS example (AWS_HOSTED_ZONE_ID)', () => {
      expect(envContent).toContain('AWS_HOSTED_ZONE_ID');
    });
  });

  describe('ModSecurity section', () => {
    it('documents MODSEC_PARANOIA_LEVEL', () => {
      expect(envContent).toContain('MODSEC_PARANOIA_LEVEL');
    });

    it('documents paranoia levels (1-4)', () => {
      expect(envContent).toMatch(/paranoia.*level.*1.*4|1.*low.*4.*maximum/i);
    });
  });

  describe('OpenClaw integration variables', () => {
    it('documents OPENCLAW_GATEWAY_URL', () => {
      expect(envContent).toContain('OPENCLAW_GATEWAY_URL');
    });

    it('documents OPENCLAW_HOOK_TOKEN', () => {
      expect(envContent).toContain('OPENCLAW_HOOK_TOKEN');
    });
  });

  describe('rate limiting and security', () => {
    it('documents RATE_LIMIT_MAX', () => {
      expect(envContent).toContain('RATE_LIMIT_MAX');
    });

    it('documents RATE_LIMIT_WINDOW_MS', () => {
      expect(envContent).toContain('RATE_LIMIT_WINDOW_MS');
    });

    it('documents WEBHOOK_IP_WHITELIST_DISABLED', () => {
      expect(envContent).toContain('WEBHOOK_IP_WHITELIST_DISABLED');
    });
  });

  describe('file upload settings', () => {
    it('documents MAX_FILE_SIZE_BYTES', () => {
      expect(envContent).toContain('MAX_FILE_SIZE_BYTES');
    });
  });
});
