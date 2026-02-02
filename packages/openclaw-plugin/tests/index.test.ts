import { describe, expect, it } from 'vitest'
import { register, plugin } from '../src/index.js'

describe('Plugin Entry Point', () => {
  describe('exports', () => {
    it('should export register function', () => {
      expect(typeof register).toBe('function')
    })

    it('should export plugin object', () => {
      expect(plugin).toBeDefined()
      expect(typeof plugin).toBe('object')
    })
  })

  describe('plugin object', () => {
    it('should have id property', () => {
      expect(plugin.id).toBe('openclaw-projects')
    })

    it('should have name property', () => {
      expect(plugin.name).toBe('OpenClaw Projects Plugin')
    })

    it('should have kind property set to memory', () => {
      expect(plugin.kind).toBe('memory')
    })

    it('should have register method', () => {
      expect(typeof plugin.register).toBe('function')
    })
  })

  describe('register function', () => {
    it('should be callable with context', () => {
      const mockContext = {
        config: { apiUrl: 'http://example.com', apiKey: 'test-key' },
        logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
      }
      // Should not throw
      expect(() => register(mockContext)).not.toThrow()
    })

    it('should return plugin instance', () => {
      const mockContext = {
        config: { apiUrl: 'http://example.com', apiKey: 'test-key' },
        logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
      }
      const result = register(mockContext)
      expect(result).toBeDefined()
    })
  })
})
