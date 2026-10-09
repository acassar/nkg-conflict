#!/usr/bin/env bash
# Lance chaque vérification sans s'arrêter à la première erreur.
# Écrit un log par étape dans ci-out/ et un résumé dans ci-out/status.txt.
set -u
mkdir -p ci-out
: > ci-out/status.txt
failed=0

run() {
  local name="$1"
  shift
  echo "::group::$name"
  "$@" > "ci-out/$name.log" 2>&1
  local code=$?
  cat "ci-out/$name.log"
  echo "::endgroup::"
  echo "$name $code" >> ci-out/status.txt
  if [ "$code" -ne 0 ]; then failed=1; fi
}

run format pnpm format:check
run typecheck pnpm typecheck
run test pnpm test
run build pnpm build
run simulate pnpm simulate 30
# Rapport d'équilibrage IA contre IA (ci-out/balance/report.md et report.json).
run balance pnpm balance 120 1,2,3 ci-out/balance

echo "failed $failed" >> ci-out/status.txt
cat ci-out/status.txt
exit 0
