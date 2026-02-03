---
name: project-status
description: Get status overview of a specific project
args:
  - name: project
    description: Project name or ID
    required: true
---

Please provide a status report for project "{{project}}" including:

1. **Project Overview**
   - Use `project_list` to find the project by name, or `project_get` if ID is provided
   - Show project name, status, and description

2. **Task Breakdown**
   - Use `todo_list` with the project ID to get all tasks
   - Count tasks by status (pending, in progress, completed)
   - Calculate overall completion percentage

3. **Recent Activity**
   - List recently completed tasks
   - Show tasks currently in progress

4. **Blockers and Risks**
   - Identify any overdue tasks
   - Note any high-priority pending items

5. **Next Steps**
   - Recommend the next tasks to focus on
   - Suggest any follow-up actions needed

Present the report in a clear, organized format suitable for stakeholder updates.
