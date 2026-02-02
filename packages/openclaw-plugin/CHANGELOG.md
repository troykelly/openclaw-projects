# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
