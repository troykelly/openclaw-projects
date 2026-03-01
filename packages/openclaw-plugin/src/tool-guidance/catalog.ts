/**
 * Static guidance registry for the tool_guide meta-tool.
 * Provides structured usage guidance for every registered tool.
 * Part of Issue #1923.
 */

/** Guidance for an individual tool */
export interface ToolGuidance {
  group: string;
  when_to_use: string;
  when_not_to_use: string;
  alternatives: string[];
  side_effects: string[];
  prerequisites: string[];
  example_calls: Array<{ description: string; params: Record<string, unknown> }>;
}

/** Guidance for a tool group */
export interface GroupGuidance {
  description: string;
  tools: string[];
  workflow_tips: string;
  related_skills: string[];
}

/**
 * Per-tool guidance catalog.
 * Keys are tool names exactly as registered with the OpenClaw gateway.
 */
export const TOOL_CATALOG: Record<string, ToolGuidance> = {
  // ── Memory tools ──────────────────────────────────────────────
  memory_recall: {
    group: 'memory',
    when_to_use: 'When you need to retrieve stored memories, preferences, facts, or past decisions. Use for context about users, relationships, or prior interactions.',
    when_not_to_use: 'When looking for tasks/todos (use todo_search), projects (use project_search), or messages (use message_search).',
    alternatives: ['context_search', 'api_recall'],
    side_effects: [],
    prerequisites: ['Memories must have been stored previously via memory_store.'],
    example_calls: [
      { description: 'Search for food preferences', params: { query: 'food preferences', limit: 5 } },
      { description: 'Find memories with specific tags', params: { query: 'meeting notes', tags: ['work'] } },
    ],
  },
  memory_store: {
    group: 'memory',
    when_to_use: 'When you need to persist a preference, fact, decision, or context for future reference across sessions.',
    when_not_to_use: 'When creating tasks (use todo_create) or projects (use project_create). Do not store transient or ephemeral information.',
    alternatives: ['skill_store_put'],
    side_effects: ['Creates a new memory record with vector embedding.'],
    prerequisites: [],
    example_calls: [
      { description: 'Store a food preference', params: { content: 'User prefers vegetarian meals', category: 'preference', tags: ['food'] } },
    ],
  },
  memory_forget: {
    group: 'memory',
    when_to_use: 'When a stored memory is outdated, incorrect, or the user requests deletion.',
    when_not_to_use: 'When updating a memory — store a new one instead. Do not delete memories without user consent.',
    alternatives: [],
    side_effects: ['Permanently deletes the memory record.'],
    prerequisites: ['Know the memory ID or have a search query to match.'],
    example_calls: [
      { description: 'Forget by ID', params: { memory_id: '550e8400-e29b-41d4-a716-446655440000' } },
      { description: 'Forget by query', params: { query: 'old phone number' } },
    ],
  },

  // ── Project tools ─────────────────────────────────────────────
  project_list: {
    group: 'projects',
    when_to_use: 'When you need to see all projects or filter by status. Good for getting an overview of active work.',
    when_not_to_use: 'When you already know the project ID (use project_get). When searching by keyword (use project_search).',
    alternatives: ['project_search'],
    side_effects: [],
    prerequisites: [],
    example_calls: [
      { description: 'List active projects', params: { status: 'active' } },
      { description: 'List all projects', params: {} },
    ],
  },
  project_get: {
    group: 'projects',
    when_to_use: 'When you need detailed information about a specific project by ID.',
    when_not_to_use: 'When browsing projects (use project_list) or searching (use project_search).',
    alternatives: ['project_list'],
    side_effects: [],
    prerequisites: ['Need a valid project ID.'],
    example_calls: [
      { description: 'Get project details', params: { project_id: '550e8400-e29b-41d4-a716-446655440000' } },
    ],
  },
  project_create: {
    group: 'projects',
    when_to_use: 'When the user wants to start tracking a new initiative, goal, or body of work.',
    when_not_to_use: 'When adding a simple task (use todo_create). When the project already exists.',
    alternatives: ['todo_create'],
    side_effects: ['Creates a new project work item.'],
    prerequisites: [],
    example_calls: [
      { description: 'Create a home renovation project', params: { name: 'Kitchen Renovation', description: 'Track all kitchen renovation tasks' } },
    ],
  },
  project_search: {
    group: 'projects',
    when_to_use: 'When searching for projects by keyword, semantic similarity, or partial name match.',
    when_not_to_use: 'When you already know the project ID (use project_get). When listing all projects (use project_list).',
    alternatives: ['project_list', 'context_search'],
    side_effects: [],
    prerequisites: [],
    example_calls: [
      { description: 'Search for renovation projects', params: { query: 'renovation' } },
    ],
  },

  // ── Todo tools ────────────────────────────────────────────────
  todo_list: {
    group: 'todos',
    when_to_use: 'When listing tasks/todos, optionally filtered by project or status.',
    when_not_to_use: 'When searching by keyword (use todo_search). When you need project-level info (use project_get).',
    alternatives: ['todo_search'],
    side_effects: [],
    prerequisites: [],
    example_calls: [
      { description: 'List open todos in a project', params: { project_id: '550e8400-e29b-41d4-a716-446655440000', status: 'open' } },
    ],
  },
  todo_create: {
    group: 'todos',
    when_to_use: 'When the user wants to add a new task, shopping list item, reminder, or action item.',
    when_not_to_use: 'When creating a project or epic (use project_create). When storing a memory (use memory_store).',
    alternatives: ['project_create'],
    side_effects: ['Creates a new todo/task work item.'],
    prerequisites: [],
    example_calls: [
      { description: 'Add a shopping list item', params: { title: 'Buy asparagus', project_id: '550e8400-e29b-41d4-a716-446655440000' } },
      { description: 'Create a reminder', params: { title: 'Call mom', not_before: '2026-03-02T10:00:00Z' } },
    ],
  },
  todo_complete: {
    group: 'todos',
    when_to_use: 'When marking a task as done or completed.',
    when_not_to_use: 'When updating task details without completing (there is no general todo_update tool — create a new one if needed).',
    alternatives: [],
    side_effects: ['Marks the todo as completed.'],
    prerequisites: ['Need a valid todo ID.'],
    example_calls: [
      { description: 'Complete a task', params: { id: '550e8400-e29b-41d4-a716-446655440000' } },
    ],
  },
  todo_search: {
    group: 'todos',
    when_to_use: 'When searching for tasks by keyword or semantic similarity.',
    when_not_to_use: 'When listing all tasks in a project (use todo_list). When searching across entity types (use context_search).',
    alternatives: ['todo_list', 'context_search'],
    side_effects: [],
    prerequisites: [],
    example_calls: [
      { description: 'Search for grocery tasks', params: { query: 'groceries' } },
    ],
  },

  // ── Search tools ──────────────────────────────────────────────
  context_search: {
    group: 'search',
    when_to_use: 'When you need to search across multiple entity types (memories, todos, projects, messages) in one query.',
    when_not_to_use: 'When you know exactly which entity type to search — use the specific search tool for better results.',
    alternatives: ['memory_recall', 'todo_search', 'project_search', 'message_search'],
    side_effects: [],
    prerequisites: [],
    example_calls: [
      { description: 'Search everything about dentist', params: { query: 'dentist appointment' } },
      { description: 'Search only memories and todos', params: { query: 'birthday', entity_types: ['memory', 'todo'] } },
    ],
  },

  // ── Contact tools ─────────────────────────────────────────────
  contact_search: {
    group: 'contacts',
    when_to_use: 'When looking up contacts by name, email, phone, or other attributes.',
    when_not_to_use: 'When you already know the contact ID (use contact_get).',
    alternatives: ['contact_get', 'contact_resolve'],
    side_effects: [],
    prerequisites: [],
    example_calls: [
      { description: 'Search by name', params: { query: 'John Smith' } },
    ],
  },
  contact_get: {
    group: 'contacts',
    when_to_use: 'When retrieving full details for a specific contact by ID.',
    when_not_to_use: 'When searching for contacts (use contact_search).',
    alternatives: ['contact_search'],
    side_effects: [],
    prerequisites: ['Need a valid contact ID.'],
    example_calls: [
      { description: 'Get contact details', params: { contact_id: '550e8400-e29b-41d4-a716-446655440000' } },
    ],
  },
  contact_create: {
    group: 'contacts',
    when_to_use: 'When adding a new person to the contacts system with their name and endpoints (email, phone, etc.).',
    when_not_to_use: 'When the contact already exists (use contact_update). Search first to avoid duplicates.',
    alternatives: ['contact_update'],
    side_effects: ['Creates a new contact record.'],
    prerequisites: ['Search first to check the contact does not already exist.'],
    example_calls: [
      { description: 'Create a contact', params: { display_name: 'Jane Doe', endpoints: [{ type: 'email', value: 'jane@example.com' }] } },
    ],
  },
  contact_update: {
    group: 'contacts',
    when_to_use: 'When updating an existing contact\'s details (name, endpoints, metadata).',
    when_not_to_use: 'When creating a new contact (use contact_create). When merging duplicates (use contact_merge).',
    alternatives: ['contact_create', 'contact_merge'],
    side_effects: ['Modifies the contact record.'],
    prerequisites: ['Need a valid contact ID.'],
    example_calls: [
      { description: 'Update display name', params: { contact_id: '550e8400-e29b-41d4-a716-446655440000', display_name: 'Jane Smith' } },
    ],
  },
  contact_merge: {
    group: 'contacts',
    when_to_use: 'When two contact records represent the same person and should be combined.',
    when_not_to_use: 'When updating a single contact (use contact_update).',
    alternatives: ['contact_update'],
    side_effects: ['Merges two contacts — the secondary contact is absorbed into the primary.'],
    prerequisites: ['Need two valid contact IDs. Confirm with user before merging.'],
    example_calls: [
      { description: 'Merge duplicate contacts', params: { survivor_id: '550e8400-0001', loser_id: '550e8400-0002' } },
    ],
  },
  contact_tag_add: {
    group: 'contacts',
    when_to_use: 'When adding a tag/label to a contact for categorization.',
    when_not_to_use: 'When removing tags (use contact_tag_remove).',
    alternatives: [],
    side_effects: ['Adds tag to the contact.'],
    prerequisites: ['Need a valid contact ID.'],
    example_calls: [
      { description: 'Tag a contact as family', params: { contact_id: '550e8400-e29b-41d4-a716-446655440000', tag: 'family' } },
    ],
  },
  contact_tag_remove: {
    group: 'contacts',
    when_to_use: 'When removing a tag/label from a contact.',
    when_not_to_use: 'When adding tags (use contact_tag_add).',
    alternatives: [],
    side_effects: ['Removes tag from the contact.'],
    prerequisites: ['Need a valid contact ID and existing tag.'],
    example_calls: [
      { description: 'Remove family tag', params: { contact_id: '550e8400-e29b-41d4-a716-446655440000', tag: 'family' } },
    ],
  },
  contact_resolve: {
    group: 'contacts',
    when_to_use: 'When resolving a contact from an endpoint (email, phone number) to find the matching contact record.',
    when_not_to_use: 'When searching by name (use contact_search). When you know the contact ID (use contact_get).',
    alternatives: ['contact_search', 'contact_get'],
    side_effects: [],
    prerequisites: ['Need an endpoint value (email or phone).'],
    example_calls: [
      { description: 'Resolve by phone', params: { endpoint: '+61412345678' } },
    ],
  },

  // ── Communication tools ───────────────────────────────────────
  sms_send: {
    group: 'communication',
    when_to_use: 'When sending an SMS or text message to a phone number. Use for short text-based communication via SMS.',
    when_not_to_use: 'When sending email (use email_send). When the recipient prefers a different channel.',
    alternatives: ['email_send'],
    side_effects: ['Sends an SMS message via Twilio. The recipient will receive the message.'],
    prerequisites: ['Twilio must be configured. Need a valid phone number.'],
    example_calls: [
      { description: 'Send an SMS', params: { to: '+61412345678', body: 'Reminder: Dentist at 3pm today' } },
    ],
  },
  email_send: {
    group: 'communication',
    when_to_use: 'When sending an email to a recipient.',
    when_not_to_use: 'When sending SMS (use sms_send). When the message is internal or does not need email delivery.',
    alternatives: ['sms_send'],
    side_effects: ['Sends an email via configured email service. The recipient will receive the email.'],
    prerequisites: ['Email service must be configured. Need a valid email address.'],
    example_calls: [
      { description: 'Send an email', params: { to: 'user@example.com', subject: 'Meeting Notes', body: 'Here are the notes from today.' } },
    ],
  },
  message_search: {
    group: 'communication',
    when_to_use: 'When searching through past messages (SMS, email) by keyword or semantic similarity.',
    when_not_to_use: 'When listing threads (use thread_list). When searching memories (use memory_recall).',
    alternatives: ['context_search', 'thread_get'],
    side_effects: [],
    prerequisites: [],
    example_calls: [
      { description: 'Search messages about invoices', params: { query: 'invoice payment' } },
    ],
  },

  // ── Thread tools ──────────────────────────────────────────────
  thread_list: {
    group: 'threads',
    when_to_use: 'When listing conversation threads (SMS or email threads).',
    when_not_to_use: 'When searching message content (use message_search). When you know the thread ID (use thread_get).',
    alternatives: ['thread_get', 'message_search'],
    side_effects: [],
    prerequisites: [],
    example_calls: [
      { description: 'List recent threads', params: { limit: 10 } },
    ],
  },
  thread_get: {
    group: 'threads',
    when_to_use: 'When retrieving a specific conversation thread with its messages.',
    when_not_to_use: 'When browsing threads (use thread_list). When searching (use message_search).',
    alternatives: ['thread_list'],
    side_effects: [],
    prerequisites: ['Need a valid thread ID.'],
    example_calls: [
      { description: 'Get thread messages', params: { thread_id: '550e8400-e29b-41d4-a716-446655440000' } },
    ],
  },

  // ── Note tools ────────────────────────────────────────────────
  note_create: {
    group: 'notes',
    when_to_use: 'When creating a new freeform note, document, or long-form content.',
    when_not_to_use: 'When storing a simple fact or preference (use memory_store). When creating a task (use todo_create).',
    alternatives: ['memory_store', 'notebook_create'],
    side_effects: ['Creates a new note record.'],
    prerequisites: [],
    example_calls: [
      { description: 'Create a meeting note', params: { title: 'Team standup 2026-03-01', content: 'Discussion points...', visibility: 'private' } },
    ],
  },
  note_get: {
    group: 'notes',
    when_to_use: 'When retrieving a specific note by ID.',
    when_not_to_use: 'When searching for notes (use note_search).',
    alternatives: ['note_search'],
    side_effects: [],
    prerequisites: ['Need a valid note ID.'],
    example_calls: [
      { description: 'Get note details', params: { note_id: '550e8400-e29b-41d4-a716-446655440000' } },
    ],
  },
  note_update: {
    group: 'notes',
    when_to_use: 'When modifying an existing note\'s title, content, or visibility.',
    when_not_to_use: 'When creating a new note (use note_create). When deleting a note (use note_delete).',
    alternatives: [],
    side_effects: ['Modifies the note record.'],
    prerequisites: ['Need a valid note ID.'],
    example_calls: [
      { description: 'Update note content', params: { note_id: '550e8400-e29b-41d4-a716-446655440000', content: 'Updated content...' } },
    ],
  },
  note_delete: {
    group: 'notes',
    when_to_use: 'When permanently removing a note.',
    when_not_to_use: 'When updating a note (use note_update). Confirm with user before deleting.',
    alternatives: [],
    side_effects: ['Permanently deletes the note.'],
    prerequisites: ['Need a valid note ID. Confirm deletion with user.'],
    example_calls: [
      { description: 'Delete a note', params: { note_id: '550e8400-e29b-41d4-a716-446655440000' } },
    ],
  },
  note_search: {
    group: 'notes',
    when_to_use: 'When searching for notes by keyword or semantic similarity.',
    when_not_to_use: 'When you know the note ID (use note_get). When searching across all entity types (use context_search).',
    alternatives: ['note_get', 'context_search'],
    side_effects: [],
    prerequisites: [],
    example_calls: [
      { description: 'Search meeting notes', params: { query: 'standup meeting' } },
    ],
  },

  // ── Notebook tools ────────────────────────────────────────────
  notebook_list: {
    group: 'notebooks',
    when_to_use: 'When listing available notebooks to organize notes.',
    when_not_to_use: 'When you know the notebook ID (use notebook_get).',
    alternatives: ['notebook_get'],
    side_effects: [],
    prerequisites: [],
    example_calls: [
      { description: 'List all notebooks', params: {} },
    ],
  },
  notebook_create: {
    group: 'notebooks',
    when_to_use: 'When creating a new notebook to organize related notes.',
    when_not_to_use: 'When creating a single note (use note_create). When the notebook already exists.',
    alternatives: ['note_create'],
    side_effects: ['Creates a new notebook.'],
    prerequisites: [],
    example_calls: [
      { description: 'Create a work notebook', params: { name: 'Work Notes', description: 'Notes from work meetings' } },
    ],
  },
  notebook_get: {
    group: 'notebooks',
    when_to_use: 'When retrieving a specific notebook and its notes by ID.',
    when_not_to_use: 'When browsing notebooks (use notebook_list).',
    alternatives: ['notebook_list'],
    side_effects: [],
    prerequisites: ['Need a valid notebook ID.'],
    example_calls: [
      { description: 'Get notebook details', params: { notebook_id: '550e8400-e29b-41d4-a716-446655440000' } },
    ],
  },

  // ── Relationship tools ────────────────────────────────────────
  relationship_set: {
    group: 'relationships',
    when_to_use: 'When defining or updating a relationship between two contacts (e.g., spouse, coworker, parent).',
    when_not_to_use: 'When linking entities across systems (use links_set). When querying relationships (use relationship_query).',
    alternatives: ['links_set'],
    side_effects: ['Creates or updates a relationship between contacts.'],
    prerequisites: ['Need two valid contact IDs.'],
    example_calls: [
      { description: 'Set a sibling relationship', params: { contact_id: '550e8400-0001', related_contact_id: '550e8400-0002', relationship_type: 'sibling' } },
    ],
  },
  relationship_query: {
    group: 'relationships',
    when_to_use: 'When querying relationships for a contact to find connected people.',
    when_not_to_use: 'When setting relationships (use relationship_set). When querying entity links (use links_query).',
    alternatives: ['links_query'],
    side_effects: [],
    prerequisites: ['Need a valid contact ID.'],
    example_calls: [
      { description: 'Find family members', params: { contact_id: '550e8400-e29b-41d4-a716-446655440000', relationship_type: 'family' } },
    ],
  },

  // ── Entity link tools ─────────────────────────────────────────
  links_set: {
    group: 'entity_links',
    when_to_use: 'When linking entities (work items, contacts, memories) to each other or external resources.',
    when_not_to_use: 'When setting contact relationships (use relationship_set).',
    alternatives: ['relationship_set'],
    side_effects: ['Creates a link between entities.'],
    prerequisites: ['Need valid entity IDs for both source and target.'],
    example_calls: [
      { description: 'Link a todo to a contact', params: { source_type: 'work_item', source_id: '550e8400-0001', target_type: 'contact', target_id: '550e8400-0002', link_type: 'assigned_to' } },
    ],
  },
  links_query: {
    group: 'entity_links',
    when_to_use: 'When querying links for an entity to find connected items.',
    when_not_to_use: 'When querying contact relationships (use relationship_query).',
    alternatives: ['relationship_query'],
    side_effects: [],
    prerequisites: ['Need a valid entity ID.'],
    example_calls: [
      { description: 'Find linked contacts', params: { source_type: 'work_item', source_id: '550e8400-e29b-41d4-a716-446655440000' } },
    ],
  },
  links_remove: {
    group: 'entity_links',
    when_to_use: 'When removing a link between entities.',
    when_not_to_use: 'When the link should be preserved. Confirm with user before removing.',
    alternatives: [],
    side_effects: ['Removes the entity link.'],
    prerequisites: ['Need a valid link ID.'],
    example_calls: [
      { description: 'Remove a link', params: { link_id: '550e8400-e29b-41d4-a716-446655440000' } },
    ],
  },

  // ── Skill store tools ─────────────────────────────────────────
  skill_store_put: {
    group: 'skill_store',
    when_to_use: 'When storing or updating a reusable skill (prompt, workflow, template) for future use.',
    when_not_to_use: 'When storing a memory/fact (use memory_store). When creating a prompt template (use prompt_template_create).',
    alternatives: ['memory_store', 'prompt_template_create'],
    side_effects: ['Creates or updates a skill in the store.'],
    prerequisites: [],
    example_calls: [
      { description: 'Store a summarization skill', params: { name: 'summarize_email', content: 'Summarize the following email...', collection: 'email_tools' } },
    ],
  },
  skill_store_get: {
    group: 'skill_store',
    when_to_use: 'When retrieving a specific skill by name or ID.',
    when_not_to_use: 'When searching for skills (use skill_store_search). When listing skills (use skill_store_list).',
    alternatives: ['skill_store_search', 'skill_store_list'],
    side_effects: [],
    prerequisites: ['Need a valid skill name or ID.'],
    example_calls: [
      { description: 'Get a skill', params: { name: 'summarize_email' } },
    ],
  },
  skill_store_list: {
    group: 'skill_store',
    when_to_use: 'When listing available skills, optionally filtered by collection.',
    when_not_to_use: 'When searching by keyword (use skill_store_search). When you know the skill name (use skill_store_get).',
    alternatives: ['skill_store_search', 'skill_store_collections'],
    side_effects: [],
    prerequisites: [],
    example_calls: [
      { description: 'List skills in a collection', params: { collection: 'email_tools' } },
    ],
  },
  skill_store_delete: {
    group: 'skill_store',
    when_to_use: 'When removing a skill from the store.',
    when_not_to_use: 'When updating a skill (use skill_store_put). Confirm with user before deleting.',
    alternatives: [],
    side_effects: ['Deletes the skill from the store.'],
    prerequisites: ['Need a valid skill name or ID.'],
    example_calls: [
      { description: 'Delete a skill', params: { name: 'old_skill' } },
    ],
  },
  skill_store_search: {
    group: 'skill_store',
    when_to_use: 'When searching for skills by keyword or semantic similarity.',
    when_not_to_use: 'When listing all skills (use skill_store_list). When you know the skill name (use skill_store_get).',
    alternatives: ['skill_store_list', 'skill_store_get'],
    side_effects: [],
    prerequisites: [],
    example_calls: [
      { description: 'Search for email skills', params: { query: 'email summarization' } },
    ],
  },
  skill_store_collections: {
    group: 'skill_store',
    when_to_use: 'When listing available skill collections to understand how skills are organized.',
    when_not_to_use: 'When searching for individual skills (use skill_store_search).',
    alternatives: ['skill_store_list'],
    side_effects: [],
    prerequisites: [],
    example_calls: [
      { description: 'List all collections', params: {} },
    ],
  },
  skill_store_aggregate: {
    group: 'skill_store',
    when_to_use: 'When getting aggregated statistics about skills in the store (counts, collections).',
    when_not_to_use: 'When retrieving individual skills.',
    alternatives: ['skill_store_collections'],
    side_effects: [],
    prerequisites: [],
    example_calls: [
      { description: 'Get skill statistics', params: {} },
    ],
  },

  // ── File share tools ──────────────────────────────────────────
  file_share: {
    group: 'file_share',
    when_to_use: 'When generating a shareable download link for a file attachment.',
    when_not_to_use: 'When uploading files or managing file content.',
    alternatives: [],
    side_effects: ['Generates a time-limited share URL.'],
    prerequisites: ['Need a valid file attachment ID.'],
    example_calls: [
      { description: 'Create share link', params: { file_id: '550e8400-e29b-41d4-a716-446655440000', expires_in: 3600 } },
    ],
  },

  // ── Terminal connection tools ─────────────────────────────────
  terminal_connection_list: {
    group: 'terminal_connections',
    when_to_use: 'When listing saved SSH/terminal connection configurations.',
    when_not_to_use: 'When managing active sessions (use terminal_session_list).',
    alternatives: ['terminal_session_list'],
    side_effects: [],
    prerequisites: [],
    example_calls: [
      { description: 'List all connections', params: {} },
    ],
  },
  terminal_connection_create: {
    group: 'terminal_connections',
    when_to_use: 'When saving a new SSH/terminal connection configuration.',
    when_not_to_use: 'When starting a session on an existing connection (use terminal_session_start).',
    alternatives: [],
    side_effects: ['Creates a new connection configuration.'],
    prerequisites: ['Need hostname, port, and authentication details.'],
    example_calls: [
      { description: 'Create SSH connection', params: { name: 'prod-server', hostname: 'example.com', port: 22, auth_method: 'key' } },
    ],
  },
  terminal_connection_update: {
    group: 'terminal_connections',
    when_to_use: 'When updating an existing connection configuration.',
    when_not_to_use: 'When creating a new connection (use terminal_connection_create).',
    alternatives: [],
    side_effects: ['Modifies the connection configuration.'],
    prerequisites: ['Need a valid connection ID.'],
    example_calls: [
      { description: 'Update connection port', params: { connection_id: '550e8400-e29b-41d4-a716-446655440000', port: 2222 } },
    ],
  },
  terminal_connection_delete: {
    group: 'terminal_connections',
    when_to_use: 'When removing a saved connection configuration.',
    when_not_to_use: 'When terminating an active session (use terminal_session_terminate).',
    alternatives: [],
    side_effects: ['Deletes the connection configuration.'],
    prerequisites: ['Need a valid connection ID. Confirm with user.'],
    example_calls: [
      { description: 'Delete a connection', params: { connection_id: '550e8400-e29b-41d4-a716-446655440000' } },
    ],
  },
  terminal_connection_test: {
    group: 'terminal_connections',
    when_to_use: 'When testing whether a saved connection can be established successfully.',
    when_not_to_use: 'When starting a full session (use terminal_session_start).',
    alternatives: ['terminal_session_start'],
    side_effects: ['Attempts a test connection to the remote host.'],
    prerequisites: ['Need a valid connection ID with credentials.'],
    example_calls: [
      { description: 'Test a connection', params: { connection_id: '550e8400-e29b-41d4-a716-446655440000' } },
    ],
  },
  terminal_credential_create: {
    group: 'terminal_connections',
    when_to_use: 'When storing SSH credentials (keys, passwords) for terminal connections.',
    when_not_to_use: 'When managing API credentials (use api_credential_manage).',
    alternatives: ['api_credential_manage'],
    side_effects: ['Stores encrypted credentials.'],
    prerequisites: ['Need the credential value (key or password).'],
    example_calls: [
      { description: 'Store an SSH key', params: { name: 'prod-key', kind: 'private_key', value: '...' } },
    ],
  },
  terminal_credential_list: {
    group: 'terminal_connections',
    when_to_use: 'When listing stored terminal credentials (names and types, not values).',
    when_not_to_use: 'When listing API credentials.',
    alternatives: [],
    side_effects: [],
    prerequisites: [],
    example_calls: [
      { description: 'List credentials', params: {} },
    ],
  },
  terminal_credential_delete: {
    group: 'terminal_connections',
    when_to_use: 'When removing stored terminal credentials.',
    when_not_to_use: 'When the credential is still in use by a connection.',
    alternatives: [],
    side_effects: ['Deletes the stored credential.'],
    prerequisites: ['Need a valid credential ID. Ensure no connections depend on it.'],
    example_calls: [
      { description: 'Delete a credential', params: { credential_id: '550e8400-e29b-41d4-a716-446655440000' } },
    ],
  },

  // ── Terminal session tools ────────────────────────────────────
  terminal_session_start: {
    group: 'terminal_sessions',
    when_to_use: 'When starting a new interactive terminal session using a saved connection.',
    when_not_to_use: 'When listing existing sessions (use terminal_session_list).',
    alternatives: [],
    side_effects: ['Opens a new SSH session to the remote host.'],
    prerequisites: ['Need a valid connection ID with working credentials.'],
    example_calls: [
      { description: 'Start a session', params: { connection_id: '550e8400-e29b-41d4-a716-446655440000' } },
    ],
  },
  terminal_session_list: {
    group: 'terminal_sessions',
    when_to_use: 'When listing active terminal sessions.',
    when_not_to_use: 'When listing saved connections (use terminal_connection_list).',
    alternatives: ['terminal_connection_list'],
    side_effects: [],
    prerequisites: [],
    example_calls: [
      { description: 'List active sessions', params: {} },
    ],
  },
  terminal_session_terminate: {
    group: 'terminal_sessions',
    when_to_use: 'When ending an active terminal session.',
    when_not_to_use: 'When deleting a saved connection (use terminal_connection_delete).',
    alternatives: [],
    side_effects: ['Terminates the SSH session.'],
    prerequisites: ['Need a valid session ID.'],
    example_calls: [
      { description: 'Terminate a session', params: { session_id: '550e8400-e29b-41d4-a716-446655440000' } },
    ],
  },
  terminal_session_info: {
    group: 'terminal_sessions',
    when_to_use: 'When getting detailed information about an active terminal session.',
    when_not_to_use: 'When listing all sessions (use terminal_session_list).',
    alternatives: ['terminal_session_list'],
    side_effects: [],
    prerequisites: ['Need a valid session ID.'],
    example_calls: [
      { description: 'Get session info', params: { session_id: '550e8400-e29b-41d4-a716-446655440000' } },
    ],
  },
  terminal_send_command: {
    group: 'terminal_sessions',
    when_to_use: 'When executing a command in an active terminal session and capturing output.',
    when_not_to_use: 'When sending raw keystrokes (use terminal_send_keys). When no session is active.',
    alternatives: ['terminal_send_keys'],
    side_effects: ['Executes a command on the remote host.'],
    prerequisites: ['Need an active terminal session.'],
    example_calls: [
      { description: 'Run a command', params: { session_id: '550e8400-e29b-41d4-a716-446655440000', command: 'ls -la' } },
    ],
  },
  terminal_send_keys: {
    group: 'terminal_sessions',
    when_to_use: 'When sending raw keystrokes to an active terminal session (for interactive programs, ctrl+c, etc.).',
    when_not_to_use: 'When executing a simple command (use terminal_send_command).',
    alternatives: ['terminal_send_command'],
    side_effects: ['Sends keystrokes to the remote host.'],
    prerequisites: ['Need an active terminal session.'],
    example_calls: [
      { description: 'Send ctrl+c', params: { session_id: '550e8400-e29b-41d4-a716-446655440000', keys: '\x03' } },
    ],
  },
  terminal_capture_pane: {
    group: 'terminal_sessions',
    when_to_use: 'When capturing the current terminal screen/pane content from an active session.',
    when_not_to_use: 'When executing commands (use terminal_send_command which returns output).',
    alternatives: ['terminal_send_command'],
    side_effects: [],
    prerequisites: ['Need an active terminal session.'],
    example_calls: [
      { description: 'Capture screen', params: { session_id: '550e8400-e29b-41d4-a716-446655440000' } },
    ],
  },

  // ── Terminal tunnel tools ─────────────────────────────────────
  terminal_tunnel_create: {
    group: 'terminal_tunnels',
    when_to_use: 'When creating an SSH port-forwarding tunnel (local or remote).',
    when_not_to_use: 'When starting a terminal session (use terminal_session_start).',
    alternatives: [],
    side_effects: ['Creates a port-forwarding tunnel through SSH.'],
    prerequisites: ['Need an active terminal session.'],
    example_calls: [
      { description: 'Create local tunnel', params: { session_id: '550e8400-e29b-41d4-a716-446655440000', direction: 'local', local_port: 8080, remote_port: 80 } },
    ],
  },
  terminal_tunnel_list: {
    group: 'terminal_tunnels',
    when_to_use: 'When listing active SSH tunnels.',
    when_not_to_use: 'When listing sessions (use terminal_session_list).',
    alternatives: ['terminal_session_list'],
    side_effects: [],
    prerequisites: [],
    example_calls: [
      { description: 'List tunnels', params: {} },
    ],
  },
  terminal_tunnel_close: {
    group: 'terminal_tunnels',
    when_to_use: 'When closing an SSH port-forwarding tunnel.',
    when_not_to_use: 'When terminating a session (use terminal_session_terminate which closes all tunnels).',
    alternatives: ['terminal_session_terminate'],
    side_effects: ['Closes the tunnel.'],
    prerequisites: ['Need a valid tunnel ID.'],
    example_calls: [
      { description: 'Close a tunnel', params: { tunnel_id: '550e8400-e29b-41d4-a716-446655440000' } },
    ],
  },

  // ── Terminal search tools ─────────────────────────────────────
  terminal_search: {
    group: 'terminal_search',
    when_to_use: 'When searching through terminal session history, command output, or annotations.',
    when_not_to_use: 'When searching memories or messages (use memory_recall or message_search).',
    alternatives: ['terminal_capture_pane'],
    side_effects: [],
    prerequisites: ['Need terminal sessions with recorded history.'],
    example_calls: [
      { description: 'Search command history', params: { query: 'deploy', session_id: '550e8400-e29b-41d4-a716-446655440000' } },
    ],
  },
  terminal_annotate: {
    group: 'terminal_search',
    when_to_use: 'When adding a note or annotation to a terminal session entry for future reference.',
    when_not_to_use: 'When creating a general note (use note_create).',
    alternatives: ['note_create'],
    side_effects: ['Adds annotation to the terminal entry.'],
    prerequisites: ['Need a valid terminal entry ID.'],
    example_calls: [
      { description: 'Annotate a command', params: { entry_id: '550e8400-e29b-41d4-a716-446655440000', annotation: 'This fixed the deployment issue' } },
    ],
  },

  // ── Dev session tools ─────────────────────────────────────────
  dev_session_create: {
    group: 'dev_sessions',
    when_to_use: 'When starting a new development session to track coding work (issues, commits, test results).',
    when_not_to_use: 'When tracking general tasks (use todo_create). When starting a terminal session (use terminal_session_start).',
    alternatives: ['todo_create'],
    side_effects: ['Creates a new dev session record.'],
    prerequisites: [],
    example_calls: [
      { description: 'Start a dev session', params: { title: 'Working on issue #123', issue_url: 'https://github.com/org/repo/issues/123' } },
    ],
  },
  dev_session_list: {
    group: 'dev_sessions',
    when_to_use: 'When listing development sessions, optionally filtered by status.',
    when_not_to_use: 'When you know the session ID (use dev_session_get).',
    alternatives: ['dev_session_get'],
    side_effects: [],
    prerequisites: [],
    example_calls: [
      { description: 'List active dev sessions', params: { status: 'active' } },
    ],
  },
  dev_session_get: {
    group: 'dev_sessions',
    when_to_use: 'When retrieving full details of a specific development session.',
    when_not_to_use: 'When listing sessions (use dev_session_list).',
    alternatives: ['dev_session_list'],
    side_effects: [],
    prerequisites: ['Need a valid dev session ID.'],
    example_calls: [
      { description: 'Get session details', params: { session_id: '550e8400-e29b-41d4-a716-446655440000' } },
    ],
  },
  dev_session_update: {
    group: 'dev_sessions',
    when_to_use: 'When updating a development session with progress, commits, or notes.',
    when_not_to_use: 'When completing a session (use dev_session_complete).',
    alternatives: ['dev_session_complete'],
    side_effects: ['Modifies the dev session record.'],
    prerequisites: ['Need a valid dev session ID.'],
    example_calls: [
      { description: 'Add progress note', params: { session_id: '550e8400-e29b-41d4-a716-446655440000', notes: 'Tests passing, PR ready for review' } },
    ],
  },
  dev_session_complete: {
    group: 'dev_sessions',
    when_to_use: 'When marking a development session as complete.',
    when_not_to_use: 'When updating progress (use dev_session_update). When abandoning (provide a reason).',
    alternatives: ['dev_session_update'],
    side_effects: ['Marks the dev session as completed.'],
    prerequisites: ['Need a valid dev session ID.'],
    example_calls: [
      { description: 'Complete a session', params: { session_id: '550e8400-e29b-41d4-a716-446655440000', summary: 'Fixed bug #123, all tests passing' } },
    ],
  },

  // ── API management tools ──────────────────────────────────────
  api_onboard: {
    group: 'api_management',
    when_to_use: 'When onboarding a new external API by providing its OpenAPI spec for parsing into searchable memories.',
    when_not_to_use: 'When recalling already-onboarded APIs (use api_recall).',
    alternatives: ['api_recall'],
    side_effects: ['Parses the API spec and stores it as searchable memories.'],
    prerequisites: ['Need an OpenAPI spec URL or inline content.'],
    example_calls: [
      { description: 'Onboard from URL', params: { spec_url: 'https://api.example.com/openapi.json', name: 'Example API' } },
    ],
  },
  api_recall: {
    group: 'api_management',
    when_to_use: 'When searching onboarded API memories to find endpoints, operations, and capabilities.',
    when_not_to_use: 'When searching general memories (use memory_recall). When the API has not been onboarded yet (use api_onboard first).',
    alternatives: ['memory_recall', 'api_get'],
    side_effects: [],
    prerequisites: ['API must be onboarded via api_onboard.'],
    example_calls: [
      { description: 'Find user endpoints', params: { query: 'create user account' } },
    ],
  },
  api_get: {
    group: 'api_management',
    when_to_use: 'When retrieving details about a specific onboarded API source.',
    when_not_to_use: 'When searching across APIs (use api_recall). When listing APIs (use api_list).',
    alternatives: ['api_recall', 'api_list'],
    side_effects: [],
    prerequisites: ['Need a valid API source ID.'],
    example_calls: [
      { description: 'Get API details', params: { source_id: '550e8400-e29b-41d4-a716-446655440000' } },
    ],
  },
  api_list: {
    group: 'api_management',
    when_to_use: 'When listing all onboarded API sources.',
    when_not_to_use: 'When searching API operations (use api_recall). When you know the source ID (use api_get).',
    alternatives: ['api_get', 'api_recall'],
    side_effects: [],
    prerequisites: [],
    example_calls: [
      { description: 'List onboarded APIs', params: {} },
    ],
  },
  api_update: {
    group: 'api_management',
    when_to_use: 'When updating an onboarded API source (re-parsing spec, changing config).',
    when_not_to_use: 'When refreshing credentials (use api_refresh). When removing an API (use api_remove).',
    alternatives: ['api_refresh'],
    side_effects: ['Updates the API source and may re-parse the spec.'],
    prerequisites: ['Need a valid API source ID.'],
    example_calls: [
      { description: 'Update API config', params: { source_id: '550e8400-e29b-41d4-a716-446655440000', name: 'Updated API Name' } },
    ],
  },
  api_credential_manage: {
    group: 'api_management',
    when_to_use: 'When managing credentials (API keys, OAuth tokens) for onboarded APIs.',
    when_not_to_use: 'When managing terminal credentials (use terminal_credential_create).',
    alternatives: ['terminal_credential_create'],
    side_effects: ['Stores or updates API credentials.'],
    prerequisites: ['Need a valid API source ID and credential values.'],
    example_calls: [
      { description: 'Set API key', params: { source_id: '550e8400-e29b-41d4-a716-446655440000', credential_type: 'api_key', value: 'sk-...' } },
    ],
  },
  api_refresh: {
    group: 'api_management',
    when_to_use: 'When refreshing an onboarded API source to re-fetch and re-parse its spec.',
    when_not_to_use: 'When updating metadata (use api_update).',
    alternatives: ['api_update'],
    side_effects: ['Re-fetches and re-parses the API spec.'],
    prerequisites: ['Need a valid API source ID.'],
    example_calls: [
      { description: 'Refresh API spec', params: { source_id: '550e8400-e29b-41d4-a716-446655440000' } },
    ],
  },
  api_remove: {
    group: 'api_management',
    when_to_use: 'When soft-deleting an onboarded API source.',
    when_not_to_use: 'When temporarily disabling (not supported — remove and re-onboard). Confirm with user.',
    alternatives: ['api_restore'],
    side_effects: ['Soft-deletes the API source.'],
    prerequisites: ['Need a valid API source ID. Confirm with user.'],
    example_calls: [
      { description: 'Remove an API', params: { source_id: '550e8400-e29b-41d4-a716-446655440000' } },
    ],
  },
  api_restore: {
    group: 'api_management',
    when_to_use: 'When restoring a previously soft-deleted API source.',
    when_not_to_use: 'When the API was never onboarded (use api_onboard).',
    alternatives: ['api_onboard'],
    side_effects: ['Restores the soft-deleted API source.'],
    prerequisites: ['Need a valid deleted API source ID.'],
    example_calls: [
      { description: 'Restore a deleted API', params: { source_id: '550e8400-e29b-41d4-a716-446655440000' } },
    ],
  },

  // ── Prompt template tools ─────────────────────────────────────
  prompt_template_list: {
    group: 'prompt_templates',
    when_to_use: 'When listing available prompt templates.',
    when_not_to_use: 'When you know the template name (use prompt_template_get).',
    alternatives: ['prompt_template_get'],
    side_effects: [],
    prerequisites: [],
    example_calls: [
      { description: 'List templates', params: {} },
    ],
  },
  prompt_template_get: {
    group: 'prompt_templates',
    when_to_use: 'When retrieving a specific prompt template by name or ID.',
    when_not_to_use: 'When listing templates (use prompt_template_list).',
    alternatives: ['prompt_template_list'],
    side_effects: [],
    prerequisites: ['Need a valid template name or ID.'],
    example_calls: [
      { description: 'Get a template', params: { name: 'welcome_message' } },
    ],
  },
  prompt_template_create: {
    group: 'prompt_templates',
    when_to_use: 'When creating a new prompt template for reuse.',
    when_not_to_use: 'When storing a skill (use skill_store_put). When the template already exists (use prompt_template_update).',
    alternatives: ['skill_store_put', 'prompt_template_update'],
    side_effects: ['Creates a new prompt template.'],
    prerequisites: [],
    example_calls: [
      { description: 'Create a template', params: { name: 'welcome_message', content: 'Hello {{name}}, welcome!' } },
    ],
  },
  prompt_template_update: {
    group: 'prompt_templates',
    when_to_use: 'When updating an existing prompt template.',
    when_not_to_use: 'When creating a new template (use prompt_template_create).',
    alternatives: ['prompt_template_create'],
    side_effects: ['Modifies the prompt template.'],
    prerequisites: ['Need a valid template name or ID.'],
    example_calls: [
      { description: 'Update template content', params: { name: 'welcome_message', content: 'Hi {{name}}, welcome back!' } },
    ],
  },
  prompt_template_delete: {
    group: 'prompt_templates',
    when_to_use: 'When deleting a prompt template.',
    when_not_to_use: 'When updating a template (use prompt_template_update). Confirm with user.',
    alternatives: [],
    side_effects: ['Deletes the prompt template.'],
    prerequisites: ['Need a valid template name or ID. Confirm with user.'],
    example_calls: [
      { description: 'Delete a template', params: { name: 'old_template' } },
    ],
  },

  // ── Inbound routing tools ─────────────────────────────────────
  inbound_destination_list: {
    group: 'inbound_routing',
    when_to_use: 'When listing configured inbound routing destinations (where inbound messages are delivered).',
    when_not_to_use: 'When managing channel defaults (use channel_default_list).',
    alternatives: ['channel_default_list'],
    side_effects: [],
    prerequisites: [],
    example_calls: [
      { description: 'List destinations', params: {} },
    ],
  },
  inbound_destination_get: {
    group: 'inbound_routing',
    when_to_use: 'When retrieving details for a specific inbound routing destination.',
    when_not_to_use: 'When listing destinations (use inbound_destination_list).',
    alternatives: ['inbound_destination_list'],
    side_effects: [],
    prerequisites: ['Need a valid destination ID.'],
    example_calls: [
      { description: 'Get destination', params: { destination_id: '550e8400-e29b-41d4-a716-446655440000' } },
    ],
  },
  inbound_destination_update: {
    group: 'inbound_routing',
    when_to_use: 'When updating an inbound routing destination configuration.',
    when_not_to_use: 'When managing channel defaults (use channel_default_set).',
    alternatives: ['channel_default_set'],
    side_effects: ['Modifies the inbound routing configuration.'],
    prerequisites: ['Need a valid destination ID.'],
    example_calls: [
      { description: 'Update destination', params: { destination_id: '550e8400-e29b-41d4-a716-446655440000', enabled: true } },
    ],
  },

  // ── Channel default tools ─────────────────────────────────────
  channel_default_list: {
    group: 'channel_defaults',
    when_to_use: 'When listing default routing configurations per channel type.',
    when_not_to_use: 'When managing inbound destinations (use inbound_destination_list).',
    alternatives: ['inbound_destination_list'],
    side_effects: [],
    prerequisites: [],
    example_calls: [
      { description: 'List channel defaults', params: {} },
    ],
  },
  channel_default_get: {
    group: 'channel_defaults',
    when_to_use: 'When retrieving the default routing config for a specific channel type.',
    when_not_to_use: 'When listing all channel defaults (use channel_default_list).',
    alternatives: ['channel_default_list'],
    side_effects: [],
    prerequisites: ['Need a valid channel type.'],
    example_calls: [
      { description: 'Get SMS channel default', params: { channel: 'sms' } },
    ],
  },
  channel_default_set: {
    group: 'channel_defaults',
    when_to_use: 'When setting or updating the default routing config for a channel type.',
    when_not_to_use: 'When managing individual destinations (use inbound_destination_update).',
    alternatives: ['inbound_destination_update'],
    side_effects: ['Updates the channel default routing configuration.'],
    prerequisites: ['Requires agentadmin access.'],
    example_calls: [
      { description: 'Set SMS default', params: { channel: 'sms', destination_id: '550e8400-e29b-41d4-a716-446655440000' } },
    ],
  },

  // ── Namespace tools ───────────────────────────────────────────
  namespace_list: {
    group: 'namespaces',
    when_to_use: 'When listing all namespaces accessible to the current user or agent.',
    when_not_to_use: 'When creating a namespace (use namespace_create).',
    alternatives: ['namespace_create'],
    side_effects: [],
    prerequisites: [],
    example_calls: [
      { description: 'List namespaces', params: {} },
    ],
  },
  namespace_create: {
    group: 'namespaces',
    when_to_use: 'When creating a new namespace for data isolation or sharing.',
    when_not_to_use: 'When the namespace already exists (use namespace_list to check first).',
    alternatives: [],
    side_effects: ['Creates a new namespace. The creating user becomes the owner.'],
    prerequisites: [],
    example_calls: [
      { description: 'Create a namespace', params: { name: 'team-projects', display_name: 'Team Projects' } },
    ],
  },
  namespace_grant: {
    group: 'namespaces',
    when_to_use: 'When granting a user access to a namespace with a specific role.',
    when_not_to_use: 'When revoking access (use namespace_revoke).',
    alternatives: ['namespace_revoke'],
    side_effects: ['Grants namespace access to a user.'],
    prerequisites: ['Need namespace name and target user ID. Must be owner or admin of the namespace.'],
    example_calls: [
      { description: 'Grant read access', params: { namespace: 'team-projects', user_id: '550e8400-e29b-41d4-a716-446655440000', role: 'reader' } },
    ],
  },
  namespace_members: {
    group: 'namespaces',
    when_to_use: 'When listing members of a namespace with their roles.',
    when_not_to_use: 'When listing namespaces themselves (use namespace_list).',
    alternatives: ['namespace_list'],
    side_effects: [],
    prerequisites: ['Need a valid namespace name.'],
    example_calls: [
      { description: 'List namespace members', params: { namespace: 'team-projects' } },
    ],
  },
  namespace_revoke: {
    group: 'namespaces',
    when_to_use: 'When revoking a user\'s access to a namespace.',
    when_not_to_use: 'When granting access (use namespace_grant). Confirm with user before revoking.',
    alternatives: ['namespace_grant'],
    side_effects: ['Removes the user\'s namespace access.'],
    prerequisites: ['Need a valid grant ID. Must be owner or admin of the namespace.'],
    example_calls: [
      { description: 'Revoke access', params: { grant_id: '550e8400-e29b-41d4-a716-446655440000' } },
    ],
  },

  // ── Meta tools ────────────────────────────────────────────────
  tool_guide: {
    group: 'meta',
    when_to_use: 'When you need guidance on which tool to use, how to use a specific tool, or want an overview of available tool groups.',
    when_not_to_use: 'When you already know which tool to use and how to call it.',
    alternatives: [],
    side_effects: [],
    prerequisites: [],
    example_calls: [
      { description: 'Get guidance for a specific tool', params: { tool: 'memory_recall' } },
      { description: 'Get overview of a tool group', params: { group: 'memory' } },
      { description: 'Find tools for a task', params: { task: 'send a text message' } },
      { description: 'List all tool groups', params: {} },
    ],
  },
};

