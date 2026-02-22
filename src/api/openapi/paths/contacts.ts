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
        required: ['id', 'contact_kind', 'created_at', 'updated_at'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Unique identifier for the contact', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
          display_name: { type: 'string', nullable: true, description: 'Display name (auto-computed from structured name fields if not set)', example: 'Alice Johnson' },
          given_name: { type: 'string', nullable: true, description: 'Given/first name', example: 'Alice' },
          family_name: { type: 'string', nullable: true, description: 'Family/last name', example: 'Johnson' },
          middle_name: { type: 'string', nullable: true, description: 'Middle name', example: 'Marie' },
          name_prefix: { type: 'string', nullable: true, description: 'Name prefix (e.g. Dr., Prof.)', example: 'Dr.' },
          name_suffix: { type: 'string', nullable: true, description: 'Name suffix (e.g. Jr., III)', example: 'Jr.' },
          nickname: { type: 'string', nullable: true, description: 'Nickname or preferred informal name', example: 'Ali' },
          phonetic_given_name: { type: 'string', nullable: true, description: 'Phonetic given name (for CJK name rendering)', example: 'Arisu' },
          phonetic_family_name: { type: 'string', nullable: true, description: 'Phonetic family name', example: 'Jonson' },
          file_as: { type: 'string', nullable: true, description: 'Sort key override (e.g. "Johnson, Alice")', example: 'Johnson, Alice' },
          notes: { type: 'string', nullable: true, description: 'Free-text notes about the contact', example: 'Met at the conference in March' },
          contact_kind: { type: 'string', enum: ['person', 'organisation', 'group', 'agent'], description: 'The kind of entity this contact represents', example: 'person' },
          custom_fields: { type: 'array', description: 'Custom key-value fields (max 50)', items: { type: 'object', required: ['key', 'value'], properties: { key: { type: 'string' }, value: { type: 'string' } } } },
          photo_url: { type: 'string', nullable: true, description: 'URL to the contact photo', example: '/api/files/abc-123' },
          preferred_channel: { type: 'string', nullable: true, description: 'Preferred communication channel', example: 'email' },
          quiet_hours_start: { type: 'string', nullable: true, description: 'Start time for quiet hours in HH:MM format', example: '22:00' },
          quiet_hours_end: { type: 'string', nullable: true, description: 'End time for quiet hours in HH:MM format', example: '08:00' },
          quiet_hours_timezone: { type: 'string', nullable: true, description: 'IANA timezone for quiet hours', example: 'Australia/Sydney' },
          urgency_override_channel: { type: 'string', nullable: true, description: 'Channel to use for urgent messages during quiet hours', example: 'sms' },
          notification_notes: { type: 'string', nullable: true, description: 'Notes about notification preferences', example: 'Prefers brief messages, no calls' },
          namespace: { type: 'string', nullable: true, description: 'Namespace scope for multi-tenant isolation', example: 'default' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
          deleted_at: { type: 'string', format: 'date-time', nullable: true },
          endpoints: { type: 'array', description: 'Included when ?include=endpoints', items: ref('ContactEndpoint') },
          addresses: { type: 'array', description: 'Included when ?include=addresses', items: ref('ContactAddress') },
          dates: { type: 'array', description: 'Included when ?include=dates', items: ref('ContactDate') },
          tags: { type: 'array', description: 'Included when ?include=tags', items: { type: 'string' } },
        },
      },

      ContactAddress: {
        type: 'object',
        required: ['id', 'address_type'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          address_type: { type: 'string', enum: ['home', 'work', 'other'] },
          label: { type: 'string', nullable: true },
          street_address: { type: 'string', nullable: true },
          extended_address: { type: 'string', nullable: true },
          city: { type: 'string', nullable: true },
          region: { type: 'string', nullable: true },
          postal_code: { type: 'string', nullable: true },
          country: { type: 'string', nullable: true },
          country_code: { type: 'string', nullable: true, description: 'ISO 3166-1 alpha-2' },
          formatted_address: { type: 'string', nullable: true },
          latitude: { type: 'number', nullable: true },
          longitude: { type: 'number', nullable: true },
          is_primary: { type: 'boolean' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },

      ContactDate: {
        type: 'object',
        required: ['id', 'date_type', 'date_value'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          date_type: { type: 'string', enum: ['birthday', 'anniversary', 'other'] },
          label: { type: 'string', nullable: true },
          date_value: { type: 'string', format: 'date' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
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
        description: 'Either display_name or given_name/family_name is required',
        properties: {
          display_name: { type: 'string', description: 'Display name (optional if structured name fields provided)', example: 'Alice Johnson' },
          given_name: { type: 'string', nullable: true, example: 'Alice' },
          family_name: { type: 'string', nullable: true, example: 'Johnson' },
          middle_name: { type: 'string', nullable: true },
          name_prefix: { type: 'string', nullable: true },
          name_suffix: { type: 'string', nullable: true },
          nickname: { type: 'string', nullable: true },
          phonetic_given_name: { type: 'string', nullable: true },
          phonetic_family_name: { type: 'string', nullable: true },
          file_as: { type: 'string', nullable: true },
          notes: { type: 'string', nullable: true },
          contact_kind: { type: 'string', enum: ['person', 'organisation', 'group', 'agent'], default: 'person' },
          custom_fields: { type: 'array', description: 'Max 50 entries', items: { type: 'object', required: ['key', 'value'], properties: { key: { type: 'string' }, value: { type: 'string' } } } },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags to assign (max 100 chars each)' },
          preferred_channel: { type: 'string', nullable: true },
          quiet_hours_start: { type: 'string', nullable: true },
          quiet_hours_end: { type: 'string', nullable: true },
          quiet_hours_timezone: { type: 'string', nullable: true },
          urgency_override_channel: { type: 'string', nullable: true },
          notification_notes: { type: 'string', nullable: true },
        },
      },

      ContactUpdateInput: {
        type: 'object',
        properties: {
          display_name: { type: 'string' },
          given_name: { type: 'string', nullable: true },
          family_name: { type: 'string', nullable: true },
          middle_name: { type: 'string', nullable: true },
          name_prefix: { type: 'string', nullable: true },
          name_suffix: { type: 'string', nullable: true },
          nickname: { type: 'string', nullable: true },
          phonetic_given_name: { type: 'string', nullable: true },
          phonetic_family_name: { type: 'string', nullable: true },
          file_as: { type: 'string', nullable: true },
          notes: { type: 'string', nullable: true },
          contact_kind: { type: 'string', enum: ['person', 'organisation', 'group', 'agent'] },
          custom_fields: { type: 'array', items: { type: 'object', required: ['key', 'value'], properties: { key: { type: 'string' }, value: { type: 'string' } } } },
          tags: { type: 'array', items: { type: 'string' }, description: 'Replace all tags (delete+replace)' },
          preferred_channel: { type: 'string', nullable: true },
          quiet_hours_start: { type: 'string', nullable: true },
          quiet_hours_end: { type: 'string', nullable: true },
          quiet_hours_timezone: { type: 'string', nullable: true },
          urgency_override_channel: { type: 'string', nullable: true },
          notification_notes: { type: 'string', nullable: true },
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
          summary: 'Get a single contact with optional eager loading',
          description: 'Without ?include, returns the contact with endpoints (backward compatible). With ?include, returns the contact plus requested child collections.',
          tags: ['Contacts'],
          parameters: [
            {
              name: 'include_deleted',
              in: 'query',
              description: 'Include the contact even if soft-deleted',
              schema: { type: 'string', enum: ['true', 'false'], default: 'false' },
            },
            {
              name: 'include',
              in: 'query',
              description: 'Comma-separated child collections to include: endpoints, addresses, dates, tags, relationships',
              schema: { type: 'string' },
              example: 'endpoints,addresses,dates,tags',
            },
          ],
          responses: {
            '200': jsonResponse('Contact details with optional child collections', ref('Contact')),
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

      // ============================================================
      // Address CRUD (#1583)
      // ============================================================
      '/api/contacts/{id}/addresses': {
        parameters: [uuidParam('id', 'Contact UUID')],
        get: {
          operationId: 'listContactAddresses',
          summary: 'List addresses for a contact',
          tags: ['Contacts'],
          responses: { '200': jsonResponse('Address list', { type: 'array', items: ref('ContactAddress') }), ...errorResponses(401, 404, 500) },
        },
        post: {
          operationId: 'addContactAddress',
          summary: 'Add an address to a contact',
          tags: ['Contacts'],
          requestBody: jsonBody(ref('ContactAddress')),
          responses: { '201': jsonResponse('Created address', ref('ContactAddress')), ...errorResponses(400, 401, 404, 500) },
        },
      },
      '/api/contacts/{id}/addresses/{addr_id}': {
        parameters: [uuidParam('id', 'Contact UUID'), uuidParam('addr_id', 'Address UUID')],
        patch: {
          operationId: 'updateContactAddress',
          summary: 'Update a contact address',
          tags: ['Contacts'],
          requestBody: jsonBody(ref('ContactAddress')),
          responses: { '200': jsonResponse('Updated address', ref('ContactAddress')), ...errorResponses(400, 401, 404, 500) },
        },
        delete: {
          operationId: 'deleteContactAddress',
          summary: 'Delete a contact address',
          tags: ['Contacts'],
          responses: { '204': { description: 'Address deleted' }, ...errorResponses(401, 404, 500) },
        },
      },

      // ============================================================
      // Date CRUD (#1584)
      // ============================================================
      '/api/contacts/{id}/dates': {
        parameters: [uuidParam('id', 'Contact UUID')],
        get: {
          operationId: 'listContactDates',
          summary: 'List dates for a contact',
          tags: ['Contacts'],
          responses: { '200': jsonResponse('Date list', { type: 'array', items: ref('ContactDate') }), ...errorResponses(401, 404, 500) },
        },
        post: {
          operationId: 'addContactDate',
          summary: 'Add a date to a contact',
          tags: ['Contacts'],
          requestBody: jsonBody({ type: 'object', required: ['date_value'], properties: { date_type: { type: 'string', enum: ['birthday', 'anniversary', 'other'] }, label: { type: 'string', nullable: true }, date_value: { type: 'string', format: 'date' } } }),
          responses: { '201': jsonResponse('Created date', ref('ContactDate')), ...errorResponses(400, 401, 404, 500) },
        },
      },
      '/api/contacts/{id}/dates/{date_id}': {
        parameters: [uuidParam('id', 'Contact UUID'), uuidParam('date_id', 'Date UUID')],
        patch: {
          operationId: 'updateContactDate',
          summary: 'Update a contact date',
          tags: ['Contacts'],
          requestBody: jsonBody({ type: 'object', properties: { date_type: { type: 'string', enum: ['birthday', 'anniversary', 'other'] }, label: { type: 'string', nullable: true }, date_value: { type: 'string', format: 'date' } } }),
          responses: { '200': jsonResponse('Updated date', ref('ContactDate')), ...errorResponses(400, 401, 404, 500) },
        },
        delete: {
          operationId: 'deleteContactDate',
          summary: 'Delete a contact date',
          tags: ['Contacts'],
          responses: { '204': { description: 'Date deleted' }, ...errorResponses(401, 404, 500) },
        },
      },

      // ============================================================
      // Endpoint Management (#1585)
      // ============================================================
      '/api/contacts/{id}/endpoints/{ep_id}': {
        parameters: [uuidParam('id', 'Contact UUID'), uuidParam('ep_id', 'Endpoint UUID')],
        patch: {
          operationId: 'updateContactEndpoint',
          summary: 'Update an endpoint (label, is_primary, metadata)',
          tags: ['Contacts'],
          requestBody: jsonBody({ type: 'object', properties: { label: { type: 'string', nullable: true }, is_primary: { type: 'boolean' }, metadata: { type: 'object' } } }),
          responses: { '200': jsonResponse('Updated endpoint', ref('ContactEndpoint')), ...errorResponses(400, 401, 404, 500) },
        },
        delete: {
          operationId: 'deleteContactEndpoint',
          summary: 'Delete a contact endpoint',
          tags: ['Contacts'],
          responses: { '204': { description: 'Endpoint deleted' }, ...errorResponses(401, 404, 500) },
        },
      },

      // ============================================================
      // Tag Management (#1586)
      // ============================================================
      '/api/contacts/{id}/tags': {
        parameters: [uuidParam('id', 'Contact UUID')],
        get: {
          operationId: 'listContactTags',
          summary: 'List tags for a contact',
          tags: ['Contacts'],
          responses: { '200': jsonResponse('Tag list', { type: 'array', items: { type: 'object', properties: { tag: { type: 'string' }, created_at: { type: 'string', format: 'date-time' } } } }), ...errorResponses(401, 404, 500) },
        },
        post: {
          operationId: 'addContactTags',
          summary: 'Add tag(s) to a contact',
          tags: ['Contacts'],
          requestBody: jsonBody({ type: 'object', properties: { tags: { type: 'array', items: { type: 'string' } }, tag: { type: 'string' } } }),
          responses: { '201': jsonResponse('Updated tag list', { type: 'array', items: { type: 'object', properties: { tag: { type: 'string' }, created_at: { type: 'string', format: 'date-time' } } } }), ...errorResponses(400, 401, 404, 500) },
        },
      },
      '/api/contacts/{id}/tags/{tag}': {
        parameters: [uuidParam('id', 'Contact UUID'), { name: 'tag', in: 'path', required: true, schema: { type: 'string' }, description: 'Tag name (URL-encoded)' }],
        delete: {
          operationId: 'deleteContactTag',
          summary: 'Remove a tag from a contact',
          tags: ['Contacts'],
          responses: { '204': { description: 'Tag removed' }, ...errorResponses(401, 404, 500) },
        },
      },
      '/api/tags': {
        get: {
          operationId: 'listAllTags',
          summary: 'List all tags with contact counts',
          description: 'Returns all tags across contacts in the user\'s namespaces, with a count of how many contacts have each tag.',
          tags: ['Contacts'],
          responses: { '200': jsonResponse('Tag list with counts', { type: 'array', items: { type: 'object', required: ['tag', 'contact_count'], properties: { tag: { type: 'string' }, contact_count: { type: 'integer' } } } }), ...errorResponses(401, 500) },
        },
      },

      // ============================================================
      // Photo Upload (#1587)
      // ============================================================
      '/api/contacts/{id}/photo': {
        parameters: [uuidParam('id', 'Contact UUID')],
        post: {
          operationId: 'uploadContactPhoto',
          summary: 'Upload a contact photo',
          tags: ['Contacts'],
          requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } } } },
          responses: { '201': jsonResponse('Photo uploaded', { type: 'object', properties: { photo_url: { type: 'string' }, file_id: { type: 'string', format: 'uuid' } } }), ...errorResponses(400, 401, 404, 413, 500) },
        },
        delete: {
          operationId: 'deleteContactPhoto',
          summary: 'Remove contact photo',
          tags: ['Contacts'],
          responses: { '204': { description: 'Photo removed' }, ...errorResponses(401, 404, 500) },
        },
      },

      // ============================================================
      // Contact Merge (#1588)
      // ============================================================
      '/api/contacts/merge': {
        post: {
          operationId: 'mergeContacts',
          summary: 'Merge two contacts',
          description: 'Merges loser into survivor. Moves endpoints, addresses, dates, tags, relationships, and work item links. Records audit trail.',
          tags: ['Contacts'],
          requestBody: jsonBody({ type: 'object', required: ['survivor_id', 'loser_id'], properties: { survivor_id: { type: 'string', format: 'uuid' }, loser_id: { type: 'string', format: 'uuid' } } }),
          responses: { '200': jsonResponse('Merge result', { type: 'object', properties: { merged: ref('Contact'), loser_id: { type: 'string', format: 'uuid' } } }), ...errorResponses(400, 401, 403, 404, 500) },
        },
      },

      // ============================================================
      // Import/Export (#1589)
      // ============================================================
      '/api/contacts/export': {
        get: {
          operationId: 'exportContacts',
          summary: 'Export contacts',
          tags: ['Contacts'],
          parameters: [
            { name: 'format', in: 'query', schema: { type: 'string', enum: ['csv', 'json'], default: 'json' }, description: 'Export format' },
            { name: 'ids', in: 'query', schema: { type: 'string' }, description: 'Comma-separated contact IDs for selective export' },
            namespaceParam(),
          ],
          responses: { '200': { description: 'Exported contacts (CSV or JSON)', content: { 'text/csv': { schema: { type: 'string' } }, 'application/json': { schema: { type: 'array', items: ref('Contact') } } } }, ...errorResponses(400, 401, 500) },
        },
      },
      '/api/contacts/import': {
        post: {
          operationId: 'importContacts',
          summary: 'Import contacts',
          description: 'Import up to 10,000 contacts. Duplicate detection by normalized email endpoint.',
          tags: ['Contacts'],
          requestBody: jsonBody({ type: 'object', required: ['contacts'], properties: { contacts: { type: 'array', items: { type: 'object', properties: { display_name: { type: 'string' }, given_name: { type: 'string' }, family_name: { type: 'string' }, endpoints: { type: 'array', items: { type: 'object', properties: { type: { type: 'string' }, value: { type: 'string' } } } }, tags: { type: 'array', items: { type: 'string' } } } } }, duplicate_handling: { type: 'string', enum: ['skip', 'update', 'create'], default: 'skip' } } }),
          responses: { '201': jsonResponse('Import results', { type: 'object', required: ['created', 'updated', 'skipped', 'failed'], properties: { created: { type: 'integer' }, updated: { type: 'integer' }, skipped: { type: 'integer' }, failed: { type: 'integer' }, errors: { type: 'array', items: { type: 'object', properties: { index: { type: 'integer' }, error: { type: 'string' } } } } } }), ...errorResponses(400, 401, 500) },
        },
      },
    },
  };
}
