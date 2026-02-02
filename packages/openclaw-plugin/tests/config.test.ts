import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  PluginConfigSchema,
  validateConfig,
  safeValidateConfig,
  redactConfig,
  type PluginConfig,
} from '../src/config.js'

describe('Config Schema', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
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
})
