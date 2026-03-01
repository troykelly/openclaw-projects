---
name: note-meeting
description: Create meeting notes with attendees, action items, and linked references
args:
  - name: title
    description: Meeting title or topic
    required: true
---

Create comprehensive meeting notes for "{{title}}":

1. **Create the Meeting Note**
   - Use `notebook_list` to find or select the appropriate notebook for meeting notes
   - Use `note_create` to create a new note titled "{{title}}"
   - Include the date, time, and meeting topic in the note body
   - Ask the user for the key discussion points and decisions

2. **Identify Attendees**
   - Use `contact_search` to look up each attendee mentioned by the user
   - For each found contact, note their name and role
   - If an attendee is not in contacts, offer to create them with `contact_create`

3. **Extract Action Items**
   - For each action item identified during the meeting:
     - Use `todo_create` to create a task with the action description
     - Set the assignee and due date if provided
     - Reference the meeting note in the task description

4. **Link Everything Together**
   - Use `links_set` to link the meeting note to:
     - Each attendee's contact record
     - Each action item created
     - Any referenced projects or existing work items
   - This creates a navigable web of meeting context

5. **Summary**
   - Present the completed meeting note with:
     - Attendee list with contact links
     - Numbered action items with assignees and due dates
     - Links to related projects or work items
   - Confirm all items are correctly captured

## Important Notes:
- Ask for clarification on ambiguous action items before creating todos
- If attendees have multiple matching contacts, ask the user to confirm
- Suggest a follow-up reminder if a next meeting date is mentioned
