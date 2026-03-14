#!/usr/bin/env bash
# check-version-consistency.sh — Validates that production compose files
# have consistent image tags. When VERSION is set (e.g., in a tagged release),
# no production compose file should reference :edge tags.
#
# Part of Issue #2523 / Epic #2522
#
# Usage:
#   VERSION=0.0.60 ./scripts/check-version-consistency.sh
#   # or without VERSION (just checks for :edge consistency across files)
#
# Exit codes:
#   0 — all checks passed
#   1 — version inconsistency found

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Production compose files that MUST be updated at release
PROD_COMPOSE_FILES=(
  "docker-compose.yml"
  "docker-compose.traefik.yml"
  "docker-compose.quickstart.yml"
  "docker-compose.full.yml"
)

# Files that should NOT be updated (use build context or :latest for local builds)
EXCLUDED_FILES=(
  ".devcontainer/docker-compose.devcontainer.yml"
  "docker-compose.test.yml"
)

ERRORS=0

# Image prefix for project images
IMAGE_PREFIX="ghcr.io/troykelly/openclaw-projects-"

echo "=== Version Consistency Check ==="
echo "Repository root: ${REPO_ROOT}"

if [ -n "${VERSION:-}" ]; then
  echo "VERSION is set: ${VERSION}"
  echo ""
  echo "--- Checking production compose files for :edge references ---"

  for file in "${PROD_COMPOSE_FILES[@]}"; do
    filepath="${REPO_ROOT}/${file}"
    if [ ! -f "${filepath}" ]; then
      echo "WARNING: ${file} not found"
      continue
    fi

    # Find any project image references with :edge tag
    edge_refs=$(grep -n "${IMAGE_PREFIX}[^:]*:edge" "${filepath}" || true)
    if [ -n "${edge_refs}" ]; then
      echo "FAIL: ${file} contains :edge references when VERSION=${VERSION} is set:"
      echo "${edge_refs}"
      ERRORS=$((ERRORS + 1))
    else
      echo "PASS: ${file} — no :edge references"
    fi
  done
else
  echo "VERSION is not set (main branch mode)"
  echo ""
  echo "--- Checking that production compose files consistently use :edge ---"

  for file in "${PROD_COMPOSE_FILES[@]}"; do
    filepath="${REPO_ROOT}/${file}"
    if [ ! -f "${filepath}" ]; then
      echo "WARNING: ${file} not found"
      continue
    fi

    # All project image references should use :edge on main
    non_edge_refs=$(grep -n "${IMAGE_PREFIX}" "${filepath}" | grep -v ":edge" || true)
    if [ -n "${non_edge_refs}" ]; then
      echo "FAIL: ${file} contains non-:edge project image references on main:"
      echo "${non_edge_refs}"
      ERRORS=$((ERRORS + 1))
    else
      echo "PASS: ${file} — all project images use :edge"
    fi
  done
fi

echo ""
echo "--- Verifying excluded files do NOT use published image tags ---"

for file in "${EXCLUDED_FILES[@]}"; do
  filepath="${REPO_ROOT}/${file}"
  if [ ! -f "${filepath}" ]; then
    echo "SKIP: ${file} not found"
    continue
  fi

  # Excluded files should use build context, not published images
  published_refs=$(grep -n "${IMAGE_PREFIX}" "${filepath}" || true)
  if [ -n "${published_refs}" ]; then
    echo "INFO: ${file} references published images (expected: build context)"
    echo "${published_refs}"
  else
    echo "PASS: ${file} — uses build context (no published image references)"
  fi
done

echo ""
echo "--- Checking image list consistency across compose files ---"

# Collect unique image names from all production compose files
declare -A image_counts
for file in "${PROD_COMPOSE_FILES[@]}"; do
  filepath="${REPO_ROOT}/${file}"
  [ -f "${filepath}" ] || continue
  while IFS= read -r img; do
    # Extract image name between prefix and tag
    name=$(echo "${img}" | sed "s|.*${IMAGE_PREFIX}\([^:]*\):.*|\1|")
    image_counts["${name}"]=$(( ${image_counts["${name}"]:-0} + 1 ))
  done < <(grep -o "${IMAGE_PREFIX}[^\"]*" "${filepath}" || true)
done

echo "Project images found across production compose files:"
for name in $(echo "${!image_counts[@]}" | tr ' ' '\n' | sort); do
  echo "  - ${name}: referenced in ${image_counts[${name}]} file(s)"
done

echo ""
if [ "${ERRORS}" -gt 0 ]; then
  echo "FAILED: ${ERRORS} error(s) found"
  exit 1
else
  echo "PASSED: All version consistency checks passed"
  exit 0
fi
