# Design: Release Workflow Artifact-Based Version Propagation

**Issue:** [#1554](https://github.com/troykelly/openclaw-projects/issues/1554)
**Date:** 2026-02-21
**Status:** Approved

## Problem

The Release workflow (`release.yml`) has a race condition between the `validate` job (which bumps version numbers and commits to `main`) and the `publish-npm` / `publish-github-packages` jobs (which check out the tag ref — pointing to the commit *before* the bump). This causes npm publish to attempt publishing the old version number, resulting in either a skip (npmjs.org) or a hard failure (GitHub Packages).

## Solution: Artifact-Based Version Propagation (Option B)

### Fix 1: Upload bumped files as artifact, download in publish jobs

**Validate job** — after version bump commit, upload the 4 bumped files as a workflow artifact:

- `package.json` (root — needed for pnpm workspace consistency)
- `packages/openclaw-plugin/package.json`
- `packages/openclaw-plugin/openclaw.plugin.json`
- `pnpm-lock.yaml`

**Both publish jobs** — after checkout (tag ref), download the artifact to overwrite stale files. Step placement: checkout → download artifact → setup-node → pnpm setup → install → build → test → publish.

Key behaviors relied upon:
- `upload-artifact@v4` preserves directory structure relative to the least common ancestor of listed paths (workspace root)
- `download-artifact@v4` extracts directly to `$GITHUB_WORKSPACE` without creating a subdirectory (v3 created a subdirectory; v4 does not)
- `pnpm install --frozen-lockfile` succeeds because the validate job ran `pnpm install --lockfile-only` after bumping, producing a consistent lockfile

### Fix 2: Add existence check to GitHub Packages publish

Add a `check-ghp` step before the publish step in `publish-github-packages`, mirroring the existing `check-npm` step in `publish-npm`. This makes retries/re-runs graceful (skip) instead of hard-failing with 409 Conflict.

The `2>/dev/null` pattern matches the existing `check-npm` step for consistency.

### Implementation notes

- All new actions SHA-pinned consistent with existing workflow
- `if-no-files-found: error` on upload-artifact for fast failure
- `retention-days: 3` to allow re-running failed jobs

### What stays unchanged

- Test job (stale checkout fine — tests validate code, not version numbers)
- Container job (gets version from git tag via `docker/metadata-action`, not `package.json`)
- Release job (uses `needs.validate.outputs.version`, not `package.json`)
