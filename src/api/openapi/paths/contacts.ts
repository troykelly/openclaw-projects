/**
 * OpenAPI path definitions for the Contacts domain.
 *
 * Covers contact CRUD, bulk operations, endpoint management,
 * fuzzy matching, linked work items, memories, and relationship graph traversal.
 */
import type { OpenApiDomainModule } from '../types.ts';
import {
  ref,
  uuidParam,
  paginationParams,
  errorResponses,
  jsonBody,
  jsonResponse,
  namespaceParam,
} from '../helpers.ts';

export function contactsPaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'Contacts', description: 'Contact management and endpoint linking' },
    ],

    schemas: {
      Contact: {
        type: 'object',
        required: ['id', 'display_name', 'contact_kind', 'created_at', 'updated_at'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Unique identifier for the contact', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
          display_name: { type: 'string', description: 'Display name of the contact', example: 'Alice Johnson' },
          notes: { type: 'string', nullable: true, description: 'Free-text notes about the contact', example: 'Met at the conference in March' },
          contact_kind: {
            type: 'string',
            enum: ['person', 'organisation', 'group', 'bot', 'other'],
            description: 'The kind of entity this contact represents',
            example: 'person',
          },
          preferred_channel: { type: 'string', nullable: true, description: 'Preferred communication channel for this contact (e.g. email, sms, whatsapp)', example: 'email' },
          quiet_hours_start: { type: 'string', nullable: true, description: 'Start time for quiet hours in HH:MM format', example: '22:00' },
          quiet_hours_end: { type: 'string', nullable: true, description: 'End time for quiet hours in HH:MM format', example: '08:00' },
          quiet_hours_timezone: { type: 'string', nullable: true, description: 'IANA timezone for quiet hours', example: 'Australia/Sydney' },
          urgency_override_channel: { type: 'string', nullable: true, description: 'Channel to use for urgent messages during quiet hours', example: 'sms' },
          notification_notes: { type: 'string', nullable: true, description: 'Notes about notification preferences for this contact', example: 'Prefers brief messages, no calls' },
          namespace: { type: 'string', nullable: true, description: 'Namespace scope for multi-tenant isolation', example: 'default' },
          created_at: { type: 'string', format: 'date-time', description: 'Timestamp when the contact was created', example: '2026-02-21T14:30:00Z' },
          updated_at: { type: 'string', format: 'date-time', description: 'Timestamp when the contact was last updated', example: '2026-02-21T14:30:00Z' },
          deleted_at: { type: 'string', format: 'date-time', nullable: true, description: 'Timestamp when the contact was soft-deleted, null if active', example: null },
          endpoints: {
            type: 'array',
            description: 'Communication endpoints associated with this contact',
            items: {
              type: 'object',
              required: ['type', 'value'],
              properties: {
                type: { type: 'string', description: 'Type of the endpoint (e.g. email, phone, telegram, whatsapp)', example: 'email' },
                value: { type: 'string', description: 'Value of the endpoint', example: 'alice@example.com' },
              },
            },
          },
        },
      },

      ContactEndpoint: {
        type: 'object',
        required: ['id', 'contact_id', 'endpoint_type', 'endpoint_value'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Unique identifier for the endpoint', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
          contact_id: { type: 'string', format: 'uuid', description: 'UUID of the contact this endpoint belongs to', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
          endpoint_type: { type: 'string', description: 'Type of the endpoint (e.g. email, phone, telegram, whatsapp, discord)', example: 'email' },
          endpoint_value: { type: 'string', description: 'Value of the endpoint (e.g. email address, phone number)', example: 'alice@example.com' },
          normalized_value: { type: 'string', nullable: true, description: 'Normalized form of the endpoint value for matching (e.g. E.164 phone number)', example: '+61400123456' },
          metadata: {
            type: 'object',
            description: 'Additional metadata for the endpoint',
            properties: {
              label: { type: 'string', description: 'Label for the endpoint (e.g. Work, Personal, Home)', example: 'Work' },
              verified: { type: 'boolean', description: 'Whether the endpoint has been verified', example: true },
              primary: { type: 'boolean', description: 'Whether this is the primary endpoint of its type', example: false },
            },
          },
        },
      },

      ContactCreateInput: {
        type: 'object',
        required: ['display_name'],
        properties: {
          display_name: { type: 'string', description: 'Display name of the contact', example: 'Alice Johnson' },
          notes: { type: 'string', nullable: true, description: 'Free-text notes about the contact', example: 'Key stakeholder for project Alpha' },
          contact_kind: {
            type: 'string',
            enum: ['person', 'organisation', 'group', 'bot', 'other'],
            default: 'person',
            description: 'The kind of entity this contact represents',
            example: 'person',
          },
          preferred_channel: { type: 'string', nullable: true, description: 'Preferred communication channel', example: 'email' },
          quiet_hours_start: { type: 'string', nullable: true, description: 'Start time for quiet hours in HH:MM format', example: '22:00' },
          quiet_hours_end: { type: 'string', nullable: true, description: 'End time for quiet hours in HH:MM format', example: '08:00' },
          quiet_hours_timezone: { type: 'string', nullable: true, description: 'IANA timezone for quiet hours', example: 'Australia/Sydney' },
          urgency_override_channel: { type: 'string', nullable: true, description: 'Channel to use for urgent messages during quiet hours', example: 'sms' },
          notification_notes: { type: 'string', nullable: true, description: 'Notes about notification preferences', example: 'Prefers brief messages' },
        },
      },

      ContactUpdateInput: {
        type: 'object',
        properties: {
          display_name: { type: 'string', description: 'Updated display name', example: 'Alice M. Johnson' },
          notes: { type: 'string', nullable: true, description: 'Updated notes about the contact', example: 'Now lead on project Beta' },
          contact_kind: {
            type: 'string',
            enum: ['person', 'organisation', 'group', 'bot', 'other'],
            description: 'Updated contact kind',
            example: 'person',
          },
          preferred_channel: { type: 'string', nullable: true, description: 'Updated preferred communication channel', example: 'whatsapp' },
          quiet_hours_start: { type: 'string', nullable: true, description: 'Updated start time for quiet hours', example: '21:00' },
          quiet_hours_end: { type: 'string', nullable: true, description: 'Updated end time for quiet hours', example: '07:00' },
          quiet_hours_timezone: { type: 'string', nullable: true, description: 'Updated IANA timezone for quiet hours', example: 'America/New_York' },
          urgency_override_channel: { type: 'string', nullable: true, description: 'Updated urgency override channel', example: 'phone' },
          notification_notes: { type: 'string', nullable: true, description: 'Updated notification preference notes', example: 'OK with calls after 9am' },
        },
      },

      BulkContactInput: {
        type: 'object',
        required: ['contacts'],
        properties: {
          contacts: {
            type: 'array',
            description: 'Array of contacts to create in bulk',
            items: {
              type: 'object',
              required: ['display_name'],
              properties: {
                display_name: { type: 'string', description: 'Display name of the contact', example: 'Bob Smith' },
                notes: { type: 'string', nullable: true, description: 'Free-text notes about the contact', example: 'Vendor contact' },
                contact_kind: {
                  type: 'string',
                  enum: ['person', 'organisation', 'group', 'bot', 'other'],
                  default: 'person',
                  description: 'The kind of entity this contact represents',
                  example: 'person',
                },
                endpoints: {
                  type: 'array',
                  description: 'Communication endpoints to create with the contact',
                  items: {
                    type: 'object',
                    required: ['endpoint_type', 'endpoint_value'],
                    properties: {
                      endpoint_type: { type: 'string', description: 'Type of the endpoint (e.g. email, phone)', example: 'email' },
                      endpoint_value: { type: 'string', description: 'Value of the endpoint', example: 'bob@example.com' },
                      metadata: {
                        type: 'object',
                        description: 'Additional metadata for the endpoint',
                        properties: {
                          label: { type: 'string', description: 'Label for the endpoint', example: 'Work' },
                          verified: { type: 'boolean', description: 'Whether the endpoint has been verified', example: false },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },

      BulkContactResult: {
        type: 'object',
        required: ['success', 'created', 'failed', 'results'],
        properties: {
          success: { type: 'boolean', description: 'Whether the bulk operation completed without any failures', example: true },
          created: { type: 'integer', description: 'Number of contacts successfully created', example: 5 },
          failed: { type: 'integer', description: 'Number of contacts that failed to create', example: 0 },
          results: {
            type: 'array',
            description: 'Per-item results for each contact in the input array',
            items: {
              type: 'object',
              required: ['index', 'status'],
              properties: {
                index: { type: 'integer', description: 'Zero-based index of the contact in the input array', example: 0 },
                id: { type: 'string', format: 'uuid', description: 'UUID of the created contact (only present on success)', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
                status: { type: 'string', enum: ['created', 'failed'], description: 'Result status for this contact', example: 'created' },
                error: { type: 'string', description: 'Error message if the contact failed to create', example: 'Duplicate display_name' },
              },
            },
          },
        },
      },

      ContactSuggestMatch: {
        type: 'object',
        required: ['matches'],
        properties: {
          matches: {
            type: 'array',
            description: 'Ranked list of potential contact matches with confidence scores',
            items: {
              type: 'object',
              required: ['contact_id', 'display_name', 'confidence', 'match_reasons'],
              properties: {
                contact_id: { type: 'string', format: 'uuid', description: 'UUID of the matching contact', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
                display_name: { type: 'string', description: 'Display name of the matching contact', example: 'Alice Johnson' },
                confidence: { type: 'number', minimum: 0, maximum: 1, description: 'Confidence score for the match (0 = no match, 1 = exact match)', example: 0.92 },
                match_reasons: {
                  type: 'array',
                  description: 'Reasons why this contact was matched',
                  items: { type: 'string' },
                  example: ['exact_phone', 'name_similarity'],
                },
                endpoints: {
                  type: 'array',
                  description: 'Endpoints of the matching contact for verification',
                  items: {
                    type: 'object',
                    required: ['type', 'value'],
                    properties: {
                      type: { type: 'string', description: 'Endpoint type', example: 'phone' },
                      value: { type: 'string', description: 'Endpoint value', example: '+61400123456' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },

    paths: {
      '/api/contacts': {
        post: {
          operationId: 'createContact',
          summary: 'Create a contact',
          tags: ['Contacts'],
          parameters: [namespaceParam()],
          requestBody: jsonBody(ref('ContactCreateInput')),
          responses: {
            '201': jsonResponse('Contact created', ref('Contact')),
            ...errorResponses(400, 401, 500),
          },
        },
        get: {
          operationId: 'listContacts',
          summary: 'List contacts with optional search and pagination',
          tags: ['Contacts'],
          parameters: [
            namespaceParam(),
            {
              name: 'search',
              in: 'query',
              description: 'Full-text search on display_name or endpoint values',
              schema: { type: 'string' },
              example: 'alice',
            },
            {
              name: 'contact_kind',
              in: 'query',
              description: 'Filter by contact kind (comma-separated for multiple)',
              schema: { type: 'string' },
              example: 'person,organisation',
            },
            {
              name: 'include_deleted',
              in: 'query',
              description: 'Include soft-deleted contacts in results',
              schema: { type: 'string', enum: ['true', 'false'], default: 'false' },
              example: 'false',
            },
            ...paginationParams(),
          ],
          responses: {
            '200': jsonResponse('Paginated contact list', {
              type: 'object',
              required: ['contacts', 'total'],
              properties: {
                contacts: { type: 'array', items: ref('Contact'), description: 'List of contacts matching the filters' },
                total: { type: 'integer', description: 'Total number of contacts matching the filters', example: 42 },
              },
            }),
            ...errorResponses(401, 500),
          },
        },
      },

      '/api/contacts/bulk': {
        post: {
          operationId: 'bulkCreateContacts',
          summary: 'Bulk create contacts with optional endpoints',
          tags: ['Contacts'],
          parameters: [namespaceParam()],
          requestBody: jsonBody(ref('BulkContactInput')),
          responses: {
            '200': jsonResponse('Bulk creation result', ref('BulkContactResult')),
            ...errorResponses(400, 401, 413, 500),
          },
        },
      },

      '/api/contacts/search': {
        get: {
          operationId: 'searchContacts',
          summary: 'Search contacts (alias redirecting to /api/contacts?search=)',
          description: 'Redirects to GET /api/contacts with the search parameter. Prevents route collision with /:id.',
          tags: ['Contacts'],
          parameters: [
            {
              name: 'q',
              in: 'query',
              description: 'Search query string',
              schema: { type: 'string' },
              example: 'alice',
            },
            ...paginationParams(),
          ],
          responses: {
            '301': { description: 'Redirects to /api/contacts?search=...' },
            ...errorResponses(401),
          },
        },
      },

      '/api/contacts/suggest-match': {
        get: {
          operationId: 'suggestContactMatch',
          summary: 'Fuzzy contact matching by phone, email, or name',
          description: 'Scores potential matches using multiple signals (exact phone, partial phone, exact email, domain email, name). Returns ranked results.',
          tags: ['Contacts'],
          parameters: [
            {
              name: 'phone',
              in: 'query',
              description: 'Phone number to match (exact and partial)',
              schema: { type: 'string' },
              example: '+61400123456',
            },
            {
              name: 'email',
              in: 'query',
              description: 'Email address to match (exact and domain)',
              schema: { type: 'string' },
              example: 'alice@example.com',
            },
            {
              name: 'name',
              in: 'query',
              description: 'Display name to fuzzy match',
              schema: { type: 'string' },
              example: 'Alice Johnson',
            },
            {
              name: 'limit',
              in: 'query',
              description: 'Maximum number of matches to return (max 50)',
              schema: { type: 'integer', default: 10, maximum: 50 },
              example: 10,
            },
          ],
          responses: {
            '200': jsonResponse('Matching contacts with confidence scores', ref('ContactSuggestMatch')),
            ...errorResponses(400, 401, 500),
          },
        },
      },

      '/api/contacts/{id}': {
        parameters: [uuidParam('id', 'Contact UUID')],
        get: {
          operationId: 'getContact',
          summary: 'Get a single contact with endpoints',
          tags: ['Contacts'],
          parameters: [
            {
              name: 'include_deleted',
              in: 'query',
              description: 'Include the contact even if soft-deleted',
              schema: { type: 'string', enum: ['true', 'false'], default: 'false' },
              example: 'false',
            },
          ],
          responses: {
            '200': jsonResponse('Contact details with endpoints', ref('Contact')),
            ...errorResponses(401, 404, 500),
          },
        },
        patch: {
          operationId: 'updateContact',
          summary: 'Update a contact',
          tags: ['Contacts'],
          requestBody: jsonBody(ref('ContactUpdateInput')),
          responses: {
            '200': jsonResponse('Updated contact', ref('Contact')),
            ...errorResponses(400, 401, 404, 500),
          },
        },
        delete: {
          operationId: 'deleteContact',
          summary: 'Soft delete a contact (or permanent with ?permanent=true)',
          tags: ['Contacts'],
          parameters: [
            {
              name: 'permanent',
              in: 'query',
              description: 'If true, permanently delete instead of soft delete',
              schema: { type: 'string', enum: ['true', 'false'] },
              example: 'false',
            },
          ],
          responses: {
            '204': { description: 'Contact deleted' },
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      '/api/contacts/{id}/restore': {
        parameters: [uuidParam('id', 'Contact UUID')],
        post: {
          operationId: 'restoreContact',
          summary: 'Restore a soft-deleted contact',
          tags: ['Contacts'],
          responses: {
            '200': jsonResponse('Restore result', {
              type: 'object',
              required: ['restored', 'id', 'display_name'],
              properties: {
                restored: { type: 'boolean', description: 'Whether the contact was successfully restored', example: true },
                id: { type: 'string', format: 'uuid', description: 'UUID of the restored contact', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
                display_name: { type: 'string', description: 'Display name of the restored contact', example: 'Alice Johnson' },
              },
            }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      '/api/contacts/{id}/work-items': {
        parameters: [uuidParam('id', 'Contact UUID')],
        get: {
          operationId: 'listContactWorkItems',
          summary: 'Get work items associated with a contact',
          description: 'Returns work items linked through communication threads.',
          tags: ['Contacts'],
          responses: {
            '200': jsonResponse('Linked work items', {
              type: 'object',
              required: ['work_items'],
              properties: {
                work_items: {
                  type: 'array',
                  description: 'Work items linked to this contact',
                  items: {
                    type: 'object',
                    required: ['id', 'title', 'status', 'kind'],
                    properties: {
                      id: { type: 'string', format: 'uuid', description: 'UUID of the work item', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
                      title: { type: 'string', description: 'Title of the work item', example: 'Follow up on proposal' },
                      status: { type: 'string', description: 'Current status of the work item', example: 'in_progress' },
                      kind: { type: 'string', description: 'Kind of work item (e.g. task, issue, epic)', example: 'task' },
                      created_at: { type: 'string', format: 'date-time', description: 'When the work item was created', example: '2026-02-21T14:30:00Z' },
                    },
                  },
                },
              },
            }),
            ...errorResponses(401, 404, 500),
          },
        },
      },

      '/api/contacts/{id}/endpoints': {
        parameters: [uuidParam('id', 'Contact UUID')],
        post: {
          operationId: 'addContactEndpoint',
          summary: 'Add a communication endpoint to a contact',
          tags: ['Contacts'],
          parameters: [namespaceParam()],
          requestBody: jsonBody({
            type: 'object',
            required: ['endpoint_type', 'endpoint_value'],
            properties: {
              endpoint_type: {
                type: 'string',
                description: 'Type of endpoint (e.g. email, phone, telegram, whatsapp, discord)',
                example: 'phone',
              },
              endpoint_value: {
                type: 'string',
                description: 'Endpoint value (e.g. email address, phone number, username)',
                example: '+61400123456',
              },
              metadata: {
                type: 'object',
                description: 'Additional metadata for the endpoint',
                properties: {
                  label: { type: 'string', description: 'Label for the endpoint (e.g. Work, Personal, Home)', example: 'Work' },
                  verified: { type: 'boolean', description: 'Whether the endpoint has been verified', example: true },
                  primary: { type: 'boolean', description: 'Whether this is the primary endpoint of its type', example: false },
                },
              },
            },
          }),
          responses: {
            '201': jsonResponse('Endpoint created', ref('ContactEndpoint')),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      '/api/contacts/{id}/memories': {
        parameters: [uuidParam('id', 'Contact UUID')],
        get: {
          operationId: 'listContactMemories',
          summary: 'Get memories linked to a contact',
          tags: ['Contacts'],
          parameters: [
            {
              name: 'relationship_type',
              in: 'query',
              description: 'Filter by memory-contact relationship type',
              schema: { type: 'string', enum: ['about', 'from', 'shared_with', 'mentioned'] },
              example: 'about',
            },
            ...paginationParams(),
          ],
          responses: {
            '200': jsonResponse('Linked memories', {
              type: 'object',
              required: ['memories'],
              properties: {
                memories: {
                  type: 'array',
                  description: 'Memories linked to this contact with relationship details',
                  items: {
                    type: 'object',
                    required: ['relationship_id', 'relationship_type', 'linked_at', 'id', 'title', 'content', 'type'],
                    properties: {
                      relationship_id: { type: 'string', format: 'uuid', description: 'UUID of the memory-contact link', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
                      relationship_type: { type: 'string', description: 'Type of relationship between the memory and contact', example: 'about' },
                      relationship_notes: { type: 'string', nullable: true, description: 'Notes about the memory-contact relationship', example: 'Primary contact for this preference' },
                      linked_at: { type: 'string', format: 'date-time', description: 'When the memory was linked to the contact', example: '2026-02-21T14:30:00Z' },
                      id: { type: 'string', format: 'uuid', description: 'UUID of the memory', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
                      title: { type: 'string', description: 'Title of the memory', example: 'Communication preferences' },
                      content: { type: 'string', description: 'Content of the memory', example: 'User prefers dark mode and metric units' },
                      type: { type: 'string', description: 'Memory type', example: 'preference' },
                      linked_item_id: { type: 'string', format: 'uuid', nullable: true, description: 'UUID of the linked work item, if any', example: null },
                      created_at: { type: 'string', format: 'date-time', description: 'When the memory was created', example: '2026-02-21T14:30:00Z' },
                      updated_at: { type: 'string', format: 'date-time', description: 'When the memory was last updated', example: '2026-02-21T14:30:00Z' },
                    },
                  },
                },
              },
            }),
            ...errorResponses(401, 404, 500),
          },
        },
      },

      '/api/contacts/{id}/similar-memories': {
        parameters: [uuidParam('id', 'Contact UUID')],
        get: {
          operationId: 'findContactSimilarMemories',
          summary: 'Find memories semantically related to a contact',
          description: 'Uses linked memory embeddings or generates an embedding from the contact name and notes to find similar memories.',
          tags: ['Contacts'],
          parameters: [
            {
              name: 'limit',
              in: 'query',
              description: 'Maximum number of results to return (max 50)',
              schema: { type: 'integer', default: 10, maximum: 50 },
              example: 10,
            },
            {
              name: 'threshold',
              in: 'query',
              description: 'Minimum similarity threshold (0 = any match, 1 = exact match)',
              schema: { type: 'number', default: 0.6, minimum: 0, maximum: 1 },
              example: 0.6,
            },
          ],
          responses: {
            '200': jsonResponse('Similar memories', {
              type: 'object',
              required: ['contact_id', 'context_source', 'threshold', 'similar_memories'],
              properties: {
                contact_id: { type: 'string', format: 'uuid', description: 'UUID of the contact used as the search anchor', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
                context_source: { type: 'string', description: 'Source of the embedding context used for similarity (e.g. linked_memories, contact_text)', example: 'linked_memories' },
                threshold: { type: 'number', description: 'Similarity threshold that was applied', example: 0.6 },
                similar_memories: {
                  type: 'array',
                  description: 'Memories semantically similar to the contact context',
                  items: {
                    type: 'object',
                    required: ['id', 'title', 'content', 'type', 'similarity'],
                    properties: {
                      id: { type: 'string', format: 'uuid', description: 'UUID of the similar memory', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
                      title: { type: 'string', description: 'Title of the memory', example: 'Meeting notes from project kickoff' },
                      content: { type: 'string', description: 'Content of the memory', example: 'Discussed project timeline and deliverables with stakeholders' },
                      type: { type: 'string', description: 'Memory type', example: 'note' },
                      linked_item_id: { type: 'string', format: 'uuid', nullable: true, description: 'UUID of the linked work item, if any', example: null },
                      created_at: { type: 'string', format: 'date-time', description: 'When the memory was created', example: '2026-02-21T14:30:00Z' },
                      updated_at: { type: 'string', format: 'date-time', description: 'When the memory was last updated', example: '2026-02-21T14:30:00Z' },
                      similarity: { type: 'number', description: 'Cosine similarity score (0-1)', example: 0.85 },
                    },
                  },
                },
              },
            }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      '/api/contacts/{id}/relationships': {
        parameters: [uuidParam('id', 'Contact UUID')],
        get: {
          operationId: 'listContactRelationships',
          summary: 'Get relationships for a contact (graph traversal)',
          tags: ['Contacts'],
          responses: {
            '200': jsonResponse('Contact relationships', {
              type: 'object',
              required: ['relationships'],
              properties: {
                relationships: {
                  type: 'array',
                  description: 'Relationships where this contact is either contact_a or contact_b',
                  items: ref('Relationship'),
                },
              },
            }),
            ...errorResponses(401, 404, 500),
          },
        },
      },

      '/api/contacts/{id}/groups': {
        parameters: [uuidParam('id', 'Contact UUID')],
        get: {
          operationId: 'listContactGroups',
          summary: 'Get groups a contact belongs to',
          tags: ['Contacts'],
          responses: {
            '200': jsonResponse('Groups list', {
              type: 'object',
              required: ['groups'],
              properties: {
                groups: {
                  type: 'array',
                  description: 'Group contacts that this contact is a member of',
                  items: {
                    type: 'object',
                    required: ['id', 'display_name'],
                    properties: {
                      id: { type: 'string', format: 'uuid', description: 'UUID of the group contact', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
                      display_name: { type: 'string', description: 'Display name of the group', example: 'Engineering Team' },
                      notes: { type: 'string', nullable: true, description: 'Notes about the group', example: 'Core engineering team for platform development' },
                      member_count: { type: 'integer', description: 'Number of members in the group', example: 8 },
                    },
                  },
                },
              },
            }),
            ...errorResponses(401, 404, 500),
          },
        },
      },

      '/api/contacts/{id}/members': {
        parameters: [uuidParam('id', 'Contact UUID (group)')],
        get: {
          operationId: 'listGroupMembers',
          summary: 'Get members of a group contact',
          tags: ['Contacts'],
          responses: {
            '200': jsonResponse('Members list', {
              type: 'object',
              required: ['members'],
              properties: {
                members: {
                  type: 'array',
                  description: 'Individual contacts that are members of this group',
                  items: {
                    type: 'object',
                    required: ['id', 'display_name', 'contact_kind'],
                    properties: {
                      id: { type: 'string', format: 'uuid', description: 'UUID of the member contact', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
                      display_name: { type: 'string', description: 'Display name of the member', example: 'Alice Johnson' },
                      contact_kind: { type: 'string', description: 'Kind of the member contact', example: 'person' },
                      role: { type: 'string', nullable: true, description: 'Role of the member within the group', example: 'lead' },
                      joined_at: { type: 'string', format: 'date-time', description: 'When the member joined the group', example: '2026-02-21T14:30:00Z' },
                    },
                  },
                },
              },
            }),
            ...errorResponses(401, 404, 500),
          },
        },
      },
    },
  };
}
