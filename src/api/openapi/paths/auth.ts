/**
 * OpenAPI path definitions for authentication endpoints.
 * Routes: POST /api/auth/request-link, POST /api/auth/consume,
 *         POST /api/auth/refresh, POST /api/auth/revoke,
 *         POST /api/auth/exchange, GET /api/me
 */
import type { OpenApiDomainModule } from '../types.ts';
import { ref, errorResponses, jsonBody, jsonResponse } from '../helpers.ts';

export function authPaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'Auth', description: 'Authentication via magic links, token refresh, and OAuth code exchange' },
    ],
    schemas: {
      MagicLinkRequest: {
        type: 'object',
        required: ['email'],
        properties: {
          email: {
            type: 'string',
            format: 'email',
            description: 'Email address to send the magic link to',
            example: 'alice@example.com',
          },
        },
      },
      MagicLinkResponse: {
        type: 'object',
        required: ['ok'],
        properties: {
          ok: {
            type: 'boolean',
            description: 'Whether the magic link was created successfully',
            example: true,
          },
          login_url: {
            type: 'string',
            description: 'Login URL (only returned in non-production when email delivery is not configured)',
            example: 'https://app.example.com/auth/consume?token=abc123def456',
          },
        },
      },
      ConsumeRequest: {
        type: 'object',
        required: ['token'],
        properties: {
          token: {
            type: 'string',
            description: 'Magic link token from the email URL',
            example: 'eyJhbGciOiJSUzI1NiIs...',
          },
        },
      },
      TokenResponse: {
        type: 'object',
        required: ['access_token'],
        properties: {
          access_token: {
            type: 'string',
            description: 'JWT access token for API authentication. Include in the Authorization header as "Bearer <token>".',
            example: 'eyJhbGciOiJSUzI1NiIs...',
          },
        },
      },
      ExchangeRequest: {
        type: 'object',
        required: ['code'],
        properties: {
          code: {
            type: 'string',
            description: 'One-time OAuth authorization code received from the OAuth callback',
            example: 'oac_abc123def456ghi789',
          },
        },
      },
      RevokeResponse: {
        type: 'object',
        required: ['ok'],
        properties: {
          ok: {
            type: 'boolean',
            description: 'Whether the token was successfully revoked',
            example: true,
          },
        },
      },
      MeResponse: {
        type: 'object',
        required: ['email'],
        properties: {
          email: {
            type: 'string',
            format: 'email',
            description: 'Email of the authenticated user',
            example: 'alice@example.com',
          },
        },
      },
    },
    paths: {
      '/api/auth/request-link': {
        post: {
          operationId: 'requestMagicLink',
          summary: 'Request a magic link',
          description: 'Sends a magic link email to the provided address. The link contains a one-time token valid for 15 minutes. Rate limited.',
          tags: ['Auth'],
          security: [],
          requestBody: jsonBody(ref('MagicLinkRequest')),
          responses: {
            '201': jsonResponse('Magic link created', ref('MagicLinkResponse')),
            ...errorResponses(400, 429, 500),
          },
        },
      },
      '/api/auth/consume': {
        post: {
          operationId: 'consumeMagicLink',
          summary: 'Consume a magic link token',
          description: 'Validates a magic link token and returns a JWT access token. Also sets an HttpOnly refresh token cookie. Rate limited.',
          tags: ['Auth'],
          security: [],
          requestBody: jsonBody(ref('ConsumeRequest')),
          responses: {
            '200': jsonResponse('Authentication successful', ref('TokenResponse')),
            ...errorResponses(400, 401, 429, 500),
          },
        },
      },
      '/api/auth/refresh': {
        post: {
          operationId: 'refreshToken',
          summary: 'Refresh access token',
          description: 'Uses the HttpOnly refresh token cookie to issue a new JWT access token and rotate the refresh token. Detects token reuse attacks and revokes the entire token family if reuse is detected. Rate limited.',
          tags: ['Auth'],
          security: [],
          responses: {
            '200': jsonResponse('Token refreshed', ref('TokenResponse')),
            ...errorResponses(401, 429, 500),
          },
        },
      },
      '/api/auth/revoke': {
        post: {
          operationId: 'revokeToken',
          summary: 'Revoke refresh token (logout)',
          description: 'Revokes the current refresh token family and clears the refresh cookie. Effectively logs the user out. Rate limited.',
          tags: ['Auth'],
          security: [],
          responses: {
            '200': jsonResponse('Token revoked', ref('RevokeResponse')),
            ...errorResponses(429, 500),
          },
        },
      },
      '/api/auth/exchange': {
        post: {
          operationId: 'exchangeCode',
          summary: 'Exchange one-time OAuth code for tokens',
          description: 'Validates a one-time OAuth authorization code and returns a JWT access token. Also sets an HttpOnly refresh token cookie. Enforces JSON content type and validates Origin header for CSRF protection. Rate limited.',
          tags: ['Auth'],
          security: [],
          requestBody: jsonBody(ref('ExchangeRequest')),
          responses: {
            '200': jsonResponse('Authentication successful', ref('TokenResponse')),
            ...errorResponses(400, 403, 415, 429, 500),
          },
        },
      },
      '/api/me': {
        get: {
          operationId: 'getCurrentUser',
          summary: 'Get current authenticated user',
          description: 'Returns the email address of the currently authenticated user based on the JWT bearer token.',
          tags: ['Auth'],
          responses: {
            '200': jsonResponse('Current user info', ref('MeResponse')),
            ...errorResponses(401, 500),
          },
        },
      },
    },
  };
}
