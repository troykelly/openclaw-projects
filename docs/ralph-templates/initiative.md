# Ralph Template: Initiative (Strategic Multi-Phase Work)

Use this template for autonomous work on an initiative - a strategic goal spanning multiple iterations or phases, typically representing a significant product capability.

## Execution Modes

| Mode | When to Use | Scale | How |
|------|-------------|-------|-----|
| **Sequential** | Strict phase dependencies, limited parallelism | Days | Single Ralph instance |
| **Agent Teams** (recommended) | Multiple independent iterations/phases | Days to weeks | Team lead coordinates teammates |
| **Legacy Orchestrated** (fallback) | Agent teams unavailable | Days to weeks | Ralph orchestrator spawns CLI workers |

Initiatives almost always benefit from parallel coordination due to their scale.

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

## Agent Teams Mode (Recommended for Parallel Work)

Use when multiple iterations or epics within a phase can run in parallel. Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` (set in devcontainer).

> **Note on nesting:** Agent teams do not support nested teams (teammates cannot create sub-teams). The lead must create ALL tasks as a flat list with dependencies. Iterations and epics become task groupings, not sub-orchestrators.

Give this prompt to Claude Code to create and coordinate the team:

```
Create an agent team for this initiative.

## Initiative: <INITIATIVE NAME>

### Strategic Goal
<Business objective this initiative achieves, success metrics>

### Phase Structure

#### Phase 1: Foundation (lead handles sequentially)
Must complete before any parallel work.
- #<ISSUE1> - Core infrastructure
- #<ISSUE2> - Base dependencies

#### Phase 2: Feature Development (teammates work in parallel)

**Iteration 2A** → assign to teammate:
- Epic: <Name>
  - #<ISSUE3> - <Title>
  - #<ISSUE4> - <Title>

**Iteration 2B** → assign to teammate:
- Epic: <Name>
  - #<ISSUE5> - <Title>
  - #<ISSUE6> - <Title>

**Iteration 2C** → assign to teammate:
- Standalone issues:
  - #<ISSUE7> - <Title>
  - #<ISSUE8> - <Title>

#### Phase 3: Integration (lead handles after Phase 2)
After all Phase 2 iterations complete.
- #<ISSUE9> - Integration testing
- #<ISSUE10> - Final polish

### Team Setup
- Spawn one teammate per iteration (not per issue)
- Each teammate works through their iteration's issues sequentially in worktrees
- Use delegate mode during Phase 2 (lead coordinates only)
- Require plan approval for teammates before they start coding

### Rules for ALL agents
- Follow CODING.md without exception
- Every agent works in an isolated worktree: `/tmp/worktree-issue-<number>-<slug>`
- One issue = one worktree = one branch = one PR
- Teammates use REST-only GitHub API (no GraphQL)
- Clean up worktree immediately after PR merge
- Update GitHub issues with progress as you work

### Task Structure (flat, with dependencies)
Create ALL tasks upfront with dependencies:
- Phase 1 tasks: unblocked (lead executes these)
- Phase 2 iteration tasks: each blocked by Phase 1 completion
  - Create one task per iteration (teammate works through its issues)
- Phase 3 tasks: blocked by ALL Phase 2 tasks

### Process
1. Lead: create team and full task list with dependencies
2. Lead: execute Phase 1 foundation issues in worktrees
3. Lead: mark Phase 1 tasks complete (unblocks Phase 2)
4. Lead: spawn teammates for Phase 2 iterations
5. Teammates: claim iteration tasks, work through issues sequentially in worktrees
6. Teammates: message lead on iteration completion or blockers
7. Lead: after all Phase 2 tasks complete, execute Phase 3
8. Lead: shut down teammates, clean up team

### Phase Transitions
After completing each phase:
1. Verify all phase objectives met
2. Document any technical debt incurred
3. Update initiative tracking issue with phase summary

### Progress Tracking
Maintain initiative status:
- Phase: X/Y
- Active teammates: N
- Issues completed: X/Y total
- Blockers: [list]
- Next milestone: [description]

### Completion
Initiative is complete when:
- ALL phases completed
- ALL issues merged to main
- ALL worktrees cleaned up
- Main branch stable (CI green)
- Initiative tracking issue updated with final summary
```

### Key Differences from Sequential Mode

- Iteration-level parallelism (each iteration runs as a separate teammate)
- Shared task list with phase-based dependencies
- Automatic phase transition when blocking tasks complete
- Direct communication between teammates and lead for blockers
- Significantly faster for initiatives with independent iterations (60%+ time reduction)

### Limitations for Initiatives

- **No nested teams**: Teammates cannot create sub-teams. Each teammate handles one iteration sequentially — they cannot parallelize within their own iteration.
- **Flat task structure**: All tasks must be created by the lead upfront. Iterations are not sub-orchestrators.
- **Token cost**: Large initiatives with many teammates use significantly more tokens. Monitor usage.
- **Lead persistence**: For multi-day initiatives, the lead session must remain active. Consider running the lead inside a ralph-loop for persistence (advanced — see notes).

## Command (Legacy Orchestrated Mode)

> **Fallback mode.** Use only when agent teams are unavailable. Prefer Agent Teams mode — it provides shared task tracking, teammate communication, and graceful shutdown instead of fire-and-forget worker spawning.

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
- Worker/teammate assignments - Group by independence and skill area

## Notes

- Very high `--max-iterations` (500+) for initiatives in ralph-loop modes
- May run for extended periods (many hours to days)
- Monitor ralph-loop periodically: `grep '^iteration:' .claude/ralph-loop.local.md`
- Can `/ralph-loop:cancel-ralph` and resume with remaining work
- Consider creating a GitHub tracking issue for the initiative itself
- Phase boundaries are natural checkpoints for `/ralph-loop:cancel-ralph`
- Agent teams mode uses more tokens but significantly reduces total time
- Agent teams require `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`
- **Advanced**: For multi-day initiatives, you can run the agent team lead inside a ralph-loop for session persistence. This is complementary (ralph-loop = persistence, agent teams = parallelism) but is an unverified combination — use with caution.

## Template Selection Guide

| Scope | Template | Typical Duration | Max Iterations | Agent Teams? |
|-------|----------|------------------|----------------|-------------|
| 1 issue | issue.md | Hours | 50 | No |
| 3-5 related issues | epic.md | Half day | 100 | Yes (parallel batch) |
| Multiple epics (sprint-sized) | iteration.md | Day | 200 | Yes (parallel epics) |
| Strategic capability (multi-sprint) | initiative.md | Multiple days | 500+ | Yes (parallel iterations) |
