---
name: dev-session-report
description: Generate a summary report for a completed dev session
args:
  - name: session
    description: Dev session ID or name to report on
    required: true
---

Generate a summary report for dev session "{{session}}":

1. **Retrieve Session Details**
   - Use `dev_session_get` with the session identifier "{{session}}"
   - Show session name, start time, duration, and current status
   - If the session is still active, ask whether to complete it first

2. **Complete Session (if needed)**
   - If the session is still in progress, use `dev_session_complete` to close it
   - Ask the user for a summary of what was accomplished
   - Record any final notes or outcomes

3. **Gather Related Work Items**
   - Use `todo_list` to find tasks linked to this dev session
   - Categorize tasks by status (completed during session, still pending, blocked)
   - Calculate completion metrics (tasks done vs remaining)

4. **Add Project Context**
   - Use `project_get` to retrieve the parent project details
   - Show how the session's work fits into overall project progress
   - Note any milestones reached or approaching

5. **Compile Report**
   - Present a structured report with:
     - Session overview (duration, focus area)
     - Accomplishments (completed tasks, key decisions)
     - Remaining work (pending tasks, blockers)
     - Project impact (progress toward goals)
   - Suggest storing the report as a memory for future reference
