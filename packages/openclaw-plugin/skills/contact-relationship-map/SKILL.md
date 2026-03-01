---
name: contact-relationship-map
description: Build a comprehensive view of a contact with relationships, links, and memories
args:
  - name: name
    description: Contact name to map
    required: true
---

Build a comprehensive relationship map for contact "{{name}}":

1. **Retrieve Contact Details**
   - Use `contact_search` to find the contact by name "{{name}}"
   - Use `contact_get` with the contact ID to retrieve full details
   - Show all known endpoints (email, phone, social accounts)
   - If multiple matches found, ask for clarification

2. **Map Relationships**
   - Use `relationship_query` with the contact ID to find all relationships
   - Show each related contact and the relationship type (colleague, family, manager, etc.)
   - Note the direction of each relationship (e.g., "reports to" vs "manages")

3. **Find Linked Items**
   - Use `links_query` with the contact's entity reference to discover linked content
   - Show linked projects, tasks, notes, and other work items
   - Highlight any active or high-priority linked items

4. **Recall Stored Memories**
   - Use `memory_recall` with the contact's name to find relevant memories
   - Show preferences, facts, past decisions, and contextual notes
   - Note when each memory was stored for recency context

5. **Relationship Map Summary**
   - Present a unified view:
     - Contact card (name, endpoints, notes)
     - Relationship network (connected people and relationship types)
     - Linked work (projects, tasks, notes referencing this contact)
     - Stored context (memories and preferences)
   - Suggest any missing information worth capturing
