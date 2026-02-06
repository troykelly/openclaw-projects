# Ralph Template: Iteration (Sprint-Sized Work)

Use this template for autonomous work on an iteration - a sprint-sized body of work spanning multiple epics or a significant number of related issues.

## Execution Modes

| Mode | When to Use | How |
|------|-------------|-----|
| **Sequential** | Limited parallelization opportunities | Single Ralph processes epics/issues in order |
| **Agent Teams** (recommended) | 2+ independent epics or issue groups | Team lead coordinates teammates per epic |
| **Legacy Orchestrated** (fallback) | Agent teams unavailable | Ralph orchestrator spawns CLI workers |

## Command (Sequential Mode)

```bash
/ralph-loop:ralph-loop "
## Iteration: <ITERATION NAME>

### Goal
<High-level objective for this iteration>

### Scope

#### Epic 1: <Epic Name>
- #<ISSUE1> - <Title>
- #<ISSUE2> - <Title>

#### Epic 2: <Epic Name>
- #<ISSUE3> - <Title>
- #<ISSUE4> - <Title>

#### Standalone Issues
- #<ISSUE5> - <Title>

### Process

Follow CODING.md without exception.

**CRITICAL: Never work in <REPO_ROOT> directly.**

#### For Each Issue:

**Setup:**
\`\`\`bash
git worktree add /tmp/worktree-issue-<number>-<slug> -b issue/<number>-<slug>
cd /tmp/worktree-issue-<number>-<slug>
\`\`\`

**Implementation:**
1. Read issue for acceptance criteria
2. TDD: failing tests first, then implement
3. Real services: PostgreSQL/Redis in devcontainer
4. Commits: \`[#<number>] description\`
5. Issue updates: progress at milestones
6. Local validation: typecheck, lint, test, build
7. PR with description
8. Self-review: security + blind spots
9. CI green, then merge

**Cleanup (after merge):**
\`\`\`bash
cd <REPO_ROOT>
git worktree remove /tmp/worktree-issue-<number>-<slug>
git branch -d issue/<number>-<slug>
git fetch origin main && git pull origin main
\`\`\`

#### Between Issues:
- Verify main is stable before next issue (check CI)
- Reference previous work in issue comments

#### Progress Tracking:
After completing each issue, summarize:
- Issues completed: X/Y
- Current epic progress
- Any blockers encountered

### Constraints
- NEVER work in <REPO_ROOT> directly
- One issue = one worktree = one branch = one PR
- Clean up worktree immediately after each merge
- Complete epics in order when dependencies exist
- Never skip issue updates
- Workers use REST-only GitHub API (no GraphQL)

### Completion

Output <promise>ITERATION COMPLETE</promise> when:
- ALL issues in scope are merged
- ALL acceptance criteria verified
- ALL issues updated with final status
- ALL worktrees cleaned up
- Main branch stable and CI green
- No open blockers or deferred work
" --completion-promise "ITERATION COMPLETE" --max-iterations 200
```

## Agent Teams Mode (Recommended for Parallel Work)

Use when 2+ epics or issue groups can be worked on simultaneously. Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` (set in devcontainer).

Give this prompt to Claude Code to create and coordinate the team:

```
Create an agent team for this iteration.

## Iteration: <ITERATION NAME>

### Goal
<High-level objective for this iteration>

### Scope

#### Phase 1: Foundation (lead handles sequentially)
- #<ISSUE1> - <Title> (must complete first)

#### Phase 2: Parallel Epics (teammates work simultaneously)

**Epic A** → assign to teammate:
- #<ISSUE2> - <Title>
- #<ISSUE3> - <Title>

**Epic B** → assign to teammate:
- #<ISSUE4> - <Title>
- #<ISSUE5> - <Title>

**Standalone** → assign to teammate:
- #<ISSUE6> - <Title>

#### Phase 3: Integration (lead handles after Phase 2)
- #<ISSUE7> - <Title> (depends on Phase 2)

### Team Setup
- Spawn one teammate per epic/group (not per issue)
- Each teammate works through their epic's issues sequentially in worktrees
- Use delegate mode during Phase 2 (lead coordinates only)
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
- Phase 2 epic tasks: blocked by Phase 1 completion
- Phase 3 tasks: blocked by all Phase 2 tasks

### Process
1. Lead: create team and task list with dependencies
2. Lead: execute Phase 1 foundation issues in worktrees
3. Lead: spawn teammates for Phase 2 epics
4. Teammates: claim epic tasks, work through issues sequentially in worktrees
5. Teammates: message lead on epic completion or blockers
6. Lead: after all Phase 2 tasks complete, execute Phase 3 integration
7. Lead: shut down teammates, clean up team

### Progress Tracking
After each phase:
- Issues completed: X/Y total
- Epics completed: X/Y
- Blockers identified

