import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(__dirname, '..')

describe('Package Structure', () => {
  describe('Required Files', () => {
    it('should have openclaw.plugin.json manifest', () => {
      const manifestPath = join(packageRoot, 'openclaw.plugin.json')
      expect(existsSync(manifestPath)).toBe(true)
    })

    it('should have package.json', () => {
      const packagePath = join(packageRoot, 'package.json')
      expect(existsSync(packagePath)).toBe(true)
    })

    it('should have tsconfig.json', () => {
      const tsconfigPath = join(packageRoot, 'tsconfig.json')
      expect(existsSync(tsconfigPath)).toBe(true)
    })

    it('should have .npmignore', () => {
      const npmignorePath = join(packageRoot, '.npmignore')
      expect(existsSync(npmignorePath)).toBe(true)
    })

    it('should have src/index.ts entry point', () => {
      const indexPath = join(packageRoot, 'src', 'index.ts')
      expect(existsSync(indexPath)).toBe(true)
    })

    it('should have src/config.ts for Zod schema', () => {
      const configPath = join(packageRoot, 'src', 'config.ts')
      expect(existsSync(configPath)).toBe(true)
    })

    it('should have src/context.ts for context extraction', () => {
      const contextPath = join(packageRoot, 'src', 'context.ts')
      expect(existsSync(contextPath)).toBe(true)
    })

    it('should have src/api-client.ts for HTTP client', () => {
      const apiClientPath = join(packageRoot, 'src', 'api-client.ts')
      expect(existsSync(apiClientPath)).toBe(true)
    })

    it('should have src/logger.ts for safe logging', () => {
      const loggerPath = join(packageRoot, 'src', 'logger.ts')
      expect(existsSync(loggerPath)).toBe(true)
    })

    it('should have src/tools/index.ts barrel', () => {
      const toolsIndexPath = join(packageRoot, 'src', 'tools', 'index.ts')
      expect(existsSync(toolsIndexPath)).toBe(true)
    })
  })

  describe('openclaw.plugin.json manifest', () => {
    it('should have valid JSON structure', () => {
      const manifestPath = join(packageRoot, 'openclaw.plugin.json')
      const content = readFileSync(manifestPath, 'utf-8')
      expect(() => JSON.parse(content)).not.toThrow()
    })

    it('should have kind set to "memory"', () => {
      const manifestPath = join(packageRoot, 'openclaw.plugin.json')
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      expect(manifest.kind).toBe('memory')
    })

    it('should have required fields', () => {
      const manifestPath = join(packageRoot, 'openclaw.plugin.json')
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      expect(manifest).toHaveProperty('id')
      expect(manifest).toHaveProperty('name')
      expect(manifest).toHaveProperty('description')
      expect(manifest).toHaveProperty('version')
      expect(manifest).toHaveProperty('main')
      expect(manifest).toHaveProperty('configSchema')
    })

    it('should have configSchema with required apiUrl and flexible apiKey', () => {
      const manifestPath = join(packageRoot, 'openclaw.plugin.json')
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      expect(manifest.configSchema.required).toContain('apiUrl')
      // apiKey is now flexible - uses anyOf with apiKey, apiKeyFile, or apiKeyCommand
      expect(manifest.configSchema.anyOf).toBeDefined()
      expect(manifest.configSchema.anyOf).toHaveLength(3)
      expect(manifest.configSchema.anyOf[0].required).toContain('apiKey')
      expect(manifest.configSchema.anyOf[1].required).toContain('apiKeyFile')
      expect(manifest.configSchema.anyOf[2].required).toContain('apiKeyCommand')
    })
  })

  describe('package.json', () => {
    it('should have valid JSON structure', () => {
      const packagePath = join(packageRoot, 'package.json')
      const content = readFileSync(packagePath, 'utf-8')
      expect(() => JSON.parse(content)).not.toThrow()
    })

    it('should have correct package name', () => {
      const packagePath = join(packageRoot, 'package.json')
      const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'))
      expect(pkg.name).toBe('@troykelly/openclaw-projects')
    })

    it('should have zod as dependency', () => {
      const packagePath = join(packageRoot, 'package.json')
      const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'))
      expect(pkg.dependencies || pkg.peerDependencies).toHaveProperty('zod')
    })

    it('should have openclaw as peer dependency', () => {
      const packagePath = join(packageRoot, 'package.json')
      const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'))
      expect(pkg.peerDependencies).toHaveProperty('openclaw')
    })

    it('should have files field explicitly listing dist and manifest', () => {
      const packagePath = join(packageRoot, 'package.json')
      const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'))
      expect(pkg.files).toBeDefined()
      expect(pkg.files).toContain('dist')
      expect(pkg.files).toContain('openclaw.plugin.json')
    })

    it('should have build script', () => {
      const packagePath = join(packageRoot, 'package.json')
      const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'))
      expect(pkg.scripts).toHaveProperty('build')
    })

    it('should have openclaw.extensions field for plugin installer discovery', () => {
      const packagePath = join(packageRoot, 'package.json')
      const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'))
      expect(pkg.openclaw).toBeDefined()
      expect(pkg.openclaw.extensions).toBeDefined()
      expect(Array.isArray(pkg.openclaw.extensions)).toBe(true)
      expect(pkg.openclaw.extensions.length).toBeGreaterThan(0)
    })

    it('should list dist/register-openclaw.js as an openclaw extension entry point', () => {
      const packagePath = join(packageRoot, 'package.json')
      const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'))
      expect(pkg.openclaw.extensions).toContain('dist/register-openclaw.js')
    })

    it('should have openclaw.extensions entries that match files in the package', () => {
      const packagePath = join(packageRoot, 'package.json')
      const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'))
      // All extension entries should be non-empty strings
      for (const entry of pkg.openclaw.extensions) {
        expect(typeof entry).toBe('string')
        expect(entry.trim().length).toBeGreaterThan(0)
      }
    })
  })

  describe('.npmignore security', () => {
    it('should exclude .env files', () => {
      const npmignorePath = join(packageRoot, '.npmignore')
      const content = readFileSync(npmignorePath, 'utf-8')
      expect(content).toMatch(/\.env\*/i)
    })

    it('should exclude *.local.* files', () => {
      const npmignorePath = join(packageRoot, '.npmignore')
      const content = readFileSync(npmignorePath, 'utf-8')
      expect(content).toMatch(/\*\.local\.\*/i)
    })

    it('should exclude node_modules', () => {
      const npmignorePath = join(packageRoot, '.npmignore')
      const content = readFileSync(npmignorePath, 'utf-8')
      expect(content).toMatch(/node_modules/i)
    })

    it('should exclude .git', () => {
      const npmignorePath = join(packageRoot, '.npmignore')
      const content = readFileSync(npmignorePath, 'utf-8')
      expect(content).toMatch(/\.git/i)
    })
  })

  describe('tsconfig.json', () => {
    it('should target ES2022', () => {
      const tsconfigPath = join(packageRoot, 'tsconfig.json')
      const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf-8'))
      expect(tsconfig.compilerOptions.target).toBe('ES2022')
    })

    it('should use NodeNext module resolution', () => {
      const tsconfigPath = join(packageRoot, 'tsconfig.json')
      const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf-8'))
      expect(tsconfig.compilerOptions.module).toBe('NodeNext')
      expect(tsconfig.compilerOptions.moduleResolution).toBe('NodeNext')
    })
  })

  describe('Skills Directory', () => {
    it('should have skillsDir declared in manifest', () => {
      const manifestPath = join(packageRoot, 'openclaw.plugin.json')
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      expect(manifest.skillsDir).toBe('skills')
    })

    it('should have skills directory', () => {
      const skillsPath = join(packageRoot, 'skills')
      expect(existsSync(skillsPath)).toBe(true)
    })

    it('should have daily-summary skill', () => {
      const skillPath = join(packageRoot, 'skills', 'daily-summary', 'SKILL.md')
      expect(existsSync(skillPath)).toBe(true)
    })

    it('should have project-status skill', () => {
      const skillPath = join(packageRoot, 'skills', 'project-status', 'SKILL.md')
      expect(existsSync(skillPath)).toBe(true)
    })

    it('should have contact-lookup skill', () => {
      const skillPath = join(packageRoot, 'skills', 'contact-lookup', 'SKILL.md')
      expect(existsSync(skillPath)).toBe(true)
    })

    it('should have send-reminder skill', () => {
      const skillPath = join(packageRoot, 'skills', 'send-reminder', 'SKILL.md')
      expect(existsSync(skillPath)).toBe(true)
    })

    it('should have valid SKILL.md format with frontmatter', () => {
      const skillPath = join(packageRoot, 'skills', 'daily-summary', 'SKILL.md')
      const content = readFileSync(skillPath, 'utf-8')
      // Should start with frontmatter
      expect(content).toMatch(/^---/)
      // Should have name field
      expect(content).toMatch(/name:\s+\S+/)
      // Should have description field
      expect(content).toMatch(/description:\s+.+/)
    })

    it('should have skills with args defined where needed', () => {
      const skillPath = join(packageRoot, 'skills', 'project-status', 'SKILL.md')
      const content = readFileSync(skillPath, 'utf-8')
      // project-status should have args
      expect(content).toMatch(/args:/)
      expect(content).toMatch(/name:\s+project/)
    })
  })
})
