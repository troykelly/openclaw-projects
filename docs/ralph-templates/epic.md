# Ralph Template: Epic (Multiple Related Issues)

Use this template for autonomous work on an epic - a group of related issues that form a cohesive feature.

## Execution Modes

Epics can run in two modes:

| Mode                       | When to Use                     | How                                                     |
| -------------------------- | ------------------------------- | ------------------------------------------------------- |
| **Sequential**             | Issues have strict dependencies | Single Ralph instance processes issues in order         |
| **Parallel Orchestration** | Independent issues exist        | Orchestrator spawns worker agents in separate worktrees |

## Command (Sequential Mode)

```bash
/ralph-loop:ralph-loop "
## Epic: <EPIC TITLE>

### Overview
<What this epic delivers, why it matters>

### Issues in Scope
1. #<ISSUE1> - <Title> (do first)
2. #<ISSUE2> - <Title> (depends on #<ISSUE1>)
3. #<ISSUE3> - <Title> (can parallel with #<ISSUE2>)

### Process

Follow CODING.md without exception.

**CRITICAL: Never work in <REPO_ROOT> directly.**

For EACH issue in dependency order:

#### Phase: Workspace Setup
1. Create isolated worktree:
   \`\`\`bash
   git worktree add /tmp/worktree-issue-<number>-<slug> -b issue/<number>-<slug>
   cd /tmp/worktree-issue-<number>-<slug>
   \`\`\`

#### Phase: Issue Work
1. Read issue for full acceptance criteria
2. Implement with TDD (tests first, real services)
3. Update issue with progress as you work
4. Commit atomically: \`[#<number>] description\`
5. Local validation: typecheck, lint, test, build
6. Create PR with clear description
7. Self-review (security + blind spots)
8. Monitor CI until green
9. Merge and update issue

#### Phase: Cleanup
After each issue's PR is merged:
\`\`\`bash
cd <REPO_ROOT>
git worktree remove /tmp/worktree-issue-<number>-<slug>
git branch -d issue/<number>-<slug>
git fetch origin main && git pull origin main
\`\`\`

#### Between Issues
- Verify main is stable (CI green)
- Reference previous work in issue comments
- Create new worktree for next issue

### Constraints
- NEVER work in <REPO_ROOT> directly
- Complete issues in dependency order
- Each issue gets its own worktree, branch, and PR
- Never batch multiple issues into one PR
- Clean up worktree immediately after each merge
- Workers use REST-only GitHub API (no GraphQL)

### Completion

Output <promise>EPIC COMPLETE</promise> when:
- ALL listed issues are merged to main
- ALL acceptance criteria verified
- ALL issues updated with completion status
- ALL worktrees cleaned up
- Main branch is stable (CI green)
" --completion-promise "EPIC COMPLETE" --max-iterations 100
```

## Command (Parallel Orchestration Mode)

Use when multiple issues can be worked on simultaneously (no dependencies between them).

```bash
/ralph-loop:ralph-loop "
## Epic: <EPIC TITLE> (Orchestrated)

### Overview
<What this epic delivers, why it matters>

### Issues in Scope

#### Sequential (must complete first)
1. #<ISSUE1> - <Title> (foundation - do first)

#### Parallel Batch 1 (after #<ISSUE1> complete)
- #<ISSUE2> - <Title>
- #<ISSUE3> - <Title>
- #<ISSUE4> - <Title>

#### Sequential (after Batch 1)
5. #<ISSUE5> - <Title> (depends on #2-#4)

### Process

Follow CODING.md without exception.

**You are the ORCHESTRATOR.** You coordinate work but delegate implementation.

#### Orchestrator Rules
- You remain in <REPO_ROOT> (coordination only)
- You are the ONLY agent allowed to use GitHub Projects/GraphQL
- You spawn worker agents for parallel issues
- You serialize project board updates

#### Sequential Issues
Handle these yourself using the standard worktree flow:
1. Create worktree in /tmp/worktree-issue-<number>-<slug>
2. Implement, test, PR, merge
3. Clean up worktree
4. Update project board status

#### Parallel Batches
Spawn Claude Code workers for independent issues:

\`\`\`bash
# Spawn workers for parallel batch (each in separate terminal/process)
claude --worktree /tmp/worktree-issue-<ISSUE2>-<slug> \"
  Work on issue #<ISSUE2>.
  Follow CODING.md.
  REST-only GitHub API (no GraphQL).
  Exit when PR merged or blocked.
\"
\`\`\`

Each worker:
- Gets its own worktree in /tmp/worktree-issue-<number>-<slug>
- Works on exactly ONE issue
- Uses REST-only GitHub API
- Reports completion via PR merge
- Cleans up its worktree after merge

#### Coordination
- Wait for all parallel workers to complete before next batch
- Aggregate any blockers before proceeding
- Update project board after each batch completes

### Constraints
- Orchestrator stays in <REPO_ROOT> (no direct code changes)
- Workers MUST use isolated worktrees in /tmp
- Workers MUST NOT use GraphQL or gh project commands
- One worker = one issue = one worktree = one branch = one PR
- Clean up all worktrees after merges

### Completion

Output <promise>EPIC COMPLETE</promise> when:
- ALL issues merged to main
- ALL worktrees cleaned up
- Main branch stable (CI green)
" --completion-promise "EPIC COMPLETE" --max-iterations 100
```

## Customization

Replace:

- `<REPO_ROOT>` - Your repository's root directory (e.g., `/workspaces/myproject`)
- `<EPIC TITLE>` - Descriptive epic name
- `<ISSUE1>`, `<ISSUE2>`, etc. - Issue numbers
- `<slug>` - Short lowercase hyphenated descriptor
- Organize issues by dependencies (sequential vs parallel batches)

## Notes

- Higher `--max-iterations` needed (100+ for 3-5 issues)
- Order issues by dependencies in sequential mode
- Group independent issues into parallel batches for orchestration
- Each issue = separate worktree + branch + PR (never combine)
- Epic may span multiple hours of autonomous work
- Parallel orchestration significantly reduces total time for independent work

## Choosing Sequential vs Parallel

| Scenario                              | Mode                   |
| ------------------------------------- | ---------------------- |
| All issues depend on each other       | Sequential             |
| Some issues can run independently     | Parallel Orchestration |
| Simple 2-3 issue epic                 | Sequential (simpler)   |
| 5+ issues with parallel opportunities | Parallel Orchestration |
