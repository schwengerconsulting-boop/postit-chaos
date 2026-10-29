#!/usr/bin/env bash
# Pre-publish scan: fails (exit 1) if any tracked file contains a blocked term.
# Usage: scripts/prepublish-scan.sh   (run from anywhere inside the repo)
set -u
cd "$(git rev-parse --show-toplevel)"

# Private block list (customer names, internal hosts, ...). It is deliberately NOT in this repo,
# otherwise the list itself would leak. Source, in this order:
#   1. env PREPUBLISH_PATTERN (CI: repository secret)
#   2. file $PREPUBLISH_PATTERN_FILE, default ~/.config/postit-chaos/prepublish-pattern.txt
PATTERN="${PREPUBLISH_PATTERN:-}"
PATTERN_FILE="${PREPUBLISH_PATTERN_FILE:-$HOME/.config/postit-chaos/prepublish-pattern.txt}"
if [ -z "$PATTERN" ] && [ -r "$PATTERN_FILE" ]; then PATTERN=$(head -n 1 "$PATTERN_FILE"); fi
if [ -z "$PATTERN" ]; then
  # Forks and contributors have no private list: only the generic checks below run.
  # The maintainer's own CI must never run without it.
  if [ "${GITHUB_REPOSITORY:-}" = "schwengerconsulting-boop/postit-chaos" ] && [ "${GITHUB_EVENT_NAME:-}" = "push" ]; then
    echo "prepublish-scan: private block list missing (secret PREPUBLISH_PATTERN)"; exit 1
  fi
  echo "prepublish-scan: no private block list, running generic checks only"
fi

# Generic leak patterns, always checked.
GENERIC='-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9]{20,}|/Users/[a-z]|/root/\.'

# Allowed IPs: 127.0.0.1, 0.0.0.0 (not in the pattern).
# This script contains the generic patterns and is excluded.
SELF="scripts/prepublish-scan.sh"

if grep -P '' /dev/null 2>/dev/null; then GREP=(grep -P -i -I -n); else GREP=(grep -E -i -I -n); fi

fail=0
files=$(git ls-files | grep -v -x -e "$SELF" -e package-lock.json)
# shellcheck disable=SC2086
hits=$(printf '%s\n' $files | tr '\n' '\0' | xargs -0 "${GREP[@]}" -e "$GENERIC" -- 2>/dev/null)
if [ -n "$PATTERN" ]; then
  # shellcheck disable=SC2086
  hits="$hits
$(printf '%s\n' $files | tr '\n' '\0' | xargs -0 "${GREP[@]}" -e "$PATTERN" -- 2>/dev/null)"
fi
# The only allowed hit: the author's copyright line in LICENSE.txt (exact text).
hits=$(printf '%s\n' "$hits" | grep -v -x -E 'LICENSE\.txt:[0-9]+:Modifications \(Post-it Chaos\): Copyright \(c\) 2026 Nicolas Schwenger\.' | grep -v '^$')
if [ -n "$hits" ]; then echo "$hits"; fail=1; fi

# file names
names=$(git ls-files | grep -i -E 'schwenger|\.env$|\.pem$|\.bak$|\.orig$|reaktor' | grep -v -x '.env.example')
if [ -n "$names" ]; then echo "blocked file names:"; echo "$names"; fail=1; fi

# lockfile: only the public npm registry
if git ls-files --error-unmatch package-lock.json >/dev/null 2>&1; then
  bad=$(grep "\"resolved\": \"http" package-lock.json | grep -v 'https://registry.npmjs.org/')
  if [ -n "$bad" ]; then echo "package-lock.json: non-registry URLs:"; echo "$bad"; fail=1; fi
fi

if [ $fail -ne 0 ]; then echo "prepublish-scan: FAILED"; exit 1; fi
echo "prepublish-scan: OK"
