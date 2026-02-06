# Ralph Template: Epic (Multiple Related Issues)

Use this template for autonomous work on an epic - a group of related issues that form a cohesive feature.

## Execution Modes

| Mode | When to Use | How |
|------|-------------|-----|
| **Sequential** | Issues have strict dependencies | Single Ralph instance processes issues in order |
| **Agent Teams** (recommended) | 3+ independent issues exist | Team lead coordinates teammates working in parallel worktrees |
| **Legacy Parallel** (fallback) | Agent teams unavailable | Ralph orchestrator spawns CLI workers |

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

## Agent Teams Mode (Recommended for Parallel Work)

Use when 3+ issues can be worked on simultaneously. Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` (set in devcontainer).

Give this prompt to Claude Code to create and coordinate the team:

```
Create an agent team for this epic.

## Epic: <EPIC TITLE>

### Overview
<What this epic delivers, why it matters>

### Issues in Scope

#### Sequential (lead handles directly)
1. #<ISSUE1> - <Title> (foundation — must complete first)

#### Parallel Batch (teammates work simultaneously)
- #<ISSUE2> - <Title> → assign to teammate
- #<ISSUE3> - <Title> → assign to teammate
- #<ISSUE4> - <Title> → assign to teammate

#### Final Sequential (lead handles after parallel batch)
5. #<ISSUE5> - <Title> (depends on #2-#4)

### Team Setup
- Spawn one teammate per parallel issue
- Use delegate mode (lead coordinates only during parallel phase)
- Require plan approval for teammates before they start coding

### Rules for ALL agents
- Follow CODING.md without exception
- Every agent works in an isolated worktree: `/tmp/worktree-issue-<number>-<slug>`
- One issue = one worktree = one branch = one PR
- Teammates use REST-only GitHub API (no GraphQL)
- Clean up worktree immediately after PR merge
- Update GitHub issues with progress as you work

### Task Dependencies
Create tasks with these dependencies:
- Phase 1 tasks: unblocked (lead executes)
- Parallel tasks: blocked by Phase 1 completion
- Phase 3 tasks: blocked by all parallel tasks

### Process
1. Lead: create team and task list with dependencies
2. Lead: execute Phase 1 issues in worktrees, mark tasks complete
3. Lead: spawn teammates for parallel batch
4. Teammates: claim unblocked tasks, work in isolated worktrees
5. Teammates: message lead on completion or blockers
6. Lead: after all parallel tasks complete, execute Phase 3
7. Lead: shut down teammates, clean up team

### Completion
Epic is complete when:
- ALL issues merged to main
- ALL acceptance criteria verified
- ALL worktrees cleaned up
- Main branch stable (CI green)
```

### Key Differences from Sequential Mode

- Teammates work simultaneously on independent issues
- Shared task list tracks progress and dependencies automatically
- Teammates communicate blockers directly to the lead via messaging
- Phase transitions happen when blocking tasks complete

## Command (Legacy Parallel Orchestration)

> **Fallback mode.** Use only when agent teams are unavailable. Prefer Agent Teams mode — it provides shared task tracking, teammate communication, and graceful shutdown instead of fire-and-forget worker spawning.

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

- Higher `--max-iterations` needed (100+ for 3-5 issues) in ralph-loop modes
- Order issues by dependencies in sequential mode
- Group independent issues into parallel batches for agent teams or orchestration
- Each issue = separate worktree + branch + PR (never combine)
- Epic may span multiple hours of autonomous work
- Agent teams mode uses more tokens but provides better coordination
- Agent teams require `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`

## Choosing a Mode

| Scenario | Mode |
|----------|------|
| All issues depend on each other | Sequential |
| 3+ independent issues, agent teams available | **Agent Teams** |
| 2 independent issues (simple) | Sequential (simpler) |
| 5+ issues with parallel opportunities | **Agent Teams** |
| Agent teams unavailable | Legacy Parallel |