/**
 * Group-level guidance catalog.
 * Keys are group names that match the `group` field in TOOL_CATALOG entries.
 */
export const GROUP_CATALOG: Record<string, GroupGuidance> = {
  memory: {
    description: 'Long-term memory storage and retrieval using semantic search (pgvector). Store preferences, facts, decisions, and context for future sessions.',
    tools: ['memory_recall', 'memory_store', 'memory_forget'],
    workflow_tips: 'Use memory_store proactively when users share preferences or important facts. Use memory_recall at the start of conversations to bootstrap context. Use memory_forget only when explicitly requested.',
    related_skills: ['context_search'],
  },
  projects: {
    description: 'Project and initiative management. Create and track bodies of work with hierarchical organization.',
    tools: ['project_list', 'project_get', 'project_create', 'project_search'],
    workflow_tips: 'Create projects for ongoing initiatives, then create todos within them. Use project_search for keyword lookup, project_list for browsing.',
    related_skills: ['todo_create', 'context_search'],
  },
  todos: {
    description: 'Task and to-do management. Create, list, search, and complete individual actionable items.',
    tools: ['todo_list', 'todo_create', 'todo_complete', 'todo_search'],
    workflow_tips: 'Create todos for actionable items. Associate with projects when relevant. Use not_before for reminders, not_after for deadlines. Mark complete when done.',
    related_skills: ['project_create', 'context_search'],
  },
  contacts: {
    description: 'Contact and people management. Create, search, update, merge contacts and manage their endpoints and tags.',
    tools: ['contact_search', 'contact_get', 'contact_create', 'contact_update', 'contact_merge', 'contact_tag_add', 'contact_tag_remove', 'contact_resolve'],
    workflow_tips: 'Always search before creating to avoid duplicates. Use contact_resolve to find contacts by email/phone. Use tags for categorization. Merge duplicates carefully.',
    related_skills: ['relationship_set', 'sms_send', 'email_send'],
  },
  search: {
    description: 'Cross-entity unified search across memories, todos, projects, and messages.',
    tools: ['context_search'],
    workflow_tips: 'Use context_search when unsure which entity type contains the information. For targeted searches, prefer entity-specific search tools (memory_recall, todo_search, etc.).',
    related_skills: ['memory_recall', 'todo_search', 'project_search', 'message_search'],
  },
  communication: {
    description: 'Send and search messages across SMS and email channels.',
    tools: ['sms_send', 'email_send', 'message_search'],
    workflow_tips: 'Always confirm the recipient and content before sending. Use message_search to find past conversations. Check contact preferences for preferred channel.',
    related_skills: ['contact_search', 'thread_list'],
  },
  threads: {
    description: 'Conversation thread management for SMS and email message threads.',
    tools: ['thread_list', 'thread_get'],
    workflow_tips: 'Use thread_list to browse recent conversations. Use thread_get with a specific thread ID to see full message history.',
    related_skills: ['message_search', 'contact_get'],
  },
  notes: {
    description: 'Freeform note creation, editing, searching, and deletion.',
    tools: ['note_create', 'note_get', 'note_update', 'note_delete', 'note_search'],
    workflow_tips: 'Use notes for longer-form content (meeting notes, documentation). Organize notes into notebooks for better structure. Use note_search for keyword/semantic lookup.',
    related_skills: ['notebook_create', 'memory_store'],
  },
  notebooks: {
    description: 'Notebook management for organizing related notes.',
    tools: ['notebook_list', 'notebook_create', 'notebook_get'],
    workflow_tips: 'Create notebooks to group related notes. List notebooks to see available collections before creating notes.',
    related_skills: ['note_create', 'note_search'],
  },
  relationships: {
    description: 'Contact relationship management. Define connections between people (family, coworker, friend, etc.).',
    tools: ['relationship_set', 'relationship_query'],
    workflow_tips: 'Set relationships between contacts to enable relationship-aware memory recall. Query relationships to understand social connections.',
    related_skills: ['contact_search', 'memory_recall', 'links_set'],
  },
  entity_links: {
    description: 'Entity linking across work items, contacts, and memories. Create typed connections between any entities.',
    tools: ['links_set', 'links_query', 'links_remove'],
    workflow_tips: 'Use entity links to connect related items (e.g., link a todo to a contact). Query links to discover connections. Different from relationships which are specifically between contacts.',
    related_skills: ['relationship_set', 'contact_get'],
  },
  skill_store: {
    description: 'Reusable skill and workflow storage. Store, search, and manage prompt templates and workflows.',
    tools: ['skill_store_put', 'skill_store_get', 'skill_store_list', 'skill_store_delete', 'skill_store_search', 'skill_store_collections', 'skill_store_aggregate'],
    workflow_tips: 'Organize skills into collections. Use semantic search to find relevant skills. Skills differ from memories — they are reusable templates/workflows, not facts.',
    related_skills: ['prompt_template_create', 'memory_store'],
  },
  file_share: {
    description: 'File sharing via time-limited download links.',
    tools: ['file_share'],
    workflow_tips: 'Generate share links when users need to share files. Links expire after the configured time (default 1 hour).',
    related_skills: [],
  },
  terminal_connections: {
    description: 'SSH/terminal connection and credential management. Save, test, and manage remote server configurations.',
    tools: ['terminal_connection_list', 'terminal_connection_create', 'terminal_connection_update', 'terminal_connection_delete', 'terminal_connection_test', 'terminal_credential_create', 'terminal_credential_list', 'terminal_credential_delete'],
    workflow_tips: 'Create connections first, then start sessions on them. Store credentials securely. Test connections before starting sessions.',
    related_skills: ['terminal_session_start'],
  },
  terminal_sessions: {
    description: 'Interactive terminal session management. Start, manage, and execute commands in remote SSH sessions.',
    tools: ['terminal_session_start', 'terminal_session_list', 'terminal_session_terminate', 'terminal_session_info', 'terminal_send_command', 'terminal_send_keys', 'terminal_capture_pane'],
    workflow_tips: 'Start sessions on saved connections. Use send_command for simple commands, send_keys for interactive programs. Capture pane to see current screen state.',
    related_skills: ['terminal_connection_list', 'terminal_tunnel_create'],
  },
  terminal_tunnels: {
    description: 'SSH port-forwarding tunnel management. Create, list, and close tunnels through active sessions.',
    tools: ['terminal_tunnel_create', 'terminal_tunnel_list', 'terminal_tunnel_close'],
    workflow_tips: 'Create tunnels on active sessions to forward ports. List tunnels to see active forwards. Close tunnels when no longer needed.',
    related_skills: ['terminal_session_start'],
  },
  terminal_search: {
    description: 'Terminal history search and annotation. Search through command history and annotate entries.',
    tools: ['terminal_search', 'terminal_annotate'],
    workflow_tips: 'Search through terminal history to find past commands and output. Annotate important entries for future reference.',
    related_skills: ['terminal_capture_pane'],
  },
  dev_sessions: {
    description: 'Development session tracking. Create, update, and complete coding sessions with associated metadata.',
    tools: ['dev_session_create', 'dev_session_list', 'dev_session_get', 'dev_session_update', 'dev_session_complete'],
    workflow_tips: 'Create a dev session when starting work on an issue. Update with progress as you work. Complete when done with a summary.',
    related_skills: ['todo_create', 'terminal_session_start'],
  },
  api_management: {
    description: 'External API onboarding and management. Parse OpenAPI specs, store credentials, and search API capabilities.',
    tools: ['api_onboard', 'api_recall', 'api_get', 'api_list', 'api_update', 'api_credential_manage', 'api_refresh', 'api_remove', 'api_restore'],
    workflow_tips: 'Onboard APIs by providing OpenAPI specs. Use api_recall to search for endpoints and operations. Manage credentials separately from specs.',
    related_skills: ['memory_recall'],
  },
  prompt_templates: {
    description: 'Prompt template management. Create, retrieve, update, and delete reusable prompt templates.',
    tools: ['prompt_template_list', 'prompt_template_get', 'prompt_template_create', 'prompt_template_update', 'prompt_template_delete'],
    workflow_tips: 'Create templates for frequently used prompts. Templates support variable substitution. Use skill_store for more complex reusable workflows.',
    related_skills: ['skill_store_put'],
  },
  inbound_routing: {
    description: 'Inbound message routing configuration. Manage where inbound SMS and email messages are delivered.',
    tools: ['inbound_destination_list', 'inbound_destination_get', 'inbound_destination_update'],
    workflow_tips: 'Configure destinations for inbound messages. Use alongside channel defaults for complete routing setup.',
    related_skills: ['channel_default_set'],
  },
  channel_defaults: {
    description: 'Default channel routing configuration. Set default routing behavior per communication channel type.',
    tools: ['channel_default_list', 'channel_default_get', 'channel_default_set'],
    workflow_tips: 'Set defaults per channel type (SMS, email). These apply when no specific destination rule matches. Requires agentadmin access.',
    related_skills: ['inbound_destination_update'],
  },
  namespaces: {
    description: 'Namespace management for data isolation and sharing. Create namespaces, grant access, and manage members.',
    tools: ['namespace_list', 'namespace_create', 'namespace_grant', 'namespace_members', 'namespace_revoke'],
    workflow_tips: 'Use namespaces to isolate data between users or teams. Grant access with appropriate roles. Most tools accept optional namespace parameters.',
    related_skills: [],
  },
  meta: {
    description: 'Meta tools for discovering and understanding available tools and their usage.',
    tools: ['tool_guide'],
    workflow_tips: 'Use tool_guide when unsure which tool to use. Call with no params for an overview, with a group name for group details, with a tool name for specific guidance, or with a task description for recommendations.',
    related_skills: [],
  },
};
