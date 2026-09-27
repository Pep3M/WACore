#!/usr/bin/env bash
# Imprime las notas de una versión del CHANGELOG.md: scripts/changelog-notes.sh 1.5.1
set -euo pipefail
version="${1#v}"
awk -v v="$version" '
  index($0, "## [" v "]") == 1 { found = 1; next }
  found && /^## \[/ { exit }
  found { print }
' CHANGELOG.md | sed -e '/^---$/d' | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}' | sed '/./,$!d'
