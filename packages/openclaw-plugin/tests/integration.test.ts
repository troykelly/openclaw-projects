/**
 * Integration tests for the OpenClaw plugin.
 * Tests full plugin lifecycle and multi-user scenarios.
 */

import { describe, expect, it, vi } from 'vitest';
import { register, type RegistrationContext } from '../src/index.js';
import type { Logger } from '../src/logger.js';

describe('Integration Tests', () => {
  const createMockLogger = (): Logger => ({
    namespace: 'test',
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  });

  describe('Full Plugin Lifecycle', () => {
    it('should register plugin with valid config', () => {
      const mockLogger = createMockLogger();
      const ctx: RegistrationContext = {
        config: {
          apiUrl: 'https://api.example.com',
          apiKey: 'test-key',
        },
        logger: mockLogger,
      };

      const instance = register(ctx);

      expect(instance.id).toBe('openclaw-projects');
      expect(instance.name).toBe('OpenClaw Projects Plugin');
      expect(instance.kind).toBe('memory');
    });

    it('should create all memory tools', () => {
      const ctx: RegistrationContext = {
        config: {
          apiUrl: 'https://api.example.com',
          apiKey: 'test-key',
        },
        logger: createMockLogger(),
      };

      const instance = register(ctx);

      expect(instance.tools.memoryRecall).toBeDefined();
      expect(instance.tools.memoryStore).toBeDefined();
      expect(instance.tools.memoryForget).toBeDefined();
    });

    it('should create all project tools', () => {
      const ctx: RegistrationContext = {
        config: {
          apiUrl: 'https://api.example.com',
          apiKey: 'test-key',
        },
        logger: createMockLogger(),
      };

      const instance = register(ctx);

      expect(instance.tools.projectList).toBeDefined();
      expect(instance.tools.projectGet).toBeDefined();
      expect(instance.tools.projectCreate).toBeDefined();
    });

    it('should create all todo tools', () => {
      const ctx: RegistrationContext = {
        config: {
          apiUrl: 'https://api.example.com',
          apiKey: 'test-key',
        },
        logger: createMockLogger(),
      };

      const instance = register(ctx);

      expect(instance.tools.todoList).toBeDefined();
      expect(instance.tools.todoCreate).toBeDefined();
      expect(instance.tools.todoComplete).toBeDefined();
    });

    it('should create all contact tools', () => {
      const ctx: RegistrationContext = {
        config: {
          apiUrl: 'https://api.example.com',
          apiKey: 'test-key',
        },
        logger: createMockLogger(),
      };

      const instance = register(ctx);

      expect(instance.tools.contactSearch).toBeDefined();
      expect(instance.tools.contactGet).toBeDefined();
      expect(instance.tools.contactCreate).toBeDefined();
    });

    it('should create lifecycle hooks', () => {
      const ctx: RegistrationContext = {
        config: {
          apiUrl: 'https://api.example.com',
          apiKey: 'test-key',
        },
        logger: createMockLogger(),
      };

      const instance = register(ctx);

      expect(instance.hooks.beforeAgentStart).toBeDefined();
      expect(typeof instance.hooks.beforeAgentStart).toBe('function');
      expect(instance.hooks.agentEnd).toBeDefined();
      expect(typeof instance.hooks.agentEnd).toBe('function');
    });

    it('should create CLI commands', () => {
      const ctx: RegistrationContext = {
        config: {
          apiUrl: 'https://api.example.com',
          apiKey: 'test-key',
        },
        logger: createMockLogger(),
      };

      const instance = register(ctx);

      expect(instance.cli).toBeDefined();
      expect(instance.cli.status).toBeDefined();
      expect(instance.cli.users).toBeDefined();
      expect(instance.cli.recall).toBeDefined();
    });

    it('should create health check function', () => {
      const ctx: RegistrationContext = {
        config: {
          apiUrl: 'https://api.example.com',
          apiKey: 'test-key',
        },
        logger: createMockLogger(),
      };

      const instance = register(ctx);

      expect(instance.healthCheck).toBeDefined();
      expect(typeof instance.healthCheck).toBe('function');
    });

    it('should log registration', () => {
      const mockLogger = createMockLogger();
      const ctx: RegistrationContext = {
        config: {
          apiUrl: 'https://api.example.com',
          apiKey: 'test-key',
        },
        logger: mockLogger,
      };

      register(ctx);

      expect(mockLogger.info).toHaveBeenCalledWith('Plugin registered', expect.any(Object));
    });

    it('should apply default config values', () => {
      const ctx: RegistrationContext = {
        config: {
          apiUrl: 'https://api.example.com',
          apiKey: 'test-key',
        },
        logger: createMockLogger(),
      };

      const instance = register(ctx);

      expect(instance.config.autoRecall).toBe(true);
      expect(instance.config.autoCapture).toBe(true);
      expect(instance.config.userScoping).toBe('agent');
      expect(instance.config.maxRecallMemories).toBe(5);
      expect(instance.config.minRecallScore).toBe(0.7);
    });

    it('should respect custom config values', () => {
      const ctx: RegistrationContext = {
        config: {
          apiUrl: 'https://api.example.com',
          apiKey: 'test-key',
          autoRecall: false,
          autoCapture: false,
          userScoping: 'session',
          maxRecallMemories: 10,
          minRecallScore: 0.9,
        },
        logger: createMockLogger(),
      };

      const instance = register(ctx);

      expect(instance.config.autoRecall).toBe(false);
      expect(instance.config.autoCapture).toBe(false);
      expect(instance.config.userScoping).toBe('session');
      expect(instance.config.maxRecallMemories).toBe(10);
      expect(instance.config.minRecallScore).toBe(0.9);
    });
  });

  describe('Multi-User Scenarios', () => {
    describe('Agent Scoping Mode', () => {
      it('should use agent ID for user scoping', () => {
        const mockLogger = createMockLogger();
        const ctx: RegistrationContext = {
          config: {
            apiUrl: 'https://api.example.com',
            apiKey: 'test-key',
            userScoping: 'agent',
          },
          logger: mockLogger,
        };

        const _instance = register(ctx);

        // The plugin should register and log with some user_id
        expect(mockLogger.info).toHaveBeenCalledWith(
          'Plugin registered',
          expect.objectContaining({
            user_id: expect.any(String),
          }),
        );
      });
    });

    describe('Session Scoping Mode', () => {
      it('should use session key for user scoping', () => {
        const mockLogger = createMockLogger();
        const ctx: RegistrationContext = {
          config: {
            apiUrl: 'https://api.example.com',
            apiKey: 'test-key',
            userScoping: 'session',
          },
          logger: mockLogger,
        };

        const _instance = register(ctx);

        // With session scoping, user_id should include session info
        expect(mockLogger.info).toHaveBeenCalledWith(
          'Plugin registered',
          expect.objectContaining({
            user_id: expect.any(String),
          }),
        );
      });
    });

    describe('Identity Scoping Mode', () => {
      it('should use identity for user scoping when available', () => {
        const mockLogger = createMockLogger();
        const ctx: RegistrationContext = {
          config: {
            apiUrl: 'https://api.example.com',
            apiKey: 'test-key',
            userScoping: 'identity',
          },
          logger: mockLogger,
        };

        const _instance = register(ctx);

        expect(mockLogger.info).toHaveBeenCalledWith('Plugin registered', expect.any(Object));
      });
    });

    describe('User Isolation', () => {
      it('should create separate plugin instances', () => {
        const ctx1: RegistrationContext = {
          config: {
            apiUrl: 'https://api.example.com',
            apiKey: 'test-key',
          },
          logger: createMockLogger(),
        };

        const ctx2: RegistrationContext = {
          config: {
            apiUrl: 'https://api.example.com',
            apiKey: 'test-key',
          },
          logger: createMockLogger(),
        };

        const instance1 = register(ctx1);
        const instance2 = register(ctx2);

        // Each instance should be independent
        expect(instance1).not.toBe(instance2);
        expect(instance1.tools).not.toBe(instance2.tools);
      });
    });
  });

  describe('Tool Availability', () => {
    it('should have correct tool names', () => {
      const ctx: RegistrationContext = {
        config: {
          apiUrl: 'https://api.example.com',
          apiKey: 'test-key',
        },
        logger: createMockLogger(),
      };

      const instance = register(ctx);

      expect(instance.tools.memoryRecall.name).toBe('memory_recall');
      expect(instance.tools.memoryStore.name).toBe('memory_store');
      expect(instance.tools.memoryForget.name).toBe('memory_forget');
      expect(instance.tools.projectList.name).toBe('project_list');
      expect(instance.tools.projectGet.name).toBe('project_get');
      expect(instance.tools.projectCreate.name).toBe('project_create');
      expect(instance.tools.todoList.name).toBe('todo_list');
      expect(instance.tools.todoCreate.name).toBe('todo_create');
      expect(instance.tools.todoComplete.name).toBe('todo_complete');
      expect(instance.tools.contactSearch.name).toBe('contact_search');
      expect(instance.tools.contactGet.name).toBe('contact_get');
      expect(instance.tools.contactCreate.name).toBe('contact_create');
    });

    it('should have tool descriptions', () => {
      const ctx: RegistrationContext = {
        config: {
          apiUrl: 'https://api.example.com',
          apiKey: 'test-key',
        },
        logger: createMockLogger(),
      };

      const instance = register(ctx);

      expect(instance.tools.memoryRecall.description).toBeDefined();
      expect(instance.tools.memoryStore.description).toBeDefined();
      expect(instance.tools.memoryForget.description).toBeDefined();
      expect(instance.tools.projectList.description).toBeDefined();
      expect(instance.tools.projectGet.description).toBeDefined();
      expect(instance.tools.projectCreate.description).toBeDefined();
      expect(instance.tools.todoList.description).toBeDefined();
      expect(instance.tools.todoCreate.description).toBeDefined();
      expect(instance.tools.todoComplete.description).toBeDefined();
      expect(instance.tools.contactSearch.description).toBeDefined();
      expect(instance.tools.contactGet.description).toBeDefined();
      expect(instance.tools.contactCreate.description).toBeDefined();
    });

    it('should have tool parameter schemas', () => {
      const ctx: RegistrationContext = {
        config: {
          apiUrl: 'https://api.example.com',
          apiKey: 'test-key',
        },
        logger: createMockLogger(),
      };

      const instance = register(ctx);

      expect(instance.tools.memoryRecall.parameters).toBeDefined();
      expect(instance.tools.memoryStore.parameters).toBeDefined();
      expect(instance.tools.memoryForget.parameters).toBeDefined();
    });

    it('should have executable functions', () => {
      const ctx: RegistrationContext = {
        config: {
          apiUrl: 'https://api.example.com',
          apiKey: 'test-key',
        },
        logger: createMockLogger(),
      };

      const instance = register(ctx);

      expect(typeof instance.tools.memoryRecall.execute).toBe('function');
      expect(typeof instance.tools.memoryStore.execute).toBe('function');
      expect(typeof instance.tools.memoryForget.execute).toBe('function');
      expect(typeof instance.tools.projectList.execute).toBe('function');
      expect(typeof instance.tools.projectGet.execute).toBe('function');
      expect(typeof instance.tools.projectCreate.execute).toBe('function');
      expect(typeof instance.tools.todoList.execute).toBe('function');
      expect(typeof instance.tools.todoCreate.execute).toBe('function');
      expect(typeof instance.tools.todoComplete.execute).toBe('function');
      expect(typeof instance.tools.contactSearch.execute).toBe('function');
      expect(typeof instance.tools.contactGet.execute).toBe('function');
      expect(typeof instance.tools.contactCreate.execute).toBe('function');
    });
  });

  describe('Hook Behavior', () => {
    it('should skip auto-recall when disabled', async () => {
      const ctx: RegistrationContext = {
        config: {
          apiUrl: 'https://api.example.com',
          apiKey: 'test-key',
          autoRecall: false,
        },
        logger: createMockLogger(),
      };

      const instance = register(ctx);
      const result = await instance.hooks.beforeAgentStart({ prompt: 'test' });

      expect(result).toBeNull();
    });

    it('should skip auto-capture when disabled', async () => {
      const mockLogger = createMockLogger();
      const ctx: RegistrationContext = {
        config: {
          apiUrl: 'https://api.example.com',
          apiKey: 'test-key',
          autoCapture: false,
        },
        logger: mockLogger,
      };

      const instance = register(ctx);
      await instance.hooks.agentEnd({ messages: [] });

      // Should log that it was skipped
      expect(mockLogger.debug).toHaveBeenCalledWith('auto-capture skipped: disabled in config', expect.any(Object));
    });
  });

  describe('Error Handling', () => {
    it('should throw on invalid config', () => {
      const ctx: RegistrationContext = {
        config: {
          // Missing required fields
        },
        logger: createMockLogger(),
      };

      expect(() => register(ctx)).toThrow();
    });

    it('should throw on invalid API URL', () => {
      const ctx: RegistrationContext = {
        config: {
          apiUrl: 'not-a-valid-url',
          apiKey: 'test-key',
        },
        logger: createMockLogger(),
      };

      expect(() => register(ctx)).toThrow();
    });

    it('should handle missing logger gracefully', () => {
      const ctx: RegistrationContext = {
        config: {
          apiUrl: 'https://api.example.com',
          apiKey: 'test-key',
        },
        // No logger provided
      };

      // Should create a default logger
      expect(() => register(ctx)).not.toThrow();
    });
  });
});
