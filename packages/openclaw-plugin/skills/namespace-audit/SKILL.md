---
name: namespace-audit
description: Audit namespace content by searching across projects, memories, and items
args:
  - name: namespace
    description: Namespace to audit (optional, audits current namespace if omitted)
    required: false
---

Audit the namespace "{{namespace}}" to review its content and usage:

1. **Search Namespace Content**
   - Use `context_search` with a broad query to discover items in the namespace
   - Note the types of content found (memories, projects, tasks, notes)
   - Report the total number of items discovered

2. **Review Projects**
   - Use `project_list` to find all projects in the namespace scope
   - For each project, note its status, task count, and last activity
   - Identify any stale or abandoned projects

3. **Check Stored Memories**
   - Use `memory_recall` with a general query to find memories in the namespace
   - Categorize memories by type (preference, fact, decision, context)
   - Flag any outdated or potentially stale memories

4. **Audit Summary**
   - Present a comprehensive namespace overview:
     - Total items by type (projects, tasks, memories, notes)
     - Active vs stale content
     - Storage utilization patterns
   - Recommend cleanup actions for stale or orphaned content
   - Suggest namespace organization improvements

## Important Notes:
- If no namespace is specified, the audit runs against the current default namespace
- Large namespaces may require multiple queries; paginate as needed
- Do not delete any content during the audit; only recommend actions
