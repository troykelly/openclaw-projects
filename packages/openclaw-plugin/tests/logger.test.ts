import { describe, expect, it } from 'vitest'
import { redactSensitive, createLogger } from '../src/logger.js'

describe('Logger', () => {
  describe('redactSensitive', () => {
    it('should redact apiKey field', () => {
      const obj = { apiKey: 'secret-key-12345', other: 'value' }
      const redacted = redactSensitive(obj)
      expect(redacted.apiKey).toBe('[REDACTED]')
      expect(redacted.other).toBe('value')
    })

    it('should redact token field', () => {
      const obj = { token: 'bearer-token-xyz', other: 'value' }
      const redacted = redactSensitive(obj)
      expect(redacted.token).toBe('[REDACTED]')
    })

    it('should redact password field', () => {
      const obj = { password: 'supersecret', user: 'john' }
      const redacted = redactSensitive(obj)
      expect(redacted.password).toBe('[REDACTED]')
      expect(redacted.user).toBe('john')
    })

    it('should redact secret field', () => {
      const obj = { secret: 'my-secret', id: '123' }
      const redacted = redactSensitive(obj)
      expect(redacted.secret).toBe('[REDACTED]')
    })

    it('should redact authorization header', () => {
      const obj = { authorization: 'Bearer xyz', other: 'value' }
      const redacted = redactSensitive(obj)
      expect(redacted.authorization).toBe('[REDACTED]')
    })

    it('should handle nested objects', () => {
      const obj = {
        config: { apiKey: 'secret', url: 'http://example.com' },
        data: 'value',
      }
      const redacted = redactSensitive(obj)
      expect(redacted.config.apiKey).toBe('[REDACTED]')
      expect(redacted.config.url).toBe('http://example.com')
    })

    it('should handle arrays', () => {
      const obj = {
        items: [
          { apiKey: 'secret1', name: 'item1' },
          { apiKey: 'secret2', name: 'item2' },
        ],
      }
      const redacted = redactSensitive(obj)
      expect(redacted.items[0].apiKey).toBe('[REDACTED]')
      expect(redacted.items[1].apiKey).toBe('[REDACTED]')
      expect(redacted.items[0].name).toBe('item1')
    })

    it('should not modify original object', () => {
      const obj = { apiKey: 'secret', other: 'value' }
      redactSensitive(obj)
      expect(obj.apiKey).toBe('secret')
    })

    it('should handle null and undefined', () => {
      expect(redactSensitive(null)).toBe(null)
      expect(redactSensitive(undefined)).toBe(undefined)
    })

    it('should handle primitive values', () => {
      expect(redactSensitive('string')).toBe('string')
      expect(redactSensitive(123)).toBe(123)
      expect(redactSensitive(true)).toBe(true)
    })
  })

  describe('createLogger', () => {
    it('should create a logger with expected methods', () => {
      const logger = createLogger('test')
      expect(logger).toHaveProperty('info')
      expect(logger).toHaveProperty('warn')
      expect(logger).toHaveProperty('error')
      expect(logger).toHaveProperty('debug')
    })

    it('should include namespace in logger', () => {
      const logger = createLogger('my-namespace')
      expect(logger.namespace).toBe('my-namespace')
    })
  })
})
