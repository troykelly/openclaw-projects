#!/usr/bin/env bash
# verify-release-versions.sh — Verify all version references in a release checkout
#
# Positively verifies that tagged releases are internally consistent:
# - All production compose files reference the exact expected version
# - package.json versions match
# - Documentation references are version-accurate
#
# Part of Issue #2528 / Epic #2522
#
# Usage:
#   # Release mode: verify all versions match the given version
#   ./scripts/verify-release-versions.sh --version 0.0.60 --mode release
#
#   # Dev mode: verify all production compose files use :edge
#   ./scripts/verify-release-versions.sh --mode dev
#
#   # Auto-detect version from package.json
#   ./scripts/verify-release-versions.sh --mode release
#
#   # CI mode (skip gracefully if VERSION not set)
#   ./scripts/verify-release-versions.sh --mode ci
#
# Exit codes:
#   0 — all checks passed
#   1 — version inconsistency found
#   2 — invalid arguments

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Defaults
VERSION=""
MODE="release"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      VERSION="$2"
      shift 2
      ;;
    --mode)
      MODE="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: $0 [--version VERSION] [--mode dev|release|ci]"
      echo ""
      echo "Options:"
      echo "  --version VERSION  Expected version (default: read from package.json)"
      echo "  --mode MODE        Verification mode: dev, release, or ci (default: release)"
      echo ""
      echo "Modes:"
      echo "  release  All compose files must reference the exact version"
      echo "  dev      All compose files must reference :edge"
      echo "  ci       Like release, but skip gracefully if VERSION is empty"
      exit 0
      ;;
    *)
      echo "ERROR: Unknown argument: $1"
      exit 2
      ;;
  esac
done

# Validate mode
case "${MODE}" in
  dev|release|ci) ;;
  *)
    echo "ERROR: Invalid mode '${MODE}'. Must be 'dev', 'release', or 'ci'."
    exit 2
    ;;
esac

# In CI mode, skip gracefully if no version is determinable
if [ "${MODE}" = "ci" ]; then
  if [ -z "${VERSION}" ]; then
    # Try reading from package.json
    if [ -f "${REPO_ROOT}/package.json" ]; then
      VERSION=$(node -e "console.log(require('${REPO_ROOT}/package.json').version)" 2>/dev/null || true)
    fi
    if [ -z "${VERSION}" ]; then
      echo "CI mode: VERSION not set and cannot be determined from package.json. Skipping."
      exit 0
    fi
  fi
  # CI mode behaves like release mode once version is known
  MODE="release"
fi

# In release mode, determine version if not provided
if [ "${MODE}" = "release" ] && [ -z "${VERSION}" ]; then
  if [ -f "${REPO_ROOT}/package.json" ]; then
    VERSION=$(node -e "console.log(require('${REPO_ROOT}/package.json').version)")
  else
    echo "ERROR: No --version provided and package.json not found."
    exit 2
  fi
fi

# Strip build metadata from version for comparison (Docker tags can't have +)
VERSION_CLEAN="${VERSION%%+*}"

# Production compose files that MUST have correct image versions
PROD_COMPOSE_FILES=(
  "docker-compose.yml"
  "docker-compose.traefik.yml"
  "docker-compose.quickstart.yml"
  "docker-compose.full.yml"
)

# Image prefix for project images
IMAGE_PREFIX="ghcr.io/troykelly/openclaw-projects-"

ERRORS=0

echo "=== Release Version Verification ==="
echo "Repository root: ${REPO_ROOT}"
echo "Mode: ${MODE}"
if [ "${MODE}" = "release" ]; then
  echo "Expected version: ${VERSION_CLEAN}"
fi
echo ""

# ── Check 1: Production compose files ──────────────────────────────

if [ "${MODE}" = "release" ]; then
  echo "--- Checking production compose files for exact version :${VERSION_CLEAN} ---"

  for file in "${PROD_COMPOSE_FILES[@]}"; do
    filepath="${REPO_ROOT}/${file}"
    if [ ! -f "${filepath}" ]; then
      echo "FAIL: ${file} not found (required production compose file)"
      ERRORS=$((ERRORS + 1))
      continue
    fi

    # Count total project image references
    total_refs=$(grep -c "${IMAGE_PREFIX}" "${filepath}" || true)
    if [ "${total_refs}" -eq 0 ]; then
      echo "WARN: ${file} has no project image references"
      continue
    fi

    # Positive check: every project image tag must equal VERSION_CLEAN
    wrong_refs=$(grep "${IMAGE_PREFIX}" "${filepath}" | grep -v ":${VERSION_CLEAN}" || true)
    if [ -n "${wrong_refs}" ]; then
      echo "FAIL: ${file} contains project images not pinned to :${VERSION_CLEAN}:"
      echo "${wrong_refs}" | while IFS= read -r line; do
        echo "  ${line}"
      done
      ERRORS=$((ERRORS + 1))
    else
      echo "PASS: ${file} — all ${total_refs} project images pinned to :${VERSION_CLEAN}"
    fi
  done