### Completion
Iteration is complete when:
- ALL phases completed
- ALL issues merged to main
- ALL worktrees cleaned up
- Main branch stable (CI green)
```

### Key Differences from Sequential Mode

- Each epic runs as a separate teammate, working in parallel
- Shared task list with dependencies automates phase transitions
- Teammates self-report completion, lead coordinates phase boundaries
- Significantly faster for iterations with independent epics

### When to Use

| Scenario | Mode |
|----------|------|
| 3-5 issues, all dependent | Sequential |
| 2+ independent epics, agent teams available | **Agent Teams** |
| Multiple standalone issues | **Agent Teams** |
| Tight deadline, parallel opportunities | **Agent Teams** |
| Simple linear work | Sequential |
| Agent teams unavailable | Legacy Orchestrated |

## Command (Legacy Orchestrated Mode)

> **Fallback mode.** Use only when agent teams are unavailable. Prefer Agent Teams mode — it provides shared task tracking, teammate communication, and graceful shutdown instead of fire-and-forget worker spawning.

```bash
/ralph-loop:ralph-loop "
## Iteration: <ITERATION NAME> (Orchestrated)

### Goal
<High-level objective for this iteration>

### Scope

#### Phase 1: Foundation (Sequential)
- #<ISSUE1> - <Title> (must complete first)

#### Phase 2: Parallel Epics
**Epic A** (assign to Worker 1):
- #<ISSUE2> - <Title>
- #<ISSUE3> - <Title>

**Epic B** (assign to Worker 2):
- #<ISSUE4> - <Title>
- #<ISSUE5> - <Title>

**Standalone** (assign to Worker 3):
- #<ISSUE6> - <Title>

#### Phase 3: Integration (Sequential)
- #<ISSUE7> - <Title> (depends on Phase 2)

### Process

Follow CODING.md without exception.

**You are the ORCHESTRATOR.** You coordinate work but delegate implementation.

#### Orchestrator Rules
- Remain in <REPO_ROOT> (coordination only)
- You are the ONLY agent allowed to use GitHub Projects/GraphQL
- Spawn worker agents for parallel work
- Serialize project board updates
- Aggregate blockers and coordinate resolution

#### Phase 1: Foundation (You Execute)
Handle foundation issues yourself:
1. Create worktree: /tmp/worktree-issue-<number>-<slug>
2. Implement, test, PR, merge
3. Clean up worktree
4. Proceed to Phase 2

#### Phase 2: Parallel Execution
Spawn workers for independent epics/issues:

\`\`\`bash
# Worker 1: Epic A
claude --worktree /tmp/worktree-epic-a \"
  Complete Epic A issues (#<ISSUE2>, #<ISSUE3>) sequentially.
  Each issue: own worktree in /tmp, own branch, own PR.
  Follow CODING.md. REST-only GitHub API.
  Clean up worktrees after each merge.
  Exit when all Epic A issues merged or blocked.
\"

# Worker 2: Epic B
claude --worktree /tmp/worktree-epic-b \"
  Complete Epic B issues (#<ISSUE4>, #<ISSUE5>) sequentially.
  Each issue: own worktree in /tmp, own branch, own PR.
  Follow CODING.md. REST-only GitHub API.
  Clean up worktrees after each merge.
  Exit when all Epic B issues merged or blocked.
\"

# Worker 3: Standalone
claude --worktree /tmp/worktree-issue-<ISSUE6>-<slug> \"
  Complete issue #<ISSUE6>.
  Follow CODING.md. REST-only GitHub API.
  Clean up worktree after merge.
  Exit when PR merged or blocked.
\"
\`\`\`

**Wait for all Phase 2 workers to complete before Phase 3.**

#### Phase 3: Integration (You Execute)
Handle integration issues yourself after Phase 2 completes.

#### Progress Tracking
After each phase:
- Issues completed: X/Y total
- Epics completed: X/Y
- Blockers identified
- Time in phase

### Constraints
- Orchestrator stays in <REPO_ROOT> (no direct code changes)
- Workers MUST use isolated worktrees in /tmp
- Workers MUST NOT use GraphQL or gh project commands
- One issue = one worktree = one branch = one PR
- Clean up all worktrees after merges
- Never skip progress tracking between phases

### Completion

Output <promise>ITERATION COMPLETE</promise> when:
- ALL phases completed
- ALL issues merged to main
- ALL worktrees cleaned up
- Main branch stable (CI green)
" --completion-promise "ITERATION COMPLETE" --max-iterations 200
```

## Customization

Replace:

- `<REPO_ROOT>` - Your repository's root directory (e.g., `/workspaces/myproject`)
- `<ITERATION NAME>` - Sprint/iteration identifier
- Epic groupings - Organize by feature area and dependencies
- Issue list - All issues in scope
- Phase structure - Group by dependencies (foundation → parallel → integration)

## Notes

- Very high `--max-iterations` (200+) for large iterations in ralph-loop modes
- May run for extended periods (hours)
- Monitor ralph-loop periodically: `grep '^iteration:' .claude/ralph-loop.local.md`
- Can `/ralph-loop:cancel-ralph` and resume later with remaining issues
- Consider breaking into smaller epics if iteration is too large
- Agent teams mode uses more tokens but provides better coordination and faster completion
- Agent teams require `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`
