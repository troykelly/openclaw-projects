# Ralph Template: Initiative (Strategic Multi-Phase Work)

Use this template for autonomous work on an initiative - a strategic goal spanning multiple iterations or phases, typically representing a significant product capability.

## Execution Modes

| Mode             | When to Use                                    | Scale         |
| ---------------- | ---------------------------------------------- | ------------- |
| **Sequential**   | Strict phase dependencies, limited parallelism | Days          |
| **Orchestrated** | Multiple independent iterations/phases         | Days to weeks |

Initiatives almost always benefit from orchestration due to their scale.

## Command (Sequential Mode)

```bash
/ralph-loop:ralph-loop "
## Initiative: <INITIATIVE NAME>

### Strategic Goal
<Business objective this initiative achieves, success metrics>

### Phases

#### Phase 1: <Phase Name> (Foundation)
**Iteration 1.1: <Name>**
- Epic: <Epic Name>
  - #<ISSUE1> - <Title>
  - #<ISSUE2> - <Title>
- Standalone: #<ISSUE3> - <Title>

**Iteration 1.2: <Name>**
- Epic: <Epic Name>
  - #<ISSUE4> - <Title>
  - #<ISSUE5> - <Title>

#### Phase 2: <Phase Name> (Enhancement)
**Iteration 2.1: <Name>**
- Epic: <Epic Name>
  - #<ISSUE6> - <Title>
  - #<ISSUE7> - <Title>

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

#### Phase Transitions:
After completing each phase:
1. Verify all phase objectives met
2. Document any technical debt incurred
3. Confirm readiness for next phase
4. Update initiative tracking issue with phase summary

#### Progress Tracking:
After each iteration, report:
- Phase: X of Y
- Iteration: X.Y
- Issues completed: N/M in current iteration
- Overall progress: total completed / total issues
- Blockers or risks identified

### Constraints
- NEVER work in <REPO_ROOT> directly
- One issue = one worktree = one branch = one PR
- Clean up worktree immediately after each merge
- Complete phases in order (phases have dependencies)
- Iterations within a phase may parallelize if independent
- Never skip issue updates or phase summaries
- Escalate blockers that affect strategic timeline
- Workers use REST-only GitHub API (no GraphQL)

### Completion

Output <promise>INITIATIVE COMPLETE</promise> when:
- ALL phases completed
- ALL iterations within phases completed
- ALL issues merged to main
- ALL acceptance criteria verified
- ALL issues updated with final status
- ALL worktrees cleaned up
- Main branch stable and CI green
- Initiative tracking issue updated with final summary
- No critical technical debt deferred
" --completion-promise "INITIATIVE COMPLETE" --max-iterations 500
```

## Command (Orchestrated Mode)

Use for large initiatives with parallel iteration opportunities.

