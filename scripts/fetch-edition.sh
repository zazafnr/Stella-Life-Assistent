#!/usr/bin/env bash
# Holt das Edition-Plugin (Stella for Students) aus dem Repo zazafnr/Stella-for-Students nach editions/students.
# Bewusst kein Git-Submodul: `git archive` (scripts/deploy-vps.sh) nimmt Submodule nicht mit, und ein festgepinnter Stand
# hinkt der Arbeit am Plugin immer hinterher. Stattdessen wird beim Bauen/Ausliefern geklont.
#
#   scripts/fetch-edition.sh [ZIEL]                    # Standard: editions/students
#
# Umgebung: STELLA_STUDENTS_REPO (Standard: https://github.com/zazafnr/Stella-for-Students.git),
#           STELLA_STUDENTS_REF  (Branch, Tag oder Commit; Standard: main),
#           STELLA_FETCH_STRIP_GIT=1 (.git danach löschen, für Pakete und Images).
set -euo pipefail

DEST=${1:-editions/students}
REPO=${STELLA_STUDENTS_REPO:-https://github.com/zazafnr/Stella-for-Students.git}
REF=${STELLA_STUDENTS_REF:-main}

rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
if git clone --quiet --depth 1 --branch "$REF" "$REPO" "$DEST" 2>/dev/null; then
  :
else
  # ein Commit kann nicht mit --branch geklont werden
  git clone --quiet "$REPO" "$DEST"
  git -C "$DEST" checkout --quiet "$REF"
fi
echo "Edition-Plugin: $(git -C "$DEST" rev-parse --short HEAD) ($REF) → $DEST"
[[ ${STELLA_FETCH_STRIP_GIT:-} == 1 ]] && rm -rf "$DEST/.git"
exit 0
