import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as childProcess from 'node:child_process'
import {
  PluginConfigSchema,
  validateConfig,
  safeValidateConfig,
  redactConfig,
  resolveConfigSecrets,
  resolveConfigSecretsSync,
  type PluginConfig,
  type RawPluginConfig,
} from '../src/config.js'
import { clearSecretCache } from '../src/secrets.js'

// Mock fs and child_process for secret resolution tests
vi.mock('node:fs')
vi.mock('node:child_process')

describe('Config Schema', () => {
  beforeEach(() => {
    clearSecretCache()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  describe('required fields', () => {
    it('should require apiUrl', () => {
      const config = { apiKey: 'test-key' }
      const result = safeValidateConfig(config)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors.some((e) => e.path.includes('apiUrl'))).toBe(true)
      }
    })

    it('should require apiKey', () => {
      const config = { apiUrl: 'https://example.com' }
      const result = safeValidateConfig(config)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors.some((e) => e.path.includes('apiKey'))).toBe(true)
      }
    })

    it('should accept valid minimal config', () => {
      const config = { apiUrl: 'https://example.com', apiKey: 'test-key' }
      const result = safeValidateConfig(config)
      expect(result.success).toBe(true)
    })
  })

  describe('apiUrl validation', () => {
    it('should accept HTTPS URLs', () => {
      const config = { apiUrl: 'https://api.example.com', apiKey: 'test-key' }
      const result = safeValidateConfig(config)
      expect(result.success).toBe(true)
    })

    it('should accept HTTP URLs in development mode', () => {
      vi.stubEnv('NODE_ENV', 'development')
      const config = { apiUrl: 'http://localhost:3000', apiKey: 'test-key' }
      const result = safeValidateConfig(config)
      expect(result.success).toBe(true)
    })

    it('should reject HTTP URLs in production mode', () => {
      vi.stubEnv('NODE_ENV', 'production')
      const config = { apiUrl: 'http://api.example.com', apiKey: 'test-key' }
      const result = safeValidateConfig(config)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors.some((e) => e.message.includes('HTTPS'))).toBe(true)
      }
    })

    it('should reject invalid URLs', () => {
      const config = { apiUrl: 'not-a-url', apiKey: 'test-key' }
      const result = safeValidateConfig(config)
      expect(result.success).toBe(false)
    })
  })

  describe('apiKey validation', () => {
    it('should reject empty apiKey', () => {
      const config = { apiUrl: 'https://example.com', apiKey: '' }
      const result = safeValidateConfig(config)
      expect(result.success).toBe(false)
    })

    it('should accept non-empty apiKey', () => {
      const config = { apiUrl: 'https://example.com', apiKey: 'my-api-key' }
      const result = safeValidateConfig(config)
      expect(result.success).toBe(true)
    })
  })

  describe('default values', () => {
    it('should set autoRecall to true by default', () => {
      const config = validateConfig({
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
      })
      expect(config.autoRecall).toBe(true)
    })

    it('should set autoCapture to true by default', () => {
      const config = validateConfig({
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
      })
      expect(config.autoCapture).toBe(true)
    })

    it('should set userScoping to "agent" by default', () => {
      const config = validateConfig({
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
      })
      expect(config.userScoping).toBe('agent')
    })

    it('should set maxRecallMemories to 5 by default', () => {
      const config = validateConfig({
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
      })
      expect(config.maxRecallMemories).toBe(5)
    })

    it('should set minRecallScore to 0.7 by default', () => {
      const config = validateConfig({
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
      })
      expect(config.minRecallScore).toBe(0.7)
    })

    it('should set timeout to 30000 by default', () => {
      const config = validateConfig({
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
      })
      expect(config.timeout).toBe(30000)
    })

    it('should set maxRetries to 3 by default', () => {
      const config = validateConfig({
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
      })
      expect(config.maxRetries).toBe(3)
    })

    it('should set debug to false by default', () => {
      const config = validateConfig({
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
      })
      expect(config.debug).toBe(false)
    })
  })

  describe('maxRecallMemories validation', () => {
    it('should accept valid maxRecallMemories', () => {
      const config = validateConfig({
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
        maxRecallMemories: 10,
      })
      expect(config.maxRecallMemories).toBe(10)
    })

    it('should reject maxRecallMemories less than 1', () => {
      const result = safeValidateConfig({
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
        maxRecallMemories: 0,
      })
      expect(result.success).toBe(false)
    })

    it('should reject maxRecallMemories greater than 20', () => {
      const result = safeValidateConfig({
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
        maxRecallMemories: 21,
      })
      expect(result.success).toBe(false)
    })
  })

  describe('minRecallScore validation', () => {
    it('should accept valid minRecallScore', () => {
      const config = validateConfig({
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
        minRecallScore: 0.5,
      })
      expect(config.minRecallScore).toBe(0.5)
    })

    it('should reject minRecallScore less than 0', () => {
      const result = safeValidateConfig({
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
        minRecallScore: -0.1,
      })
      expect(result.success).toBe(false)
    })

    it('should reject minRecallScore greater than 1', () => {
      const result = safeValidateConfig({
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
        minRecallScore: 1.1,
      })
      expect(result.success).toBe(false)
    })
  })

  describe('timeout validation', () => {
    it('should accept valid timeout', () => {
      const config = validateConfig({
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
        timeout: 5000,
      })
      expect(config.timeout).toBe(5000)
    })

    it('should reject timeout less than 1000', () => {
      const result = safeValidateConfig({
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
        timeout: 500,
      })
      expect(result.success).toBe(false)
    })

    it('should reject timeout greater than 60000', () => {
      const result = safeValidateConfig({
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
        timeout: 61000,
      })
      expect(result.success).toBe(false)
    })
  })

  describe('maxRetries validation', () => {
    it('should accept valid maxRetries', () => {
      const config = validateConfig({
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
        maxRetries: 5,
      })
      expect(config.maxRetries).toBe(5)
    })

    it('should accept maxRetries of 0', () => {
      const config = validateConfig({
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
        maxRetries: 0,
      })
      expect(config.maxRetries).toBe(0)
    })

    it('should reject maxRetries greater than 5', () => {
      const result = safeValidateConfig({
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
        maxRetries: 6,
      })
      expect(result.success).toBe(false)
    })
  })

  describe('userScoping validation', () => {
    it('should accept "agent" scoping', () => {
      const config = validateConfig({
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
        userScoping: 'agent',
      })
      expect(config.userScoping).toBe('agent')
    })

    it('should accept "identity" scoping', () => {
      const config = validateConfig({
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
        userScoping: 'identity',
      })
      expect(config.userScoping).toBe('identity')
    })

    it('should accept "session" scoping', () => {
      const config = validateConfig({
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
        userScoping: 'session',
      })
      expect(config.userScoping).toBe('session')
    })

    it('should reject invalid scoping values', () => {
      const result = safeValidateConfig({
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
        userScoping: 'invalid',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('redactConfig', () => {
    it('should redact apiKey', () => {
      const config: PluginConfig = {
        apiUrl: 'https://example.com',
        apiKey: 'super-secret-key',
        autoRecall: true,
        autoCapture: true,
        userScoping: 'agent',
        maxRecallMemories: 5,
        minRecallScore: 0.7,
        timeout: 30000,
        maxRetries: 3,
        debug: false,
      }
      const redacted = redactConfig(config)
      expect(redacted.apiKey).toBe('[REDACTED]')
    })

    it('should preserve other config values', () => {
      const config: PluginConfig = {
        apiUrl: 'https://example.com',
        apiKey: 'super-secret-key',
        autoRecall: false,
        autoCapture: true,
        userScoping: 'identity',
        maxRecallMemories: 10,
        minRecallScore: 0.5,
        timeout: 5000,
        maxRetries: 2,
        debug: true,
      }
      const redacted = redactConfig(config)
      expect(redacted.apiUrl).toBe('https://example.com')
      expect(redacted.autoRecall).toBe(false)
      expect(redacted.autoCapture).toBe(true)
      expect(redacted.userScoping).toBe('identity')
      expect(redacted.maxRecallMemories).toBe(10)
      expect(redacted.minRecallScore).toBe(0.5)
      expect(redacted.timeout).toBe(5000)
      expect(redacted.maxRetries).toBe(2)
      expect(redacted.debug).toBe(true)
    })

    it('should not modify original config', () => {
      const config: PluginConfig = {
        apiUrl: 'https://example.com',
        apiKey: 'super-secret-key',
        autoRecall: true,
        autoCapture: true,
        userScoping: 'agent',
        maxRecallMemories: 5,
        minRecallScore: 0.7,
        timeout: 30000,
        maxRetries: 3,
        debug: false,
      }
      redactConfig(config)
      expect(config.apiKey).toBe('super-secret-key')
    })
  })

  describe('validateConfig', () => {
    it('should throw ZodError for invalid config', () => {
      expect(() => validateConfig({})).toThrow()
    })

    it('should return parsed config for valid input', () => {
      const config = validateConfig({
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
      })
      expect(config.apiUrl).toBe('https://example.com')
      expect(config.apiKey).toBe('test-key')
    })
  })

  describe('flexible secret config fields', () => {
    describe('apiKey variants', () => {
      it('should accept apiKey as direct value', () => {
        const result = safeValidateConfig({
          apiUrl: 'https://example.com',
          apiKey: 'direct-key',
        })
        expect(result.success).toBe(true)
      })

      it('should accept apiKeyFile as file reference', () => {
        const result = safeValidateConfig({
          apiUrl: 'https://example.com',
          apiKeyFile: '~/.secrets/api_key',
        })
        expect(result.success).toBe(true)
      })

      it('should accept apiKeyCommand as command reference', () => {
        const result = safeValidateConfig({
          apiUrl: 'https://example.com',
          apiKeyCommand: 'op read op://Personal/openclaw/api_key',
        })
        expect(result.success).toBe(true)
      })

      it('should require at least one apiKey variant', () => {
        const result = safeValidateConfig({
          apiUrl: 'https://example.com',
        })
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(
            result.errors.some((e) => e.message.includes('apiKey'))
          ).toBe(true)
        }
      })
    })

    describe('Twilio credentials', () => {
      it('should accept twilioAccountSid as direct value', () => {
        const result = safeValidateConfig({
          apiUrl: 'https://example.com',
          apiKey: 'test-key',
          twilioAccountSid: 'AC123456',
        })
        expect(result.success).toBe(true)
      })

      it('should accept twilioAccountSidFile', () => {
        const result = safeValidateConfig({
          apiUrl: 'https://example.com',
          apiKey: 'test-key',
          twilioAccountSidFile: '~/.secrets/twilio_sid',
        })
        expect(result.success).toBe(true)
      })

      it('should accept twilioAccountSidCommand', () => {
        const result = safeValidateConfig({
          apiUrl: 'https://example.com',
          apiKey: 'test-key',
          twilioAccountSidCommand: 'op read op://Personal/twilio/account_sid',
        })
        expect(result.success).toBe(true)
      })

      it('should accept twilioAuthToken variants', () => {
        const result = safeValidateConfig({
          apiUrl: 'https://example.com',
          apiKey: 'test-key',
          twilioAuthTokenFile: '~/.secrets/twilio_token',
        })
        expect(result.success).toBe(true)
      })

      it('should accept twilioPhoneNumber variants', () => {
        const result = safeValidateConfig({
          apiUrl: 'https://example.com',
          apiKey: 'test-key',
          twilioPhoneNumberFile: '~/.secrets/twilio_phone',
        })
        expect(result.success).toBe(true)
      })
    })

    describe('Postmark credentials', () => {
      it('should accept postmarkToken as direct value', () => {
        const result = safeValidateConfig({
          apiUrl: 'https://example.com',
          apiKey: 'test-key',
          postmarkToken: 'pm-token-123',
        })
        expect(result.success).toBe(true)
      })

      it('should accept postmarkTokenFile', () => {
        const result = safeValidateConfig({
          apiUrl: 'https://example.com',
          apiKey: 'test-key',
          postmarkTokenFile: '~/.secrets/postmark_token',
        })
        expect(result.success).toBe(true)
      })

      it('should accept postmarkTokenCommand', () => {
        const result = safeValidateConfig({
          apiUrl: 'https://example.com',
          apiKey: 'test-key',
          postmarkTokenCommand: 'op read op://Personal/postmark/token',
        })
        expect(result.success).toBe(true)
      })

      it('should accept postmarkFromEmail variants', () => {
        const result = safeValidateConfig({
          apiUrl: 'https://example.com',
          apiKey: 'test-key',
          postmarkFromEmailFile: '~/.secrets/postmark_from',
        })
        expect(result.success).toBe(true)
      })
    })

    describe('command timeout', () => {
      it('should accept secretCommandTimeout option', () => {
        const result = safeValidateConfig({
          apiUrl: 'https://example.com',
          apiKeyCommand: 'op read op://Personal/openclaw/api_key',
          secretCommandTimeout: 10000,
        })
        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.secretCommandTimeout).toBe(10000)
        }
      })

      it('should default secretCommandTimeout to 5000', () => {
        const result = safeValidateConfig({
          apiUrl: 'https://example.com',
          apiKey: 'test-key',
        })
        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.secretCommandTimeout).toBe(5000)
        }
      })

      it('should reject secretCommandTimeout less than 1000', () => {
        const result = safeValidateConfig({
          apiUrl: 'https://example.com',
          apiKey: 'test-key',
          secretCommandTimeout: 500,
        })
        expect(result.success).toBe(false)
      })

      it('should reject secretCommandTimeout greater than 30000', () => {
        const result = safeValidateConfig({
          apiUrl: 'https://example.com',
          apiKey: 'test-key',
          secretCommandTimeout: 31000,
        })
        expect(result.success).toBe(false)
      })
    })
  })

  describe('redactConfig with flexible secrets', () => {
    it('should redact all secret fields', () => {
      const config: PluginConfig = {
        apiUrl: 'https://example.com',
        apiKey: 'super-secret-key',
        twilioAccountSid: 'AC123456',
        twilioAuthToken: 'auth-token',
        twilioPhoneNumber: '+15551234567',
        postmarkToken: 'pm-token',
        postmarkFromEmail: 'noreply@example.com',
        autoRecall: true,
        autoCapture: true,
        userScoping: 'agent',
        maxRecallMemories: 5,
        minRecallScore: 0.7,
        timeout: 30000,
        maxRetries: 3,
        secretCommandTimeout: 5000,
        debug: false,
      }
      const redacted = redactConfig(config)
      expect(redacted.apiKey).toBe('[REDACTED]')
      expect(redacted.twilioAccountSid).toBe('[REDACTED]')
      expect(redacted.twilioAuthToken).toBe('[REDACTED]')
      expect(redacted.twilioPhoneNumber).toBe('[REDACTED]')
      expect(redacted.postmarkToken).toBe('[REDACTED]')
      // postmarkFromEmail is not a secret, it's just a from address
      expect(redacted.postmarkFromEmail).toBe('noreply@example.com')
    })
  })

  describe('resolveConfigSecrets', () => {
    it('should resolve direct apiKey', async () => {
      const rawConfig: RawPluginConfig = {
        apiUrl: 'https://example.com',
        apiKey: 'direct-api-key',
        secretCommandTimeout: 5000,
        autoRecall: true,
        autoCapture: true,
        userScoping: 'agent',
        maxRecallMemories: 5,
        minRecallScore: 0.7,
        timeout: 30000,
        maxRetries: 3,
        debug: false,
      }

      const resolved = await resolveConfigSecrets(rawConfig)
      expect(resolved.apiKey).toBe('direct-api-key')
    })

    it('should resolve apiKey from file', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue('file-api-key\n')
      vi.mocked(fs.statSync).mockReturnValue({ mode: 0o600 } as fs.Stats)

      const rawConfig: RawPluginConfig = {
        apiUrl: 'https://example.com',
        apiKeyFile: '/path/to/api_key',
        secretCommandTimeout: 5000,
        autoRecall: true,
        autoCapture: true,
        userScoping: 'agent',
        maxRecallMemories: 5,
        minRecallScore: 0.7,
        timeout: 30000,
        maxRetries: 3,
        debug: false,
      }

      const resolved = await resolveConfigSecrets(rawConfig)
      expect(resolved.apiKey).toBe('file-api-key')
    })

    it('should resolve apiKey from command', async () => {
      vi.mocked(childProcess.execSync).mockReturnValue('command-api-key\n')

      const rawConfig: RawPluginConfig = {
        apiUrl: 'https://example.com',
        apiKeyCommand: 'op read op://test/api_key',
        secretCommandTimeout: 5000,
        autoRecall: true,
        autoCapture: true,
        userScoping: 'agent',
        maxRecallMemories: 5,
        minRecallScore: 0.7,
        timeout: 30000,
        maxRetries: 3,
        debug: false,
      }

      const resolved = await resolveConfigSecrets(rawConfig)
      expect(resolved.apiKey).toBe('command-api-key')
    })

    it('should resolve all Twilio credentials', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockImplementation((path) => {
        if (String(path).includes('sid')) return 'twilio-sid'
        if (String(path).includes('token')) return 'twilio-token'
        if (String(path).includes('phone')) return '+15551234567'
        return ''
      })
      vi.mocked(fs.statSync).mockReturnValue({ mode: 0o600 } as fs.Stats)

      const rawConfig: RawPluginConfig = {
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
        twilioAccountSidFile: '/path/to/twilio_sid',
        twilioAuthTokenFile: '/path/to/twilio_token',
        twilioPhoneNumberFile: '/path/to/twilio_phone',
        secretCommandTimeout: 5000,
        autoRecall: true,
        autoCapture: true,
        userScoping: 'agent',
        maxRecallMemories: 5,
        minRecallScore: 0.7,
        timeout: 30000,
        maxRetries: 3,
        debug: false,
      }

      const resolved = await resolveConfigSecrets(rawConfig)
      expect(resolved.twilioAccountSid).toBe('twilio-sid')
      expect(resolved.twilioAuthToken).toBe('twilio-token')
      expect(resolved.twilioPhoneNumber).toBe('+15551234567')
    })

    it('should resolve Postmark credentials', async () => {
      vi.mocked(childProcess.execSync).mockReturnValue('postmark-token-from-1password')

      const rawConfig: RawPluginConfig = {
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
        postmarkTokenCommand: 'op read op://test/postmark_token',
        postmarkFromEmail: 'noreply@example.com',
        secretCommandTimeout: 5000,
        autoRecall: true,
        autoCapture: true,
        userScoping: 'agent',
        maxRecallMemories: 5,
        minRecallScore: 0.7,
        timeout: 30000,
        maxRetries: 3,
        debug: false,
      }

      const resolved = await resolveConfigSecrets(rawConfig)
      expect(resolved.postmarkToken).toBe('postmark-token-from-1password')
      expect(resolved.postmarkFromEmail).toBe('noreply@example.com')
    })

    it('should throw when apiKey cannot be resolved', async () => {
      const rawConfig: RawPluginConfig = {
        apiUrl: 'https://example.com',
        apiKey: '   ', // empty after trim
        secretCommandTimeout: 5000,
        autoRecall: true,
        autoCapture: true,
        userScoping: 'agent',
        maxRecallMemories: 5,
        minRecallScore: 0.7,
        timeout: 30000,
        maxRetries: 3,
        debug: false,
      }

      await expect(resolveConfigSecrets(rawConfig)).rejects.toThrow(
        /Failed to resolve API key/
      )
    })

    it('should use configured command timeout', async () => {
      vi.mocked(childProcess.execSync).mockReturnValue('test-key')

      const rawConfig: RawPluginConfig = {
        apiUrl: 'https://example.com',
        apiKeyCommand: 'echo test-key',
        secretCommandTimeout: 10000,
        autoRecall: true,
        autoCapture: true,
        userScoping: 'agent',
        maxRecallMemories: 5,
        minRecallScore: 0.7,
        timeout: 30000,
        maxRetries: 3,
        debug: false,
      }

      await resolveConfigSecrets(rawConfig)
      expect(childProcess.execSync).toHaveBeenCalledWith(
        'echo test-key',
        expect.objectContaining({ timeout: 10000 })
      )
    })
  })

  describe('resolveConfigSecretsSync', () => {
    it('should resolve direct apiKey', () => {
      const rawConfig: RawPluginConfig = {
        apiUrl: 'https://example.com',
        apiKey: 'direct-api-key',
        secretCommandTimeout: 5000,
        autoRecall: true,
        autoCapture: true,
        userScoping: 'agent',
        maxRecallMemories: 5,
        minRecallScore: 0.7,
        timeout: 30000,
        maxRetries: 3,
        debug: false,
      }

      const resolved = resolveConfigSecretsSync(rawConfig)
      expect(resolved.apiKey).toBe('direct-api-key')
    })

    it('should resolve apiKey from file', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue('file-api-key\n')
      vi.mocked(fs.statSync).mockReturnValue({ mode: 0o600 } as fs.Stats)

      const rawConfig: RawPluginConfig = {
        apiUrl: 'https://example.com',
        apiKeyFile: '/path/to/api_key',
        secretCommandTimeout: 5000,
        autoRecall: true,
        autoCapture: true,
        userScoping: 'agent',
        maxRecallMemories: 5,
        minRecallScore: 0.7,
        timeout: 30000,
        maxRetries: 3,
        debug: false,
      }

      const resolved = resolveConfigSecretsSync(rawConfig)
      expect(resolved.apiKey).toBe('file-api-key')
    })

    it('should resolve apiKey from command', () => {
      vi.mocked(childProcess.execSync).mockReturnValue('command-api-key\n')

      const rawConfig: RawPluginConfig = {
        apiUrl: 'https://example.com',
        apiKeyCommand: 'op read op://test/api_key',
        secretCommandTimeout: 5000,
        autoRecall: true,
        autoCapture: true,
        userScoping: 'agent',
        maxRecallMemories: 5,
        minRecallScore: 0.7,
        timeout: 30000,
        maxRetries: 3,
        debug: false,
      }

      const resolved = resolveConfigSecretsSync(rawConfig)
      expect(resolved.apiKey).toBe('command-api-key')
    })

    it('should resolve all six secret fields', () => {
      vi.mocked(childProcess.execSync).mockReturnValue('cmd-api-key')
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockImplementation((path) => {
        const p = String(path)
        if (p.includes('postmark_token')) return 'pm-token'
        if (p.includes('postmark_from')) return 'noreply@example.com'
        if (p.includes('sid')) return 'twilio-sid'
        if (p.includes('token')) return 'twilio-token'
        if (p.includes('phone')) return '+15551234567'
        return ''
      })
      vi.mocked(fs.statSync).mockReturnValue({ mode: 0o600 } as fs.Stats)

      const rawConfig: RawPluginConfig = {
        apiUrl: 'https://example.com',
        apiKeyCommand: 'op read op://test/api_key',
        twilioAccountSidFile: '/path/to/twilio_sid',
        twilioAuthTokenFile: '/path/to/twilio_token',
        twilioPhoneNumberFile: '/path/to/twilio_phone',
        postmarkTokenFile: '/path/to/postmark_token',
        postmarkFromEmailFile: '/path/to/postmark_from',
        secretCommandTimeout: 5000,
        autoRecall: true,
        autoCapture: true,
        userScoping: 'agent',
        maxRecallMemories: 5,
        minRecallScore: 0.7,
        timeout: 30000,
        maxRetries: 3,
        debug: false,
      }

      const resolved = resolveConfigSecretsSync(rawConfig)
      expect(resolved.apiKey).toBe('cmd-api-key')
      expect(resolved.twilioAccountSid).toBe('twilio-sid')
      expect(resolved.twilioAuthToken).toBe('twilio-token')
      expect(resolved.twilioPhoneNumber).toBe('+15551234567')
      expect(resolved.postmarkToken).toBe('pm-token')
      expect(resolved.postmarkFromEmail).toBe('noreply@example.com')
    })

    it('should resolve Twilio credentials from files', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockImplementation((path) => {
        if (String(path).includes('sid')) return 'twilio-sid'
        if (String(path).includes('token')) return 'twilio-token'
        if (String(path).includes('phone')) return '+15551234567'
        return ''
      })
      vi.mocked(fs.statSync).mockReturnValue({ mode: 0o600 } as fs.Stats)

      const rawConfig: RawPluginConfig = {
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
        twilioAccountSidFile: '/path/to/twilio_sid',
        twilioAuthTokenFile: '/path/to/twilio_token',
        twilioPhoneNumberFile: '/path/to/twilio_phone',
        secretCommandTimeout: 5000,
        autoRecall: true,
        autoCapture: true,
        userScoping: 'agent',
        maxRecallMemories: 5,
        minRecallScore: 0.7,
        timeout: 30000,
        maxRetries: 3,
        debug: false,
      }

      const resolved = resolveConfigSecretsSync(rawConfig)
      expect(resolved.twilioAccountSid).toBe('twilio-sid')
      expect(resolved.twilioAuthToken).toBe('twilio-token')
      expect(resolved.twilioPhoneNumber).toBe('+15551234567')
    })

    it('should resolve Postmark credentials', () => {
      vi.mocked(childProcess.execSync).mockReturnValue('postmark-token-from-1password')

      const rawConfig: RawPluginConfig = {
        apiUrl: 'https://example.com',
        apiKey: 'test-key',
        postmarkTokenCommand: 'op read op://test/postmark_token',
        postmarkFromEmail: 'noreply@example.com',
        secretCommandTimeout: 5000,
        autoRecall: true,
        autoCapture: true,
        userScoping: 'agent',
        maxRecallMemories: 5,
        minRecallScore: 0.7,
        timeout: 30000,
        maxRetries: 3,
        debug: false,
      }

      const resolved = resolveConfigSecretsSync(rawConfig)
      expect(resolved.postmarkToken).toBe('postmark-token-from-1password')
      expect(resolved.postmarkFromEmail).toBe('noreply@example.com')
    })

    it('should throw when apiKey resolves to empty string', () => {
      const rawConfig: RawPluginConfig = {
        apiUrl: 'https://example.com',
        apiKey: '   ', // empty after trim
        secretCommandTimeout: 5000,
        autoRecall: true,
        autoCapture: true,
        userScoping: 'agent',
        maxRecallMemories: 5,
        minRecallScore: 0.7,
        timeout: 30000,
        maxRetries: 3,
        debug: false,
      }

      expect(() => resolveConfigSecretsSync(rawConfig)).toThrow(
        /Failed to resolve API key/
      )
    })

    it('should throw when apiKey resolves to whitespace only', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue('   \n')
      vi.mocked(fs.statSync).mockReturnValue({ mode: 0o600 } as fs.Stats)

      const rawConfig: RawPluginConfig = {
        apiUrl: 'https://example.com',
        apiKeyFile: '/path/to/empty_key',
        secretCommandTimeout: 5000,
        autoRecall: true,
        autoCapture: true,
        userScoping: 'agent',
        maxRecallMemories: 5,
        minRecallScore: 0.7,
        timeout: 30000,
        maxRetries: 3,
        debug: false,
      }

      expect(() => resolveConfigSecretsSync(rawConfig)).toThrow(
        /Failed to resolve API key/
      )
    })

    it('should propagate execSync timeout errors', () => {
      const timeoutError = new Error('Command timed out') as Error & { killed: boolean }
      timeoutError.killed = true
      vi.mocked(childProcess.execSync).mockImplementation(() => {
        throw timeoutError
      })

      const rawConfig: RawPluginConfig = {
        apiUrl: 'https://example.com',
        apiKeyCommand: 'slow-command',
        secretCommandTimeout: 5000,
        autoRecall: true,
        autoCapture: true,
        userScoping: 'agent',
        maxRecallMemories: 5,
        minRecallScore: 0.7,
        timeout: 30000,
        maxRetries: 3,
        debug: false,
      }

      expect(() => resolveConfigSecretsSync(rawConfig)).toThrow(
        /timed out/
      )
    })

    it('should propagate readFileSync failure errors', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('EACCES: permission denied')
      })
      vi.mocked(fs.statSync).mockReturnValue({ mode: 0o600 } as fs.Stats)

      const rawConfig: RawPluginConfig = {
        apiUrl: 'https://example.com',
        apiKeyFile: '/path/to/unreadable_key',
        secretCommandTimeout: 5000,
        autoRecall: true,
        autoCapture: true,
        userScoping: 'agent',
        maxRecallMemories: 5,
        minRecallScore: 0.7,
        timeout: 30000,
        maxRetries: 3,
        debug: false,
      }

      expect(() => resolveConfigSecretsSync(rawConfig)).toThrow(
        /Failed to read secret file/
      )
    })

    it('should produce a config that passes validateConfig (Zod validation)', () => {
      const rawConfig: RawPluginConfig = {
        apiUrl: 'https://example.com',
        apiKey: 'valid-api-key',
        secretCommandTimeout: 5000,
        autoRecall: true,
        autoCapture: true,
        userScoping: 'agent',
        maxRecallMemories: 5,
        minRecallScore: 0.7,
        timeout: 30000,
        maxRetries: 3,
        debug: false,
      }

      const resolved = resolveConfigSecretsSync(rawConfig)
      // Verify the resolved config passes Zod validation
      const validated = PluginConfigSchema.parse(resolved)
      expect(validated.apiUrl).toBe('https://example.com')
      expect(validated.apiKey).toBe('valid-api-key')
      expect(validated.secretCommandTimeout).toBe(5000)
      expect(validated.autoRecall).toBe(true)
      expect(validated.autoCapture).toBe(true)
      expect(validated.userScoping).toBe('agent')
    })

    it('should pass secretCommandTimeout through to resolveSecretSync', () => {
      vi.mocked(childProcess.execSync).mockReturnValue('test-key')

      const rawConfig: RawPluginConfig = {
        apiUrl: 'https://example.com',
        apiKeyCommand: 'echo test-key',
        secretCommandTimeout: 10000,
        autoRecall: true,
        autoCapture: true,
        userScoping: 'agent',
        maxRecallMemories: 5,
        minRecallScore: 0.7,
        timeout: 30000,
        maxRetries: 3,
        debug: false,
      }

      resolveConfigSecretsSync(rawConfig)
      expect(childProcess.execSync).toHaveBeenCalledWith(
        'echo test-key',
        expect.objectContaining({ timeout: 10000 })
      )
    })

    it('should preserve non-secret config fields in resolved output', () => {
      const rawConfig: RawPluginConfig = {
        apiUrl: 'https://api.custom.com',
        apiKey: 'test-key',
        secretCommandTimeout: 7000,
        autoRecall: false,
        autoCapture: false,
        userScoping: 'session',
        maxRecallMemories: 10,
        minRecallScore: 0.5,
        timeout: 15000,
        maxRetries: 1,
        debug: true,
        baseUrl: 'https://app.custom.com',
      }

      const resolved = resolveConfigSecretsSync(rawConfig)
      expect(resolved.apiUrl).toBe('https://api.custom.com')
      expect(resolved.secretCommandTimeout).toBe(7000)
      expect(resolved.autoRecall).toBe(false)
      expect(resolved.autoCapture).toBe(false)
      expect(resolved.userScoping).toBe('session')
      expect(resolved.maxRecallMemories).toBe(10)
      expect(resolved.minRecallScore).toBe(0.5)
      expect(resolved.timeout).toBe(15000)
      expect(resolved.maxRetries).toBe(1)
      expect(resolved.debug).toBe(true)
      expect(resolved.baseUrl).toBe('https://app.custom.com')
    })
  })
})