```bash
/ralph-loop:ralph-loop "
## Initiative: <INITIATIVE NAME> (Orchestrated)

### Strategic Goal
<Business objective this initiative achieves, success metrics>

### Phase Structure

#### Phase 1: Foundation (Sequential)
Must complete before any parallel work.
- #<ISSUE1> - Core infrastructure
- #<ISSUE2> - Base dependencies

#### Phase 2: Feature Development (Parallel Iterations)

**Iteration 2A: <Name>** (Worker 1)
- Epic: <Name>
  - #<ISSUE3> - <Title>
  - #<ISSUE4> - <Title>

**Iteration 2B: <Name>** (Worker 2)
- Epic: <Name>
  - #<ISSUE5> - <Title>
  - #<ISSUE6> - <Title>

**Iteration 2C: <Name>** (Worker 3)
- Standalone issues:
  - #<ISSUE7> - <Title>
  - #<ISSUE8> - <Title>

#### Phase 3: Integration (Sequential)
After all Phase 2 iterations complete.
- #<ISSUE9> - Integration testing
- #<ISSUE10> - Final polish

### Process

Follow CODING.md without exception.

**You are the ORCHESTRATOR.** You coordinate the strategic initiative.

#### Orchestrator Responsibilities
- Remain in <REPO_ROOT> (coordination only)
- ONLY agent allowed to use GitHub Projects/GraphQL
- Spawn and monitor worker agents
- Serialize project board updates
- Manage phase transitions
- Track overall initiative progress
- Escalate blockers that affect timeline

#### Phase 1: Foundation (You Execute)
Handle foundation issues yourself:
1. Create worktree: /tmp/worktree-issue-<number>-<slug>
2. Implement, test, PR, merge
3. Clean up worktree
4. Document phase completion
5. Proceed to Phase 2

#### Phase 2: Parallel Iterations
Spawn workers for independent iterations:

\`\`\`bash
# Worker 1: Iteration 2A
claude --worktree /tmp/worktree-iteration-2a \"
  ## Iteration 2A: <Name>

  Complete these issues sequentially:
  - #<ISSUE3>
  - #<ISSUE4>

  For each issue:
  1. Create worktree: /tmp/worktree-issue-<num>-<slug>
  2. TDD, implement, PR, merge
  3. Clean up worktree
  4. Update issue

  Constraints:
  - Follow CODING.md
  - REST-only GitHub API (no GraphQL)
  - One worktree per issue

  Exit when all issues merged or blocked.
\"

# Worker 2: Iteration 2B
claude --worktree /tmp/worktree-iteration-2b \"
  ## Iteration 2B: <Name>

  Complete these issues sequentially:
  - #<ISSUE5>
  - #<ISSUE6>

  [Same constraints as Worker 1]
\"

# Worker 3: Iteration 2C
claude --worktree /tmp/worktree-iteration-2c \"
  ## Iteration 2C: <Name>

  Complete these issues:
  - #<ISSUE7>
  - #<ISSUE8>

  [Same constraints as Worker 1]
\"
\`\`\`

**Monitor workers. Wait for ALL to complete before Phase 3.**

#### Phase 3: Integration (You Execute)
After Phase 2 completes:
1. Verify all Phase 2 PRs merged
2. Run integration testing
3. Handle integration issues in worktrees
4. Final polish

#### Progress Tracking
Maintain initiative status:
\`\`\`
Phase: X/Y
Active workers: N
Issues completed: X/Y total
Blockers: [list]
Next milestone: [description]
\`\`\`

### Constraints
- Orchestrator stays in <REPO_ROOT> (no direct code changes)
- Workers MUST use isolated worktrees in /tmp
- Workers MUST NOT use GraphQL or gh project commands
- One issue = one worktree = one branch = one PR
- Clean up all worktrees after merges
- Phase boundaries are synchronization points
- Never proceed to next phase until current phase fully complete

### Completion

Output <promise>INITIATIVE COMPLETE</promise> when:
- ALL phases completed
- ALL workers finished
- ALL issues merged to main
- ALL worktrees cleaned up
- Main branch stable (CI green)
- Initiative tracking issue updated
" --completion-promise "INITIATIVE COMPLETE" --max-iterations 500
```

## Customization

Replace:

- `<REPO_ROOT>` - Your repository's root directory (e.g., `/workspaces/myproject`)
- `<INITIATIVE NAME>` - Strategic capability being delivered
- Phase structure - Organize by delivery milestones and dependencies
- Iterations - Group related work within phases
- Issue list - All issues in scope
- Worker assignments - Group by independence and skill area

## Notes

- Very high `--max-iterations` (500+) for initiatives
- May run for extended periods (many hours to days)
- Monitor periodically: `grep '^iteration:' .claude/ralph-loop.local.md`
- Can `/ralph-loop:cancel-ralph` and resume with remaining work
- Consider creating a GitHub tracking issue for the initiative itself
- Phase boundaries are natural checkpoints for `/ralph-loop:cancel-ralph`
- Orchestrated mode can reduce total time by 60%+ for large initiatives

## Template Selection Guide

| Scope                               | Template      | Typical Duration | Max Iterations |
| ----------------------------------- | ------------- | ---------------- | -------------- |
| 1 issue                             | issue.md      | Hours            | 50             |
| 3-5 related issues                  | epic.md       | Half day         | 100            |
| Multiple epics (sprint-sized)       | iteration.md  | Day              | 200            |
| Strategic capability (multi-sprint) | initiative.md | Multiple days    | 500+           |
