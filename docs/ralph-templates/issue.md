# Ralph Template: Single Issue

Use this template for autonomous work on a single GitHub issue.

## Command

```bash
/ralph-loop:ralph-loop "
## Issue: #<NUMBER> - <TITLE>

### Context
<Brief background, why this issue exists, any constraints>

### Acceptance Criteria
<Copy directly from the GitHub issue>
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

### Process

Follow CODING.md without exception.

#### Workspace Setup (MANDATORY)
**Never work in the root repository.** All work MUST happen in an isolated git worktree.

1. Create worktree:
   \`\`\`bash
   git worktree add /tmp/worktree-issue-<NUMBER>-<slug> -b issue/<NUMBER>-<slug>
   cd /tmp/worktree-issue-<NUMBER>-<slug>
   \`\`\`
2. All subsequent work happens in this worktree directory
3. The worktree isolates your work from other parallel agents

#### Implementation
1. **TDD**: Write failing tests first, then implement
2. **Real services**: Test against PostgreSQL/Redis in devcontainer
3. **Commits**: Atomic, tested, format: \`[#<NUMBER>] description\`
4. **Issue updates**: Post progress after each milestone (not at end)

#### Local Validation (before PR)
- \`pnpm typecheck\`
- \`pnpm lint\`
- \`pnpm test\`
- \`pnpm build\`

#### Ship
1. **PR**: Create with clear description
2. **Self-review**: Security + blind spot review
3. **CI**: Monitor until green, fix any failures
4. **Merge**: After CI green and review complete

#### Cleanup (MANDATORY)
After PR is merged:
\`\`\`bash
cd <REPO_ROOT>
git worktree remove /tmp/worktree-issue-<NUMBER>-<slug>
git branch -d issue/<NUMBER>-<slug>
\`\`\`

### Constraints
- NEVER work in the root repository directly
- One worktree per issue, one branch per issue
- Clean up worktree immediately after merge
- Workers use REST-only GitHub API (no GraphQL)

### Completion

Output <promise>ISSUE <NUMBER> COMPLETE</promise> when:
- All acceptance criteria verified and checked off
- All tests passing locally
- CI green
- Issue updated with completion status
- PR merged to main
- Worktree cleaned up
" --completion-promise "ISSUE <NUMBER> COMPLETE" --max-iterations 50
```

## Customization

Replace:

- `<REPO_ROOT>` - Your repository's root directory (e.g., `/workspaces/myproject`)
- `<NUMBER>` - GitHub issue number
- `<TITLE>` - Issue title
- `<slug>` - Short branch name descriptor (lowercase, hyphenated)
- Acceptance criteria - Copy from issue

## Notes

- Adjust `--max-iterations` based on complexity (30-100 typical)
- For database changes, add `pnpm db:reset && pnpm db:migrate && pnpm db:seed` to validation
- For API changes, add runtime testing step
- Worktrees in `/tmp` prevent filesystem conflicts with other agents
- The worktree cleanup step is part of the completion criteria
