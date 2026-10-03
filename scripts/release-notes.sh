#!/usr/bin/env bash
# Print the CHANGELOG.md section of one version, without its heading.
# Fails if the section is missing or empty, so a release is never published
# with empty notes.
#
# Usage: scripts/release-notes.sh 0.1.0
set -euo pipefail

version="${1:?usage: release-notes.sh <version>}"
changelog="$(dirname "${BASH_SOURCE[0]}")/../CHANGELOG.md"

notes="$(
    awk -v v="$version" '
        /^## \[/       { if (found) exit; found = (index($0, "[" v "]") == 4); next }
        /^\[[^]]+\]: / { if (found) exit }
        found          { print }
    ' "$changelog" \
        | sed '/./,$!d' \
        | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}'
)"

if [[ -z "${notes//[[:space:]]/}" ]]; then
    echo "error: no notes for version ${version} in CHANGELOG.md" >&2
    echo "add a '## [${version}] - YYYY-MM-DD' section before releasing" >&2
    exit 1
fi

printf '%s\n' "$notes"