elif [ "${MODE}" = "dev" ]; then
  echo "--- Checking production compose files consistently use :edge ---"

  for file in "${PROD_COMPOSE_FILES[@]}"; do
    filepath="${REPO_ROOT}/${file}"
    if [ ! -f "${filepath}" ]; then
      echo "FAIL: ${file} not found (required production compose file)"
      ERRORS=$((ERRORS + 1))
      continue
    fi

    total_refs=$(grep -c "${IMAGE_PREFIX}" "${filepath}" || true)
    if [ "${total_refs}" -eq 0 ]; then
      echo "WARN: ${file} has no project image references"
      continue
    fi

    non_edge_refs=$(grep "${IMAGE_PREFIX}" "${filepath}" | grep -v ":edge" || true)
    if [ -n "${non_edge_refs}" ]; then
      echo "FAIL: ${file} contains non-:edge project image references:"
      echo "${non_edge_refs}" | while IFS= read -r line; do
        echo "  ${line}"
      done
      ERRORS=$((ERRORS + 1))
    else
      echo "PASS: ${file} — all ${total_refs} project images use :edge"
    fi
  done
fi

echo ""

# ── Check 2: package.json versions ──────────────────────────────────

if [ "${MODE}" = "release" ]; then
  echo "--- Checking package.json versions ---"

  PACKAGE_FILES=(
    "package.json"
    "packages/openclaw-plugin/package.json"
    "packages/openclaw-plugin/openclaw.plugin.json"
  )

  for file in "${PACKAGE_FILES[@]}"; do
    filepath="${REPO_ROOT}/${file}"
    if [ ! -f "${filepath}" ]; then
      echo "SKIP: ${file} not found"
      continue
    fi

    actual=$(node -e "console.log(require('${filepath}').version)" 2>/dev/null || true)
    if [ "${actual}" = "${VERSION_CLEAN}" ]; then
      echo "PASS: ${file} — version ${actual}"
    else
      echo "FAIL: ${file} — has version ${actual}, expected ${VERSION_CLEAN}"
      ERRORS=$((ERRORS + 1))
    fi
  done

  echo ""
fi

# ── Check 3: Documentation version references ──────────────────────

if [ "${MODE}" = "release" ]; then
  echo "--- Checking documentation version references ---"

  DOCS_FILE="${REPO_ROOT}/docs/deployment.md"
  if [ -f "${DOCS_FILE}" ]; then
    # Check that docs don't use :latest for project images
    latest_refs=$(grep "${IMAGE_PREFIX}" "${DOCS_FILE}" | grep ":latest" || true)
    if [ -n "${latest_refs}" ]; then
      echo "WARN: docs/deployment.md references :latest for project images (expected :${VERSION_CLEAN} or generic)"
      echo "${latest_refs}" | while IFS= read -r line; do
        echo "  ${line}"
      done
      # This is a warning, not a hard failure — docs might intentionally use :latest
    else
      echo "PASS: docs/deployment.md — no :latest project image references"
    fi
  else
    echo "SKIP: docs/deployment.md not found"
  fi

  echo ""
fi

# ── Check 4: Image consistency across compose files ────────────────

echo "--- Checking image list consistency across compose files ---"

declare -A image_counts
for file in "${PROD_COMPOSE_FILES[@]}"; do
  filepath="${REPO_ROOT}/${file}"
  [ -f "${filepath}" ] || continue
  while IFS= read -r img; do
    name=$(echo "${img}" | sed "s|.*${IMAGE_PREFIX}\([^:]*\):.*|\1|")
    image_counts["${name}"]=$(( ${image_counts["${name}"]:-0} + 1 ))
  done < <(grep -o "${IMAGE_PREFIX}[^\"' ]*" "${filepath}" || true)
done

echo "Project images found across production compose files:"
for name in $(echo "${!image_counts[@]}" | tr ' ' '\n' | sort); do
  echo "  - ${name}: referenced in ${image_counts[${name}]} file(s)"
done

echo ""

# ── Summary ────────────────────────────────────────────────────────

if [ "${ERRORS}" -gt 0 ]; then
  echo "FAILED: ${ERRORS} error(s) found"
  exit 1
else
  echo "PASSED: All version verification checks passed"
  exit 0
fi
