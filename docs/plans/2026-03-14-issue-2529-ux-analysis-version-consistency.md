# UX Analysis: Version Consistency for Deployment Users

**Issue:** #2529
**Epic:** #2522 — Correctly update compose files and docs in tagged version releases
**Date:** 2026-03-14

---

## Summary

This document analyzes the user experience for deploying openclaw-projects from a tagged release. It identifies all touchpoints where version inconsistency causes confusion or failure, and documents the fixes applied.

---

## User Personas

### 1. Docker Compose Deployer

**Workflow:** Downloads compose files from GitHub Release assets, runs `docker compose up -d`.

**Current State:** Works correctly. The release workflow generates versioned compose files via `sed` replacement of `:edge` with the release version (e.g., `:0.0.60`). These are attached to the GitHub Release as assets.

**Issues Found:** None for this persona. The release asset compose files are the happy path.

### 2. Git Tag Deployer

**Workflow:** Clones repo, runs `git checkout v0.0.60`, uses compose files from the checkout.

**Current State:** BROKEN. The compose files on any git tag reference `:edge` images because:
- The release workflow bumps `package.json` versions and commits to `main`, but does NOT update compose file image tags.
- The git tag points to the commit before the version bump.
- The versioned compose files are only generated as release assets (via `sed`), never committed to git.

**Impact:** A user who checks out a tag and runs `docker compose up` gets `:edge` (latest development) images instead of the stable release version they expected. This is a silent failure — the services start successfully but may exhibit unstable or untested behavior.

**Fix:** Epic #2522 Phase 2 (#2524, #2525) will add compose file image tag updates to the release workflow's version bump step and re-point the git tag to the bump commit. Until then, the deployment documentation now warns users and directs them to use release asset compose files instead.

### 3. Documentation-Guided Deployer

**Workflow:** Follows `docs/deployment.md` to deploy.

**Current State:** Previously problematic. The deployment docs listed images with `:latest` tags (e.g., `ghcr.io/troykelly/openclaw-projects-db:latest`), which:
- May not match the version the user intends to deploy
- Provides no guidance on how to pin a specific version
- Does not explain the image tagging scheme (`:edge` vs `:<version>` vs `:latest`)

**Fixes Applied:**
- Removed `:latest` from the architecture image table (images now listed without tags, with a separate tag scheme table)
- Added "Image Tag Scheme" table explaining `:edge`, `:<version>`, and `:latest`
- Added "Deploying a Specific Version" section with two options (release assets and git checkout)
- Added warning about `:edge` on `main` branch
- Updated "Specific Version" upgrade section to include all services and reference the new section

---

## Deployment Paths Analysis

### Happy Path (After Fix)

1. User visits [GitHub Releases](https://github.com/troykelly/openclaw-projects/releases)
2. Downloads `docker-compose.yml` (or `.traefik.yml`, `.full.yml`, `.quickstart.yml`) from release assets
3. Runs `docker compose -f docker-compose.yml up -d`
4. All services pull the correct versioned images (e.g., `ghcr.io/troykelly/openclaw-projects-api:0.0.60`)
5. Everything works consistently

### Alternative: Git Checkout (After Epic #2522 Completion)

1. User runs `git checkout v0.0.60`
2. Compose files reference `0.0.60` images (updated by release workflow)
3. `docker compose up -d` pulls correct images
4. Everything works consistently

### Edge Cases

| Scenario | Expected Behavior | Status |
|----------|-------------------|--------|
| User on `main` branch | Gets `:edge` images — correct and expected | OK |
| User switches between tags | Compose files update with each checkout (after #2522) | Pending #2522 |
| User has cached `:edge` images locally | `docker compose pull` before `up` fetches versioned images | Documented |
| User uses `:latest` tag | Gets most recent stable release — may not match docs version | Documented with warning |
| User mixes release asset compose with repo `.env` | Works — `.env` is orthogonal to image versions | OK |

---

## Documentation Changes Made

### `docs/deployment.md`

1. **Architecture Overview > Container Images**: Removed `:latest` suffix from image names in the table
2. **New: Image Tag Scheme**: Added table explaining `:edge`, `:<version>`, `:latest` tags
3. **New: Warning about `:edge` on main**: Added callout warning users about main branch compose files
4. **New: Deploying a Specific Version section**: Two options (release assets and git checkout) with step-by-step instructions
5. **Updated: Upgrading Containers > Specific Version**: Expanded to cover all services, added cross-reference to new section
6. **Table of Contents**: Added link to new section

### `vitest.config.unit.ts` / `vitest.config.integration.ts`

- Moved `tests/ci/` tests from integration runner to unit runner (they are pure filesystem tests with no DB dependency)

### Test Coverage

- Added `tests/ci/deployment-versioning-docs.test.ts` validating all required sections exist in deployment documentation

---

## Release Notes Template

The existing release workflow (`release.yml`) already generates a release body with:
- npm install command with the version
- Docker Compose download instructions referencing release assets
- Container image pull commands with the version

The release body template is adequate for guiding users to version-consistent deployments. The `symphony-worker` image is missing from the template (tracked by #2535).

---

## Remaining Work (Tracked by Other Issues)

| Gap | Issue |
|-----|-------|
| Compose files in git tags still reference `:edge` | #2524, #2525 |
| `symphony-worker` missing from release body template | #2535 |
| CI verification of version consistency in tags | #2528 |
| Comprehensive deployment guide updates | #2531 |
