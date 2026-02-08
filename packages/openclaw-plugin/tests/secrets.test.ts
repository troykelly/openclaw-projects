import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as childProcess from 'node:child_process'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  resolveSecret,
  resolveSecretSync,
  resolveSecrets,
  clearSecretCache,
  type SecretConfig,
} from '../src/secrets.js'

// Mock fs and child_process
vi.mock('node:fs')
vi.mock('node:child_process')

describe('Secrets Module', () => {
  beforeEach(() => {
    clearSecretCache()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('resolveSecret', () => {
    describe('direct value', () => {
      it('should return direct value when provided', async () => {
        const config: SecretConfig = { direct: 'my-secret-key' }
        const result = await resolveSecret(config)
        expect(result).toBe('my-secret-key')
      })

      it('should trim whitespace from direct value', async () => {
        const config: SecretConfig = { direct: '  my-secret-key  ' }
        const result = await resolveSecret(config)
        expect(result).toBe('my-secret-key')
      })

      it('should return undefined for empty direct value', async () => {
        const config: SecretConfig = { direct: '' }
        const result = await resolveSecret(config)
        expect(result).toBeUndefined()
      })

      it('should return undefined for whitespace-only direct value', async () => {
        const config: SecretConfig = { direct: '   ' }
        const result = await resolveSecret(config)
        expect(result).toBeUndefined()
      })
    })

    describe('file reference', () => {
      it('should read secret from file', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(true)
        vi.mocked(fs.readFileSync).mockReturnValue('secret-from-file')
        vi.mocked(fs.statSync).mockReturnValue({ mode: 0o600 } as fs.Stats)

        const config: SecretConfig = { file: '/path/to/secret' }
        const result = await resolveSecret(config)
        expect(result).toBe('secret-from-file')
        expect(fs.readFileSync).toHaveBeenCalledWith('/path/to/secret', 'utf-8')
      })

      it('should trim whitespace from file contents', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(true)
        vi.mocked(fs.readFileSync).mockReturnValue('  secret-from-file\n')
        vi.mocked(fs.statSync).mockReturnValue({ mode: 0o600 } as fs.Stats)

        const config: SecretConfig = { file: '/path/to/secret' }
        const result = await resolveSecret(config)
        expect(result).toBe('secret-from-file')
      })

      it('should expand ~ in file path', async () => {
        const homeDir = os.homedir()
        vi.mocked(fs.existsSync).mockReturnValue(true)
        vi.mocked(fs.readFileSync).mockReturnValue('secret-from-file')
        vi.mocked(fs.statSync).mockReturnValue({ mode: 0o600 } as fs.Stats)

        const config: SecretConfig = { file: '~/.secrets/api_key' }
        const result = await resolveSecret(config)
        expect(result).toBe('secret-from-file')
        expect(fs.readFileSync).toHaveBeenCalledWith(
          path.join(homeDir, '.secrets', 'api_key'),
          'utf-8'
        )
      })

      it('should warn when file is world-readable', async () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.mocked(fs.existsSync).mockReturnValue(true)
        vi.mocked(fs.readFileSync).mockReturnValue('secret')
        vi.mocked(fs.statSync).mockReturnValue({ mode: 0o644 } as fs.Stats)

        const config: SecretConfig = { file: '/path/to/secret' }
        await resolveSecret(config)
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('world-readable')
        )
      })

      it('should log warning when statSync throws (not silent)', async () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.mocked(fs.existsSync).mockReturnValue(true)
        vi.mocked(fs.readFileSync).mockReturnValue('secret')
        vi.mocked(fs.statSync).mockImplementation(() => {
          throw new Error('ELOOP: too many levels of symbolic links')
        })

        const config: SecretConfig = { file: '/path/to/secret' }
        await resolveSecret(config)

        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('Could not check permissions')
        )
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('ELOOP')
        )
      })

      it('should throw when file does not exist', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(false)

        const config: SecretConfig = { file: '/path/to/nonexistent' }
        await expect(resolveSecret(config)).rejects.toThrow(/does not exist/)
      })

      it('should throw when file read fails', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(true)
        vi.mocked(fs.statSync).mockReturnValue({ mode: 0o600 } as fs.Stats)
        vi.mocked(fs.readFileSync).mockImplementation(() => {
          throw new Error('Permission denied')
        })

        const config: SecretConfig = { file: '/path/to/secret' }
        await expect(resolveSecret(config)).rejects.toThrow(/Permission denied/)
      })
    })

    describe('command reference', () => {
      it('should execute command and return output', async () => {
        vi.mocked(childProcess.execSync).mockReturnValue('secret-from-command')

        const config: SecretConfig = { command: 'echo secret-from-command' }
        const result = await resolveSecret(config)
        expect(result).toBe('secret-from-command')
      })

      it('should trim whitespace from command output', async () => {
        vi.mocked(childProcess.execSync).mockReturnValue('  secret-from-command\n')

        const config: SecretConfig = { command: 'echo secret' }
        const result = await resolveSecret(config)
        expect(result).toBe('secret-from-command')
      })

      it('should use default timeout of 5 seconds', async () => {
        vi.mocked(childProcess.execSync).mockReturnValue('secret')

        const config: SecretConfig = { command: 'some-command' }
        await resolveSecret(config)
        expect(childProcess.execSync).toHaveBeenCalledWith(
          'some-command',
          expect.objectContaining({ timeout: 5000 })
        )
      })

      it('should allow custom timeout', async () => {
        vi.mocked(childProcess.execSync).mockReturnValue('secret')

        const config: SecretConfig = { command: 'some-command', commandTimeout: 10000 }
        await resolveSecret(config)
        expect(childProcess.execSync).toHaveBeenCalledWith(
          'some-command',
          expect.objectContaining({ timeout: 10000 })
        )
      })

      it('should throw when command fails', async () => {
        vi.mocked(childProcess.execSync).mockImplementation(() => {
          throw new Error('Command failed')
        })

        const config: SecretConfig = { command: 'invalid-command' }
        await expect(resolveSecret(config)).rejects.toThrow(/Command failed/)
      })

      it('should throw timeout message when command is killed with SIGTERM', async () => {
        vi.mocked(childProcess.execSync).mockImplementation(() => {
          const error = new Error('Command timed out') as Error & {
            killed: boolean
            signal: string
          }
          error.killed = true
          error.signal = 'SIGTERM'
          throw error
        })

        const config: SecretConfig = { command: 'slow-command' }
        await expect(resolveSecret(config)).rejects.toThrow(/timed out after 5000ms/)
      })

      it('should throw distinct message when command is killed with non-SIGTERM signal', async () => {
        vi.mocked(childProcess.execSync).mockImplementation(() => {
          const error = new Error('Killed') as Error & {
            killed: boolean
            signal: string
          }
          error.killed = true
          error.signal = 'SIGKILL'
          throw error
        })

        const config: SecretConfig = { command: 'oom-command' }
        await expect(resolveSecret(config)).rejects.toThrow(/killed.*SIGKILL/)
      })

      it('should produce useful error when a non-Error is thrown', async () => {
        vi.mocked(childProcess.execSync).mockImplementation(() => {
          throw 'string-error-value'
        })

        const config: SecretConfig = { command: 'bad-command' }
        await expect(resolveSecret(config)).rejects.toThrow(/string-error-value/)
      })
    })

    describe('priority: command > file > direct', () => {
      it('should prefer command over file and direct', async () => {
        vi.mocked(childProcess.execSync).mockReturnValue('from-command')
        vi.mocked(fs.existsSync).mockReturnValue(true)
        vi.mocked(fs.readFileSync).mockReturnValue('from-file')
        vi.mocked(fs.statSync).mockReturnValue({ mode: 0o600 } as fs.Stats)

        const config: SecretConfig = {
          direct: 'from-direct',
          file: '/path/to/secret',
          command: 'echo from-command',
        }
        const result = await resolveSecret(config)
        expect(result).toBe('from-command')
      })

      it('should prefer file over direct when command not provided', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(true)
        vi.mocked(fs.readFileSync).mockReturnValue('from-file')
        vi.mocked(fs.statSync).mockReturnValue({ mode: 0o600 } as fs.Stats)

        const config: SecretConfig = {
          direct: 'from-direct',
          file: '/path/to/secret',
        }
        const result = await resolveSecret(config)
        expect(result).toBe('from-file')
      })

      it('should use direct when command and file not provided', async () => {
        const config: SecretConfig = { direct: 'from-direct' }
        const result = await resolveSecret(config)
        expect(result).toBe('from-direct')
      })
    })

    describe('caching', () => {
      it('should cache resolved secrets', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(true)
        vi.mocked(fs.readFileSync).mockReturnValue('cached-secret')
        vi.mocked(fs.statSync).mockReturnValue({ mode: 0o600 } as fs.Stats)

        const config: SecretConfig = { file: '/path/to/secret' }
        const result1 = await resolveSecret(config, 'apiKey')
        const result2 = await resolveSecret(config, 'apiKey')

        expect(result1).toBe('cached-secret')
        expect(result2).toBe('cached-secret')
        expect(fs.readFileSync).toHaveBeenCalledTimes(1)
      })

      it('should not cache when cacheKey is not provided', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(true)
        vi.mocked(fs.readFileSync).mockReturnValue('uncached-secret')
        vi.mocked(fs.statSync).mockReturnValue({ mode: 0o600 } as fs.Stats)

        const config: SecretConfig = { file: '/path/to/secret' }
        await resolveSecret(config)
        await resolveSecret(config)

        expect(fs.readFileSync).toHaveBeenCalledTimes(2)
      })

      it('should clear cache when clearSecretCache is called', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(true)
        vi.mocked(fs.readFileSync).mockReturnValue('cached-secret')
        vi.mocked(fs.statSync).mockReturnValue({ mode: 0o600 } as fs.Stats)

        const config: SecretConfig = { file: '/path/to/secret' }
        await resolveSecret(config, 'apiKey')
        clearSecretCache()
        await resolveSecret(config, 'apiKey')

        expect(fs.readFileSync).toHaveBeenCalledTimes(2)
      })
    })

    describe('empty config', () => {
      it('should return undefined for empty config', async () => {
        const config: SecretConfig = {}
        const result = await resolveSecret(config)
        expect(result).toBeUndefined()
      })
    })
  })

  describe('resolveSecrets', () => {
    it('should resolve multiple secrets in parallel', async () => {
      const configs = {
        apiKey: { direct: 'api-key-value' } as SecretConfig,
        twilioToken: { direct: 'twilio-token-value' } as SecretConfig,
      }

      const result = await resolveSecrets(configs)
      expect(result).toEqual({
        apiKey: 'api-key-value',
        twilioToken: 'twilio-token-value',
      })
    })

    it('should handle mixed resolution methods', async () => {
      vi.mocked(childProcess.execSync).mockReturnValue('from-command')
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue('from-file')
      vi.mocked(fs.statSync).mockReturnValue({ mode: 0o600 } as fs.Stats)

      const configs = {
        apiKey: { command: 'echo from-command' } as SecretConfig,
        twilioToken: { file: '/path/to/token' } as SecretConfig,
        postmarkToken: { direct: 'direct-value' } as SecretConfig,
      }

      const result = await resolveSecrets(configs)
      expect(result).toEqual({
        apiKey: 'from-command',
        twilioToken: 'from-file',
        postmarkToken: 'direct-value',
      })
    })

    it('should cache all resolved secrets', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue('cached-secret')
      vi.mocked(fs.statSync).mockReturnValue({ mode: 0o600 } as fs.Stats)

      const configs = {
        apiKey: { file: '/path/to/api_key' } as SecretConfig,
        twilioToken: { file: '/path/to/twilio' } as SecretConfig,
      }

      await resolveSecrets(configs)
      await resolveSecrets(configs)

      // Should only read each file once due to caching
      expect(fs.readFileSync).toHaveBeenCalledTimes(2)
    })
  })

  describe('security', () => {
    it('should not include secrets in error messages', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('Failed to read')
      })

      const config: SecretConfig = { file: '/path/to/secret-key-12345' }
      try {
        await resolveSecret(config)
      } catch (error) {
        expect((error as Error).message).not.toContain('secret-key-12345')
      }
    })
  })

  describe('resolveSecretSync', () => {
    describe('direct value', () => {
      it('should return direct value synchronously', () => {
        const config: SecretConfig = { direct: 'my-secret-key' }
        const result = resolveSecretSync(config)
        expect(result).toBe('my-secret-key')
      })

      it('should trim whitespace from direct value', () => {
        const config: SecretConfig = { direct: '  my-secret-key  ' }
        const result = resolveSecretSync(config)
        expect(result).toBe('my-secret-key')
      })

      it('should return undefined for empty direct value', () => {
        const config: SecretConfig = { direct: '' }
        const result = resolveSecretSync(config)
        expect(result).toBeUndefined()
      })

      it('should return undefined for whitespace-only direct value', () => {
        const config: SecretConfig = { direct: '   ' }
        const result = resolveSecretSync(config)
        expect(result).toBeUndefined()
      })
    })

    describe('file reference', () => {
      it('should read secret from file synchronously', () => {
        vi.mocked(fs.existsSync).mockReturnValue(true)
        vi.mocked(fs.readFileSync).mockReturnValue('secret-from-file')
        vi.mocked(fs.statSync).mockReturnValue({ mode: 0o600 } as fs.Stats)

        const config: SecretConfig = { file: '/path/to/secret' }
        const result = resolveSecretSync(config)
        expect(result).toBe('secret-from-file')
        expect(fs.readFileSync).toHaveBeenCalledWith('/path/to/secret', 'utf-8')
      })

      it('should expand ~ in file path', () => {
        const homeDir = os.homedir()
        vi.mocked(fs.existsSync).mockReturnValue(true)
        vi.mocked(fs.readFileSync).mockReturnValue('secret-from-file')
        vi.mocked(fs.statSync).mockReturnValue({ mode: 0o600 } as fs.Stats)

        const config: SecretConfig = { file: '~/.secrets/api_key' }
        const result = resolveSecretSync(config)
        expect(result).toBe('secret-from-file')
        expect(fs.readFileSync).toHaveBeenCalledWith(
          path.join(homeDir, '.secrets', 'api_key'),
          'utf-8'
        )
      })

      it('should log warning when statSync throws (not silent)', () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.mocked(fs.existsSync).mockReturnValue(true)
        vi.mocked(fs.readFileSync).mockReturnValue('secret')
        vi.mocked(fs.statSync).mockImplementation(() => {
          throw new Error('ELOOP: too many levels of symbolic links')
        })

        const config: SecretConfig = { file: '/path/to/secret' }
        resolveSecretSync(config)

        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('Could not check permissions')
        )
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('ELOOP')
        )
      })

      it('should throw when file does not exist', () => {
        vi.mocked(fs.existsSync).mockReturnValue(false)

        const config: SecretConfig = { file: '/path/to/nonexistent' }
        expect(() => resolveSecretSync(config)).toThrow(/does not exist/)
      })

      it('should throw when file read fails', () => {
        vi.mocked(fs.existsSync).mockReturnValue(true)
        vi.mocked(fs.statSync).mockReturnValue({ mode: 0o600 } as fs.Stats)
        vi.mocked(fs.readFileSync).mockImplementation(() => {
          throw new Error('Permission denied')
        })

        const config: SecretConfig = { file: '/path/to/secret' }
        expect(() => resolveSecretSync(config)).toThrow(/Permission denied/)
      })
    })

    describe('command reference', () => {
      it('should execute command and return output synchronously', () => {
        vi.mocked(childProcess.execSync).mockReturnValue('secret-from-command')

        const config: SecretConfig = { command: 'echo secret-from-command' }
        const result = resolveSecretSync(config)
        expect(result).toBe('secret-from-command')
      })

      it('should use default timeout of 5 seconds', () => {
        vi.mocked(childProcess.execSync).mockReturnValue('secret')

        const config: SecretConfig = { command: 'some-command' }
        resolveSecretSync(config)
        expect(childProcess.execSync).toHaveBeenCalledWith(
          'some-command',
          expect.objectContaining({ timeout: 5000 })
        )
      })

      it('should allow custom timeout', () => {
        vi.mocked(childProcess.execSync).mockReturnValue('secret')

        const config: SecretConfig = { command: 'some-command', commandTimeout: 10000 }
        resolveSecretSync(config)
        expect(childProcess.execSync).toHaveBeenCalledWith(
          'some-command',
          expect.objectContaining({ timeout: 10000 })
        )
      })

      it('should throw when command fails', () => {
        vi.mocked(childProcess.execSync).mockImplementation(() => {
          throw new Error('Command failed')
        })

        const config: SecretConfig = { command: 'invalid-command' }
        expect(() => resolveSecretSync(config)).toThrow(/Command failed/)
      })

      it('should throw timeout message when command is killed with SIGTERM', () => {
        vi.mocked(childProcess.execSync).mockImplementation(() => {
          const error = new Error('Command timed out') as Error & {
            killed: boolean
            signal: string
          }
          error.killed = true
          error.signal = 'SIGTERM'
          throw error
        })

        const config: SecretConfig = { command: 'slow-command' }
        expect(() => resolveSecretSync(config)).toThrow(/timed out after 5000ms/)
      })

      it('should throw distinct message when command is killed with non-SIGTERM signal', () => {
        vi.mocked(childProcess.execSync).mockImplementation(() => {
          const error = new Error('Killed') as Error & {
            killed: boolean
            signal: string
          }
          error.killed = true
          error.signal = 'SIGKILL'
          throw error
        })

        const config: SecretConfig = { command: 'oom-command' }
        expect(() => resolveSecretSync(config)).toThrow(/killed.*SIGKILL/)
      })

      it('should produce useful error when a non-Error is thrown', () => {
        vi.mocked(childProcess.execSync).mockImplementation(() => {
          throw 'string-error-value'
        })

        const config: SecretConfig = { command: 'bad-command' }
        expect(() => resolveSecretSync(config)).toThrow(/string-error-value/)
      })
    })

    describe('priority: command > file > direct', () => {
      it('should prefer command over file and direct', () => {
        vi.mocked(childProcess.execSync).mockReturnValue('from-command')
        vi.mocked(fs.existsSync).mockReturnValue(true)
        vi.mocked(fs.readFileSync).mockReturnValue('from-file')
        vi.mocked(fs.statSync).mockReturnValue({ mode: 0o600 } as fs.Stats)

        const config: SecretConfig = {
          direct: 'from-direct',
          file: '/path/to/secret',
          command: 'echo from-command',
        }
        const result = resolveSecretSync(config)
        expect(result).toBe('from-command')
      })

      it('should prefer file over direct when command not provided', () => {
        vi.mocked(fs.existsSync).mockReturnValue(true)
        vi.mocked(fs.readFileSync).mockReturnValue('from-file')
        vi.mocked(fs.statSync).mockReturnValue({ mode: 0o600 } as fs.Stats)

        const config: SecretConfig = {
          direct: 'from-direct',
          file: '/path/to/secret',
        }
        const result = resolveSecretSync(config)
        expect(result).toBe('from-file')
      })
    })

    describe('caching', () => {
      it('should cache resolved secrets', () => {
        vi.mocked(fs.existsSync).mockReturnValue(true)
        vi.mocked(fs.readFileSync).mockReturnValue('cached-secret')
        vi.mocked(fs.statSync).mockReturnValue({ mode: 0o600 } as fs.Stats)

        const config: SecretConfig = { file: '/path/to/secret' }
        const result1 = resolveSecretSync(config, 'syncApiKey')
        const result2 = resolveSecretSync(config, 'syncApiKey')

        expect(result1).toBe('cached-secret')
        expect(result2).toBe('cached-secret')
        expect(fs.readFileSync).toHaveBeenCalledTimes(1)
      })
    })

    describe('return type', () => {
      it('should NOT return a Promise', () => {
        const config: SecretConfig = { direct: 'test-value' }
        const result = resolveSecretSync(config)
        // Verify it is NOT thenable (not a Promise)
        expect(result).not.toBeInstanceOf(Promise)
        expect(typeof (result as unknown as Record<string, unknown>)?.then).not.toBe('function')
      })

      it('should return undefined for empty config without being a Promise', () => {
        const config: SecretConfig = {}
        const result = resolveSecretSync(config)
        expect(result).toBeUndefined()
      })
    })
  })
})
