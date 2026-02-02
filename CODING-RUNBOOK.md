## Non‑negotiables

1. **Follow**: `CODING.md` (mandatory).
2. **Issue-driven**: every change maps to a GitHub issue with acceptance criteria.
3. **Branch-only work**: never commit directly to `main`.
4. **Local validation first**: CI is **not** the first line of defense.

---

#### Ralph (ralph-loop) for autonomous runs

Ralph is not "magic autonomy"; it's a deliberate **in-session loop** implemented via a Claude Code **Stop hook**.

- Starting Ralph creates `.claude/ralph-loop.local.md` (state + the prompt)
- When Claude tries to exit, the stop hook reads the transcript, checks for completion, and (if not complete) **blocks exit** and feeds the **same prompt** back in.

**Key commands:**

- Start:
  - `/ralph-loop "<prompt>" --completion-promise "DONE" --max-iterations 50`
- Cancel:
  - `/cancel-ralph`

**Required safety settings:**

- Always set `--max-iterations` (avoid infinite loops)
- Prefer setting `--completion-promise` and require that it only be emitted when _actually true_

**Monitoring/health checks:**

- Ralph state file:
  - `.claude/ralph-loop.local.md`
- Quick iteration check:
  - `grep '^iteration:' .claude/ralph-loop.local.md`

#### Completion promise format

To signal completion, output the **exact** promise text wrapped in XML tags:

```
<promise>TASK COMPLETE</promise>
```

**Critical rules:**

- Use `<promise>` tags exactly as shown (literal XML, not markdown)
- The enclosed text must match `--completion-promise` exactly
- Only output when the statement is **completely and unequivocally TRUE**
- Never lie to exit the loop - verify all criteria before outputting

#### Writing effective Ralph prompts

**Structure:**

1. **Context** - Issue number, background, constraints
2. **Acceptance criteria** - Explicit, checkable requirements
3. **Process** - Steps to follow (TDD, issue updates, commits)
4. **Completion signal** - When and how to output the promise

**Best practices:**

- Use phased approaches for complex work (Phase 1, Phase 2, etc.)
- Include self-correction loops: test → fix → verify → continue
- Reference `CODING.md` explicitly in the prompt
- Require issue updates at milestones (not just at end)
- Specify commit format: `[#issue] description`

**Example structure:**

```markdown
## Issue: #123 - Feature description

### Context

[Background and constraints]

### Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Tests passing

### Process

1. Follow CODING.md (TDD, real services, atomic commits)
2. Update issue #123 after each milestone
3. Commit with [#123] prefix

### Completion

Output <promise>ISSUE 123 COMPLETE</promise> when:

- All criteria checked and verified
- All tests passing locally
- Issue updated with final status
```

#### Ralph prompt templates

See `docs/ralph-templates/` for ready-to-use templates:

- `iteration.md` - Multi-issue initiative work
- `epic.md` - Grouped feature development
- `issue.md` - Single issue implementation

---

## Coding tools: Claude Code vs Codex

- **Claude Code**: use for **all coding/implementation work**.
- **Codex CLI**: use for **all review work** (PR review, security/blind spot pass, etc.).

When delegating to these tools, be explicit: they don’t know our workflow by default. Always include the required process steps and point at `CODING.md`.

### Claude Code plugins / skills

Our standard Claude Code plugin list is:

- circleback@claude-plugins-official
- claude-code-setup@claude-plugins-official
- claude-md-management@claude-plugins-official
- code-review@claude-plugins-official
- code-simplifier@claude-plugins-official
- commit-commands@claude-plugins-official
- feature-dev@claude-plugins-official
- frontend-design@claude-plugins-official
- github@claude-plugins-official
- hookify@claude-plugins-official
- linear@claude-plugins-official
- playground@claude-plugins-official
- playwright@claude-plugins-official
- pr-review-toolkit@claude-plugins-official
- pyright-lsp@claude-plugins-official
- ralph-loop@claude-plugins-official
- security-guidance@claude-plugins-official
- sentry@claude-plugins-official
- stripe@claude-plugins-official
- superpowers@claude-plugins-official
- typescript-lsp@claude-plugins-official

Key plugins to be aware of:

- `ralph-loop` (required for longer autonomous runs)
- `code-review`, `security-guidance`, `pr-review-toolkit`
- `github`, `commit-commands`, `playwright`

---

## Standard workflow (default)

### 0) Intake

- Confirm the **issue** exists and has clear **acceptance criteria**.
- If missing, create/fix the issue before coding.
- Be very careful of formatting and escaping
- Follow best practices for issue layout and content

### 1) Prepare workspace

- Create a **new branch**:
  - `issue/<number>-<short-slug>` or repo’s preferred naming.

### 2) Devcontainer

- Ensure devcontainer services required for the work are ready - databases, s3 servers etc.

### 3) Implement with meaningful local testing

- Follow TDD per `CODING.md`.
- Run locally before PR:
  - unit tests
  - integration tests (real services if provided)
  - lint/format
  - typecheck

### 4) Issue hygiene (as you go)

**NOT NEGOTIABLE**

- Post progress updates and decisions **AS YOU WORK**
- On completion: mark acceptance criteria as complete **only if actually done + tested**.
- Never "update dump" at the end of a long process or completion of work.

### 5) Ship

1. Commit (small, atomic, tested) using the format:
   - `[#issue] Brief description of change`
2. Push branch.
3. Open PR.

### 6) Review

- Perform a **self-review** minimum:
  - security review
  - “blind spot” review (what could we have missed?)
- Address **all** review items (self + others).
- Mark feedback threads as resolved only when truly resolved.

### 7) CI to green

- Fix any CI issues until **completely green**.

### 8) Approve + merge

- Unless explicitly marked “human approval only”:
  - approve (if required) using alternate github token, ie `GITHUB_TOKEN= gh ...`
  - merge

### 9) Reset and continue

- Fetch, switch to `main`, pull.
- Continue with next issue, if any.

---
