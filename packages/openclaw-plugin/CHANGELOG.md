# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.12] - 2026-02-15

### Added

#### Geolocation-Aware Memory Storage and Recall (#1204)
- `memory_store` accepts optional `lat`, `lng` fields for location-tagged memories
- `memory_recall` accepts optional `location` parameter for geo-contextual re-ranking using haversine distance
- Nominatim reverse geocoding resolves coordinates to human-readable addresses and place labels
- LRU-cached geocoding with ~100m deduplication precision

#### Semantic Search for Work Items (#1214)
- `todo_search` tool with semantic matching across all work item types (#1216)
- `project_search` tool with semantic matching scoped to projects (#1217)
- `context_search` cross-entity recall tool spanning memories, todos, projects, and messages (#1219)
- Entity linking tools for cross-reference traversal between memories, todos, projects, and external refs (#1220)
- Messages included in cross-entity recall (#1222)
- Inbound message auto-linking to contacts, projects, and todos (#1223)
- Geo-contextual ranking for work item search via query augmentation (#1218)

#### Security
- Prompt injection protection for inbound message processing (#1224)
- Rate limiting and spam protection for inbound message processing (#1225)

### Fixed
- Nominatim reverse geocode logs warnings on HTTP errors and exceptions (#1238)
- Bulk memory API validates geo field pairing and ranges with `Number.isFinite()` (#1239)
- Text-fallback memory query includes lat, lng, address, place_label columns (#1240)

## [0.0.11] - 2026-02-14

### Fixed

#### Plugin Configuration
- Config validation now uses lenient parsing (`.strip()`) instead of strict mode — unknown properties are silently stripped rather than causing errors (#1137)

#### Memory Tools
- `memory_forget` now returns full UUIDs in results and auto-deletes when a single match is found (#1138)
- `memory_recall` correctly maps the `other` category type bidirectionally (#1144)
- `memory_store` content alias verified and working (#1142)

#### Contact Tools
- `contact_search` and `contact_get` now correctly map `display_name` and `contact_kind` fields from the API (#1131)

#### Relationship Tools
- `relationship_query` now sends `contact` query parameter instead of incorrect `contact_id` (#1132)

### Improved

#### Memory Search (API-side, affects plugin results)
- Memory search responses now include `score` and `embedding_provider` fields (#1145)
- Content-based deduplication prevents storing duplicate memories (#1143)
- Keyword boosting improves semantic search relevance (#1146)

## [1.0.0] - 2024-02-02

### Added

#### Memory Tools
- `memory_recall` - Semantic search for memories with category filtering
- `memory_store` - Store memories with category and importance
- `memory_forget` - Delete memories by ID or bulk query (GDPR compliant)

#### Project Tools
- `project_list` - List projects with status filtering
- `project_get` - Get project details by ID
- `project_create` - Create new projects

#### Todo Tools
- `todo_list` - List todos with project and completion filtering
- `todo_create` - Create todos with optional due dates
- `todo_complete` - Mark todos as complete

#### Contact Tools
- `contact_search` - Search contacts by query
- `contact_get` - Get contact details by ID
- `contact_create` - Create contacts with email/phone validation

#### Lifecycle Hooks
- `beforeAgentStart` - Auto-recall relevant context (5s timeout)
- `agentEnd` - Auto-capture conversation insights (10s timeout)

#### CLI Commands
- `status` - Check API connectivity and latency
- `users` - Display user scoping configuration
- `recall` - Manual memory search from CLI
- `stats` - Memory statistics by category
- `export` - Export all memories (GDPR data portability)

#### Infrastructure
- Zod-based configuration validation
- API client with retry logic
- Flexible user scoping (agent, session, identity)
- Health check function
- Comprehensive error handling
- Sensitive content filtering

### Security

- Input validation on all parameters
- UUID format validation
- Sensitive pattern detection (API keys, passwords, credit cards)
- Error message sanitization
- PII protection in logging
- HTML/XSS stripping in outputs
