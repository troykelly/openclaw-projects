/**
 * Unit tests for embedding text generator templates.
 * Part of API Onboarding feature (#1779).
 */

import { describe, it, expect } from 'vitest';
import {
  generateOperationText,
  generateTagGroupText,
  generateOverviewText,
} from '../../../src/api/api-sources/embedding-text.ts';
import type {
  ParsedOperation,
  ParsedTagGroup,
  ParsedApiOverview,
} from '../../../src/api/api-sources/types.ts';

const sampleOperation: ParsedOperation = {
  operationKey: 'getDepartures',
  method: 'GET',
  path: '/v1/stops/{stop_id}/departures',
  summary: 'Get real-time departures',
  description: 'Returns a list of departure information for a given stop, including route, direction, and estimated times.',
  tags: ['realtime', 'departures'],
  parameters: [
    { name: 'stop_id', in: 'path', description: 'The unique stop identifier', required: true, schema: { type: 'string' } },
    { name: 'limit', in: 'query', description: 'Maximum number of results', required: false, schema: { type: 'integer' } },
  ],
  requestBody: null,
  responses: {
    '200': { description: 'Successful response', schema: { type: 'object', properties: { departures: { type: 'array' } } } },
    '404': { description: 'Stop not found' },
  },
};

const sampleOperationNoDesc: ParsedOperation = {
  operationKey: 'GET:/v1/users/{}',
  method: 'GET',
  path: '/v1/users/{user_id}',
  summary: null,
  description: null,
  tags: [],
  parameters: [
    { name: 'user_id', in: 'path', description: 'User identifier', required: true, schema: { type: 'string' } },
  ],
  requestBody: null,
  responses: {},
};

const sampleOperationNoParams: ParsedOperation = {
  operationKey: 'getHealth',
  method: 'GET',
  path: '/health',
  summary: 'Health check',
  description: 'Returns service health status.',
  tags: ['system'],
  parameters: [],
  requestBody: null,
  responses: {
    '200': { description: 'Healthy' },
  },
};

describe('generateOperationText', () => {
  it('produces intent-first text with parameters', () => {
    const result = generateOperationText(sampleOperation, 'Transport API', 'API key in header');

    expect(result.title).toContain('getDepartures');
    expect(result.content).toContain('GET');
    expect(result.content).toContain('/v1/stops/{stop_id}/departures');
    expect(result.content).toContain('departure');
    expect(result.content).toContain('stop_id');
    expect(result.content).toContain('limit');
    expect(result.content).toContain('Transport API');
    expect(result.content).toContain('API key in header');
    expect(result.descriptionQuality).toBe('original');
  });

  it('includes return information', () => {
    const result = generateOperationText(sampleOperation, 'Transport API', 'API key');
    expect(result.content).toContain('200');
  });

  it('includes tags in output', () => {
    const result = generateOperationText(sampleOperation, 'Transport API', 'API key');
    expect(result.content).toContain('realtime');
    expect(result.content).toContain('departures');
  });

  it('synthesizes description from path when none provided', () => {
    const result = generateOperationText(sampleOperationNoDesc, 'User API', 'none');

    expect(result.descriptionQuality).toBe('synthesized');
    // Should synthesize something meaningful from the path
    expect(result.content).toContain('users');
    expect(result.content).toContain('GET');
  });

  it('omits Inputs section when no parameters', () => {
    const result = generateOperationText(sampleOperationNoParams, 'System API', 'none');

    expect(result.content).toContain('Health check');
    // Should not have an empty parameters section
    expect(result.content).not.toMatch(/Inputs:\s*\n\s*\n/);
  });

  it('handles missing response schema gracefully', () => {
    const op: ParsedOperation = {
      ...sampleOperation,
      responses: { '204': { description: 'No content' } },
    };
    const result = generateOperationText(op, 'API', 'none');
    expect(result.content).toContain('204');
  });
});

describe('generateTagGroupText', () => {
  const sampleTagGroup: ParsedTagGroup = {
    tag: 'realtime',
    description: 'Real-time transit data endpoints',
    operations: [
      { operationKey: 'getDepartures', method: 'GET', path: '/v1/stops/{stop_id}/departures', summary: 'Get departures' },
      { operationKey: 'getArrivals', method: 'GET', path: '/v1/stops/{stop_id}/arrivals', summary: 'Get arrivals' },
    ],
  };

  it('produces group summary with operation list', () => {
    const result = generateTagGroupText(sampleTagGroup, 'Transport API');

    expect(result.title).toContain('realtime');
    expect(result.content).toContain('Transport API');
    expect(result.content).toContain('Real-time transit data');
    expect(result.content).toContain('getDepartures');
    expect(result.content).toContain('getArrivals');
    expect(result.content).toContain('GET');
  });

  it('handles tag group with no description', () => {
    const tagGroup: ParsedTagGroup = {
      tag: 'misc',
      description: null,
      operations: [
        { operationKey: 'ping', method: 'GET', path: '/ping', summary: 'Ping' },
      ],
    };
    const result = generateTagGroupText(tagGroup, 'API');
    expect(result.title).toContain('misc');
    expect(result.content).toContain('ping');
  });

  it('handles tag group with empty operations', () => {
    const tagGroup: ParsedTagGroup = {
      tag: 'empty',
      description: 'No operations yet',
      operations: [],
    };
    const result = generateTagGroupText(tagGroup, 'API');
    expect(result.title).toContain('empty');
  });
});

describe('generateOverviewText', () => {
  const sampleOverview: ParsedApiOverview = {
    name: 'Transport NSW API',
    description: 'Real-time and static public transport data for New South Wales.',
    version: '2.0',
    servers: [{ url: 'https://api.transport.nsw.gov.au' }],
    authSummary: 'API key required in Authorization header',
    tagGroups: [
      { tag: 'realtime', operationCount: 5 },
      { tag: 'static', operationCount: 12 },
    ],
    totalOperations: 17,
  };

  it('produces API summary with tag group list', () => {
    const result = generateOverviewText(sampleOverview);

    expect(result.title).toContain('Transport NSW API');
    expect(result.content).toContain('Transport NSW API');
    expect(result.content).toContain('Real-time and static public transport');
    expect(result.content).toContain('2.0');
    expect(result.content).toContain('api.transport.nsw.gov.au');
    expect(result.content).toContain('API key required');
    expect(result.content).toContain('realtime');
    expect(result.content).toContain('static');
    expect(result.content).toContain('17');
  });

  it('handles missing optional fields', () => {
    const overview: ParsedApiOverview = {
      name: 'Minimal API',
      description: null,
      version: null,
      servers: [],
      authSummary: 'none',
      tagGroups: [],
      totalOperations: 0,
    };
    const result = generateOverviewText(overview);
    expect(result.title).toContain('Minimal API');
    expect(result.content).toContain('Minimal API');
  });
});
