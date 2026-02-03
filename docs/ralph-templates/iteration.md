# Ralph Template: Iteration (Sprint-Sized Work)

Use this template for autonomous work on an iteration - a sprint-sized body of work spanning multiple epics or a significant number of related issues.

## Execution Modes

| Mode             | When to Use                           | How                                           |
| ---------------- | ------------------------------------- | --------------------------------------------- |
| **Sequential**   | Limited parallelization opportunities | Single Ralph processes epics/issues in order  |
| **Orchestrated** | Multiple independent epics or issues  | Orchestrator spawns workers for parallel work |

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

## Command (Orchestrated Mode)

Use when epics or issues within the iteration can be parallelized.

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

- Very high `--max-iterations` (200+) for large iterations
- May run for extended periods (hours)
- Monitor periodically: `grep '^iteration:' .claude/ralph-loop.local.md`
- Can `/ralph-loop:cancel-ralph` and resume later with remaining issues
- Consider breaking into smaller epics if iteration is too large
- Orchestrated mode can reduce total time by 50%+ with parallel epics

## When to Use Orchestrated Mode

| Scenario                               | Recommendation |
| -------------------------------------- | -------------- |
| 3-5 issues, all dependent              | Sequential     |
| 5+ issues, 2+ independent epics        | Orchestrated   |
| Multiple standalone issues             | Orchestrated   |
| Tight deadline, parallel opportunities | Orchestrated   |
| Simple linear work                     | Sequential     |
