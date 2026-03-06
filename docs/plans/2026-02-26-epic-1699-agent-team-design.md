# Design: Agent Team Strategy for Epic #1699 Gap Completion

**Epic:** [#1699](https://github.com/troykelly/openclaw-projects/issues/1699)
**Date:** 2026-02-26
**Status:** Approved

## Problem

Epic #1699 (Frontend Integration) was closed with 35 issues "done" but 16 remain broken:
- RouterSidebar never wired into AppShell (all new features invisible)
- Frontend hooks written against imagined API shapes (silent runtime failures)
- Server endpoints missing fields the frontend expects

## Team Composition

| Agent | Role | Omnibus PR | Issues |
|-------|------|-----------|--------|
| **agent-nav** | Sidebar fix | PR 1 | #1875 |
| **agent-memory** | Memory full-stack fixes | PR 2 | #1719, #1721, #1724, #1732, #1876, #1877, #1878, #1879, #1880 |
| **agent-workitems** | Work item + contact fixes | PR 3 | #1702, #1707, #1712, #1714, #1720 |

## Omnibus PR Groupings

### PR 1: Wire RouterSidebar (#1875)
- **Files:** `app-shell.tsx`, `router-sidebar.tsx`, `mobile-nav.tsx`
- **Scope:** Replace old 5-item Sidebar with 13-item RouterSidebar, add namespace selector
- **No dependencies on other PRs**

### PR 2: Memory Full-Stack Fixes (9 issues)
- **Server files:** `server.ts` (memory PATCH/GET/POST/bulk handlers, type validation)
- **Frontend files:** memory hooks, `api-types.ts` (memory types), memory pages
- **Internal ordering:** Server fixes first (#1719, #1732, #1876, #1879), then frontend (#1721, #1724, #1877, #1878, #1880)

### PR 3: Work Item + Contact Fixes (5 issues)
- **Server files:** `server.ts` (comment/dependency/participant/contact handlers)
- **Frontend files:** work-item hooks, contact hooks, `api-types.ts` (work-item types)
- **Key fix pattern:** Server should extract user_email from JWT (not require in body)

## Conflict Risk

- `server.ts` touched by PR 2 and PR 3 but in different handler sections
- `api-types.ts` touched by PR 2 and PR 3 but in different type blocks
- Whoever merges second resolves trivial conflicts

## Per-Agent Workflow (from CODING-RUNBOOK.md)

1. Create worktree: `/tmp/worktree-epic-1699-<slug>`
2. Create branch: `issue/<issues>-<slug>`
3. TDD: failing tests first, then implementation
4. Build + typecheck: `pnpm run build`
5. Test: `pnpm test`
6. Codex CLI review (security + blind spots)
7. Push, open PR with `Closes #N` for each issue
8. Monitor CI, fix failures
9. Approve with `GITHUB_TOKEN_TROY`, merge
10. Clean up worktree

## Phasing

- **Wave 1:** All 3 agents launch in parallel
- **Standdown:** agent-nav after sidebar merges (smallest scope)
- **Wave 2:** agent-memory and agent-workitems continue until done
- **Cleanup:** Update epic, close remaining issues, delete team

## Verification Requirements

Every PR must include:
- Unit tests with correct API shapes (not imagined ones)
- At least one integration test per fixed endpoint
- `pnpm run build` clean
- `pnpm test` passing
- Codex review passing
