---
name: contact-lookup
description: Look up contact information and recent communications
args:
  - name: name
    description: Contact name to search for
    required: true
---

Search for contact "{{name}}" and show:

1. **Contact Details**
   - Use `contact_search` to find matching contacts
   - Use `contact_get` to retrieve full details (name, email, phone, notes)
   - If multiple matches found, list them and ask for clarification

2. **Recent Communications**
   - Use `message_search` with the contact ID to find recent messages
   - Show the last few messages exchanged (both sent and received)
   - Note the channels used (SMS, email)

3. **Related Projects and Tasks**
   - Check if there are any todos or projects associated with this contact
   - Use `todo_list` and `project_list` to find related items

4. **Stored Memories**
   - Use `memory_recall` with the contact's name to find relevant memories
   - Show any stored preferences, facts, or context about this person

Present the information in a clear, organized format to help understand the full context of this contact relationship.
